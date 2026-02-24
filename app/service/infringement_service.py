"""
简化版侵权监测服务（方案A）
用户主动提交疑似侵权链接，系统自动检测比对
不消耗免费额度，按需运行，精准有效
"""

import httpx
import io
import os
import hashlib
import logging
from datetime import datetime
from typing import Dict, Optional, List
from dataclasses import dataclass
from PIL import Image

from app.service.enhanced_watermark import EnhancedWatermarkService
from app.utils.image import load_image_bytes
from app.service.ai_assistant import AIAssistantService

logger = logging.getLogger("app")


@dataclass
class InfringementReport:
    """侵权举报数据结构"""
    report_id: str
    reporter_id: str
    reporter_name: str
    my_asset_id: int  # 用户自己的作品ID
    my_asset_fingerprint: str
    infringing_url: str
    infringing_image_hash: Optional[str]  # 下载图片的hash
    similarity_score: float
    confidence_level: str
    is_infringing: bool
    evidence_screenshot_url: Optional[str]
    status: str  # pending/confirmed/rejected
    created_at: str
    analysis_result: Dict


class InfringementService:
    """
    简化版侵权监测服务
    用户主动发现 → 提交链接 → 系统自动检测 → 生成报告
    """
    
    def __init__(self):
        self.watermark_service = EnhancedWatermarkService()
        self.min_similarity_threshold = 70.0  # 最低相似度阈值
        self.max_image_size = 10 * 1024 * 1024  # 最大10MB
    
    async def report_infringement(
        self,
        reporter_id: str,
        reporter_name: str,
        my_asset_id: int,
        infringing_url: str,
        description: str = ""
    ) -> Dict:
        """
        用户提交侵权举报
        
        流程：
        1. 验证用户作品是否存在
        2. 下载疑似侵权图片
        3. 提取指纹并比对
        4. 生成分析报告
        5. 保存举报记录
        
        Returns:
            检测结果和维权建议
        """
        from app.utils.supabase import get_supabase_service_client
        
        sb = get_supabase_service_client()
        if not sb:
            return {"success": False, "error": "数据库连接失败"}
        
        # 1. 获取用户自己的作品信息
        try:
            asset_res = sb.table("watermarked_assets").select("*").eq("id", my_asset_id).execute()
            if not asset_res.data:
                return {"success": False, "error": "未找到您的作品，请确认asset_id正确"}
            
            my_asset = asset_res.data[0]
            my_fingerprint = my_asset.get("fingerprint", "")
            my_filename = my_asset.get("filename", "")
            
            # 检查是否是该用户的作品
            if my_asset.get("user_id") != reporter_id:
                return {"success": False, "error": "您只能举报自己的作品被侵权"}
                
        except Exception as e:
            logger.error(f"获取作品信息失败: {e}")
            return {"success": False, "error": f"获取作品信息失败: {str(e)}"}
        
        # 2. 下载疑似侵权图片
        try:
            download_result = await self._download_image(infringing_url)
            if not download_result["success"]:
                return {
                    "success": False, 
                    "error": f"无法下载侵权链接图片: {download_result.get('error', '未知错误')}"
                }
            
            infringing_image_bytes = download_result["image_bytes"]
            infringing_image_hash = download_result["image_hash"]
            
        except Exception as e:
            logger.error(f"下载侵权图片失败: {e}")
            return {"success": False, "error": f"下载图片失败: {str(e)}"}
        
        # 3. 检测下载的图片是否有水印
        try:
            detection_result = self.watermark_service.detect_watermark(
                infringing_image_bytes,
                "infringing_image.jpg"
            )
        except Exception as e:
            logger.error(f"检测侵权图片失败: {e}")
            detection_result = {"success": True, "has_watermark": False, "message": "检测失败"}
        
        # 4. 直接指纹比对（最准确的方法）
        similarity_result = self._direct_fingerprint_compare(
            my_fingerprint,
            detection_result.get("extracted_fingerprint", {}).get("full_fingerprint", "") if isinstance(detection_result.get("extracted_fingerprint"), dict) else detection_result.get("extracted_fingerprint", "")
        )
        
        # 5. 综合判断
        final_similarity = max(
            similarity_result["similarity"],
            detection_result.get("match_summary", {}).get("best_match_similarity", 0) if isinstance(detection_result.get("match_summary"), dict) else 0
        )
        
        is_infringing = final_similarity >= self.min_similarity_threshold
        
        # 6. 生成报告ID
        report_id = f"INF_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{hashlib.md5(infringing_url.encode()).hexdigest()[:8]}"
        
        # 7. 构建分析报告
        analysis = {
            "my_asset": {
                "id": my_asset_id,
                "filename": my_filename,
                "fingerprint_prefix": my_fingerprint[:32] if my_fingerprint else "N/A"
            },
            "infringing_source": {
                "url": infringing_url,
                "image_hash": infringing_image_hash,
                "download_success": True
            },
            "fingerprint_comparison": similarity_result,
            "detection_analysis": detection_result.get("analysis", {}) if isinstance(detection_result, dict) else {},
            "final_similarity": final_similarity,
            "confidence_level": self._get_confidence_level(final_similarity),
            "is_infringing": is_infringing,
            "threshold_used": self.min_similarity_threshold
        }
        
        # 8. 保存举报记录到数据库
        try:
            report_data = {
                "report_id": report_id,
                "reporter_id": reporter_id,
                "reporter_name": reporter_name,
                "my_asset_id": my_asset_id,
                "infringing_url": infringing_url,
                "description": description,
                "similarity_score": final_similarity,
                "confidence_level": analysis["confidence_level"],
                "is_infringing": is_infringing,
                "status": "confirmed" if is_infringing else "pending_review",
                "analysis_result": analysis,
                "created_at": datetime.now().isoformat()
            }
            
            sb.table("infringement_reports").insert(report_data).execute()
            
        except Exception as e:
            logger.error(f"保存举报记录失败: {e}")
            # 不阻断，继续返回结果
        
        # 9. 生成维权建议
        recommendations = self._generate_infringement_recommendations(
            is_infringing,
            final_similarity,
            my_asset,
            infringing_url
        )
        
        # 10. 生成对比图（如果确认侵权）
        evidence_url = None
        if is_infringing:
            try:
                evidence_url = await self._generate_evidence_image(
                    my_asset_id,
                    infringing_image_bytes,
                    final_similarity
                )
            except Exception as e:
                logger.error(f"生成证据图失败: {e}")
        
        return {
            "success": True,
            "report_id": report_id,
            "is_infringing": is_infringing,
            "similarity_score": final_similarity,
            "confidence_level": analysis["confidence_level"],
            "analysis": analysis,
            "recommendations": recommendations,
            "evidence_url": evidence_url,
            "next_steps": [
                "1. 如确认侵权，可点击'生成DMCA函'自动创建维权通知",
                "2. 保存本报告作为证据材料",
                "3. 联系侵权平台提交下架申请",
                "4. 如需法律援助，可导出报告咨询专业律师"
            ] if is_infringing else [
                "1. 相似度未达到侵权阈值，可能不构成侵权",
                "2. 您仍可向平台投诉，但胜诉概率较低",
                "3. 建议收集更多证据后再提交",
                "4. 如确定是侵权，可联系管理员人工复核"
            ]
        }
    
    async def _download_image(self, url: str) -> Dict:
        """
        下载网络图片
        """
        try:
            async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
                # 添加常见浏览器请求头，避免被反爬
                headers = {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Accept": "image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                    "Accept-Encoding": "gzip, deflate, br",
                    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
                }
                
                response = await client.get(url, headers=headers)
                response.raise_for_status()
                
                image_bytes = response.content
                
                # 检查文件大小
                if len(image_bytes) > self.max_image_size:
                    return {
                        "success": False,
                        "error": f"图片过大({len(image_bytes)//1024//1024}MB)，超过{self.max_image_size//1024//1024}MB限制"
                    }
                
                # 计算hash
                image_hash = hashlib.md5(image_bytes).hexdigest()
                
                return {
                    "success": True,
                    "image_bytes": image_bytes,
                    "image_hash": image_hash,
                    "content_type": response.headers.get("content-type", "unknown"),
                    "size": len(image_bytes)
                }
                
        except httpx.HTTPStatusError as e:
            return {"success": False, "error": f"HTTP错误 {e.response.status_code}: 无法访问该链接"}
        except httpx.RequestError as e:
            return {"success": False, "error": f"网络请求失败: {str(e)}"}
        except Exception as e:
            return {"success": False, "error": f"下载失败: {str(e)}"}
    
    def _direct_fingerprint_compare(self, fingerprint1: str, fingerprint2: str) -> Dict:
        """
        直接比对两个指纹的相似度
        """
        if not fingerprint1 or not fingerprint2:
            return {"similarity": 0, "method": "direct_compare", "error": "指纹为空"}
        
        try:
            # 使用指纹引擎的相似度计算
            similarity = self.watermark_service.engine.fingerprint_similarity(fingerprint1, fingerprint2)
            
            return {
                "similarity": round(similarity * 100, 2),
                "method": "direct_fingerprint_compare",
                "fingerprint1_length": len(fingerprint1),
                "fingerprint2_length": len(fingerprint2),
                "common_prefix": self._get_common_prefix(fingerprint1, fingerprint2)
            }
        except Exception as e:
            logger.error(f"指纹比对失败: {e}")
            return {"similarity": 0, "method": "direct_compare", "error": str(e)}
    
    def _get_common_prefix(self, s1: str, s2: str, max_check: int = 32) -> str:
        """获取两个字符串的共同前缀"""
        common = []
        for i in range(min(len(s1), len(s2), max_check)):
            if s1[i] == s2[i]:
                common.append(s1[i])
            else:
                break
        return "".join(common) if common else "无"
    
    def _get_confidence_level(self, similarity: float) -> str:
        """根据相似度获取置信度等级"""
        if similarity >= 90:
            return "极高 - 几乎可以确定为同一作品"
        elif similarity >= 80:
            return "高 - 高度疑似侵权"
        elif similarity >= 70:
            return "中高 - 可能相关，建议人工复核"
        elif similarity >= 60:
            return "中等 - 有一定相似性"
        elif similarity >= 40:
            return "低 - 相似度较低"
        else:
            return "极低 - 基本可以排除"
    
    def _generate_infringement_recommendations(
        self,
        is_infringing: bool,
        similarity: float,
        my_asset: Dict,
        infringing_url: str
    ) -> List[str]:
        """生成维权建议"""
        recommendations = []
        
        if is_infringing:
            recommendations.extend([
                f"✅ **相似度{similarity}%确认侵权**",
                f"1. **立即行动**：向平台提交DMCA下架通知",
                f"2. **保存证据**：截图保存侵权页面，下载侵权图片",
                f"3. **生成函件**：使用系统自动生成律师函",
                f"4. **时间戳固化**：建议将证据区块链存证",
                f"5. **联系平台**：{self._extract_domain(infringing_url)} 的客服/版权部门",
                f"6. **法律途径**：如平台不处理，可准备诉讼材料"
            ])
        else:
            recommendations.extend([
                f"⚠️ **相似度{similarity}%未达侵权标准**",
                f"1. 可能原因：",
                f"   - 图片经过大幅编辑/压缩",
                f"   - 只是风格相似，并非同一作品",
                f"   - 属于合理使用的范围",
                f"2. 建议：",
                f"   - 如仍认为是侵权，可联系管理员人工复核",
                f"   - 收集更多相似证据（多个平台）",
                f"   - 咨询专业律师意见"
            ])
        
        return recommendations
    
    def _extract_domain(self, url: str) -> str:
        """从URL提取域名"""
        try:
            from urllib.parse import urlparse
            parsed = urlparse(url)
            return parsed.netloc or "未知平台"
        except:
            return "未知平台"
    
    async def _generate_evidence_image(
        self,
        my_asset_id: int,
        infringing_image_bytes: bytes,
        similarity: float
    ) -> Optional[str]:
        """
        生成证据对比图（原始作品 vs 侵权图片）
        并排显示，标注相似度
        """
        try:
            # 获取原始作品图片
            from app.utils.supabase import get_supabase_service_client
            sb = get_supabase_service_client()
            
            asset_res = sb.table("watermarked_assets").select("filename").eq("id", my_asset_id).execute()
            if not asset_res.data:
                return None
            
            original_filename = asset_res.data[0]["filename"]
            original_path = os.path.join("outputs", original_filename)
            
            if not os.path.exists(original_path):
                return None
            
            # 加载两张图片
            original_img = Image.open(original_path)
            infringing_img = Image.open(io.BytesIO(infringing_image_bytes))
            
            # 统一尺寸
            target_height = 400
            orig_width = int(original_img.width * (target_height / original_img.height))
            infr_width = int(infringing_img.width * (target_height / infringing_img.height))
            
            original_img = original_img.resize((orig_width, target_height), Image.Resampling.LANCZOS)
            infringing_img = infringing_img.resize((infr_width, target_height), Image.Resampling.LANCZOS)
            
            # 创建对比图
            total_width = orig_width + infr_width + 20  # 中间留20px间隔
            combined = Image.new('RGB', (total_width, target_height + 60), 'white')
            
            # 粘贴图片
            combined.paste(original_img, (0, 30))
            combined.paste(infringing_img, (orig_width + 20, 30))
            
            # 添加文字标注
            from PIL import ImageDraw, ImageFont
            draw = ImageDraw.Draw(combined)
            
            # 尝试加载字体
            try:
                font = ImageFont.truetype("arial.ttf", 20)
                small_font = ImageFont.truetype("arial.ttf", 16)
            except:
                font = ImageFont.load_default()
                small_font = font
            
            # 顶部标注
            draw.text((10, 5), "原始作品（您的）", fill='black', font=font)
            draw.text((orig_width + 30, 5), f"疑似侵权（相似度{similarity}%）", fill='red' if similarity >= 70 else 'orange', font=font)
            
            # 底部标注
            footer_text = f"智御AIGC版权卫士生成 | 检测时间: {datetime.now().strftime('%Y-%m-%d %H:%M')}"
            draw.text((10, target_height + 35), footer_text, fill='gray', font=small_font)
            
            # 保存
            evidence_filename = f"evidence_{my_asset_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jpg"
            evidence_path = os.path.join("outputs", evidence_filename)
            combined.save(evidence_path, "JPEG", quality=95)
            
            return f"/api/image/{evidence_filename}"
            
        except Exception as e:
            logger.error(f"生成证据图失败: {e}")
            return None
    
    async def generate_dmca_notice(self, report_id: str, user_id: str) -> Dict:
        """
        为确认的侵权举报生成DMCA下架函
        """
        from app.utils.supabase import get_supabase_service_client
        
        sb = get_supabase_service_client()
        if not sb:
            return {"success": False, "error": "数据库连接失败"}
        
        # 获取举报记录
        try:
            report_res = sb.table("infringement_reports").select("*").eq("report_id", report_id).execute()
            if not report_res.data:
                return {"success": False, "error": "未找到举报记录"}
            
            report = report_res.data[0]
            
            # 检查权限 - 使用 id (UUID) 查询
            if report.get("reporter_id") != user_id:
                # 检查是否是admin
                user_res = sb.table("profiles").select("role").eq("id", user_id).execute()
                is_admin = user_res.data and user_res.data[0].get("role") in ["admin", "行政"]
                if not is_admin:
                    return {"success": False, "error": "无权为此举报生成函件"}
            
            # 获取作品信息
            my_asset_id = report.get("my_asset_id")
            asset_res = sb.table("watermarked_assets").select("*").eq("id", my_asset_id).execute()
            if not asset_res.data:
                return {"success": False, "error": "未找到作品信息"}
            
            asset = asset_res.data[0]
            author_name = report.get("reporter_name", user_id)
            asset_name = asset.get("filename", "未知作品")
            infringing_url = report.get("infringing_url", "")
            similarity = report.get("similarity_score", 0)
            
            # 生成DMCA函
            notice_text = await AIAssistantService.generate_takedown_notice(
                author_name=author_name,
                asset_name=asset_name,
                infringing_url=infringing_url
            )
            
            # 保存到数据库
            sb.table("infringement_reports").update({
                "dmca_notice": notice_text,
                "status": "dmca_generated"
            }).eq("report_id", report_id).execute()
            
            return {
                "success": True,
                "report_id": report_id,
                "dmca_notice": notice_text,
                "similarity_cited": similarity,
                "note": "请根据实际情况修改落款信息后再发送"
            }
            
        except Exception as e:
            logger.error(f"生成DMCA函失败: {e}")
            return {"success": False, "error": f"生成失败: {str(e)}"}
    
    def get_user_reports(self, user_id: str, limit: int = 20) -> List[Dict]:
        """
        获取用户的侵权举报历史
        """
        from app.utils.supabase import get_supabase_service_client
        
        sb = get_supabase_service_client()
        if not sb:
            return []
        
        try:
            # 检查是否是admin - 使用 id (UUID) 查询
            user_res = sb.table("profiles").select("role").eq("id", user_id).execute()
            is_admin = user_res.data and user_res.data[0].get("role") in ["admin", "行政"]
            
            if is_admin:
                # Admin看所有
                reports_res = sb.table("infringement_reports").select("*").order("created_at", desc=True).limit(limit).execute()
            else:
                # 普通用户只看自己的
                reports_res = sb.table("infringement_reports").select("*").eq("reporter_id", user_id).order("created_at", desc=True).limit(limit).execute()
            
            return reports_res.data or []
            
        except Exception as e:
            logger.error(f"获取举报历史失败: {e}")
            return []


# 便捷函数：快速举报入口
async def quick_infringement_check(
    user_id: str,
    user_name: str,
    my_asset_id: int,
    infringing_url: str
) -> Dict:
    """
    快速侵权检测入口
    """
    service = InfringementService()
    return await service.report_infringement(
        reporter_id=user_id,
        reporter_name=user_name,
        my_asset_id=my_asset_id,
        infringing_url=infringing_url
    )
