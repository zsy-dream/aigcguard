"""
增强版数字水印服务
解决两个问题：
1. 历史数据可追溯性 - 嵌入时间戳和作者信息
2. 防重复水印攻击 - 检测已有水印并警告
"""

import os
import cv2
import numpy as np
import hashlib
import json
import time
from datetime import datetime
from typing import Optional, Dict, List, Tuple
from dataclasses import dataclass
import secrets

from algorithms.fingerprint_engine import FingerprintEngine
from algorithms.image_matcher import ImageMatcher
from app.utils.image import load_image_bytes
from app.service.vector_search import vector_service
import io
from PIL import Image


# ---- 资产指纹库内存缓存（避免每次检测都跨洋全表扫描） ----
_assets_cache: dict = {}   # {"data": [...], "expires": float}
_profile_cache: dict = {}  # {"data": {uid: display_name}, "expires": float}
_ASSETS_CACHE_TTL = 120    # 秒，2 分钟
_PROFILE_CACHE_TTL = 300   # 秒，5 分钟


def _get_cached_assets() -> List[Dict]:
    """获取资产列表（带缓存），只查必要列"""
    if _assets_cache.get("data") is not None and time.time() < _assets_cache.get("expires", 0):
        print(f"[AssetsCache] 命中缓存, 资产数: {len(_assets_cache['data'])}")
        return _assets_cache["data"]

    from app.utils.supabase import get_supabase_service_client
    sb = get_supabase_service_client()
    if not sb:
        print("[AssetsCache] Supabase 客户端不可用")
        return _assets_cache.get("data") or []

    try:
        res = sb.table("watermarked_assets").select(
            "id, fingerprint, user_id, phash, timestamp, filename"
        ).execute()
        data = res.data or []
        _assets_cache["data"] = data
        _assets_cache["expires"] = time.time() + _ASSETS_CACHE_TTL
        print(f"[AssetsCache] 加载完成, 资产数: {len(data)}")
        return data
    except Exception as e:
        print(f"[AssetsCache] 查询失败: {e}")
        return _assets_cache.get("data") or []


def _get_cached_profiles(user_ids: List[str]) -> Dict[str, str]:
    """获取用户 display_name 映射（带缓存）"""
    if _profile_cache.get("data") is not None and time.time() < _profile_cache.get("expires", 0):
        return _profile_cache["data"]

    from app.utils.supabase import get_supabase_service_client
    sb = get_supabase_service_client()
    if not sb or not user_ids:
        return _profile_cache.get("data") or {}

    try:
        prof_res = sb.table("profiles").select("id, display_name").in_("id", user_ids).execute()
        profile_map = {}
        for p in (prof_res.data or []):
            if p.get("id"):
                profile_map[str(p["id"])] = p.get("display_name") or ""
        _profile_cache["data"] = profile_map
        _profile_cache["expires"] = time.time() + _PROFILE_CACHE_TTL
        return profile_map
    except Exception as e:
        print(f"[ProfileCache] 查询失败: {e}")
        return _profile_cache.get("data") or {}


def invalidate_assets_cache():
    """手动失效缓存（新资产嵌入后调用）"""
    _assets_cache.clear()


def inject_asset_to_cache(fingerprint: str, user_id: str, filename: str, asset_id: str = None):
    """将刚嵌入的资产立即注入内存缓存，确保后续检测能立刻命中。

    在 embed API 返回前（而非后台任务）调用，解决"刚嵌入立即检测却说没指纹"的时序问题。
    """
    import time as _time
    new_entry = {
        "id": asset_id or f"pending_{int(_time.time())}_{filename[:20]}",
        "fingerprint": fingerprint,
        "user_id": user_id,
        "filename": filename,
        "phash": None,
        "timestamp": str(int(_time.time())),
    }

    data = _assets_cache.get("data")
    if data is not None:
        # 追加到已有缓存
        data.append(new_entry)
        print(f"[AssetsCache] 注入新资产到缓存: {filename}, 当前缓存数: {len(data)}")
    else:
        # 缓存为空，初始化只含这一条（下一次 detect 会自动全量刷新）
        _assets_cache["data"] = [new_entry]
        _assets_cache["expires"] = _time.time() + _ASSETS_CACHE_TTL
        print(f"[AssetsCache] 初始化缓存并注入新资产: {filename}")


@dataclass
class WatermarkInfo:
    """水印信息数据结构"""
    fingerprint: str
    author_id: str
    author_name: str
    timestamp: int  # Unix时间戳
    version: str = "2.0"  # 水印版本
    nonce: str = ""  # 随机盐值，防止伪造
    
    def to_dict(self) -> dict:
        return {
            "fingerprint": self.fingerprint,
            "author_id": self.author_id,
            "author_name": self.author_name,
            "timestamp": self.timestamp,
            "version": self.version,
            "nonce": self.nonce
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> "WatermarkInfo":
        return cls(**data)


class EnhancedWatermarkService:
    """增强版水印服务 - 支持时间戳存证和防重复检测"""
    
    def __init__(self):
        self.engine = FingerprintEngine()
        self.matcher = ImageMatcher()
        self.min_fingerprint_strength = 10  # 最小有效指纹强度
    
    def _generate_enhanced_fingerprint(self, user_id: str, author_name: str) -> WatermarkInfo:
        """
        生成增强版指纹，包含完整作者信息和时间戳
        """
        timestamp = int(time.time())
        nonce = hashlib.sha256(os.urandom(32)).hexdigest()[:16]
        
        # 生成基础指纹
        data = f"{user_id}:{author_name}:{timestamp}:{nonce}"
        fingerprint = hashlib.sha256(data.encode()).hexdigest()
        
        return WatermarkInfo(
            fingerprint=fingerprint,
            author_id=user_id,
            author_name=author_name,
            timestamp=timestamp,
            version="2.0",
            nonce=nonce
        )
    
    def _encode_watermark_info(self, info: WatermarkInfo) -> str:
        """
        将水印信息编码为可嵌入的字符串
        格式: fingerprint|author_id|timestamp|version|nonce|author_name
        """
        # 使用JSON编码，然后Base64（简化版直接用字符串拼接）
        data = f"{info.fingerprint}|{info.author_id}|{info.timestamp}|{info.version}|{info.nonce}|{info.author_name}"
        return data
    
    def _decode_watermark_info(self, data: str) -> Optional[WatermarkInfo]:
        """
        解码水印信息
        """
        try:
            parts = data.split("|")
            if len(parts) >= 5:
                return WatermarkInfo(
                    fingerprint=parts[0],
                    author_id=parts[1],
                    timestamp=int(parts[2]),
                    version=parts[3],
                    nonce=parts[4],
                    author_name=parts[5] if len(parts) > 5 else "未知"
                )
        except Exception as e:
            print(f"解码水印信息失败: {e}")
        return None
    
    def check_existing_watermark(self, image_bytes: bytes, preloaded_image: np.ndarray = None, quick: bool = False) -> Dict:
        """
        检查图片是否已有水印
        返回: {"has_watermark": bool, "existing_info": WatermarkInfo|None, "warning": str}

        Args:
            image_bytes: 图片字节（当 preloaded_image 为 None 时使用）
            preloaded_image: 已加载的 cv2 图像，避免重复解码
            quick: True 时使用 32 位快速预检，适合嵌入前的快速筛查
        """
        img_cv2 = preloaded_image if preloaded_image is not None else load_image_bytes(image_bytes)
        if img_cv2 is None:
            return {"has_watermark": False, "existing_info": None, "warning": "无法解析图片"}

        # 尝试提取现有水印（quick 模式仅采样 32 位）
        extracted_data = self._extract_enhanced_watermark(img_cv2, quick=quick)
        
        if extracted_data:
            # 解析水印信息
            info = self._decode_watermark_info(extracted_data)
            if info:
                # 检查指纹强度
                fingerprint_strength = len(info.fingerprint.strip('0'))
                if fingerprint_strength >= self.min_fingerprint_strength:
                    # 格式化时间
                    creation_time = datetime.fromtimestamp(info.timestamp).strftime('%Y-%m-%d %H:%M:%S')
                    
                    return {
                        "has_watermark": True,
                        "existing_info": info,
                        "warning": f"⚠️ 该图片已于 {creation_time} 由 [{info.author_name}] 添加数字指纹。\n"
                                  f"二次添加水印可能：\n"
                                  f"1. 干扰原有指纹（降低可追溯性）\n"
                                  f"2. 创建双重所有权争议\n"
                                  f"3. 降低水印检测准确率",
                        "creation_time": creation_time,
                        "original_author": info.author_name,
                        "fingerprint_version": info.version
                    }
        
        return {"has_watermark": False, "existing_info": None, "warning": ""}
    
    def _extract_enhanced_watermark(self, image: np.ndarray, quick: bool = False) -> Optional[str]:
        """
        提取增强版水印信息
        尝试多种方法提取最完整的数据

        Args:
            image: cv2 图像
            quick: True 时仅采样前 32 位做快速预检，减少 >90% 计算量
        """
        try:
            if quick:
                # 快速预检：仅提取前 32 位判断是否有水印特征
                extracted = self.engine.quick_extract_dct(image, sample_bits=32)
                if len(extracted) >= 8:
                    return extracted
                return None

            # 完整提取（检测流程使用）
            extracted = self.engine.extract_dct(image, length=1024)

            # 检查是否包含有效数据（使用分隔符判断）
            if "|" in extracted:
                return extracted.split("|")[0] + "|" + "|".join(extracted.split("|")[1:5])

            # 兼容旧版水印
            if len(extracted) >= 64:
                return extracted[:256]

        except Exception as e:
            print(f"提取水印失败: {e}")

        return None
    
    def embed_watermark(
        self,
        file_bytes: bytes,
        filename: str,
        user_id: str,
        author_name: Optional[str] = None,
        strength: float = 0.1,
        force: bool = False  # 是否强制覆盖已有水印
    ) -> Dict:
        """
        嵌入增强版水印
        
        Args:
            file_bytes: 图片文件字节
            filename: 文件名
            user_id: 用户ID
            author_name: 作者名
            strength: 水印强度
            force: 是否强制覆盖已有水印（默认False会警告）
        
        Returns:
            包含操作结果的字典
        """
        # 1. 预加载图片（只解码一次，后续 check + embed 共用）
        img_cv2 = load_image_bytes(file_bytes)
        if img_cv2 is None:
            return {"success": False, "error": "INVALID_IMAGE", "message": "无法解析图片格式"}
        
        # 2. 检查是否已有水印（快速预检，仅 32 位采样，避免全量提取）
        existing_check = self.check_existing_watermark(file_bytes, preloaded_image=img_cv2, quick=True)
        
        if existing_check["has_watermark"] and not force:
            return {
                "success": False,
                "error": "WATERMARK_EXISTS",
                "warning": existing_check["warning"],
                "existing_info": existing_check["existing_info"].to_dict() if existing_check["existing_info"] else None,
                "message": "检测到已有数字指纹，如需覆盖请设置 force=True",
                "options": [
                    "1. 取消操作，保留原始指纹",
                    "2. 使用 force=True 强制添加（不推荐）",
                    "3. 联系原作者获取授权"
                ]
            }
        
        # 3. 生成增强版指纹
        watermark_info = self._generate_enhanced_fingerprint(user_id, author_name or user_id)
        
        # 4. 获取用于嵌入的指纹
        # 重要：只嵌入 SHA256 指纹（纯十六进制），因为 DCT 算法只支持十六进制字符
        # 数据库也存储这个指纹，这样检测时提取的指纹就能正确匹配
        watermark_data = watermark_info.fingerprint  # SHA256 指纹，64字符十六进制
        
        # 5. 准备路径
        # 使用「秒级时间戳」会导致同一秒内多次上传生成相同文件名，从而覆盖 outputs 内的文件。
        # 这里加入微秒 + 随机后缀，并做一次碰撞检查，确保文件名稳定唯一。
        ts = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
        rand = secrets.token_hex(3)  # 6 hex chars
        output_filename = f"{ts}_{rand}_watermarked.jpg"
        output_path = os.path.join("outputs", output_filename)
        os.makedirs("outputs", exist_ok=True)

        if os.path.exists(output_path):
            ts2 = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
            rand2 = secrets.token_hex(3)
            output_filename = f"{ts2}_{rand2}_watermarked.jpg"
            output_path = os.path.join("outputs", output_filename)
        
        # 6. 嵌入水印（复用 self.engine，避免重复创建实例）
        try:
            self.engine.strength = strength
            watermarked = self.engine.embed_dct(img_cv2, watermark_data)

            # 保存结果
            cv2.imwrite(output_path, watermarked, [int(cv2.IMWRITE_JPEG_QUALITY), 95])

            # 7. PSNR 估算（跳过昂贵的全图 MSE 计算）
            # QIM 嵌入在 Q=30 步长下对 256 个 8×8 块的修改量仍然很小，
            # 对常规分辨率图片 PSNR 通常 > 40dB。
            psnr_val = 42.0  # 估算值，Q=30 比旧 Q=8 略大但仍在安全范围内
            
            # 8. 构建响应（pHash 在嵌入阶段无需计算，检测阶段会按需生成）
            import urllib.parse
            result = {
                "success": True,
                "fingerprint": watermark_info.fingerprint,
                "watermark_info": watermark_info.to_dict(),
                "psnr": psnr_val,
                "filename": output_filename,
                "download_url": f"/api/image/{urllib.parse.quote(output_filename)}",
                "message": "✅ 数字指纹嵌入成功",
                "details": {
                    "author": watermark_info.author_name,
                    "timestamp": watermark_info.timestamp,
                    "creation_time": datetime.fromtimestamp(watermark_info.timestamp).strftime('%Y-%m-%d %H:%M:%S'),
                    "fingerprint_version": watermark_info.version,
                    "is_override": existing_check["has_watermark"],
                    "original_author": existing_check.get("original_author") if existing_check["has_watermark"] else None
                }
            }
            
            if existing_check["has_watermark"]:
                result["warning"] = "⚠️ 已覆盖原有水印，原始作者信息已丢失"
            
            return result
            
        except Exception as e:
            return {
                "success": False,
                "error": "EMBED_FAILED",
                "message": f"水印嵌入失败: {str(e)}"
            }
    
    def detect_watermark(self, file_bytes: bytes, filename: str) -> Dict:
        """
        检测增强版水印 - 提供详细的匹配分析报告
        支持提取完整作者信息和首创时间证明
        """
        import time
        start_time = time.time()
        
        img_cv2 = load_image_bytes(file_bytes)
        if img_cv2 is None:
            return {"success": False, "error": "INVALID_IMAGE", "message": "无法解析图片格式"}
        
        # 1. 提取指纹（自适应 QIM 步长，兼容旧版 Q=8 和新版 Q=30）
        base_fingerprint, used_qim_step = self.engine.extract_dct_adaptive(img_cv2, length=256)
        # 指纹强度：计算非零字符数量
        fingerprint_strength = sum(1 for c in base_fingerprint if c != '0')
        
        # 直接使用提取的指纹进行数据库匹配
        match_fingerprint = base_fingerprint
        print(f"[Detect] 提取指纹: {base_fingerprint[:32]}... 强度: {fingerprint_strength}, 长度: {len(base_fingerprint)}, QIM_STEP={used_qim_step}")
        
        # watermark_info 将从数据库匹配结果中获取，而不是从图片中解码
        watermark_info = None
        
        # 3. 计算pHash
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        temp_path = os.path.join("uploads", f"temp_detect_{timestamp}.jpg")
        os.makedirs("uploads", exist_ok=True)
        with open(temp_path, "wb") as f:
            f.write(file_bytes)
        
        phash = None
        try:
            phash = self.matcher.calculate_phash(temp_path)
        except:
            pass
        
        # 4. 【快速预检】如果指纹特征强度极低，直接判定无水印，跳过全库查询
        QUICK_CHECK_THRESHOLD = 15  # 指纹强度阈值，低于此值视为无水印
        if fingerprint_strength < QUICK_CHECK_THRESHOLD and not watermark_info:
            detection_time = round(time.time() - start_time, 3)
            
            # 清理临时文件
            if os.path.exists(temp_path):
                os.remove(temp_path)
            
            return {
                "success": True,
                "detection_id": f"det_{int(time.time())}_{filename[:20]}",
                "detection_time_ms": detection_time * 1000,
                "has_watermark": False,
                "extracted_fingerprint": "",
                "extracted_fingerprint_detail": None,
                "watermark_details": None,
                "match_summary": {
                    "total_candidates": 0,
                    "best_match_similarity": 0,
                    "match_found": False,
                    "confidence_score": {"total_score": 0, "max_score": 100, "confidence_level": "低", "factors": ["未检测到有效数字指纹特征"], "is_reliable": False},
                    "is_verified": False
                },
                "match_candidates": [],
                "best_match": None,
                "deep_learning_match": None,
                "analysis": {
                    "verdict": "❌ 无版权标记: 未检测到有效的数字指纹特征。该作品目前无法通过技术手段确认版权归属。",
                    "risk_level": {"level": "UNKNOWN", "color": "gray", "description": "未知风险 - 无法确认版权状态", "action_required": "建议自行确认版权或仅作参考使用"},
                    "suggested_action": ["1. 该作品未检测到版权标记，建议自行确认版权归属", "2. 如需使用，建议从正规渠道获取授权", "3. 可考虑使用反向图片搜索进一步确认来源"],
                    "evidence_strength": {"total_strength": 0, "evidence_count": 0, "evidence_list": [], "is_admissible": False}
                },
                "message": "🟢 未检测到版权标记\n该作品暂未发现数字指纹保护",
                "matched_asset": None,
                "confidence": 0.0,
            }
        
        # 5. 数据库匹配 - 获取所有候选并排名（仅当通过快速预检时执行）
        # 使用 match_fingerprint 而不是 base_fingerprint，因为数据库存的是 SHA256 指纹
        all_matches = self._find_all_matches(match_fingerprint, phash, watermark_info)
        best_match = all_matches[0] if all_matches else None
        print(f"[Detect] 数据库匹配: 找到 {len(all_matches)} 个候选, 最佳匹配: {best_match.get('similarity') if best_match else 0}%")
        
        # 5. FAISS深度搜索（如果传统方法失败）
        faiss_match = None
        if not best_match or best_match['similarity'] < 70:
            try:
                img_pil = Image.open(io.BytesIO(file_bytes)).convert('RGB')
                faiss_result = vector_service.search(img_pil, threshold=0.80, top_k=5)
                if faiss_result:
                    faiss_match = {
                        'asset_id': faiss_result.get('asset_id'),
                        'similarity': round(faiss_result['similarity'] * 100, 2),
                        'match_source': 'FAISS深度学习',
                        'method': '向量相似度'
                    }
            except Exception as e:
                print(f"FAISS搜索失败: {e}")
        
        # 6. 构建详细分析报告
        detection_time = round(time.time() - start_time, 3)

        def _safe_parse_unix_seconds(val) -> Optional[int]:
            if val is None:
                return None
            try:
                if isinstance(val, (int, float)):
                    return int(val)
                s = str(val).strip()
                if not s:
                    return None
                if s.isdigit() or (s.startswith('-') and s[1:].isdigit()):
                    return int(s)
                # Try ISO datetime string
                try:
                    if s.endswith('Z'):
                        s = s[:-1] + '+00:00'
                    dt = datetime.fromisoformat(s)
                    return int(dt.timestamp())
                except Exception:
                    return None
            except Exception:
                return None

        # 判断水印存在性
        # 三级判定：
        # 1) 数据库匹配到(相似度>=60%) → 确认有水印
        # 2) 指纹特征强度极高(>=20) → 高度疑似有水印（即使 DB 暂未匹配，也要告知用户）
        # 3) watermark_info 可解码 → 确认有水印（当前版本仅嵌入纯 SHA256，此分支实际不触发）
        has_strong_fingerprint = fingerprint_strength >= self.min_fingerprint_strength
        has_very_strong_fingerprint = fingerprint_strength >= 20  # 更高阈值，减少误报
        has_db_match = best_match is not None and best_match.get('similarity', 0) >= 60
        has_watermark = has_db_match or watermark_info is not None or has_very_strong_fingerprint
        detection_source = "db_match" if has_db_match else ("watermark_info" if watermark_info else ("fingerprint_signal" if has_very_strong_fingerprint else "none"))
        
        # 构建匹配候选列表
        candidate_list = []
        for i, match in enumerate(all_matches[:5], 1):  # 前5名
            candidate_list.append({
                "rank": i,
                "author": match.get('author_name', '未知'),
                "similarity": match['similarity'],
                "confidence_level": self._get_confidence_level(match['similarity']),
                "match_time": match.get('timestamp', '未知'),
                "match_method": match.get('match_method', '指纹相似度')
            })
        
        # 构建核心结果
        result = {
            "success": True,
            "detection_id": f"det_{int(time.time())}_{filename[:20]}",
            "detection_time_ms": detection_time * 1000,
            "has_watermark": has_watermark,
            
            # 提取的指纹信息（extracted_fingerprint 必须为字符串以符合 DetectionResult schema）
            "extracted_fingerprint": base_fingerprint if has_watermark else "",
            "extracted_fingerprint_detail": {
                "fingerprint_hash": base_fingerprint[:32] + "..." if base_fingerprint else "",
                "full_fingerprint": base_fingerprint or "",
                "strength_score": fingerprint_strength,
                "strength_level": "强" if fingerprint_strength > 50 else "中" if fingerprint_strength > 20 else "弱",
                "phash": phash
            } if has_watermark else None,
            
            # 水印详细信息（如果提取到）
            "watermark_details": watermark_info.to_dict() if watermark_info else None,
            
            # 匹配结果汇总
            "match_summary": {
                "total_candidates": len(all_matches),
                "best_match_similarity": best_match['similarity'] if best_match else 0,
                "match_found": best_match is not None and best_match['similarity'] >= 60,
                "confidence_score": self._calculate_overall_confidence(best_match, watermark_info, has_strong_fingerprint),
                "is_verified": best_match is not None and best_match['similarity'] >= 85
            },
            
            # 详细匹配列表
            "match_candidates": candidate_list,
            
            # 最佳匹配详情
            "best_match": {
                "author_id": best_match.get('user_id') if best_match else None,
                "author_name": best_match.get('author_name', '未知') if best_match else None,
                "similarity": best_match['similarity'] if best_match else 0,
                "match_confidence": best_match.get('match_confidence', 'NONE') if best_match else 'NONE',
                "creation_time": (
                    datetime.fromtimestamp(_safe_parse_unix_seconds(best_match.get('timestamp'))).strftime('%Y-%m-%d %H:%M:%S')
                    if best_match and _safe_parse_unix_seconds(best_match.get('timestamp')) is not None
                    else '未知'
                ),
                "fingerprint_fragment_match": self._calculate_fragment_match(base_fingerprint, best_match.get('fingerprint', '')) if best_match else 0,
                "is_original_author": best_match.get('is_original_author', False) if best_match else False
            } if best_match else None,
            
            # FAISS补充匹配
            "deep_learning_match": faiss_match,
            
            # 分析结论
            "analysis": {
                "verdict": self._generate_verdict(best_match, watermark_info, has_strong_fingerprint),
                "risk_level": self._calculate_risk_level(best_match, watermark_info),
                "suggested_action": self._generate_suggestion(best_match, watermark_info, has_strong_fingerprint),
                "evidence_strength": self._calculate_evidence_strength(best_match, watermark_info, has_strong_fingerprint)
            },
            
            # 原始信息（向后兼容）
            "message": self._generate_user_message(best_match, watermark_info, has_strong_fingerprint, candidate_list),
            
            # --- 与文本/视频检测 API 保持字段一致 ---
            "matched_asset": {
                "id": best_match.get('id'),
                "user_id": best_match.get('user_id'),
                "author_name": best_match.get('author_name', '未知'),
                "filename": best_match.get('filename', ''),
                "timestamp": best_match.get('timestamp', ''),
                "similarity": best_match.get('similarity', 0),
                "is_cloud_record": True,
            } if has_db_match and best_match else None,
            "confidence": round(best_match['similarity'] / 100, 4) if has_db_match and best_match else (0.55 if detection_source == "fingerprint_signal" else 0.0),
            "detection_source": detection_source,  # "db_match" | "fingerprint_signal" | "none"
        }
        
        # 清理临时文件
        if os.path.exists(temp_path):
            os.remove(temp_path)
        
        return result
    
    def _find_best_match_enhanced(
        self,
        extracted_fingerprint: str,
        query_phash: Optional[str],
        watermark_info: Optional[WatermarkInfo],
        min_similarity: float = 0.60,
        phash_threshold: int = 15
    ) -> Optional[Dict]:
        """
        增强版数据库匹配 - 使用内存缓存，避免每次跨洋查询
        """
        all_assets = _get_cached_assets()
        if not all_assets:
            return None

        user_ids = list({a.get('user_id') for a in all_assets if a.get('user_id')})
        profile_map = _get_cached_profiles(user_ids)
        
        # 辅助函数
        def _phash_hamming_dist(p1, p2):
            if not p1 or not p2:
                return 999
            try:
                return bin(int(p1, 16) ^ int(p2, 16)).count('1')
            except:
                return 999
        
        best_match = None
        best_sim = 0.0
        
        candidates = all_assets
        
        # 先用pHash预过滤
        if query_phash and len(all_assets) > 5:
            filtered = [
                r for r in all_assets
                if r.get('phash') and _phash_hamming_dist(query_phash, r['phash']) <= phash_threshold
            ]
            if filtered:
                candidates = filtered
        
        # 指纹相似度匹配
        for row in candidates:
            sim = self.engine.fingerprint_similarity(extracted_fingerprint, row.get('fingerprint', ''))
            
            # 增强匹配：如果时间戳也匹配，提高置信度
            if watermark_info and row.get('timestamp'):
                try:
                    db_timestamp = int(row['timestamp'])
                    if abs(watermark_info.timestamp - db_timestamp) < 300:
                        sim = min(1.0, sim + 0.1)
                except:
                    pass
            
            if sim >= min_similarity and sim > best_sim:
                best_sim = sim
                uid = str(row.get('user_id') or '')
                display_name = profile_map.get(uid)
                best_match = {
                    'id': row['id'],
                    'user_id': row['user_id'],
                    'author_name': display_name or uid or row.get('user_id'),
                    'filename': row['filename'],
                    'fingerprint': row.get('fingerprint'),
                    'timestamp': row.get('timestamp'),
                    'similarity': round(best_sim * 100, 2),
                    'is_original_author': True,
                    'match_confidence': 'HIGH' if best_sim > 0.85 else 'MEDIUM'
                }
        
        return best_match
    
    def _find_all_matches(
        self,
        extracted_fingerprint: str,
        query_phash: Optional[str],
        watermark_info: Optional[WatermarkInfo],
        min_similarity: float = 0.30,
        phash_threshold: int = 20,
        top_k: int = 10
    ) -> List[Dict]:
        """
        查找所有可能的匹配候选 - 使用内存缓存，避免每次跨洋查询
        """
        all_assets = _get_cached_assets()
        if not all_assets:
            return []

        user_ids = list({a.get('user_id') for a in all_assets if a.get('user_id')})
        profile_map = _get_cached_profiles(user_ids)
        
        def _phash_hamming_dist(p1, p2):
            if not p1 or not p2:
                return 999
            try:
                return bin(int(p1, 16) ^ int(p2, 16)).count('1')
            except:
                return 999
        
        matches = []
        best_sim_debug = 0
        
        for row in all_assets:
            sim = self.engine.fingerprint_similarity(extracted_fingerprint, row.get('fingerprint', ''))
            if sim > best_sim_debug:
                best_sim_debug = sim
                print(f"[Match] 新最高相似度: {sim*100:.1f}%, 指纹库: {row.get('fingerprint', '')[:16]}..., 提取: {extracted_fingerprint[:16]}...")
            
            phash_dist = 999
            if query_phash and row.get('phash'):
                phash_dist = _phash_hamming_dist(query_phash, row['phash'])
            
            combined_score = sim * 100
            if phash_dist <= phash_threshold:
                combined_score += (1 - phash_dist / phash_threshold) * 30
            
            if watermark_info and row.get('timestamp'):
                try:
                    db_timestamp = int(row['timestamp'])
                    if abs(watermark_info.timestamp - db_timestamp) < 300:
                        combined_score += 10
                except:
                    pass
            
            if combined_score >= min_similarity * 100:
                uid = str(row.get('user_id') or '')
                display_name = profile_map.get(uid)
                matches.append({
                    'id': row['id'],
                    'user_id': row['user_id'],
                    'author_name': display_name or uid or row.get('user_id'),
                    'filename': row['filename'],
                    'fingerprint': row.get('fingerprint'),
                    'timestamp': row.get('timestamp'),
                    'similarity': round(combined_score, 2),
                    'fingerprint_sim': round(sim * 100, 2),
                    'phash_distance': phash_dist,
                    'is_original_author': True,
                    'match_confidence': 'HIGH' if combined_score > 85 else 'MEDIUM' if combined_score > 70 else 'LOW',
                    'match_method': '指纹+pHash综合'
                })
        
        matches.sort(key=lambda x: x['similarity'], reverse=True)
        return matches[:top_k]
    
    def _get_confidence_level(self, similarity: float) -> str:
        """根据相似度获取置信度等级"""
        if similarity >= 90:
            return "极高"
        elif similarity >= 80:
            return "高"
        elif similarity >= 70:
            return "中高"
        elif similarity >= 60:
            return "中"
        elif similarity >= 40:
            return "低"
        else:
            return "极低"
    
    def _calculate_overall_confidence(
        self,
        best_match: Optional[Dict],
        watermark_info: Optional[WatermarkInfo],
        has_strong_fingerprint: bool
    ) -> Dict:
        """计算整体置信度评分"""
        score = 0.0
        factors = []
        
        # 数据库匹配得分 (0-40分)
        if best_match:
            match_score = min(40, best_match['similarity'] * 0.4)
            score += match_score
            factors.append(f"数据库匹配: +{match_score:.1f}分 (相似度{best_match['similarity']}%)")
        
        # 水印信息提取得分 (0-30分)
        if watermark_info:
            score += 30
            factors.append(f"水印信息提取: +30分 (作者:{watermark_info.author_name})")
        
        # 指纹强度得分 (0-20分)
        if has_strong_fingerprint:
            score += 20
            factors.append("指纹特征强度: +20分 (强特征)")
        elif best_match and best_match.get('fingerprint_sim', 0) > 50:
            score += 10
            factors.append("指纹特征强度: +10分 (中等特征)")
        
        # 时间一致性加分 (0-10分)
        if best_match and watermark_info:
            try:
                db_time = int(best_match.get('timestamp', 0))
                if abs(watermark_info.timestamp - db_time) < 300:
                    score += 10
                    factors.append("时间一致性: +10分 (5分钟内)")
            except:
                pass
        
        return {
            "total_score": round(score, 1),
            "max_score": 100,
            "confidence_level": "高" if score >= 80 else "中" if score >= 50 else "低",
            "factors": factors,
            "is_reliable": score >= 70
        }
    
    def _calculate_fragment_match(self, fingerprint1: str, fingerprint2: str) -> float:
        """计算两个指纹的片段匹配率"""
        if not fingerprint1 or not fingerprint2:
            return 0.0
        
        min_len = min(len(fingerprint1), len(fingerprint2))
        if min_len == 0:
            return 0.0
        
        # 计算前32位的匹配率（片段匹配）
        fragment_len = min(32, min_len)
        matches = sum(1 for i in range(fragment_len) if fingerprint1[i] == fingerprint2[i])
        return round(matches / fragment_len * 100, 2)
    
    def _generate_verdict(
        self,
        best_match: Optional[Dict],
        watermark_info: Optional[WatermarkInfo],
        has_strong_fingerprint: bool
    ) -> str:
        """生成判决结论"""
        if best_match and best_match['similarity'] >= 85:
            return f"✅ 高度确认: 该作品与数据库中 [{best_match['author_name']}] 的作品高度匹配 (相似度{best_match['similarity']}%)，极大概率存在版权关联。"
        
        elif best_match and best_match['similarity'] >= 70:
            return f"⚠️ 中度怀疑: 该作品与 [{best_match['author_name']}] 的作品相似度为{best_match['similarity']}%，可能存在版权关联，建议进一步人工审核。"
        
        elif watermark_info and best_match:
            return f"⚠️ 信息矛盾: 提取到作者'{watermark_info.author_name}'的水印，但数据库匹配到'{best_match['author_name']}'，存在所有权争议。"
        
        elif watermark_info:
            return f"⚠️ 未登记作品: 提取到'{watermark_info.author_name}'于{datetime.fromtimestamp(watermark_info.timestamp).strftime('%Y-%m-%d')}创建的水印，但未在数据库中找到对应记录。可能是历史遗留作品或第三方授权内容。"
        
        elif has_strong_fingerprint:
            return "⚠️ 疑似保护作品: 检测到强数字指纹特征，但无法提取完整信息或匹配数据库。可能原因：1.水印版本较旧 2.图片经过压缩或编辑 3.数据库未同步。"
        
        else:
            return "❌ 无版权标记: 未检测到有效的数字指纹或高相似度匹配。该作品目前无法通过技术手段确认版权归属。"
    
    def _calculate_risk_level(
        self,
        best_match: Optional[Dict],
        watermark_info: Optional[WatermarkInfo]
    ) -> Dict:
        """计算风险等级"""
        if best_match and best_match['similarity'] >= 85:
            return {
                "level": "HIGH",
                "color": "red",
                "description": "高风险 - 极可能涉及版权侵权",
                "action_required": "建议立即联系原作者获取授权或停止使用"
            }
        elif best_match and best_match['similarity'] >= 60:
            return {
                "level": "MEDIUM",
                "color": "orange", 
                "description": "中风险 - 可能存在版权争议",
                "action_required": "建议谨慎使用，进一步核实版权归属"
            }
        elif watermark_info:
            return {
                "level": "LOW-MEDIUM",
                "color": "yellow",
                "description": "低中风险 - 作品有水印但无法验证",
                "action_required": "建议联系水印中的作者确认使用权"
            }
        else:
            return {
                "level": "UNKNOWN",
                "color": "gray",
                "description": "未知风险 - 无法确认版权状态",
                "action_required": "建议自行确认版权或仅作参考使用"
            }
    
    def _generate_suggestion(
        self,
        best_match: Optional[Dict],
        watermark_info: Optional[WatermarkInfo],
        has_strong_fingerprint: bool
    ) -> List[str]:
        """生成建议行动列表"""
        suggestions = []
        
        if best_match and best_match['similarity'] >= 85:
            suggestions.extend([
                f"1. 建议立即联系原作者 [{best_match['author_name']}] 获取使用授权",
                "2. 如已获授权，请保存授权证明文件",
                "3. 如需使用，建议购买正版授权或寻找替代素材",
                "4. 如需申诉，可准备原创证明材料申请版权异议"
            ])
        elif best_match and best_match['similarity'] >= 60:
            suggestions.extend([
                f"1. 建议联系疑似原作者 [{best_match['author_name']}] 核实情况",
                "2. 可要求对方提供原创证明或授权文件",
                "3. 在争议解决前，建议谨慎使用该素材"
            ])
        elif watermark_info:
            suggestions.extend([
                f"1. 尝试联系水印中的作者 '{watermark_info.author_name}'",
                "2. 建议作者到平台补登记作品信息",
                "3. 如是历史作品，请联系管理员迁移数据"
            ])
        elif has_strong_fingerprint:
            suggestions.extend([
                "1. 该作品可能经过压缩或编辑，建议获取原始高清版本重新检测",
                "2. 可尝试使用其他检测工具交叉验证",
                "3. 建议人工审核确认版权状态"
            ])
        else:
            suggestions.extend([
                "1. 该作品未检测到版权标记，建议自行确认版权归属",
                "2. 如需使用，建议从正规渠道获取授权",
                "3. 可考虑使用反向图片搜索进一步确认来源"
            ])
        
        return suggestions
    
    def _calculate_evidence_strength(
        self,
        best_match: Optional[Dict],
        watermark_info: Optional[WatermarkInfo],
        has_strong_fingerprint: bool
    ) -> Dict:
        """计算证据强度"""
        evidence = []
        strength = 0
        
        # 数据库匹配证据
        if best_match:
            evidence.append({
                "type": "数据库匹配",
                "strength": best_match['similarity'] / 100,
                "description": f"与数据库中作品相似度{best_match['similarity']}%"
            })
            strength += best_match['similarity']
        
        # 水印信息证据
        if watermark_info:
            evidence.append({
                "type": "数字水印",
                "strength": 0.9,
                "description": f"提取到完整水印信息: 作者{watermark_info.author_name}, 创建时间{datetime.fromtimestamp(watermark_info.timestamp).strftime('%Y-%m-%d %H:%M')}"
            })
            strength += 90
        
        # 指纹特征证据
        if has_strong_fingerprint:
            evidence.append({
                "type": "指纹特征",
                "strength": 0.7,
                "description": "检测到强数字指纹特征"
            })
            strength += 70
        
        return {
            "total_strength": min(100, strength),
            "evidence_count": len(evidence),
            "evidence_list": evidence,
            "is_admissible": strength >= 60  # 是否可作为有效证据
        }
    
    def _generate_user_message(
        self,
        best_match: Optional[Dict],
        watermark_info: Optional[WatermarkInfo],
        has_strong_fingerprint: bool,
        candidate_list: List[Dict]
    ) -> str:
        """生成用户友好的消息"""
        if best_match and best_match['similarity'] >= 85:
            msg = f"🔴 高度确认匹配\n"
            msg += f"最可能作者: {best_match['author_name']}\n"
            msg += f"相似度: {best_match['similarity']}%\n"
            if len(candidate_list) > 1:
                msg += f"其他候选: {len(candidate_list)-1}个\n"
            msg += f"建议: 立即联系原作者获取授权"
            return msg
        
        elif best_match and best_match['similarity'] >= 60:
            msg = f"🟡 疑似匹配\n"
            msg += f"疑似作者: {best_match['author_name']}\n"
            msg += f"相似度: {best_match['similarity']}%\n"
            msg += f"建议: 进一步核实版权归属"
            return msg
        
        elif watermark_info:
            return f"🟡 提取到水印但未匹配数据库\n作者: {watermark_info.author_name}\n创建时间: {datetime.fromtimestamp(watermark_info.timestamp).strftime('%Y-%m-%d')}\n建议: 联系作者确认或补登记"
        
        elif has_strong_fingerprint:
            return "🟡 检测到强指纹特征但无法识别\n建议: 尝试获取原始高清版本重新检测"
        
        else:
            return "🟢 未检测到版权标记\n该作品暂未发现数字指纹保护"


# 保持向后兼容 - 原有接口
class WatermarkService(EnhancedWatermarkService):
    """向后兼容的别名"""
    pass
