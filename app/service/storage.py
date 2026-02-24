import os
import logging
from typing import Optional
from app.utils.supabase import get_supabase_service_client

logger = logging.getLogger("app")

class StorageService:
    """Supabase 云端存储服务"""
    
    @staticmethod
    def upload_file(local_path: str, bucket_name: str = "assets") -> Optional[str]:
        """
        上传本地文件到 Supabase Storage 并返回公开访问链接
        """
        if not os.path.exists(local_path):
            logger.error(f"Upload failed: File not found at {local_path}")
            return None
        
        filename = os.path.basename(local_path)
        sb = get_supabase_service_client()
        if not sb:
            logger.error("Upload failed: Supabase client not initialized")
            return None
            
        try:
            with open(local_path, "rb") as f:
                # 执行上传
                # upsert: true 表示如果同名文件存在则覆盖
                storage_res = sb.storage.from_(bucket_name).upload(
                    path=filename,
                    file=f,
                    file_options={"cache-control": "3600", "upsert": "true"}
                )
            
            # 获取公开访问链接
            public_url = sb.storage.from_(bucket_name).get_public_url(filename)
            logger.info(f"Cloud Sync Success: {filename} -> {public_url}")
            return public_url
        except Exception as e:
            logger.error(f"Cloud Sync Error for {filename}: {e}")
            # 即使上传失败，也返回 None 供逻辑回退
            return None
