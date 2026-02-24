from typing import Any, Dict, List, Optional
import logging
import os
import urllib.parse

from fastapi import APIRouter, Header, HTTPException, Form, Query
from jose import jwt
import httpx

from app.utils.supabase import get_supabase_service_client
from app.core.config import settings

router = APIRouter()
logger = logging.getLogger("app")


def _get_bearer_token(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    return authorization[len("Bearer ") :]


def _verify_local_jwt(token: str) -> Optional[Dict[str, Any]]:
    """Verify locally issued HS256 JWT.

    Returns payload if verified, otherwise None.
    """
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except Exception:
        return None


def _verify_supabase_jwt_and_get_uid(token: str) -> Optional[str]:
    """Validate Supabase access_token by calling Supabase Auth API.

    This avoids relying on unverified claims when ADMIN_API_SECRET is disabled.
    """
    if not settings.SUPABASE_URL or not settings.SUPABASE_KEY:
        return None

    url = f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/user"
    headers = {
        "Authorization": f"Bearer {token}",
        "apikey": settings.SUPABASE_KEY,
    }
    try:
        with httpx.Client(timeout=8.0) as client:
            resp = client.get(url, headers=headers)
        if resp.status_code != 200:
            return None
        data = resp.json() if resp.content else {}
        uid = data.get("id")
        return str(uid) if uid else None
    except Exception:
        return None


def _get_verified_uid(authorization: Optional[str]) -> str:
    token = _get_bearer_token(authorization)

    # 1) local token
    payload = _verify_local_jwt(token)
    if payload and payload.get("sub"):
        return str(payload.get("sub"))

    # 2) supabase token
    uid = _verify_supabase_jwt_and_get_uid(token)
    if uid:
        return uid

    raise HTTPException(status_code=401, detail="Invalid token")


def _require_admin(authorization: Optional[str], admin_secret: Optional[str]) -> Dict[str, Any]:
    configured_secret = os.environ.get("ADMIN_API_SECRET", "")
    if configured_secret and admin_secret != configured_secret:
        raise HTTPException(status_code=403, detail="Forbidden - Admin secret required")

    uid = _get_verified_uid(authorization)

    sb = get_supabase_service_client()
    if not sb:
        raise HTTPException(status_code=500, detail="Supabase service client not configured. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.")

    try:
        res = sb.table("profiles").select("id, role").eq("id", uid).limit(1).execute()
        row = res.data[0] if res and res.data else None
    except Exception as e:
        logger.error(f"Failed to query admin role: {e}")
        raise HTTPException(status_code=500, detail=f"Database query failed: {str(e)}")

    if not row or (row.get("role") not in ["admin", "行政"]):
        raise HTTPException(status_code=403, detail="Forbidden - Admin role required")

    return {"uid": uid}


@router.get("/overview")
def admin_overview(
    authorization: Optional[str] = Header(None),
    x_admin_secret: Optional[str] = Header(None, alias="X-Admin-Secret"),
) -> Dict[str, Any]:
    _require_admin(authorization, x_admin_secret)

    admin_secret_enabled = bool(os.environ.get("ADMIN_API_SECRET", ""))

    sb = get_supabase_service_client()

    try:
        # 查询用户列表（包含订阅信息）
        users_res = (
            sb.table("profiles")
            .select(
                "id, username, display_name, role, plan, "
                "quota_used, quota_total, quota_embed_used, quota_embed_total, quota_detect_used, quota_detect_total, "
                "subscription_period, subscription_expires_at, subscription_status, subscription_started_at, created_at"
            )
            .order("id", desc=True)
            .limit(100)
            .execute()
        )
        users: List[Dict[str, Any]] = users_res.data or []
        users_count = len(users)

        # 查询资产列表
        assets_res = (
            sb.table("watermarked_assets")
            .select(
                "id, user_id, filename, asset_type, created_at, output_path, fingerprint, phash, timestamp, psnr, tx_hash, block_height"
            )
            .order("timestamp", desc=True)
            .limit(100)
            .execute()
        )
        assets: List[Dict[str, Any]] = assets_res.data or []
        assets_count = len(assets)

        # 补齐上传者信息 + 预览 URL（管理员不锁定/不打码）
        user_ids = list({a.get("user_id") for a in assets if a.get("user_id")})
        user_map: Dict[str, Dict[str, Any]] = {}
        if user_ids:
            try:
                prof_res = (
                    sb.table("profiles")
                    .select("id, username, display_name")
                    .in_("id", user_ids)
                    .execute()
                )
                for p in (prof_res.data or []):
                    pid = p.get("id")
                    if pid:
                        user_map[str(pid)] = p
            except Exception:
                user_map = {}

        for a in assets:
            a["is_locked"] = False
            url = a.get("output_path") or ""
            if isinstance(url, str) and url.startswith("http"):
                a["preview_url"] = url
            else:
                fname = a.get("filename") or ""
                a["preview_url"] = f"/api/image/{urllib.parse.quote(fname)}" if fname else ""

            uid = a.get("user_id")
            p = user_map.get(str(uid)) if uid else None
            if p:
                a["uploader_username"] = p.get("username")
                a["uploader_display_name"] = p.get("display_name")

        logger.info(f"Admin overview: {users_count} users, {assets_count} assets")

        return {
            "users_count": users_count,
            "assets_count": assets_count,
            "users": users,
            "assets": assets,
            "admin_secret_enabled": admin_secret_enabled,
        }
    except Exception as e:
        logger.error(f"Admin overview query failed: {e}")
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")


@router.get("/summary")
def admin_summary(
    authorization: Optional[str] = Header(None),
    x_admin_secret: Optional[str] = Header(None, alias="X-Admin-Secret"),
    limit_users: int = Query(10, ge=0, le=50),
    limit_assets: int = Query(10, ge=0, le=50),
) -> Dict[str, Any]:
    _require_admin(authorization, x_admin_secret)

    admin_secret_enabled = bool(os.environ.get("ADMIN_API_SECRET", ""))

    sb = get_supabase_service_client()
    if not sb:
        raise HTTPException(status_code=500, detail="Supabase service client not configured")

    try:
        users_res = (
            sb.table("profiles")
            .select("id", count="exact")
            .limit(1)
            .execute()
        )
        assets_res = (
            sb.table("watermarked_assets")
            .select("id", count="exact")
            .limit(1)
            .execute()
        )

        latest_users_res = (
            sb.table("profiles")
            .select(
                "id, username, display_name, role, plan, "
                "quota_used, quota_total, quota_embed_used, quota_embed_total, quota_detect_used, quota_detect_total, "
                "subscription_period, subscription_expires_at, subscription_status, subscription_started_at, created_at"
            )
            .order("created_at", desc=True)
            .limit(limit_users)
            .execute()
        )
        latest_assets_res = (
            sb.table("watermarked_assets")
            .select("id, user_id, filename, asset_type, timestamp, created_at, output_path, fingerprint, psnr")
            .order("created_at", desc=True)
            .limit(limit_assets)
            .execute()
        )

        assets = latest_assets_res.data or []
        # 补齐上传者信息 + 预览 URL（管理员不锁定/不打码）
        user_ids = list({a.get("user_id") for a in assets if a.get("user_id")})
        user_map: Dict[str, Dict[str, Any]] = {}
        if user_ids:
            try:
                prof_res = (
                    sb.table("profiles")
                    .select("id, username, display_name")
                    .in_("id", user_ids)
                    .execute()
                )
                for p in (prof_res.data or []):
                    pid = p.get("id")
                    if pid:
                        user_map[str(pid)] = p
            except Exception:
                user_map = {}

        for a in assets:
            a["is_locked"] = False
            url = a.get("output_path") or ""
            if isinstance(url, str) and url.startswith("http"):
                a["preview_url"] = url
            else:
                fname = a.get("filename") or ""
                a["preview_url"] = f"/api/image/{urllib.parse.quote(fname)}" if fname else ""

            uid = a.get("user_id")
            p = user_map.get(str(uid)) if uid else None
            if p:
                a["uploader_username"] = p.get("username")
                a["uploader_display_name"] = p.get("display_name")

        return {
            "users_count": getattr(users_res, "count", 0) or 0,
            "assets_count": getattr(assets_res, "count", 0) or 0,
            "users": latest_users_res.data or [],
            "assets": assets,
            "admin_secret_enabled": admin_secret_enabled,
        }
    except Exception as e:
        logger.error(f"Admin summary query failed: {e}")
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")


@router.get("/assets")
def list_all_assets(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    authorization: Optional[str] = Header(None),
    x_admin_secret: Optional[str] = Header(None, alias="X-Admin-Secret"),
) -> Dict[str, Any]:
    """管理员查看全部资产（分页）"""
    _require_admin(authorization, x_admin_secret)

    sb = get_supabase_service_client()
    if not sb:
        raise HTTPException(status_code=500, detail="Supabase service client not configured")

    try:
        total_res = sb.table("watermarked_assets").select("id", count="exact").limit(1).execute()
        total = getattr(total_res, "count", 0) or 0

        assets_res = (
            sb.table("watermarked_assets")
            .select(
                "id, user_id, filename, asset_type, created_at, output_path, fingerprint, phash, timestamp, psnr, tx_hash, block_height"
            )
            .order("created_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
        assets: List[Dict[str, Any]] = assets_res.data or []

        # uploader map
        user_ids = list({a.get("user_id") for a in assets if a.get("user_id")})
        user_map: Dict[str, Dict[str, Any]] = {}
        if user_ids:
            try:
                prof_res = (
                    sb.table("profiles")
                    .select("id, username, display_name")
                    .in_("id", user_ids)
                    .execute()
                )
                for p in (prof_res.data or []):
                    pid = p.get("id")
                    if pid:
                        user_map[str(pid)] = p
            except Exception:
                user_map = {}

        for a in assets:
            a["is_locked"] = False
            url = a.get("output_path") or ""
            if isinstance(url, str) and url.startswith("http"):
                a["preview_url"] = url
            else:
                fname = a.get("filename") or ""
                a["preview_url"] = f"/api/image/{urllib.parse.quote(fname)}" if fname else ""

            uid = a.get("user_id")
            p = user_map.get(str(uid)) if uid else None
            if p:
                a["uploader_username"] = p.get("username")
                a["uploader_display_name"] = p.get("display_name")

        return {
            "success": True,
            "total": total,
            "assets": assets,
            "limit": limit,
            "offset": offset,
        }
    except Exception as e:
        logger.error(f"Admin list_all_assets failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/update-user-plan")
def update_user_plan(
    user_id: str = Form(...),
    plan: str = Form(...),
    subscription_period: Optional[str] = Form(None),  # 'month' 或 'year'
    authorization: Optional[str] = Header(None),
    x_admin_secret: Optional[str] = Header(None, alias="X-Admin-Secret"),
) -> Dict[str, Any]:
    """
    管理员手动调整用户套餐权限和订阅周期
    同步更新到 Supabase profiles 表
    """
    _require_admin(authorization, x_admin_secret)

    sb = get_supabase_service_client()
    if not sb:
        raise HTTPException(status_code=500, detail="Supabase service client not configured")

    # 根据套餐设置额度（仅4类权限）
    quota_map = {
        "free": 10,
        "personal": 500,
        "pro": 2000,
        "enterprise": 9999999,
    }
    quota_total = quota_map.get(plan, 10)

    embed_quota_map = {"free": 50, "personal": 500, "pro": 2000, "enterprise": 9999999}
    detect_quota_map = {"free": 20, "personal": 200, "pro": 1000, "enterprise": 9999999}
    
    # 计算订阅到期时间
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    expires_at = None
    sub_status = 'inactive'

    # 续费/顺延仅在管理员显式传入周期（month/year）时发生。
    # 仅修改套餐（plan）时，不应隐式顺延到期时间，避免误操作造成“多续费”。
    effective_period = subscription_period if subscription_period in ['month', 'year'] else None

    def _parse_iso_datetime(val: Optional[str]) -> Optional[datetime]:
        if not val:
            return None
        try:
            s = str(val).strip()
            if s.endswith('Z'):
                s = s[:-1] + '+00:00'
            dt = datetime.fromisoformat(s)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except Exception:
            return None

    try:
        existing_res = (
            sb.table("profiles")
            .select(
                "id, quota_used, quota_total, quota_embed_used, quota_embed_total, quota_detect_used, quota_detect_total, subscription_period, subscription_status, subscription_expires_at, subscription_started_at"
            )
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
        existing_row = existing_res.data[0] if existing_res and existing_res.data else None
        if not existing_row:
            raise HTTPException(status_code=404, detail="User not found")

        existing_quota_used = int(existing_row.get("quota_used") or 0)
        existing_quota_embed_used = int(existing_row.get("quota_embed_used") or 0)
        existing_quota_detect_used = int(existing_row.get("quota_detect_used") or 0)

        # 续费顺延：如果当前订阅未到期，则在原到期时间基础上延长；否则从现在开始
        base_time = now
        if effective_period in ['month', 'year'] and plan != 'free':
            prev_expires = _parse_iso_datetime(existing_row.get('subscription_expires_at'))
            prev_status = existing_row.get('subscription_status')
            if prev_expires and prev_status == 'active' and prev_expires > now:
                base_time = prev_expires

            if effective_period == 'month':
                expires_at = base_time + timedelta(days=30)
            else:  # year
                expires_at = base_time + timedelta(days=365)
            sub_status = 'active'

        # 构建更新数据
        new_quota_embed_total = embed_quota_map.get(plan, 50)
        new_quota_detect_total = detect_quota_map.get(plan, 20)

        # total 不能小于已用，避免出现 used > total 导致前端/后端逻辑异常
        new_quota_embed_total = max(int(new_quota_embed_total), existing_quota_embed_used)
        new_quota_detect_total = max(int(new_quota_detect_total), existing_quota_detect_used)
        quota_total = max(int(quota_total), existing_quota_used)

        update_data = {
            "plan": plan,
            # 兼容旧字段
            "quota_total": quota_total,
            "quota_used": existing_quota_used,
            # 新字段：分开限制嵌入/检测
            "quota_embed_total": new_quota_embed_total,
            "quota_embed_used": existing_quota_embed_used,
            "quota_detect_total": new_quota_detect_total,
            "quota_detect_used": existing_quota_detect_used,
        }
        
        # 添加订阅相关字段
        if effective_period:
            update_data["subscription_period"] = effective_period
            update_data["subscription_status"] = sub_status
            update_data["subscription_started_at"] = now.isoformat()
            if expires_at:
                update_data["subscription_expires_at"] = expires_at.isoformat()
        
        # 如果是免费版，清除订阅信息
        if plan == 'free':
            update_data["subscription_period"] = None
            update_data["subscription_status"] = 'inactive'
            update_data["subscription_expires_at"] = None
            update_data["subscription_started_at"] = None
        
        # 更新用户套餐和额度
        res = sb.table("profiles").update(update_data).eq("id", user_id).execute()

        updated = res.data[0] if res and res.data else None
        if not updated:
            raise HTTPException(status_code=404, detail="User not found")

        return {
            "success": True,
            "message": f"User {user_id} upgraded to {plan} ({subscription_period or 'one-time'})",
            "user": updated
        }
    except Exception as e:
        logger.error(f"Failed to update user plan: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/users/{user_id}")
def get_user_detail(
    user_id: str,
    authorization: Optional[str] = Header(None),
    x_admin_secret: Optional[str] = Header(None, alias="X-Admin-Secret"),
) -> Dict[str, Any]:
    """获取单个用户的详细信息"""
    _require_admin(authorization, x_admin_secret)
    
    sb = get_supabase_service_client()
    if not sb:
        raise HTTPException(status_code=500, detail="Supabase service client not configured")
    
    try:
        user_res = sb.table("profiles").select(
            "id, username, display_name, role, plan, "
            "quota_used, quota_total, quota_embed_used, quota_embed_total, quota_detect_used, quota_detect_total, "
            "subscription_period, subscription_expires_at, subscription_status, subscription_started_at, "
            "created_at"
        ).eq("id", user_id).limit(1).execute()
        
        if not user_res.data:
            raise HTTPException(status_code=404, detail="User not found")
        
        user = user_res.data[0]
        
        # 统计该用户的资产数、检测记录数、举报数
        assets_count = sb.table("watermarked_assets").select("id", count="exact").eq("user_id", user_id).limit(1).execute()
        detections_count = sb.table("detection_records").select("id", count="exact").eq("user_id", user_id).limit(1).execute()
        reports_count = sb.table("infringement_reports").select("id", count="exact").eq("reporter_id", user_id).limit(1).execute()
        
        user["stats"] = {
            "assets_count": getattr(assets_count, "count", 0) or 0,
            "detections_count": getattr(detections_count, "count", 0) or 0,
            "reports_count": getattr(reports_count, "count", 0) or 0,
        }
        
        return {"success": True, "user": user}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get user detail: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/users/{user_id}/assets")
def get_user_assets(
    user_id: str,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    asset_type: Optional[str] = Query(None),  # image/text/video
    authorization: Optional[str] = Header(None),
    x_admin_secret: Optional[str] = Header(None, alias="X-Admin-Secret"),
) -> Dict[str, Any]:
    """获取用户上传的资产列表（分页）"""
    _require_admin(authorization, x_admin_secret)
    
    sb = get_supabase_service_client()
    if not sb:
        raise HTTPException(status_code=500, detail="Supabase service client not configured")
    
    try:
        query = sb.table("watermarked_assets").select(
            "id, filename, fingerprint, phash, timestamp, psnr, asset_type, output_path, tx_hash, block_height, created_at"
        ).eq("user_id", user_id)
        
        if asset_type:
            query = query.eq("asset_type", asset_type)
        
        # 先获取总数
        count_res = query.execute()
        total = len(count_res.data) if count_res.data else 0
        
        # 分页查询
        res = query.order("created_at", desc=True).limit(limit).offset(offset).execute()
        
        return {
            "success": True,
            "total": total,
            "limit": limit,
            "offset": offset,
            "assets": res.data or []
        }
    except Exception as e:
        logger.error(f"Failed to get user assets: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/users/{user_id}/detection-records")
def get_user_detection_records(
    user_id: str,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    has_watermark: Optional[bool] = Query(None),  # 筛选是否命中
    start_date: Optional[str] = Query(None),  # ISO format date
    end_date: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
    x_admin_secret: Optional[str] = Header(None, alias="X-Admin-Secret"),
) -> Dict[str, Any]:
    """获取用户的检测记录列表（分页+筛选）"""
    _require_admin(authorization, x_admin_secret)
    
    sb = get_supabase_service_client()
    if not sb:
        raise HTTPException(status_code=500, detail="Supabase service client not configured")
    
    try:
        query = sb.table("detection_records").select(
            "id, user_id, created_at, input_filename, has_watermark, confidence, "
            "matched_asset_id, matched_asset, candidates, fingerprint_prefix, metadata"
        ).eq("user_id", user_id)
        
        if has_watermark is not None:
            query = query.eq("has_watermark", has_watermark)
        
        if start_date:
            query = query.gte("created_at", start_date)
        if end_date:
            query = query.lte("created_at", end_date)
        
        # 获取总数（简化：用 count="exact" 但 Supabase Python 客户端可能不支持，这里用 len）
        count_res = query.execute()
        total = len(count_res.data) if count_res.data else 0
        
        # 分页查询
        res = query.order("created_at", desc=True).limit(limit).offset(offset).execute()
        
        return {
            "success": True,
            "total": total,
            "limit": limit,
            "offset": offset,
            "records": res.data or []
        }
    except Exception as e:
        logger.error(f"Failed to get user detection records: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/users/{user_id}/infringement-reports")
def get_user_infringement_reports(
    user_id: str,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    status: Optional[str] = Query(None),  # pending/confirmed/rejected
    authorization: Optional[str] = Header(None),
    x_admin_secret: Optional[str] = Header(None, alias="X-Admin-Secret"),
) -> Dict[str, Any]:
    """获取用户的侵权举报/维权记录（分页+筛选）"""
    _require_admin(authorization, x_admin_secret)
    
    sb = get_supabase_service_client()
    if not sb:
        raise HTTPException(status_code=500, detail="Supabase service client not configured")
    
    try:
        query = sb.table("infringement_reports").select(
            "id, reporter_id, asset_id, infringing_url, similarity, status, "
            "analysis, dmca_text, created_at, updated_at"
        ).eq("reporter_id", user_id)
        
        if status:
            query = query.eq("status", status)
        
        count_res = query.execute()
        total = len(count_res.data) if count_res.data else 0
        
        res = query.order("created_at", desc=True).limit(limit).offset(offset).execute()
        
        return {
            "success": True,
            "total": total,
            "limit": limit,
            "offset": offset,
            "reports": res.data or []
        }
    except Exception as e:
        logger.error(f"Failed to get user infringement reports: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/users/{user_id}/timeline")
def get_user_timeline(
    user_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    authorization: Optional[str] = Header(None),
    x_admin_secret: Optional[str] = Header(None, alias="X-Admin-Secret"),
) -> Dict[str, Any]:
    """获取用户的时间线（合并资产、检测、举报记录，按时间排序）"""
    _require_admin(authorization, x_admin_secret)
    
    sb = get_supabase_service_client()
    if not sb:
        raise HTTPException(status_code=500, detail="Supabase service client not configured")
    
    try:
        # 获取各类记录
        assets_res = sb.table("watermarked_assets").select(
            "id, filename, asset_type, created_at"
        ).eq("user_id", user_id).order("created_at", desc=True).limit(100).execute()
        
        detections_res = sb.table("detection_records").select(
            "id, input_filename, has_watermark, confidence, created_at"
        ).eq("user_id", user_id).order("created_at", desc=True).limit(100).execute()
        
        reports_res = sb.table("infringement_reports").select(
            "id, infringing_url, status, created_at"
        ).eq("reporter_id", user_id).order("created_at", desc=True).limit(100).execute()
        
        # 合并时间线
        timeline = []
        
        for a in (assets_res.data or []):
            timeline.append({
                "type": "asset",
                "subtype": a.get("asset_type", "image"),
                "id": a["id"],
                "title": a.get("filename", "未知文件"),
                "timestamp": a.get("created_at"),
                "icon": "📁"
            })
        
        for d in (detections_res.data or []):
            timeline.append({
                "type": "detection",
                "subtype": "hit" if d.get("has_watermark") else "miss",
                "id": d["id"],
                "title": d.get("input_filename", "检测任务"),
                "timestamp": d.get("created_at"),
                "confidence": d.get("confidence"),
                "icon": "🔍" if d.get("has_watermark") else "❓"
            })
        
        for r in (reports_res.data or []):
            timeline.append({
                "type": "report",
                "subtype": r.get("status", "pending"),
                "id": r["id"],
                "title": r.get("infringing_url", "侵权举报")[:50] + "..." if r.get("infringing_url") else "侵权举报",
                "timestamp": r.get("created_at"),
                "icon": "⚠️"
            })
        
        # 按时间倒序
        timeline.sort(key=lambda x: x.get("timestamp") or "", reverse=True)
        
        total = len(timeline)
        paginated = timeline[offset:offset+limit]
        
        return {
            "success": True,
            "total": total,
            "limit": limit,
            "offset": offset,
            "timeline": paginated
        }
    except Exception as e:
        logger.error(f"Failed to get user timeline: {e}")
        raise HTTPException(status_code=500, detail=str(e))
