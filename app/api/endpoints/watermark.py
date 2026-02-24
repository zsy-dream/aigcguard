from typing import Any, List, Optional, Dict
from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException, Header, BackgroundTasks
from fastapi.responses import StreamingResponse
import urllib.parse
from fastapi.responses import JSONResponse
from jose import jwt, JWTError

from app.schema.asset import WatermarkResult, DetectionResult, Asset
from app.api.deps import get_current_active_user
from app.core.config import settings
from app.schema.user import User
from app.service.watermark import WatermarkService
from app.service.ai_assistant import AIAssistantService
from app.service.text_watermark import TextWatermarkService
from app.service.video_watermark import VideoWatermarkService
from app.service.blockchain import BlockchainService
from app.service.storage import StorageService
from app.utils.supabase import get_supabase_service_client
from fastapi.responses import FileResponse
from fastapi import Query
from pydantic import BaseModel
import os
import io
import logging
from datetime import datetime
import time

logger = logging.getLogger(__name__)

# ---- 额度查询内存缓存（批量模式下避免每张图都访问 Supabase） ----
_quota_cache: dict = {}   # {user_id: {"embed_used": int, "embed_total": int, "plan": str, "expires": float}}
_QUOTA_CACHE_TTL = 600     # 秒

# ---- 检测额度内存缓存（与 embed 对齐，避免每次检测都跨洋查库） ----
_detect_quota_cache: dict = {}  # {user_id: {"detect_used": int, "detect_total": int, "plan": str, "expires": float}}
_DETECT_QUOTA_CACHE_TTL = 600  # 秒

# ---- Token -> user_id 内存缓存（避免每次都调用 Supabase Auth /auth/v1/user） ----
_token_user_cache: dict = {}  # {token: {"user_id": str, "expires": float}}
_TOKEN_CACHE_TTL = 600  # 秒

# ---- 最近嵌入文件权限缓存（用于异步落库期间，立即支持 /api/image 预览） ----
_recent_embed_files: dict = {}  # {filename: {"user_id": str, "expires": float}}
_RECENT_EMBED_TTL = 300  # 秒


def _get_user_id_from_token_cached(token: str) -> Optional[str]:
    if not token:
        return None
    entry = _token_user_cache.get(token)
    if entry and time.time() < entry.get("expires", 0):
        return entry.get("user_id")

    try:
        from app.utils.supabase import get_supabase_client

        sb_client = get_supabase_client()
        if not sb_client:
            return None
        auth_user = sb_client.auth.get_user(token)
        uid = auth_user.user.id if auth_user and auth_user.user else None
        if uid:
            _token_user_cache[token] = {"user_id": str(uid), "expires": time.time() + _TOKEN_CACHE_TTL}
            return str(uid)
    except Exception:
        return None

    return None

def _get_quota_from_cache(user_id: str):
    entry = _quota_cache.get(user_id)
    if entry and time.time() < entry["expires"]:
        return entry
    return None

def _set_quota_cache(user_id: str, embed_used: int, embed_total: int, plan: str):
    _quota_cache[user_id] = {
        "embed_used": embed_used,
        "embed_total": embed_total,
        "plan": plan,
        "expires": time.time() + _QUOTA_CACHE_TTL,
    }

def _increment_quota_cache(user_id: str):
    entry = _quota_cache.get(user_id)
    if entry:
        entry["embed_used"] = entry.get("embed_used", 0) + 1

def _invalidate_quota_cache(user_id: str):
    """强制清除缓存，强制下一次请求重新查询 Supabase"""
    if user_id in _quota_cache:
        del _quota_cache[user_id]


# ---- 检测额度缓存操作 ----
def _get_detect_quota_from_cache(user_id: str):
    entry = _detect_quota_cache.get(user_id)
    if entry and time.time() < entry["expires"]:
        return entry
    return None

def _set_detect_quota_cache(user_id: str, detect_used: int, detect_total: int, plan: str):
    _detect_quota_cache[user_id] = {
        "detect_used": detect_used,
        "detect_total": detect_total,
        "plan": plan,
        "expires": time.time() + _DETECT_QUOTA_CACHE_TTL,
    }

def _increment_detect_quota_cache(user_id: str):
    entry = _detect_quota_cache.get(user_id)
    if entry:
        entry["detect_used"] = entry.get("detect_used", 0) + 1

def _invalidate_detect_quota_cache(user_id: str):
    """强制清除缓存，强制下一次请求重新查询 Supabase"""
    if user_id in _detect_quota_cache:
        del _detect_quota_cache[user_id]

class TextEmbedRequest(BaseModel):
    text: str
    author_name: str = ""

class TextDetectRequest(BaseModel):
    text: str

# NOTE: 从 Authorization header 中尝试获取用户，失败则返回 None (Guest)
def get_optional_user(authorization: Optional[str] = Header(None)) -> Optional[str]:
    """尝试从 Bearer token 获取用户ID，支持本地 JWT 和 Supabase JWT
    
    统一返回 Supabase UUID (sub) 作为 user_id，确保资产查询一致性
    """
    if authorization and authorization.startswith('Bearer '):
        token = authorization[len('Bearer '):]
        # 1. 尝试本地验证
        try:
            payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
            username = payload.get('sub')
            if username:
                import uuid
                # 检查是否为 UUID，如果不是说明是旧的本地 token，直接忽略
                try:
                    uuid.UUID(username)
                    return username
                except ValueError:
                    pass
        except JWTError:
            pass
            
        # 2. 尝试 Supabase Token 验证 - 优先使用 sub (UUID)
        # 通过调用 Supabase Auth API 验证 token，而不是仅解析未验证的 claims
        uid = _get_user_id_from_token_cached(token)
        if uid:
            return uid
    return None

router = APIRouter()

@router.get("/image/{filename}")
def get_image(
    filename: str,
    token: Optional[str] = Query(None),
    user_id: Optional[str] = Depends(get_optional_user),
):
    # <img> 标签无法携带 Authorization header，所以允许 token query。
    # 在 token query 模式下，使用 Supabase Auth API 验证 token 获取用户 ID
    if (not user_id or user_id == "guest") and token:
        uid = _get_user_id_from_token_cached(token)
        user_id = uid

    if not user_id or user_id == "guest":
        raise HTTPException(status_code=401, detail="请登录后下载")

    # 异步落库期间：允许刚嵌入的文件直接预览（避免 Supabase 记录尚未写入导致 404）
    entry = _recent_embed_files.get(filename)
    if entry and time.time() < entry.get("expires", 0) and entry.get("user_id") == user_id:
        file_path = os.path.join("outputs", filename)
        if not os.path.exists(file_path):
            logger.warning(f"Image not found: {filename}")
            raise HTTPException(status_code=404, detail="File not found")
        return FileResponse(
            file_path,
            filename=filename,
            content_disposition_type="attachment"
        )

    # 无论是否 token query 模式，都必须做权限校验。
    # 说明：token query 仅用于 <img> 无法携带 Authorization header 的场景。
    sb = get_supabase_service_client()
    if not sb:
        raise HTTPException(status_code=500, detail="Supabase 未配置")

    # 判断是否 admin
    user_res = sb.table("profiles").select("role").eq("id", user_id).limit(1).execute()
    is_admin = bool(user_res.data) and user_res.data[0].get("role") in ["admin", "行政"]

    # 资产归属校验（按 filename 查询）
    asset_res = sb.table("watermarked_assets").select("user_id").eq("filename", filename).limit(1).execute()
    if not asset_res.data:
        raise HTTPException(status_code=404, detail="File not found")

    owner_id = asset_res.data[0].get("user_id")
    if not is_admin and owner_id != user_id:
        raise HTTPException(status_code=403, detail="无权下载他人文件")

    # Directly read from outputs
    file_path = os.path.join("outputs", filename)
    if not os.path.exists(file_path):
        logger.warning(f"Image not found: {filename}")
        raise HTTPException(status_code=404, detail="File not found")
    
    # Force the filename in the response header to avoid UUID naming issues in some browsers
    return FileResponse(
        file_path, 
        filename=filename,
        content_disposition_type="attachment"
    )

@router.post("/embed", response_model=WatermarkResult)
def embed_watermark(
    image: UploadFile = File(...),
    strength: float = Form(0.1),
    author_name: str = Form(""),
    user_id: Optional[str] = Depends(get_optional_user),
    background_tasks: BackgroundTasks = None
) -> Any:
    if not image.filename:
         raise HTTPException(status_code=400, detail="No file selected")
    
    final_user_id = user_id if user_id else "guest"
    _cached_embed_used = 0
    _cached_embed_total = 50
    t_start = time.perf_counter()
    
    # Check Embed Quota - 优先使用内存缓存（批量嵌入时避免每张图都访问新加坡节点）
    if final_user_id != "guest":
        cached_q = _get_quota_from_cache(final_user_id)
        if cached_q:
            # 命中缓存，直接使用，跳过 Supabase 网络往返
            embed_used = cached_q["embed_used"]
            embed_total = cached_q["embed_total"]
            _cached_embed_used = embed_used
            _cached_embed_total = embed_total
            if embed_used >= embed_total:
                raise HTTPException(status_code=402, detail=f"您的嵌入额度已用完（{embed_used}/{embed_total}），请升级套餐或联系管理员。")
        else:
            # 缓存未命中，查询 Supabase
            sb = get_supabase_service_client()
            if sb:
                user_res = sb.table("profiles").select("plan, quota_embed_used, quota_embed_total, subscription_expires_at, subscription_status").eq("id", final_user_id).execute()
                if user_res.data:
                    def safe_int(val, default=0):
                        try:
                            return int(val) if val is not None else default
                        except (ValueError, TypeError):
                            return default
                    
                    user_data = user_res.data[0]
                    plan = user_data.get("plan", "free")
                    embed_total = safe_int(user_data.get("quota_embed_total"), 50)
                    embed_used = safe_int(user_data.get("quota_embed_used"), 0)
                    
                    # 检查订阅是否过期
                    from datetime import datetime
                    expires_at = user_data.get("subscription_expires_at")
                    sub_status = user_data.get("subscription_status")
                    
                    if expires_at and sub_status == 'active':
                        try:
                            expire_time = datetime.fromisoformat(expires_at.replace('Z', '+00:00'))
                            if datetime.now(expire_time.tzinfo) > expire_time:
                                sb.table("profiles").update({
                                    "plan": "free",
                                    "quota_total": 10,
                                    "quota_embed_total": 50,
                                    "quota_detect_total": 20,
                                    "subscription_status": "expired",
                                    "subscription_period": None,
                                    "subscription_expires_at": None
                                }).eq("id", final_user_id).execute()
                                plan = "free"
                                embed_total = 50
                                raise HTTPException(status_code=402, detail="您的订阅已过期，已自动降级到免费版。如需继续使用付费功能，请重新订阅。")
                        except ValueError:
                            pass
                    
                    expected_total = {"free": 50, "personal": 500, "pro": 2000, "enterprise": 9999999}.get(plan, 50)
                    if embed_total != expected_total:
                        sb.table("profiles").update({"quota_embed_total": expected_total}).eq("id", final_user_id).execute()
                        embed_total = expected_total
                    
                    # 写入缓存，后续批量请求直接命中
                    _set_quota_cache(final_user_id, embed_used, embed_total, plan)
                    
                    _cached_embed_used = embed_used
                    _cached_embed_total = embed_total
                    
                    if embed_used >= embed_total:
                        raise HTTPException(status_code=402, detail=f"您的嵌入额度已用完（{embed_used}/{embed_total}），请升级套餐或联系管理员。")
            
    t_quota = time.perf_counter()
    try:
        t0 = time.perf_counter()
        content = image.file.read()
        t_read = time.perf_counter()

        res = WatermarkService.embed_watermark(
            file_bytes=content,
            filename=image.filename,
            user_id=final_user_id,
            author_name=author_name or final_user_id,
            strength=strength
        )
        t_embed = time.perf_counter()
        
        # Save to Supabase and update quota
        if final_user_id != "guest" and res.get("success"):
            local_output_path = f"/api/image/{res.get('filename')}"
            res["download_url"] = local_output_path

            # ★ 立即注入检测缓存，确保"刚嵌入立即检测"能命中
            try:
                from app.service.enhanced_watermark import inject_asset_to_cache, invalidate_assets_cache
                inject_asset_to_cache(
                    fingerprint=str(res.get("fingerprint", "")),
                    user_id=final_user_id,
                    filename=str(res.get("filename", "")),
                )
            except Exception as e:
                print(f"[CacheInject] 注入检测缓存失败(non-fatal): {e}")

            # 异步落库期间：记录文件归属，允许立即预览
            if res.get("filename"):
                _recent_embed_files[str(res.get("filename"))] = {
                    "user_id": final_user_id,
                    "expires": time.time() + _RECENT_EMBED_TTL,
                }

            # 先用内存缓存做“乐观更新”（体感更快）；真正持久化在后台完成
            optimistic_used = _cached_embed_used + 1
            _increment_quota_cache(final_user_id)
            res["quota_embed_used"] = optimistic_used
            res["quota_embed_total"] = _cached_embed_total
            res["quota_used"] = optimistic_used
            res["quota_total"] = _cached_embed_total
            res["quota_deducted"] = True

            def _background_persist(filename: str, fingerprint: str, psnr: float):
                try:
                    sb2 = get_supabase_service_client()
                    if not sb2:
                        return

                    # 失效资产缓存，下次检测时会重新加载含新资产的列表
                    try:
                        from app.service.enhanced_watermark import invalidate_assets_cache
                        invalidate_assets_cache()
                    except Exception:
                        pass

                    # 1) 插入资产记录（先本地 URL，后续上传会更新为云端 URL）
                    insert_res = sb2.table("watermarked_assets").insert({
                        "user_id": final_user_id,
                        "filename": filename,
                        "fingerprint": fingerprint,
                        "timestamp": datetime.now().isoformat(),
                        "psnr": psnr,
                        "asset_type": "image",
                        "output_path": f"/api/image/{filename}",
                    }).execute()

                    inserted_id = None
                    try:
                        if getattr(insert_res, "data", None) and isinstance(insert_res.data, list) and insert_res.data and insert_res.data[0].get("id") is not None:
                            inserted_id = insert_res.data[0].get("id")
                    except Exception:
                        inserted_id = None

                    # 2) 扣减额度（异步）
                    try:
                        sb2.table("profiles").update({
                            "quota_embed_used": optimistic_used,
                            "quota_used": optimistic_used,
                        }).eq("id", final_user_id).execute()
                        # 持久化成功后，清除缓存，强制下一次重新查询（为了批量嵌入此时获取最新的额度）
                        _invalidate_quota_cache(final_user_id)
                    except Exception as e:
                        print(f"[Quota] Failed to update embed quota(async): {e}")

                    # 3) 上传到 Supabase Storage，并更新 output_path
                    try:
                        local_path = os.path.join("outputs", filename)
                        cloud_url = StorageService.upload_file(local_path)
                        if cloud_url and inserted_id is not None:
                            sb2.table("watermarked_assets").update({"output_path": cloud_url}).eq("id", inserted_id).execute()
                    except Exception as e:
                        print(f"Background sync failed: {e}")
                except Exception as e:
                    print(f"Background persist failed: {e}")

            if background_tasks is not None and res.get("filename") and res.get("fingerprint"):
                background_tasks.add_task(
                    _background_persist,
                    str(res.get("filename")),
                    str(res.get("fingerprint")),
                    float(res.get("psnr") or 0),
                )

            t_done = time.perf_counter()
            res["processing_time_sec"] = round(t_done - t_start, 3)
            print(
                "DEBUG: embed timings(ms) quota=%.1f read=%.1f embed=%.1f total=%.1f (persist async)"
                % (
                    (t_quota - t_start) * 1000,
                    (t_read - t0) * 1000,
                    (t_embed - t_read) * 1000,
                    (t_done - t_start) * 1000,
                )
            )

        else:
            t_done = time.perf_counter()
            res["processing_time_sec"] = round(t_done - t_start, 3)
            res["quota_deducted"] = False
            # Add current quota info even on failure
            if final_user_id != "guest":
                res["quota_embed_used"] = _cached_embed_used
                res["quota_embed_total"] = _cached_embed_total
            print(
                "DEBUG: embed timings(ms) quota=%.1f read=%.1f embed=%.1f total=%.1f"
                % (
                    (t_quota - t_start) * 1000,
                    (t_read - t0) * 1000,
                    (t_embed - t_read) * 1000,
                    (t_done - t_start) * 1000,
                )
            )
            
        return res
    except ValueError as e:
         return {
             "success": False,
             "error": "INVALID_INPUT",
             "message": str(e),
             "quota_deducted": False,
             "quota_embed_used": _cached_embed_used if final_user_id != "guest" else 0,
             "quota_embed_total": _cached_embed_total if final_user_id != "guest" else 50,
         }
    except Exception as e:
         print(f"Embed Error: {e}")
         return {
             "success": False,
             "error": "EMBED_FAILED",
             "message": f"嵌入失败: {str(e)}",
             "quota_deducted": False,
             "quota_embed_used": _cached_embed_used if final_user_id != "guest" else 0,
             "quota_embed_total": _cached_embed_total if final_user_id != "guest" else 50,
         }

from app.workers.tasks import process_watermark_batch, run_infringement_crawler
import base64

@router.post("/detect", response_model=DetectionResult)
def detect_watermark(
    image: UploadFile = File(...),
    user_id: Optional[str] = Depends(get_optional_user),
    background_tasks: BackgroundTasks = None
) -> Any:
    final_user_id = user_id if user_id else "guest"
    t_start = time.perf_counter()
    _cached_detect_used = 0
    _cached_detect_total = 20
    _cached_plan = "free"
    
    # Check Detect Quota - 优先使用内存缓存（批量检测时避免每张图都访问新加坡节点）
    if final_user_id != "guest":
        cached_dq = _get_detect_quota_from_cache(final_user_id)
        if cached_dq:
            # 命中缓存，直接使用，跳过 Supabase 网络往返
            detect_used = cached_dq["detect_used"]
            detect_total = cached_dq["detect_total"]
            _cached_detect_used = detect_used
            _cached_detect_total = detect_total
            _cached_plan = cached_dq.get("plan", "free")
            if detect_used >= detect_total:
                raise HTTPException(status_code=402, detail=f"您的检测额度已用完（{detect_used}/{detect_total}），请升级套餐或联系管理员。")
        else:
            # 缓存未命中，查询 Supabase
            sb = get_supabase_service_client()
            if sb:
                user_res = sb.table("profiles").select("plan, quota_detect_used, quota_detect_total, subscription_expires_at, subscription_status").eq("id", final_user_id).execute()
                if user_res.data:
                    user_data = user_res.data[0]
                    def safe_int(val, default=0):
                        try:
                            return int(val) if val is not None else default
                        except (ValueError, TypeError):
                            return default
                    
                    plan = user_data.get("plan", "free")
                    detect_total = safe_int(user_data.get("quota_detect_total"), 20)
                    detect_used = safe_int(user_data.get("quota_detect_used"), 0)
                    
                    # 检查订阅是否过期
                    from datetime import datetime
                    expires_at = user_data.get("subscription_expires_at")
                    sub_status = user_data.get("subscription_status")
                    
                    if expires_at and sub_status == 'active':
                        try:
                            expire_time = datetime.fromisoformat(expires_at.replace('Z', '+00:00'))
                            if datetime.now(expire_time.tzinfo) > expire_time:
                                sb.table("profiles").update({
                                    "plan": "free",
                                    "quota_total": 10,
                                    "quota_embed_total": 50,
                                    "quota_detect_total": 20,
                                    "subscription_status": "expired",
                                    "subscription_period": None,
                                    "subscription_expires_at": None
                                }).eq("id", final_user_id).execute()
                                plan = "free"
                                detect_total = 20
                                raise HTTPException(status_code=402, detail="您的订阅已过期，已自动降级到免费版。如需继续使用付费功能，请重新订阅。")
                        except ValueError:
                            pass
                    
                    expected_total = {"free": 20, "personal": 200, "pro": 1000, "enterprise": 9999999}.get(plan, 20)
                    if detect_total != expected_total:
                        sb.table("profiles").update({"quota_detect_total": expected_total}).eq("id", final_user_id).execute()
                        detect_total = expected_total
                    
                    # 写入缓存，后续批量请求直接命中
                    _set_detect_quota_cache(final_user_id, detect_used, detect_total, plan)
                    _cached_detect_used = detect_used
                    _cached_detect_total = detect_total
                    _cached_plan = plan
                    
                    if detect_used >= detect_total:
                        raise HTTPException(status_code=402, detail=f"您的检测额度已用完（{detect_used}/{detect_total}），请升级套餐或联系管理员。")
    
    t_quota = time.perf_counter()
    try:
        t0 = time.perf_counter()
        content = image.file.read()
        t_read = time.perf_counter()
        res = WatermarkService.detect_watermark(content, image.filename or "unknown")
        t_detect = time.perf_counter()
        
        # 乐观更新额度缓存（体感更快），真正持久化在后台完成
        optimistic_detect_used = _cached_detect_used + 1
        _increment_detect_quota_cache(final_user_id)
        res["quota_detect_used"] = optimistic_detect_used
        res["quota_detect_total"] = _cached_detect_total
        
        # --- [五维评分计算 - 同步计算，但区块链数据删归后台] ---
        if final_user_id != "guest":
            try:
                from app.service.report_service import ReportService
                user_plan = _cached_plan
                
                enhanced_report = ReportService.generate_enhanced_report(
                    detection_result=res,
                    image_filename=image.filename or "unknown",
                    user_plan=user_plan,
                    blockchain_data=None  # 区块链数据移到后台获取
                )
                
                if enhanced_report and enhanced_report.get("detection_summary", {}).get("five_dim_score"):
                    five_dim_score = enhanced_report["detection_summary"]["five_dim_score"]
                    res["five_dim_score"] = five_dim_score
                    res["confidence_level"] = enhanced_report["detection_summary"].get("confidence_level", "未评级")
                    res["legal_description"] = enhanced_report["detection_summary"].get("legal_description", "")
                    
                    if enhanced_report.get("visualizations"):
                        res["visualizations"] = enhanced_report["visualizations"]
                    if enhanced_report.get("legal_assessment"):
                        res["legal_assessment"] = enhanced_report["legal_assessment"]
                        
            except Exception as e:
                print(f"[FiveDimScore] Failed to calculate: {e}")
        
        # --- [额度持久化 + 检测记录辐库 → 后台任务] ---
        if final_user_id != "guest" and background_tasks is not None:
            def _background_detect_persist():
                try:
                    sb2 = get_supabase_service_client()
                    if not sb2:
                        return
                    
                    # 1) 额度持久化
                    try:
                        sb2.table("profiles").update({
                            "quota_detect_used": optimistic_detect_used
                        }).eq("id", final_user_id).execute()
                        # 持久化成功后，清除缓存，强制下一次重新查询（为了批量检测此时获取最新的额度）
                        _invalidate_detect_quota_cache(final_user_id)
                    except Exception as e:
                        print(f"[Quota] Failed to update detect quota(async): {e}")
                    
                    # 2) 检测记录落库
                    try:
                        candidates = []
                        if res.get("candidates"):
                            for c in res["candidates"]:
                                candidates.append({
                                    "id": c.get("id"),
                                    "filename": c.get("filename"),
                                    "author": c.get("author"),
                                    "similarity": c.get("similarity"),
                                    "source": c.get("source", "unknown")
                                })
                        
                        fingerprint_full = res.get("extracted_fingerprint", "")
                        fingerprint_prefix = fingerprint_full[:128] if len(fingerprint_full) > 128 else fingerprint_full
                        
                        matched_asset = None
                        best_match = res.get("best_match")
                        if best_match:
                            matched_asset = {
                                "id": best_match.get("id"),
                                "filename": best_match.get("filename"),
                                "author": best_match.get("author"),
                                "similarity": best_match.get("similarity")
                            }
                        
                        sb2.table("detection_records").insert({
                            "user_id": final_user_id,
                            "input_filename": image.filename or "unknown",
                            "has_watermark": res.get("has_watermark", False),
                            "confidence": res.get("confidence", 0),
                            "matched_asset_id": best_match.get("id") if best_match else None,
                            "matched_asset": matched_asset,
                            "candidates": candidates,
                            "fingerprint_prefix": fingerprint_prefix,
                            "metadata": {
                                "request_type": "image",
                                "processing_time_ms": round((t_detect - t_read) * 1000, 2)
                            }
                        }).execute()
                    except Exception as e:
                        print(f"[DetectionRecord] Failed to save detection record(async): {e}")
                except Exception as e:
                    print(f"Background detect persist failed: {e}")
            
            background_tasks.add_task(_background_detect_persist)
        
        t_done = time.perf_counter()
        res["processing_time_sec"] = round(t_done - t_start, 3)
        print(
            "DEBUG: detect timings(ms) quota=%.1f read=%.1f detect=%.1f total=%.1f (persist async)"
            % (
                (t_quota - t_start) * 1000,
                (t_read - t0) * 1000,
                (t_detect - t_read) * 1000,
                (t_done - t_start) * 1000,
            )
        )
        return res
    except ValueError as e:
         raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
         print(f"Detect Error: {e}")
         raise HTTPException(status_code=500, detail="Internal Server Error")

@router.post("/embed/batch")
def embed_watermark_batch(
    images: List[UploadFile] = File(...),
    strength: float = Form(0.1),
    author_name: str = Form(""),
    user_id: Optional[str] = Depends(get_optional_user)
) -> Any:
    """提交大批量水印任务进 Celery 队列"""
    final_user_id = user_id if user_id else "guest"
    
    b64_files = []
    filenames = []
    for img in images:
        content = img.file.read()
        b64_files.append(base64.b64encode(content).decode('utf-8'))
        filenames.append(img.filename)
        
    task = process_watermark_batch.delay(b64_files, filenames, final_user_id, author_name or final_user_id, strength)
    return {"message": "Batch task submitted successfully", "task_id": task.id}

@router.post("/embed/text")
def embed_text_watermark(req: TextEmbedRequest, user_id: Optional[str] = Depends(get_optional_user)):
    """AIGC 爆款文案/小说 - 零宽字符水印隐写"""
    final_user_id = user_id if user_id else "guest"
    
    # 检查订阅和额度（同图片嵌入逻辑）
    if final_user_id != "guest":
        sb = get_supabase_service_client()
        if sb:
            user_res = sb.table("profiles").select("plan, quota_embed_used, quota_embed_total, subscription_expires_at, subscription_status").eq("id", final_user_id).execute()
            if user_res.data:
                user_data = user_res.data[0]
                def safe_int(val, default=0):
                    try:
                        return int(val) if val is not None else default
                    except (ValueError, TypeError):
                        return default
                
                plan = user_data.get("plan", "free")
                embed_total = safe_int(user_data.get("quota_embed_total"), 50)
                embed_used = safe_int(user_data.get("quota_embed_used"), 0)
                
                # 检查订阅过期
                from datetime import datetime
                expires_at = user_data.get("subscription_expires_at")
                sub_status = user_data.get("subscription_status")
                
                if expires_at and sub_status == 'active':
                    try:
                        expire_time = datetime.fromisoformat(expires_at.replace('Z', '+00:00'))
                        if datetime.now(expire_time.tzinfo) > expire_time:
                            sb.table("profiles").update({
                                "plan": "free",
                                "quota_total": 10,
                                "quota_embed_total": 50,
                                "quota_detect_total": 20,
                                "subscription_status": "expired",
                                "subscription_period": None,
                                "subscription_expires_at": None
                            }).eq("id", final_user_id).execute()
                            raise HTTPException(status_code=402, detail="您的订阅已过期，已自动降级到免费版。如需继续使用付费功能，请重新订阅。")
                    except ValueError:
                        pass
                
                # 检查额度
                expected_total = {"free": 50, "personal": 500, "pro": 2000, "enterprise": 9999999}.get(plan, 50)
                if embed_total != expected_total:
                    sb.table("profiles").update({"quota_embed_total": expected_total}).eq("id", final_user_id).execute()
                    embed_total = expected_total
                
                if embed_used >= embed_total:
                    raise HTTPException(status_code=402, detail=f"您的嵌入额度已用完（{embed_used}/{embed_total}），请升级套餐或联系管理员。")
    
    timestamp = datetime.now().strftime('%Y%m%d%H%M')
    fingerprint = str(abs(hash(f"{final_user_id}_{timestamp}_{req.author_name}")) % (10**8))
    
    watermarked = TextWatermarkService.embed(req.text, fingerprint)
    
    filename = f"text_{timestamp}_{fingerprint[:8]}.txt"
    output_path = os.path.join("outputs", filename)
    os.makedirs("outputs", exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(watermarked)
        
    # Save to Supabase
    if final_user_id != "guest":
        sb = get_supabase_service_client()
        if sb:
            sb.table("watermarked_assets").insert({
                "user_id": final_user_id,
                "filename": filename,
                "fingerprint": fingerprint,
                "timestamp": datetime.now().isoformat(),
                "psnr": 0,
                "asset_type": "text",
                "output_path": f"/api/image/{filename}"
            }).execute()
            
            # 更新额度
            user_res = sb.table("profiles").select("quota_embed_used, quota_embed_total").eq("id", final_user_id).execute()
            if user_res.data:
                current_used = user_res.data[0].get("quota_embed_used", 0)
                current_total = user_res.data[0].get("quota_embed_total", 50)
                sb.table("profiles").update({
                    "quota_embed_used": current_used + 1
                }).eq("id", final_user_id).execute()
        
    return {
        "success": True,
        "fingerprint": fingerprint,
        "watermarked_text": watermarked,
        "message": "文本防搬运隐秘水印已注入并存证"
    }

@router.post("/detect/text")
def detect_text_watermark(
    req: TextDetectRequest,
    user_id: Optional[str] = Depends(get_optional_user)
):
    """检测被恶意复制的爆款文案的源头指纹"""
    final_user_id = user_id if user_id else "guest"
    
    # 检查检测额度
    if final_user_id != "guest":
        sb = get_supabase_service_client()
        if sb:
            user_res = sb.table("profiles").select("plan, quota_detect_used, quota_detect_total, subscription_expires_at, subscription_status").eq("id", final_user_id).execute()
            if user_res.data:
                user_data = user_res.data[0]
                def safe_int(val, default=0):
                    try:
                        return int(val) if val is not None else default
                    except (ValueError, TypeError):
                        return default
                
                plan = user_data.get("plan", "free")
                detect_total = safe_int(user_data.get("quota_detect_total"), 20)
                detect_used = safe_int(user_data.get("quota_detect_used"), 0)
                
                # 检查订阅过期
                from datetime import datetime
                expires_at = user_data.get("subscription_expires_at")
                sub_status = user_data.get("subscription_status")
                
                if expires_at and sub_status == 'active':
                    try:
                        expire_time = datetime.fromisoformat(expires_at.replace('Z', '+00:00'))
                        if datetime.now(expire_time.tzinfo) > expire_time:
                            sb.table("profiles").update({
                                "plan": "free",
                                "quota_total": 10,
                                "quota_embed_total": 50,
                                "quota_detect_total": 20,
                                "subscription_status": "expired",
                                "subscription_period": None,
                                "subscription_expires_at": None
                            }).eq("id", final_user_id).execute()
                            raise HTTPException(status_code=402, detail="您的订阅已过期，已自动降级到免费版。如需继续使用付费功能，请重新订阅。")
                    except ValueError:
                        pass
                
                # 根据套餐设置正确的检测额度上限
                expected_total = {"free": 20, "personal": 200, "pro": 1000, "enterprise": 9999999}.get(plan, 20)
                if detect_total != expected_total:
                    sb.table("profiles").update({"quota_detect_total": expected_total}).eq("id", final_user_id).execute()
                    detect_total = expected_total
                
                if detect_used >= detect_total:
                    raise HTTPException(status_code=402, detail=f"您的检测额度已用完（{detect_used}/{detect_total}），请升级套餐或联系管理员。")
    
    fingerprint = TextWatermarkService.extract(req.text)

    has_watermark = (fingerprint != "" and fingerprint != "No watermark found" and fingerprint != "Corrupted watermark")
    matched_asset = None
    
    if has_watermark:
        # Search Cloud Only - 使用独立查询避免 FK join 失败
        try:
            sb = get_supabase_service_client()
            if sb:
                # 第一步：按指纹精确匹配（不使用 join，避免 FK 缺失导致查询失败）
                res = sb.table('watermarked_assets').select('id, user_id, filename, fingerprint, timestamp, asset_type').eq('fingerprint', fingerprint).execute()
                
                # 第二步：如果精确匹配无结果，尝试 LIKE 模糊匹配（处理可能的前导零/格式差异）
                if not res.data:
                    res = sb.table('watermarked_assets').select('id, user_id, filename, fingerprint, timestamp, asset_type').like('fingerprint', f'%{fingerprint}%').execute()
                
                if res.data:
                    row = res.data[0]
                    # 第三步：单独查询作者名（避免 join 依赖 FK）
                    author_name = row.get('user_id', '未知')
                    try:
                        prof_res = sb.table('profiles').select('display_name').eq('id', row['user_id']).limit(1).execute()
                        if prof_res.data and prof_res.data[0].get('display_name'):
                            author_name = prof_res.data[0]['display_name']
                    except Exception:
                        pass
                    
                    matched_asset = {
                        'id': row['id'],
                        'user_id': row['user_id'],
                        'author_name': author_name,
                        'filename': row.get('filename', ''),
                        'timestamp': row.get('timestamp', ''),
                        'asset_type': row.get('asset_type', 'text'),
                        'is_cloud_record': True
                    }
                else:
                    print(f"[TextDetect] 指纹 {fingerprint} 在证据库中未找到匹配记录")
        except Exception as e:
            print(f"Text Supabase search error: {e}")
            import traceback
            traceback.print_exc()
    
    # 更新检测额度（每次检测都扣减，与图片/视频检测保持一致）
    if final_user_id != "guest":
        sb = get_supabase_service_client()
        if sb:
            try:
                user_res = sb.table("profiles").select("quota_detect_used, quota_detect_total").eq("id", final_user_id).execute()
                if user_res.data:
                    current_used = user_res.data[0].get("quota_detect_used", 0)
                    current_total = user_res.data[0].get("quota_detect_total", 20)
                    sb.table("profiles").update({
                        "quota_detect_used": current_used + 1
                    }).eq("id", final_user_id).execute()
            except Exception as e:
                print(f"Update text detect quota failed: {e}")
    
    # --- 构建解释性结论（用于前端报告展示）---
    if fingerprint == "No watermark found":
        extracted_value = ""
        method_note = "未发现零宽字符边界标记（\\u200d），未能定位到隐写片段。"
    elif fingerprint == "Corrupted watermark":
        extracted_value = ""
        method_note = "检测到零宽字符边界不完整，隐写片段可能被截断/清洗，无法可靠还原。"
    else:
        extracted_value = fingerprint
        method_note = "已定位零宽字符边界标记（\\u200d），并从 \\u200b(0)/\\u200c(1) 二进制流中还原指纹。"

    if has_watermark:
        if matched_asset:
            verdict = (
                f"检测到零宽字符隐写水印指纹：{extracted_value}。"
                f"该指纹在证据库中匹配到资产（ID: {matched_asset.get('id')}），"
                "可判定该文本高度疑似来源于已存证作品/版本。"
            )
            confidence = 0.92
            confidence_level = "高"
            legal_description = "具备明确可复现的隐藏指纹证据，适合用于溯源与维权材料。"
        else:
            verdict = (
                f"检测到零宽字符隐写水印指纹：{extracted_value}。"
                "但当前账号/证据库中未查询到对应存证记录。"
                "建议确认是否为他人作品指纹，或检查是否已将原文进行过存证（嵌入）。"
            )
            confidence = 0.75
            confidence_level = "中"
            legal_description = "检测到隐藏指纹但缺少证据库匹配项，建议结合存证记录进一步核验。"
    else:
        verdict = (
            "未检测到零宽字符隐写水印特征。"
            "若文本曾被平台清洗（去除零宽字符/格式化），可能导致水印丢失。"
            "建议：使用“文本水印嵌入/存证”重新生成带指纹版本后再传播。"
        )
        confidence = 0.0
        confidence_level = "低"
        legal_description = "未发现可复现的零宽字符隐写证据。"

    return {
        "success": True,
        "has_watermark": has_watermark,
        # 兼容：历史字段
        "extracted_fingerprint": extracted_value,
        # 前端期望字段
        "extracted_watermark": extracted_value,
        "matched_asset": matched_asset,
        "confidence": confidence,
        "confidence_level": confidence_level,
        "legal_description": legal_description,
        "analysis": {
            "verdict": verdict,
            "method": "Unicode 零宽字符隐写检测（\\u200d 边界 + \\u200b/\\u200c 编码）",
            "notes": method_note,
        },
        "message": "文本深度解析完成。" if has_watermark else "未检测到隐秘水印特征。",
    }

@router.post("/embed/video")
def embed_video_watermark(
    video: UploadFile = File(...),
    author_name: str = Form(""),
    user_id: Optional[str] = Depends(get_optional_user)
):
    """Sora/Runway AIGC 视频级盲水印嵌入"""
    final_user_id = user_id if user_id else "guest"
    
    # 检查订阅和额度
    if final_user_id != "guest":
        sb = get_supabase_service_client()
        if sb:
            user_res = sb.table("profiles").select("plan, quota_embed_used, quota_embed_total, subscription_expires_at, subscription_status").eq("id", final_user_id).execute()
            if user_res.data:
                user_data = user_res.data[0]
                def safe_int(val, default=0):
                    try:
                        return int(val) if val is not None else default
                    except (ValueError, TypeError):
                        return default
                
                plan = user_data.get("plan", "free")
                embed_total = safe_int(user_data.get("quota_embed_total"), 50)
                embed_used = safe_int(user_data.get("quota_embed_used"), 0)
                
                # 检查订阅过期
                from datetime import datetime
                expires_at = user_data.get("subscription_expires_at")
                sub_status = user_data.get("subscription_status")
                
                if expires_at and sub_status == 'active':
                    try:
                        expire_time = datetime.fromisoformat(expires_at.replace('Z', '+00:00'))
                        if datetime.now(expire_time.tzinfo) > expire_time:
                            sb.table("profiles").update({
                                "plan": "free",
                                "quota_total": 10,
                                "quota_embed_total": 50,
                                "quota_detect_total": 20,
                                "subscription_status": "expired",
                                "subscription_period": None,
                                "subscription_expires_at": None
                            }).eq("id", final_user_id).execute()
                            raise HTTPException(status_code=402, detail="您的订阅已过期，已自动降级到免费版。如需继续使用付费功能，请重新订阅。")
                    except ValueError:
                        pass
                
                # 检查额度
                expected_total = {"free": 50, "personal": 500, "pro": 2000, "enterprise": 9999999}.get(plan, 50)
                if embed_total != expected_total:
                    sb.table("profiles").update({"quota_embed_total": expected_total}).eq("id", final_user_id).execute()
                    embed_total = expected_total
                
                if embed_used >= embed_total:
                    raise HTTPException(status_code=402, detail=f"您的嵌入额度已用完（{embed_used}/{embed_total}），请升级套餐或联系管理员。")
    
    import tempfile
    
    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as in_tmp:
        in_tmp.write(video.file.read())
        in_path = in_tmp.name
        
    out_path = in_path.replace(".mp4", "_watermarked.mp4")
    
    import hashlib
    timestamp = datetime.now().strftime('%Y%m%d%H%M')
    # 使用 SHA256 生成合法的 64 字符十六进制指纹，确保 embed_dct 能正确嵌入 256 位
    fingerprint = hashlib.sha256(f"{final_user_id}:{timestamp}:{author_name}".encode()).hexdigest()
    
    try:
        res = VideoWatermarkService.embed_video(in_path, out_path, fingerprint, author_name)
        
        timestamp_full = datetime.now().strftime('%Y%m%d_%H%M%S')
        final_filename = f"video_{timestamp_full}_{fingerprint[:16]}.mp4"
        final_path = os.path.join("outputs", final_filename)
        os.makedirs("outputs", exist_ok=True)
        import shutil
        shutil.move(out_path, final_path)
        if os.path.exists(in_path): os.remove(in_path)
        
        # Save to Supabase
        if final_user_id != "guest":
            sb = get_supabase_service_client()
            if sb:
                # --- [云端同步逻辑] ---
                cloud_url = StorageService.upload_file(final_path)
                
                sb.table("watermarked_assets").insert({
                    "user_id": final_user_id,
                    "filename": final_filename,
                    "fingerprint": fingerprint,
                    "timestamp": datetime.now().isoformat(),
                    "psnr": res.get("psnr", 0),
                    "asset_type": "video",
                    "output_path": cloud_url or f"/api/image/{final_filename}"
                }).execute()
                
                # 更新额度
                user_res = sb.table("profiles").select("quota_embed_used, quota_embed_total").eq("id", final_user_id).execute()
                if user_res.data:
                    current_used = user_res.data[0].get("quota_embed_used", 0)
                    current_total = user_res.data[0].get("quota_embed_total", 50)
                    sb.table("profiles").update({
                        "quota_embed_used": current_used + 1
                    }).eq("id", final_user_id).execute()
                
                # 如果同步成功，更新下载链接
                if cloud_url:
                    res_url = cloud_url
                else:
                    res_url = f"/api/image/{final_filename}"
            
        return {
            "success": True,
            "message": "视频盲水印注入完成",
            "fingerprint_embedded": fingerprint,
            "video_stats": res,
            "download_url": res_url if 'res_url' in locals() else f"/api/image/{final_filename}"
        }
    except Exception as e:
        if os.path.exists(in_path): os.remove(in_path)
        raise HTTPException(status_code=500, detail=str(e))
        
@router.post("/detect/video")
def detect_video_watermark(
    video: UploadFile = File(...),
    user_id: Optional[str] = Depends(get_optional_user)
):
    """提取恶意搬运的短视频内的盲水印"""
    final_user_id = user_id if user_id else "guest"
    
    # 检查订阅和额度
    if final_user_id != "guest":
        sb = get_supabase_service_client()
        if sb:
            user_res = sb.table("profiles").select("plan, quota_detect_used, quota_detect_total, subscription_expires_at, subscription_status").eq("id", final_user_id).execute()
            if user_res.data:
                user_data = user_res.data[0]
                def safe_int(val, default=0):
                    try:
                        return int(val) if val is not None else default
                    except (ValueError, TypeError):
                        return default
                
                plan = user_data.get("plan", "free")
                detect_total = safe_int(user_data.get("quota_detect_total"), 20)
                detect_used = safe_int(user_data.get("quota_detect_used"), 0)
                
                # 检查订阅过期
                from datetime import datetime
                expires_at = user_data.get("subscription_expires_at")
                sub_status = user_data.get("subscription_status")
                
                if expires_at and sub_status == 'active':
                    try:
                        expire_time = datetime.fromisoformat(expires_at.replace('Z', '+00:00'))
                        if datetime.now(expire_time.tzinfo) > expire_time:
                            sb.table("profiles").update({
                                "plan": "free",
                                "quota_total": 10,
                                "quota_embed_total": 50,
                                "quota_detect_total": 20,
                                "subscription_status": "expired",
                                "subscription_period": None,
                                "subscription_expires_at": None
                            }).eq("id", final_user_id).execute()
                            raise HTTPException(status_code=402, detail="您的订阅已过期，已自动降级到免费版。如需继续使用付费功能，请重新订阅。")
                    except ValueError:
                        pass
                
                # 检查额度
                expected_total = {"free": 20, "personal": 200, "pro": 1000, "enterprise": 9999999}.get(plan, 20)
                if detect_total != expected_total:
                    sb.table("profiles").update({"quota_detect_total": expected_total}).eq("id", final_user_id).execute()
                    detect_total = expected_total
                
                if detect_used >= detect_total:
                    raise HTTPException(status_code=402, detail=f"您的检测额度已用完（{detect_used}/{detect_total}），请升级套餐或联系管理员。")
    
    import tempfile
    from algorithms.fingerprint_engine import FingerprintEngine

    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as in_tmp:
        in_tmp.write(video.file.read())
        in_path = in_tmp.name
        
    raw_res = VideoWatermarkService.detect_video(in_path)

    # 清理临时文件
    if os.path.exists(in_path):
        try:
            os.remove(in_path)
        except Exception:
            pass

    extracted_fp = raw_res.get("extracted_fingerprint", "")
    has_watermark = raw_res.get("has_watermark", False)
    matched_asset = None
    confidence = 0.0
    confidence_level = "低"
    legal_description = ""
    verdict = ""
    method_note = ""

    # --- 数据库指纹比对（与文本检测对齐） ---
    if has_watermark and extracted_fp:
        try:
            sb = get_supabase_service_client()
            if sb:
                engine = FingerprintEngine()
                # 查询所有视频资产（也包含图片，因为用的是同一套 DCT 指纹）
                assets_res = sb.table("watermarked_assets").select(
                    "id, fingerprint, user_id, filename, timestamp, asset_type"
                ).execute()
                best_sim = 0.0
                best_row = None
                for row in (assets_res.data or []):
                    db_fp = row.get("fingerprint", "")
                    if not db_fp:
                        continue
                    sim = engine.fingerprint_similarity(extracted_fp, db_fp)
                    if sim > best_sim:
                        best_sim = sim
                        best_row = row

                if best_row and best_sim >= 0.60:
                    # 查询作者名
                    author_name = best_row.get("user_id", "未知")
                    try:
                        prof_res = sb.table("profiles").select("display_name").eq("id", best_row["user_id"]).limit(1).execute()
                        if prof_res.data and prof_res.data[0].get("display_name"):
                            author_name = prof_res.data[0]["display_name"]
                    except Exception:
                        pass

                    matched_asset = {
                        "id": best_row["id"],
                        "user_id": best_row["user_id"],
                        "author_name": author_name,
                        "filename": best_row.get("filename", ""),
                        "timestamp": best_row.get("timestamp", ""),
                        "similarity": round(best_sim * 100, 2),
                        "is_cloud_record": True,
                    }
        except Exception as e:
            print(f"Video Supabase search error: {e}")

    # --- 构建解释性检测结果 ---
    if has_watermark:
        if matched_asset:
            confidence = round(matched_asset["similarity"] / 100, 4)
            confidence_level = "高" if confidence >= 0.85 else "中" if confidence >= 0.70 else "低"
            verdict = (
                f"检测到 DCT 频域盲水印指纹。"
                f"该指纹在证据库中匹配到资产（ID: {matched_asset.get('id')}），"
                f"作者: {matched_asset.get('author_name')}，"
                f"相似度: {matched_asset['similarity']}%。"
                "可判定该视频高度疑似来源于已存证作品。"
            )
            legal_description = "具备明确可复现的频域指纹证据，适合用于溯源与维权材料。"
            method_note = "已通过关键帧抽取 + DCT 频域 QIM 解调提取出 256 位指纹，并在证据库中成功匹配。"
        else:
            confidence = 0.55
            confidence_level = "中"
            verdict = (
                f"检测到 DCT 频域盲水印特征，"
                "但当前证据库中未查询到对应存证记录。"
                "建议确认是否为他人作品指纹，或检查是否已将原视频进行过存证（嵌入）。"
            )
            legal_description = "检测到隐藏指纹但缺少证据库匹配项，建议结合存证记录进一步核验。"
            method_note = "已通过关键帧抽取 + DCT 频域 QIM 解调提取指纹片段，但未在证据库中匹配到记录。"
    else:
        confidence = 0.0
        confidence_level = "低"
        verdict = (
            "未检测到 DCT 频域盲水印特征。"
            "若视频经过重编码/压缩/裁剪，可能导致水印丢失。"
            "建议：使用“视频水印嵌入/存证”重新生成带指纹版本后再传播。"
        )
        legal_description = "未发现可复现的频域盲水印证据。"
        method_note = "已对视频关键帧进行 DCT 频域扫描，未发现有效的数字指纹特征。"

    # 更新检测额度
    if final_user_id != "guest":
        sb = get_supabase_service_client()
        if sb:
            try:
                user_res = sb.table("profiles").select("quota_detect_used, quota_detect_total").eq("id", final_user_id).execute()
                if user_res.data:
                    current_used = user_res.data[0].get("quota_detect_used", 0)
                    current_total = user_res.data[0].get("quota_detect_total", 20)
                    sb.table("profiles").update({
                        "quota_detect_used": current_used + 1
                    }).eq("id", final_user_id).execute()
            except Exception as e:
                print(f"Update video detect quota failed: {e}")
    
    return {
        "success": True,
        "has_watermark": has_watermark,
        "extracted_fingerprint": extracted_fp,
        "matched_asset": matched_asset,
        "confidence": confidence,
        "confidence_level": confidence_level,
        "legal_description": legal_description,
        "analysis": {
            "verdict": verdict,
            "method": "DCT 频域盲水印检测（关键帧抽取 + QIM 解调）",
            "notes": method_note,
        },
        "message": "视频深度解析完成。" if has_watermark else "未检测到视频盲水印特征。",
        "fps": raw_res.get("fps", 0),
        "processed_seconds": raw_res.get("processed_seconds", 0),
    }

@router.post("/crawl/start")
def start_crawler(keyword: str = Query(...), user_id: Optional[str] = Depends(get_optional_user)):
    """启动全网监控爬虫任务"""
    if not user_id or user_id == "guest":
        raise HTTPException(status_code=401, detail="请登录后使用爬虫服务")
        
    task = run_infringement_crawler.delay(target_keyword=keyword, platform="all")
    return {"message": f"Crawler task for {keyword} submitted successfully.", "task_id": task.id}


@router.get("/assets", response_model=List[Asset])
def list_my_assets(
    user_id: Optional[str] = Depends(get_optional_user),
    limit: int = 100
) -> Any:
    if not user_id:
        return []

    sb = get_supabase_service_client()
    if not sb:
        raise HTTPException(status_code=500, detail="Supabase 未配置：请检查 SUPABASE_URL / SUPABASE_KEY / SUPABASE_SERVICE_ROLE_KEY")
    
    # Check if admin（user_id 应为 UUID，对应 profiles.id）
    user_res = sb.table("profiles").select("role").eq("id", user_id).execute()
    is_admin = user_res.data and user_res.data[0].get("role") in ["admin", "行政"]
    
    # Query assets - 回归私有库模式：用户仅能查看自己的存证记录
    print(f"DEBUG: Listing assets for user_id={user_id}, is_admin={is_admin}")
    
    if is_admin:
        assets_res = sb.table("watermarked_assets").select("*").order("created_at", desc=True).limit(limit).execute()
    else:
        assets_res = sb.table("watermarked_assets").select("*").eq("user_id", user_id).order("created_at", desc=True).limit(limit).execute()
    
    assets = assets_res.data or []
    print(f"DEBUG: Found {len(assets)} assets in DB")
    
    # Rename fields for frontend consistency if needed, but mainly ensure URL logic
    for a in assets:
        a['is_locked'] = False
        
        # 使用 output_path 作为主 URL
        url = a.get('output_path') or ''
        if isinstance(url, str) and url.startswith('http'):
            a['preview_url'] = url
        else:
            fname = a.get('filename', '')
            if fname:
                a['preview_url'] = f"/api/image/{urllib.parse.quote(fname)}"
            else:
                a['preview_url'] = url or ''
    return assets

@router.get("/stats", response_model=Dict[str, int])
def get_dashboard_stats(username: Optional[str] = Depends(get_optional_user)) -> Any:
    # Marketing mode for Guests
    if not username:
        return {
            "total_assets": 12589,
            "active_monitors": 56,
            "total_infringements": 124,
            "total_authors": 1205
        }

    sb = get_supabase_service_client()
    if not sb:
        return {"total_assets": 0, "active_monitors": 0, "total_infringements": 0, "total_authors": 1}
    
    # Check if admin - 使用 id (UUID) 查询
    user_res = sb.table("profiles").select("role").eq("id", username).execute()
    is_admin = user_res.data and user_res.data[0].get("role") in ["admin", "行政"]
    
    if is_admin:
        # Get real stats from Supabase
        assets_res = sb.table("watermarked_assets").select("id", count="exact").execute()
        users_res = sb.table("profiles").select("id", count="exact").execute()
        return {
            "total_assets": getattr(assets_res, 'count', 0),
            "active_monitors": 12,
            "total_infringements": 0,
            "total_authors": getattr(users_res, 'count', 0)
        }
    else:
        # User stats - 使用 id (UUID) 查询
        user_assets = sb.table("watermarked_assets").select("id").eq("user_id", username).execute()
        return {
            "total_assets": len(user_assets.data or []),
            "active_monitors": 1,
            "total_infringements": 0,
            "total_authors": 1
        }

@router.get("/activity", response_model=List[Dict])
def get_recent_activity(username: Optional[str] = Depends(get_optional_user)):
    sb = get_supabase_service_client()
    if not sb:
        return []
    
    is_admin = False
    if username:
        # 使用 id (UUID) 查询 profiles 表
        user_res = sb.table("profiles").select("role").eq("id", username).execute()
        is_admin = user_res.data and user_res.data[0].get("role") in ["admin", "行政"]
    
    assets_res = (
        sb.table("watermarked_assets")
        .select("id, user_id, filename, fingerprint, asset_type, timestamp, created_at, output_path")
        .order("created_at", desc=True)
        .limit(10)
        .execute()
    )
    
    assets = assets_res.data or []
    for a in assets:
        # 第一页 Dashboard 权限区分逻辑：
        # 只有资产的拥有者或者是管理员，才能看到非锁定内容
        if username and (is_admin or a.get('user_id') == username):
            a['is_locked'] = False
        else:
            # 其他人的数据在第一页显示为锁定/加密状态
            a['is_locked'] = True
            
        url = a.get('output_path') or ''
        if isinstance(url, str) and url.startswith('http'):
            a['preview_url'] = url
        else:
            fname = a.get('filename', '')
            if fname:
                a['preview_url'] = f"/api/image/{urllib.parse.quote(fname)}"
            else:
                a['preview_url'] = url or ''
    
    # 始终添加模拟数据以增强“全网监测”氛围
    if len(assets) < 15:
        import random
        from datetime import datetime, timedelta
        fake_assets = []
        current_time = datetime.now()
        user_pool = ["u8821***", "art_flow***", "pixel_ma***"]
        
        for i in range(10 - len(assets)):
            fake_assets.append({
                "id": f"fake_{i}",
                "filename": "私密资产_" + datetime.now().strftime('%H%M%S'),
                "user_id": random.choice(user_pool),
                "timestamp": (current_time - timedelta(minutes=random.randint(2, 300))).strftime("%Y-%m-%d %H:%M:%S"),
                "fingerprint": "hash_" + os.urandom(8).hex()[:12] + "...",
                "preview_url": "", 
                "is_locked": True,
                "asset_type": "image"
            })
        assets = assets + fake_assets
    
    return assets


@router.get("/detection/my-records")
def get_my_detection_records(
    limit: int = Query(50, ge=1, le=500),
    user_id: Optional[str] = Depends(get_optional_user),
):
    """获取当前用户的检测记录（用于前端检测记录同步）"""
    if not user_id:
        raise HTTPException(status_code=401, detail="请先登录")

    sb = get_supabase_service_client()
    if not sb:
        raise HTTPException(status_code=500, detail="数据库未配置")

    try:
        res = (
            sb.table("detection_records")
            .select(
                "id, user_id, created_at, input_filename, has_watermark, confidence, matched_asset_id, matched_asset, candidates, fingerprint_prefix, metadata"
            )
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )

        return {
            "success": True,
            "records": res.data or [],
        }
    except Exception as e:
        logger.error(f"获取 detection_records 失败: {e}")
        raise HTTPException(status_code=500, detail="获取检测记录失败")

class DMCARequest(BaseModel):
    asset_id: int | str
    infringing_url: str
    similarity: float | None = None
    tx_hash: str | None = None
    block_height: str | int | None = None
    evidence_points: list[str] | None = None

@router.post("/dmca/generate")
async def generate_dmca_notice(req: DMCARequest, user_id: Optional[str] = Depends(get_optional_user)):
    """利用 DeepSeek 大模型一键生成维权律师函
    
    改进了参数验证和错误处理
    """
    # 用户认证
    if not user_id:
        raise HTTPException(status_code=401, detail="请先登录")
    
    # 数据库霣耀
    sb = get_supabase_service_client()
    if not sb:
        raise HTTPException(status_code=500, detail="数据库未配置")
    
    # 参数校验：资产ID
    if not req.asset_id:
        raise HTTPException(
            status_code=400, 
            detail="缺少asset_id，无法疲分该资产的所有人和作品会号。请使用正确的资产ID。"
        )
    
    # 参数校验：侵权网站URL
    if not req.infringing_url or not isinstance(req.infringing_url, str) or len(req.infringing_url.strip()) == 0:
        raise HTTPException(
            status_code=400, 
            detail="侵权网站URL为必填项。请填入侵权内容所在的完整确切位置URL，有效的源位置信息有助于平台准确下架。"
        )
    
    # 查询类资产
    try:
        asset_res = sb.table("watermarked_assets").select("*").eq("id", req.asset_id).execute()
    except Exception as e:
        logger.error(f"[DMCA] 查询资产失败: {e}")
        raise HTTPException(
            status_code=500, 
            detail="数据库查询失败，请稍后重试。"
        )
    
    if not asset_res.data:
        raise HTTPException(
            status_code=404, 
            detail="未找到该asset_id对应的资产记录，你的资产可能丢失或无效。你可以：\n1. 检查你是否已经注册并为资产添加了数字指纹\n2. 分享你的资产ID（例如112358）给我们。"
        )
    
    asset = asset_res.data[0]
    
    # 管理员检查
    try:
        user_res = sb.table("profiles").select("role").eq("id", user_id).execute()
        is_admin = user_res.data and user_res.data[0].get("role") in ["admin", "行政"]
    except Exception as e:
        logger.error(f"[DMCA] 检查管理员管失败: {e}")
        is_admin = False
    
    # 权限检查
    if asset['user_id'] != user_id and not is_admin:
        raise HTTPException(
            status_code=403, 
            detail="你不是该资产的所有者，无权为其生成DMCA下架法律文书。\n可以呼吁资产所有者的账户登录后听取你的扩展信息。"
        )
    
    # 资产信息提取
    author_name = asset.get('author_name') or asset.get('user_id') or '作者'
    asset_name = asset.get('filename') or f"resource_{asset.get('id')}"
    tx_hash = req.tx_hash or asset.get('tx_hash')
    block_height = req.block_height or asset.get('block_height')
    
    # 缺少区块链信息的惊憧
    if not tx_hash:
        logger.warning(f"[DMCA] 资产{req.asset_id}缺少区块链 TxHash，将散发有效限可能陋减")
    
    try:
        # 备份参数
        if not req.evidence_points:
            req.evidence_points = []
        
        # 调用AI服务生成DMCA法律文书
        notice_text = await AIAssistantService.generate_takedown_notice(
            author_name=author_name,
            asset_name=asset_name,
            infringing_url=req.infringing_url.strip(),
            similarity=req.similarity,
            tx_hash=tx_hash,
            block_height=block_height,
            evidence_points=req.evidence_points or [],
        )
        
        if not notice_text or len(notice_text.strip()) == 0:
            raise ValueError("生成法律文书为null或空白")
        
        logger.info(f"[DMCA] 成功为用户{user_id}的资产{req.asset_id}生成了DMCA文书")
        
        return {
            "success": True,
            "notice_text": notice_text,
            "metadata": {
                "asset_id": req.asset_id,
                "asset_name": asset_name,
                "author_name": author_name,
                "generated_at": datetime.now().isoformat(),
                "has_blockchain_proof": bool(tx_hash)
            }
        }
    
    except ValueError as ve:
        logger.error(f"[DMCA] 参数校验失败: {ve}")
        raise HTTPException(
            status_code=400, 
            detail=f"准备失败: {str(ve)} - 提供以下信息将帮助: 侵权网站URL, 相似度或置信度, 法律依据."
        )
    
    except Exception as e:
        logger.error(f"[DMCA] 生成失败: {e}", exc_info=True)
        raise HTTPException(
            status_code=500, 
            detail=f"生成DMCA下架法律文书失败: {str(e)[:100]} - 可能原因: AI服务暂時無法使用、网路問題或参數格式不正確。"
        )

@router.post("/anchor/{asset_id}")
def anchor_asset(asset_id: str, user_id: Optional[str] = Depends(get_optional_user)):
    """区块链存证上链"""
    if not user_id:
        raise HTTPException(status_code=401, detail="Please login first")
    
    sb = get_supabase_service_client()
    if not sb:
        raise HTTPException(status_code=500, detail="Database not configured")
    
    asset_res = sb.table("watermarked_assets").select("*").eq("id", asset_id).execute()
    if not asset_res.data:
        raise HTTPException(status_code=404, detail="Asset not found")
    
    asset = asset_res.data[0]
    
    # Check if admin - 使用 id (UUID) 查询
    user_res = sb.table("profiles").select("role").eq("id", user_id).execute()
    is_admin = user_res.data and user_res.data[0].get("role") in ["admin", "行政"]
    
    if asset['user_id'] != user_id and not is_admin:
        raise HTTPException(status_code=403, detail="Forbidden")
    
    if asset.get('tx_hash'):
        return {"message": "Already anchored", "tx_hash": asset['tx_hash'], "block_height": asset['block_height']}
    
    # Blockchain anchoring
    chain_res = BlockchainService.anchor_evidence(
        fingerprint=asset['fingerprint'],
        asset_id=asset_id,
        user_id=user_id
    )
    
    # Update Supabase with blockchain info
    sb.table("watermarked_assets").update({
        "tx_hash": chain_res["tx_hash"],
        "block_height": chain_res["block_height"]
    }).eq("id", asset_id).execute()
    
    return {
        "message": "数字指纹已成功存证至区块链节点",
        "tx_hash": chain_res["tx_hash"],
        "block_height": chain_res["block_height"],
        "channel": chain_res["channel"]
    }


# ==================== 检测报告导出功能 ====================

from pydantic import BaseModel
from typing import Literal

class GenerateReportRequest(BaseModel):
    """生成检测报告请求"""
    detection_result: dict  # 检测结果数据
    image_filename: str
    report_format: Literal["json", "markdown", "ai_analysis"] = "markdown"
    include_ai_analysis: bool = True

class ReportExportRequest(BaseModel):
    """导出报告请求"""
    report_id: str
    export_format: Literal["json", "markdown", "html", "pdf"] = "markdown"
    markdown_content: str | None = None
    file_name: str | None = None
    report_data: Dict[str, Any] | None = None  # 完整报告数据（用于增强版PDF生成）


@router.post("/report/generate")
async def generate_detection_report(
    req: GenerateReportRequest,
    user_id: Optional[str] = Depends(get_optional_user)
):
    """
    生成数字指纹检测报告
    
    支持三种格式：
    - json: 结构化JSON数据
    - markdown: Markdown格式报告
    - ai_analysis: DeepSeek AI生成的专业分析报告
    """
    if not user_id:
        raise HTTPException(status_code=401, detail="请登录后使用报告生成功能")
    
    try:
        from app.service.report_service import ReportService

        # 获取用户信息以检查套餐等级（AI 报告：个人版及以上）
        sb = get_supabase_service_client()
        user_plan = "free"
        user_role = "user"
        if sb:
            try:
                user_res = sb.table("profiles").select("plan, role").eq("id", user_id).execute()
                if user_res.data:
                    user_plan = user_res.data[0].get("plan", "free")
                    user_role = user_res.data[0].get("role", "user")
            except Exception:
                pass
        
        if req.report_format == "ai_analysis":
            if user_role != "admin" and user_plan not in ["personal", "pro", "enterprise"]:
                raise HTTPException(status_code=403, detail="AI 分析报告仅对个人版及以上用户开放，请升级套餐后使用。")
            # 调用DeepSeek生成AI分析报告
            ai_report = await ReportService.generate_ai_analysis_report(
                detection_result=req.detection_result,
                image_filename=req.image_filename
            )
            return {
                "success": True,
                "report_type": "ai_analysis",
                "report_format": "markdown",
                "content": ai_report,
                "generated_at": datetime.now().isoformat(),
                "note": "本报告由DeepSeek AI大模型基于检测数据生成"
            }
        
        else:
            # 生成结构化报告
            structured_report = ReportService.generate_structured_report(
                detection_result=req.detection_result,
                image_filename=req.image_filename,
                format=req.report_format
            )
            
            if req.report_format == "markdown":
                return {
                    "success": True,
                    "report_type": "structured",
                    "report_format": "markdown",
                    "content": structured_report.get("markdown_content", ""),
                    "structured_data": structured_report,
                    "generated_at": datetime.now().isoformat()
                }
            else:
                return {
                    "success": True,
                    "report_type": "structured",
                    "report_format": "json",
                    "data": structured_report,
                    "generated_at": datetime.now().isoformat()
                }
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"报告生成失败: {e}")
        raise HTTPException(status_code=500, detail=f"报告生成失败: {str(e)}")


@router.post("/detect-with-report")
async def detect_watermark_with_report(
    image: UploadFile = File(...),
    generate_report: bool = Form(True),
    report_format: str = Form("markdown"),
    user_id: Optional[str] = Depends(get_optional_user)
):
    """
    检测水印并自动生成报告（一站式接口）
    
    先执行检测，然后自动生成分析报告
    """
    try:
        content = image.file.read()
        
        # 1. 执行水印检测
        detection_result = WatermarkService.detect_watermark(content, image.filename or "unknown")
        
        response = {
            "success": True,
            "detection": detection_result,
        }
        
        # 2. 如果请求生成报告
        if generate_report and detection_result.get("success"):
            try:
                from app.service.report_service import ReportService
                
                if report_format == "ai":
                    # AI分析报告
                    ai_report = await ReportService.generate_ai_analysis_report(
                        detection_result=detection_result,
                        image_filename=image.filename
                    )
                    response["report"] = {
                        "type": "ai_analysis",
                        "format": "markdown",
                        "content": ai_report
                    }
                else:
                    # 结构化报告
                    structured_report = ReportService.generate_structured_report(
                        detection_result=detection_result,
                        image_filename=image.filename,
                        format=report_format
                    )
                    response["report"] = {
                        "type": "structured",
                        "format": report_format,
                        "data": structured_report
                    }
                    if report_format == "markdown":
                        response["report"]["content"] = structured_report.get("markdown_content", "")
                
            except Exception as e:
                logger.error(f"自动报告生成失败: {e}")
                response["report_error"] = f"报告生成失败: {str(e)}"
        
        return response
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"检测+报告失败: {e}")
        raise HTTPException(status_code=500, detail="检测和报告生成失败")


@router.post("/report/export")
async def export_report(
    req: ReportExportRequest,
    user_id: Optional[str] = Depends(get_optional_user)
):
    """
    导出检测报告（支持 Markdown、JSON、增强版 PDF）
    
    - PDF 导出包含五维评分雷达图、比特热力图等可视化
    - 专业版及以上用户可使用增强 PDF 功能
    """
    if not user_id:
        raise HTTPException(status_code=401, detail="请登录后使用")
    
    # 获取用户信息以检查套餐等级
    sb = get_supabase_service_client()
    user_plan = "free"
    user_role = "user"
    if sb:
        try:
            user_res = sb.table("profiles").select("plan, role").eq("id", user_id).execute()
            if user_res.data:
                user_plan = user_res.data[0].get("plan", "free")
                user_role = user_res.data[0].get("role", "user")
        except:
            pass

    # 多格式导出权限：个人版及以上（管理员不受限）
    if user_role != "admin" and req.export_format in ["pdf", "html"]:
        if user_plan not in ["personal", "pro", "enterprise"]:
            raise HTTPException(status_code=403, detail="该导出格式仅对个人版及以上用户开放，请升级套餐后使用。")
    
    if req.export_format == "json":
        # 返回结构化报告数据
        return {
            "success": True,
            "message": "报告数据",
            "report_id": req.report_id,
            "data": req.markdown_content  # 实际应该从数据库查询
        }
    
    if req.export_format == "markdown":
        # 直接返回 Markdown 内容
        if not req.markdown_content:
            raise HTTPException(status_code=400, detail="缺少 markdown_content")
        
        buf = io.BytesIO()
        buf.write(req.markdown_content.encode('utf-8'))
        buf.seek(0)
        
        download_name = req.file_name or f"AIGC_Report_{req.report_id}.md"
        headers = {"Content-Disposition": f"attachment; filename=\"{download_name}\""}
        return StreamingResponse(buf, media_type="text/markdown; charset=utf-8", headers=headers)

    if req.export_format == "html":
        # 将 Markdown 内容导出为 HTML 文件（自包含，便于直接打开/发给律师）
        if not req.markdown_content:
            raise HTTPException(status_code=400, detail="缺少 markdown_content")

        import html as _html
        import re as _re

        def _md_to_html(md: str) -> str:
            """将 Markdown 转换为带样式的 HTML，覆盖标题/列表/粗体/代码块/表格/段落"""
            lines = md.replace("\r\n", "\n").split("\n")
            out: list[str] = []
            in_code = False
            in_ul = False
            in_ol = False
            in_table = False
            table_rows: list[list[str]] = []

            def _inline(s: str) -> str:
                """处理行内格式：粗体、斜体、行内代码"""
                s = _html.escape(s)
                s = _re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', s)
                s = _re.sub(r'\*(.+?)\*', r'<em>\1</em>', s)
                s = _re.sub(r'`([^`]+)`', r'<code class="inline-code">\1</code>', s)
                return s

            def _close_list():
                nonlocal in_ul, in_ol
                if in_ul:
                    out.append('</ul>')
                    in_ul = False
                if in_ol:
                    out.append('</ol>')
                    in_ol = False

            def _flush_table():
                nonlocal in_table, table_rows
                if not in_table:
                    return
                html = '<table class="report-table">'
                for ri, cells in enumerate(table_rows):
                    tag = 'th' if ri == 0 else 'td'
                    html += '<tr>' + ''.join(f'<{tag}>{_inline(c)}</{tag}>' for c in cells) + '</tr>'
                html += '</table>'
                out.append(html)
                in_table = False
                table_rows = []

            for line in lines:
                # === 代码块 ===
                if line.strip().startswith('```'):
                    if in_code:
                        out.append('</code></pre>')
                        in_code = False
                    else:
                        _close_list()
                        _flush_table()
                        in_code = True
                        out.append('<pre class="code-block"><code>')
                    continue
                if in_code:
                    out.append(_html.escape(line))
                    continue

                # === 表格行 ===
                stripped = line.strip()
                if stripped.startswith('|') and stripped.endswith('|'):
                    _close_list()
                    if not in_table:
                        in_table = True
                        table_rows = []
                    if _re.match(r'^\|[\s\-:|]+\|$', stripped):
                        continue  # 分隔行
                    cells = [c.strip() for c in stripped.split('|')[1:-1]]
                    table_rows.append(cells)
                    continue
                elif in_table:
                    _flush_table()

                # === 空行 ===
                if stripped == '':
                    _close_list()
                    out.append('<div class="spacer"></div>')
                    continue

                # === 标题 ===
                hm = _re.match(r'^(#{1,6})\s+(.+)$', line)
                if hm:
                    _close_list()
                    lvl = len(hm.group(1))
                    out.append(f'<h{lvl} class="heading-{lvl}">{_inline(hm.group(2))}</h{lvl}>')
                    continue

                # === 无序列表 ===
                ulm = _re.match(r'^\s*[-*]\s+(.+)$', line)
                if ulm:
                    if in_ol:
                        out.append('</ol>')
                        in_ol = False
                    if not in_ul:
                        out.append('<ul class="report-list">')
                        in_ul = True
                    out.append(f'<li>{_inline(ulm.group(1))}</li>')
                    continue

                # === 有序列表 ===
                olm = _re.match(r'^\s*\d+[.)\s]\s*(.+)$', line)
                if olm:
                    if in_ul:
                        out.append('</ul>')
                        in_ul = False
                    if not in_ol:
                        out.append('<ol class="report-ol">')
                        in_ol = True
                    out.append(f'<li>{_inline(olm.group(1))}</li>')
                    continue

                _close_list()

                # === 分隔线 ===
                if _re.match(r'^---+$', stripped):
                    out.append('<hr class="divider">')
                    continue

                # === 普通段落 ===
                out.append(f'<p class="paragraph">{_inline(line)}</p>')

            _close_list()
            _flush_table()
            if in_code:
                out.append('</code></pre>')
            return '\n'.join(out)

        body_html = _md_to_html(req.markdown_content)
        gen_time = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        report_id_escaped = _html.escape(str(req.report_id))
        html_doc = f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AIGC Report {report_id_escaped}</title>
  <style>
    * {{ margin: 0; padding: 0; box-sizing: border-box; }}
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif; margin: 0; padding: 0; color: #1e293b; background: #f8fafc; }}
    .report-wrapper {{ max-width: 900px; margin: 0 auto; padding: 40px 48px; background: #ffffff; min-height: 100vh; box-shadow: 0 0 30px rgba(0,0,0,0.06); }}
    .report-header {{ text-align: center; padding: 24px 0 20px; border-bottom: 3px solid #6366f1; margin-bottom: 30px; }}
    .report-header h1 {{ font-size: 22px; color: #1e1b4b; margin: 0 0 8px; font-weight: 800; }}
    .report-header .meta {{ font-size: 11px; color: #94a3b8; }}
    /* 标题层级 */
    .heading-1 {{ font-size: 20px; color: #1e1b4b; border-bottom: 2px solid #6366f1; padding-bottom: 8px; margin: 28px 0 14px; font-weight: 700; }}
    .heading-2 {{ font-size: 16px; color: #312e81; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; margin: 22px 0 10px; font-weight: 700; }}
    .heading-3 {{ font-size: 14px; color: #4338ca; margin: 18px 0 8px; font-weight: 600; }}
    .heading-4, .heading-5, .heading-6 {{ font-size: 13px; color: #4f46e5; margin: 14px 0 6px; font-weight: 600; }}
    /* 段落 */
    .paragraph {{ margin: 8px 0; line-height: 1.8; color: #334155; text-align: justify; word-break: break-all; }}
    .spacer {{ height: 10px; }}
    /* 列表 */
    .report-list {{ margin: 10px 0 10px 24px; padding: 0; list-style: disc; color: #475569; }}
    .report-list li {{ margin: 5px 0; line-height: 1.7; }}
    .report-ol {{ margin: 10px 0 10px 24px; padding: 0; list-style: decimal; color: #475569; }}
    .report-ol li {{ margin: 5px 0; line-height: 1.7; }}
    /* 表格 */
    .report-table {{ border-collapse: collapse; width: 100%; margin: 16px 0; font-size: 13px; }}
    .report-table th {{ background: #f1f5f9; font-weight: 700; color: #1e293b; border: 1px solid #cbd5e1; padding: 10px 12px; text-align: left; }}
    .report-table td {{ border: 1px solid #e2e8f0; padding: 8px 12px; color: #475569; }}
    .report-table tr:nth-child(even) td {{ background: #f8fafc; }}
    /* 代码 */
    .inline-code {{ background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-family: 'Courier New', Consolas, monospace; font-size: 12px; color: #7c3aed; }}
    .code-block {{ background: #1e293b; border-radius: 8px; padding: 14px 18px; overflow-x: auto; font-size: 12px; line-height: 1.6; margin: 12px 0; color: #e2e8f0; white-space: pre-wrap; word-break: break-all; }}
    .code-block code {{ font-family: 'Courier New', Consolas, monospace; color: #e2e8f0; background: transparent; padding: 0; }}
    /* 分隔线 */
    .divider {{ border: none; border-top: 1px solid #e5e7eb; margin: 18px 0; }}
    /* 粗体 */
    strong {{ color: #1e1b4b; font-weight: 700; }}
    /* 页脚 */
    .report-footer {{ margin-top: 36px; padding-top: 14px; border-top: 2px solid #6366f1; text-align: center; font-size: 11px; color: #94a3b8; }}
    @media print {{
      body {{ background: white; }}
      .report-wrapper {{ box-shadow: none; padding: 20px; }}
    }}
  </style>
</head>
<body>
  <div class="report-wrapper">
    <div class="report-header">
      <h1>AIGC Guard 检测分析报告</h1>
      <div class="meta">导出时间：{gen_time} · 报告ID：{report_id_escaped} · AIGC-Guard v1.0</div>
    </div>
    {body_html}
    <div class="report-footer">
      <p>本报告由 AIGC Guard 数字内容指纹嵌入与侵权全网监测平台自动生成</p>
      <p>报告仅供参考，最终法律效力以司法机关认定为准 · © {datetime.now().year} AIGC Guard</p>
    </div>
  </div>
</body>
</html>"""

        buf = io.BytesIO()
        buf.write(html_doc.encode("utf-8"))
        buf.seek(0)

        download_name = req.file_name or f"AIGC_Report_{req.report_id}.html"
        headers = {"Content-Disposition": f"attachment; filename=\"{download_name}\""}
        return StreamingResponse(buf, media_type="text/html; charset=utf-8", headers=headers)
    
    if req.export_format == "pdf":
        # 增强版 PDF 导出（含可视化图表）
        try:
            from app.service.pdf_report_service import PDFReportService
            
            # 构建报告数据结构
            # 如果提供了完整的报告数据，直接使用；否则构建简化版
            if req.report_data:
                report_data = req.report_data
            else:
                # 从 markdown_content 构建基础报告结构
                report_data = {
                    "report_meta": {
                        "report_id": req.report_id,
                        "generated_at": datetime.now().isoformat(),
                        "user_plan": user_plan
                    },
                    "detection_summary": {
                        "target_file": req.file_name or "unknown",
                        "export_format": "pdf"
                    }
                }
            
            # 使用增强版 PDF 生成服务
            pdf_content = await PDFReportService.generate_enhanced_pdf_report(report_data)
            
            download_name = req.file_name or f"AIGC_Detection_Report_{req.report_id}.pdf"
            headers = {"Content-Disposition": f"attachment; filename=\"{download_name}\""}
            
            return StreamingResponse(
                io.BytesIO(pdf_content), 
                media_type="application/pdf", 
                headers=headers
            )
            
        except ImportError as e:
            logger.warning(f"增强版 PDF 服务不可用: {e}，回退到基础版")
            
            # 回退到基础版 PDF 生成（支持中文字体）
            if not req.markdown_content:
                raise HTTPException(status_code=400, detail="缺少 markdown_content，无法导出 PDF")
            
            try:
                from reportlab.lib.pagesizes import A4
                from reportlab.pdfgen import canvas
                from reportlab.pdfbase import pdfmetrics
                from reportlab.pdfbase.ttfonts import TTFont
                import os
                
                buf = io.BytesIO()
                c = canvas.Canvas(buf, pagesize=A4)
                width, height = A4
                x, y = 40, height - 50
                line_height = 18
                
                # 尝试注册中文字体（支持SimSun或Source Han Sans）
                font_name = 'Helvetica'
                try:
                    # 尝试使用系统字体
                    font_paths = [
                        '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',  # Linux
                        '/System/Library/Fonts/PingFang.ttc',  # macOS
                        'C:\\Windows\\Fonts\\simhei.ttf',  # Windows SimHei
                        'C:\\Windows\\Fonts\\simsun.ttc',  # Windows SimSun
                    ]
                    
                    font_registered = False
                    for font_path in font_paths:
                        if os.path.exists(font_path):
                            try:
                                pdfmetrics.registerFont(TTFont('CNFont', font_path))
                                font_name = 'CNFont'
                                font_registered = True
                                logger.info(f"成功注册中文字体: {font_path}")
                                break
                            except Exception as e:
                                logger.debug(f"字体注册失败 {font_path}: {e}")
                                continue
                    
                    if not font_registered:
                        logger.warning("未找到中文字体，将使用Helvetica渲染")
                        font_name = 'Helvetica'
                
                except Exception as e:
                    logger.warning(f"中文字体配置失败: {e}，回退到Helvetica")
                    font_name = 'Helvetica'
                
                import re as _pdf_re
                
                # 封面标题
                c.setFont(font_name, 18)
                c.drawCentredString(width / 2, y, 'AIGC Guard 检测分析报告')
                y -= 24
                c.setFont(font_name, 9)
                c.setFillColorRGB(0.58, 0.64, 0.70)  # gray
                c.drawCentredString(width / 2, y, f'报告ID: {req.report_id[:16] if req.report_id else "N/A"} | 生成时间: {datetime.now().strftime("%Y-%m-%d %H:%M")}')
                c.setFillColorRGB(0, 0, 0)
                y -= 10
                # 分隔线
                c.setStrokeColorRGB(0.39, 0.40, 0.95)  # indigo
                c.setLineWidth(2)
                c.line(x, y, width - 40, y)
                c.setStrokeColorRGB(0, 0, 0)
                c.setLineWidth(1)
                y -= 24
                
                base_font_size = 10
                base_line_height = 16
                max_chars = 80  # 每行最大字符数
                
                def _new_page():
                    nonlocal y
                    c.showPage()
                    y = height - 50
                    c.setFont(font_name, base_font_size)
                
                def _check_page(needed=20):
                    if y <= needed + 40:
                        _new_page()
                
                in_code_block = False
                
                for raw_line in (req.markdown_content or "").splitlines():
                    # 代码块标记
                    if raw_line.strip().startswith('```'):
                        in_code_block = not in_code_block
                        if in_code_block:
                            y -= 4
                        continue
                    
                    if in_code_block:
                        _check_page()
                        c.setFont(font_name, 9)
                        c.setFillColorRGB(0.30, 0.30, 0.35)
                        display = raw_line[:max_chars]
                        c.drawString(x + 12, y, display)
                        c.setFillColorRGB(0, 0, 0)
                        y -= 14
                        continue
                    
                    # 空行
                    if raw_line.strip() == '':
                        y -= 8
                        continue
                    
                    # 分隔线
                    if _pdf_re.match(r'^---+$', raw_line.strip()):
                        _check_page()
                        c.setStrokeColorRGB(0.88, 0.91, 0.94)
                        c.line(x, y, width - 40, y)
                        c.setStrokeColorRGB(0, 0, 0)
                        y -= 12
                        continue
                    
                    # 标题
                    hm = _pdf_re.match(r'^(#{1,6})\s+(.+)$', raw_line)
                    if hm:
                        lvl = len(hm.group(1))
                        display = hm.group(2).replace('**', '').strip()
                        sizes = {1: 16, 2: 14, 3: 12, 4: 11, 5: 11, 6: 10}
                        font_size = sizes.get(lvl, 10)
                        _check_page(font_size + 10)
                        y -= 6  # 标题前间距
                        c.setFont(font_name, font_size)
                        if lvl <= 2:
                            c.setFillColorRGB(0.12, 0.11, 0.29)  # #1e1b4b
                        else:
                            c.setFillColorRGB(0.26, 0.22, 0.79)  # #4338ca
                        # 自动换行
                        char_limit = int(max_chars * (base_font_size / font_size))
                        for i in range(0, len(display), char_limit):
                            _check_page()
                            c.drawString(x, y, display[i:i+char_limit])
                            y -= font_size + 4
                        # 标题下划线（仅 h1, h2）
                        if lvl <= 2:
                            c.setStrokeColorRGB(0.39, 0.40, 0.95)
                            c.setLineWidth(0.5 if lvl == 2 else 1)
                            c.line(x, y + 2, width - 40, y + 2)
                            c.setStrokeColorRGB(0, 0, 0)
                            c.setLineWidth(1)
                        c.setFillColorRGB(0, 0, 0)
                        y -= 4
                        c.setFont(font_name, base_font_size)
                        continue
                    
                    # 列表项
                    lm = _pdf_re.match(r'^\s*[-*]\s+(.+)$', raw_line)
                    if lm:
                        display = lm.group(1).replace('**', '').strip()
                        _check_page()
                        c.setFont(font_name, base_font_size)
                        c.drawString(x + 12, y, '•  ' + display[:max_chars - 4])
                        y -= base_line_height
                        continue
                    
                    olm = _pdf_re.match(r'^\s*(\d+)[.)\s]\s*(.+)$', raw_line)
                    if olm:
                        num = olm.group(1)
                        display = olm.group(2).replace('**', '').strip()
                        _check_page()
                        c.setFont(font_name, base_font_size)
                        c.drawString(x + 12, y, f'{num}. {display[:max_chars - 4]}')
                        y -= base_line_height
                        continue
                    
                    # 普通段落 - 自动换行
                    display = raw_line.replace('**', '').strip()
                    c.setFont(font_name, base_font_size)
                    for i in range(0, max(len(display), 1), max_chars):
                        _check_page()
                        c.drawString(x, y, display[i:i+max_chars])
                        y -= base_line_height
                
                # 页脚
                y -= 20
                _check_page(40)
                c.setStrokeColorRGB(0.39, 0.40, 0.95)
                c.setLineWidth(1)
                c.line(x, y, width - 40, y)
                y -= 14
                c.setFont(font_name, 8)
                c.setFillColorRGB(0.58, 0.64, 0.70)
                c.drawCentredString(width / 2, y, '本报告由 AIGC Guard 数字内容指纹嵌入与侵权全网监测平台自动生成')
                y -= 12
                c.drawCentredString(width / 2, y, '报告仅供参考，最终法律效力以司法机关认定为准')
                
                c.save()
                buf.seek(0)
                
                download_name = req.file_name or f"AIGC_Report_{req.report_id}.pdf"
                headers = {"Content-Disposition": f"attachment; filename=\"{download_name}\""}
                return StreamingResponse(buf, media_type="application/pdf", headers=headers)
            
            except Exception as pdf_err:
                logger.error(f"PDF生成失败: {pdf_err}")
                raise HTTPException(status_code=500, detail=f"PDF生成失败: {str(pdf_err)}")
    
    raise HTTPException(status_code=400, detail="不支持的导出格式")


# 快捷接口：快速检测并获取AI报告
@router.post("/quick-analysis")
async def quick_analysis(
    image: UploadFile = File(...),
    user_id: Optional[str] = Depends(get_optional_user)
):
    """
    快速分析接口 - 一键检测+AI报告
    
    适合移动端或需要快速结果的场景
    """
    if not user_id:
        raise HTTPException(status_code=401, detail="请登录后使用")
    
    try:
        content = image.file.read()
        
        # 执行检测
        detection_result = WatermarkService.detect_watermark(content, image.filename or "unknown")
        
        # 生成AI报告（仅当发现水印时）
        ai_report = None
        if detection_result.get("has_watermark"):
            try:
                from app.service.report_service import ReportService
                ai_report = await ReportService.generate_ai_analysis_report(
                    detection_result=detection_result,
                    image_filename=image.filename
                )
            except Exception as e:
                logger.error(f"AI报告生成失败: {e}")
        
        # 简化响应
        return {
            "success": True,
            "has_watermark": detection_result.get("has_watermark"),
            "best_match_author": detection_result.get("best_match", {}).get("author_name") if detection_result.get("best_match") else None,
            "similarity": detection_result.get("best_match", {}).get("similarity") if detection_result.get("best_match") else 0,
            "risk_level": detection_result.get("analysis", {}).get("risk_level", {}).get("level", "UNKNOWN"),
            "verdict": detection_result.get("analysis", {}).get("verdict", ""),
            "ai_report": ai_report,
            "suggested_action": detection_result.get("analysis", {}).get("suggested_action", [])
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"分析失败: {str(e)}")


# ==================== 简化版侵权监测（方案A）====================

from pydantic import BaseModel, Field

class InfringementReportRequest(BaseModel):
    """侵权举报请求"""
    my_asset_id: int = Field(..., description="用户自己的作品ID")
    infringing_url: str = Field(..., description="疑似侵权的链接URL")
    description: str = Field(default="", description="补充说明")


@router.post("/infringement/report")
async def report_infringement(
    req: InfringementReportRequest,
    user_id: Optional[str] = Depends(get_optional_user)
):
    """
    提交侵权举报（简化版方案A）
    
    用户发现疑似侵权链接后提交，系统自动：
    1. 下载侵权图片
    2. 提取指纹比对
    3. 生成相似度报告
    4. 提供维权建议
    
    优势：按需运行，不消耗免费额度，精准有效
    """
    if not user_id:
        raise HTTPException(status_code=401, detail="请登录后使用侵权举报功能")
    
    try:
        from app.service.infringement_service import InfringementService
        
        service = InfringementService()
        result = await service.report_infringement(
            reporter_id=user_id,
            reporter_name=user_id,  # 简化处理，实际可查询用户昵称
            my_asset_id=req.my_asset_id,
            infringing_url=req.infringing_url,
            description=req.description
        )
        
        if not result.get("success"):
            raise HTTPException(status_code=400, detail=result.get("error", "举报失败"))
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"侵权举报失败: {e}")
        raise HTTPException(status_code=500, detail=f"举报处理失败: {str(e)}")


@router.post("/dmca/export-pdf")
async def export_dmca_pdf(
    report_id: str = Form(...),
    user_id: Optional[str] = Depends(get_optional_user)
):
    """
    导出 DMCA 维权文书为 PDF
    
    生成正式的 PDF 格式法律函件，可直接打印或发送
    """
    if not user_id:
        raise HTTPException(status_code=401, detail="请登录后使用")
    
    try:
        from app.service.infringement_service import InfringementService
        from app.service.dmca_pdf_service import DMCAPDFService
        
        # 获取举报详情
        service = InfringementService()
        reports = service.get_user_reports(user_id, limit=100)
        
        report = None
        for r in reports:
            if r.get("report_id") == report_id:
                report = r
                break
        
        if not report:
            raise HTTPException(status_code=404, detail="未找到该举报记录")
        
        # 检查是否已生成 DMCA
        if not report.get("dmca_notice"):
            raise HTTPException(status_code=400, detail="请先生成 DMCA 文书")
        
        # 生成 PDF
        pdf_content = DMCAPDFService.generate_dmca_pdf(
            dmca_content=report["dmca_notice"],
            author_name=report.get("reporter_name", "权利人"),
            asset_name=report.get("asset_name", "原创作品"),
            infringing_url=report.get("infringing_url", ""),
            similarity=report.get("similarity_score", 0),
            evidence_data={
                "tx_hash": report.get("tx_hash"),
                "block_height": report.get("block_height"),
                "fingerprint_match": report.get("similarity_score"),
                "timestamp": report.get("created_at")
            }
        )
        
        download_name = f"DMCA_维权函_{report_id[:8]}_{datetime.now().strftime('%Y%m%d')}.pdf"
        headers = {"Content-Disposition": f"attachment; filename=\"{download_name}\""}
        
        return StreamingResponse(
            io.BytesIO(pdf_content),
            media_type="application/pdf",
            headers=headers
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"DMCA PDF 导出失败: {e}")
        raise HTTPException(status_code=500, detail=f"PDF 导出失败: {str(e)}")


@router.post("/infringement/generate-dmca")
async def generate_infringement_dmca(
    report_id: str = Form(...),
    user_id: Optional[str] = Depends(get_optional_user)
):
    """
    为确认的侵权举报生成DMCA下架函
    """
    if not user_id:
        raise HTTPException(status_code=401, detail="请登录后使用")
    
    try:
        from app.service.infringement_service import InfringementService
        
        service = InfringementService()
        result = await service.generate_dmca_notice(report_id, user_id)
        
        if not result.get("success"):
            raise HTTPException(status_code=400, detail=result.get("error", "生成失败"))
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"生成DMCA函失败: {e}")
        raise HTTPException(status_code=500, detail=f"生成失败: {str(e)}")


@router.get("/infringement/my-reports")
def get_my_infringement_reports(
    limit: int = Query(20, ge=1, le=100),
    user_id: Optional[str] = Depends(get_optional_user)
):
    """
    获取我的侵权举报历史
    
    - 普通用户：只看到自己的举报
    - Admin：可以看到所有举报
    """
    if not user_id:
        raise HTTPException(status_code=401, detail="请登录后查看")
    
    try:
        from app.service.infringement_service import InfringementService
        
        service = InfringementService()
        reports = service.get_user_reports(user_id, limit)
        
        return {
            "success": True,
            "total": len(reports),
            "reports": reports
        }
        
    except Exception as e:
        logger.error(f"获取举报历史失败: {e}")
        raise HTTPException(status_code=500, detail=f"获取失败: {str(e)}")


# 快捷接口：一键检测侵权（检测+举报一站式）
@router.post("/infringement/quick-check")
async def quick_infringement_check(
    my_asset_id: int = Form(..., description="您的作品ID"),
    infringing_url: str = Form(..., description="疑似侵权链接"),
    user_id: Optional[str] = Depends(get_optional_user)
):
    """
    快速检测侵权（一站式接口）
    
    适合移动端使用，一步完成检测和举报
    """
    if not user_id:
        raise HTTPException(status_code=401, detail="请登录后使用")
    
    try:
        from app.service.infringement_service import quick_infringement_check
        
        result = await quick_infringement_check(
            user_id=user_id,
            user_name=user_id,
            my_asset_id=my_asset_id,
            infringing_url=infringing_url
        )
        
        # 简化响应，适合移动端
        return {
            "success": result.get("success", False),
            "is_infringing": result.get("is_infringing", False),
            "similarity": result.get("similarity_score", 0),
            "report_id": result.get("report_id"),
            "message": "✅ 确认侵权，建议立即维权" if result.get("is_infringing") else "⚠️ 相似度不足，可能不构成侵权",
            "can_generate_dmca": result.get("is_infringing", False)
        }
        
    except Exception as e:
        logger.error(f"快速检测失败: {e}")
        raise HTTPException(status_code=500, detail=f"检测失败: {str(e)}")


# ==================== 异步任务队列接口 ====================

from app.service.task_queue import task_queue

@router.post("/detect/async")
async def submit_async_detection(
    file: UploadFile = File(...),
    task_type: str = Form("image"),
    user_id: Optional[str] = Depends(get_optional_user)
):
    """
    提交异步检测任务
    
    适用于大文件或批量检测场景，返回 task_id 用于后续查询进度
    """
    if not user_id:
        raise HTTPException(status_code=401, detail="请登录后使用")
    
    try:
        import tempfile
        import os

        suffix = os.path.splitext(file.filename or "")[1] or ".bin"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(await file.read())
            tmp_path = tmp.name

        task_id = task_queue.submit_task(
            user_id=user_id,
            task_type=task_type,
            file_name=file.filename or "unknown",
            file_path=tmp_path,
        )
        
        return {
            "success": True,
            "task_id": task_id,
            "message": "任务已提交，请使用 task_id 查询进度",
            "query_url": f"/api/tasks/{task_id}/status"
        }
    except Exception as e:
        logger.error(f"提交异步任务失败: {e}")
        raise HTTPException(status_code=500, detail=f"提交任务失败: {str(e)}")

@router.get("/tasks/{task_id}/status")
async def get_task_status(
    task_id: str,
    user_id: Optional[str] = Depends(get_optional_user)
):
    """
    查询异步任务状态和进度
    
    前端可以轮询此接口获取实时进度
    """
    if not user_id:
        raise HTTPException(status_code=401, detail="请登录后使用")
    
    task = task_queue.get_task(task_id)
    
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    # 只能查看自己的任务（管理员除外）
    if task.user_id != user_id:
        sb = get_supabase_service_client()
        if sb:
            user_res = sb.table("profiles").select("role").eq("id", user_id).execute()
            is_admin = user_res.data and user_res.data[0].get("role") in ["admin", "行政"]
            if not is_admin:
                raise HTTPException(status_code=403, detail="无权查看他人任务")
    
    return {
        "task_id": task.task_id,
        "status": task.status.value,
        "progress": {
            "current": task.progress.current,
            "total": task.progress.total,
            "percentage": round(task.progress.current / task.progress.total * 100, 1) if task.progress.total > 0 else 0,
            "stage": task.progress.stage,
            "detail": task.progress.detail
        },
        "result": task.result,
        "error_message": task.error_message,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
        "completed_at": task.completed_at
    }

@router.get("/tasks/my")
async def get_my_tasks(
    limit: int = 20,
    user_id: Optional[str] = Depends(get_optional_user)
):
    """
    获取当前用户的任务列表
    """
    if not user_id:
        raise HTTPException(status_code=401, detail="请登录后使用")
    
    tasks = task_queue.get_user_tasks(user_id, limit)
    
    return {
        "tasks": [
            {
                "task_id": t.task_id,
                "task_type": t.task_type,
                "file_name": t.file_name,
                "status": t.status.value,
                "progress": {
                    "current": t.progress.current,
                    "total": t.progress.total,
                    "percentage": round(t.progress.current / t.progress.total * 100, 1) if t.progress.total > 0 else 0
                },
                "created_at": t.created_at,
                "updated_at": t.updated_at,
                "completed_at": t.completed_at
            }
            for t in tasks
        ]
    }

@router.post("/tasks/{task_id}/cancel")
async def cancel_task(
    task_id: str,
    user_id: Optional[str] = Depends(get_optional_user)
):
    """
    取消正在执行或等待中的任务
    """
    if not user_id:
        raise HTTPException(status_code=401, detail="请登录后使用")
    
    task = task_queue.get_task(task_id)
    
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    
    # 只能取消自己的任务
    if task.user_id != user_id:
        raise HTTPException(status_code=403, detail="无权取消他人任务")
    
    success = task_queue.cancel_task(task_id)
    
    if success:
        return {"success": True, "message": "任务已取消"}
    else:
        raise HTTPException(status_code=400, detail="任务已完成或已失败，无法取消")
