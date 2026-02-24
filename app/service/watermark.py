"""
水印服务 - 向后兼容封装，内部使用增强版实现
"""

import os
import cv2
import numpy as np
from datetime import datetime
from typing import Optional, Dict, List

from algorithms.fingerprint_engine import FingerprintEngine
from algorithms.image_matcher import ImageMatcher
from app.utils.image import load_image_bytes
from app.service.vector_search import vector_service
import io
from PIL import Image

# 导入增强版服务
from app.service.enhanced_watermark import EnhancedWatermarkService, WatermarkInfo

# 保持向后兼容 - 使用增强版实现
class WatermarkService:
    """
    水印服务 - 自动使用增强版算法
    支持：时间戳存证、防重复检测、历史数据追溯
    """
    
    # 单例模式
    _instance = None
    _enhanced_service = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._enhanced_service = EnhancedWatermarkService()
        return cls._instance
    
    @staticmethod
    def embed_watermark(
        file_bytes: bytes,
        filename: str,
        user_id: str,
        author_name: Optional[str] = None,
        strength: float = 0.1
    ) -> Dict:
        """
        嵌入水印（自动检测重复）
        """
        service = WatermarkService()._enhanced_service
        
        # 使用增强版嵌入，自动检测已有水印
        result = service.embed_watermark(
            file_bytes=file_bytes,
            filename=filename,
            user_id=user_id,
            author_name=author_name,
            strength=strength,
            force=False  # 默认不强制覆盖
        )
        
        # 保持返回格式兼容
        if result.get("success"):
            return {
                "success": True,
                "fingerprint": result["fingerprint"],
                "psnr": result.get("psnr", 50.0),
                "filename": result["filename"],
                "download_url": result["download_url"],
                "message": result["message"],
                # 新增字段
                "watermark_info": result.get("watermark_info"),
                "details": result.get("details")
            }
        else:
            return result
    
    @staticmethod
    def embed_watermark_force(
        file_bytes: bytes,
        filename: str,
        user_id: str,
        author_name: Optional[str] = None,
        strength: float = 0.1
    ) -> Dict:
        """
        强制嵌入水印（覆盖已有）
        慎用！会丢失原始水印信息
        """
        service = WatermarkService()._enhanced_service
        
        return service.embed_watermark(
            file_bytes=file_bytes,
            filename=filename,
            user_id=user_id,
            author_name=author_name,
            strength=strength,
            force=True
        )
    
    @staticmethod
    def detect_watermark(file_bytes: bytes, filename: str) -> Dict:
        """
        检测水印（增强版）
        支持提取完整作者信息和首创时间
        """
        service = WatermarkService()._enhanced_service
        return service.detect_watermark(file_bytes, filename)
    
    @staticmethod
    def check_existing_watermark(file_bytes: bytes) -> Dict:
        """
        检查是否已有水印（新增功能）
        用于添加水印前的检测
        """
        service = WatermarkService()._enhanced_service
        return service.check_existing_watermark(file_bytes)
    
    @staticmethod
    def _find_best_match(
        extracted_fingerprint: str,
        query_phash: Optional[str] = None,
        min_similarity: float = 0.60,
        phash_threshold: int = 15
    ) -> Optional[Dict]:
        """内部使用 - 保持兼容"""
        service = WatermarkService()._enhanced_service
        return service._find_best_match_enhanced(
            extracted_fingerprint, 
            query_phash, 
            None,  # watermark_info
            min_similarity, 
            phash_threshold
        )


# 工具函数：检测重复水印（可用于批量检测）
def batch_check_watermark(image_paths: List[str]) -> List[Dict]:
    """
    批量检测图片是否已有水印
    """
    service = EnhancedWatermarkService()
    results = []
    
    for path in image_paths:
        try:
            with open(path, 'rb') as f:
                file_bytes = f.read()
            
            result = service.check_existing_watermark(file_bytes)
            results.append({
                "path": path,
                "has_watermark": result["has_watermark"],
                "warning": result.get("warning", ""),
                "original_author": result.get("original_author")
            })
        except Exception as e:
            results.append({
                "path": path,
                "error": str(e)
            })
    
    return results


# 保持导入兼容
__all__ = ['WatermarkService', 'batch_check_watermark']
