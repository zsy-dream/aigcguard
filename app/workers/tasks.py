import os
import time
import logging
from datetime import datetime
from app.workers.celery_app import celery_app
from app.service.watermark import WatermarkService
from app.utils.supabase import get_supabase_service_client
import base64

logger = logging.getLogger("celery.task")

@celery_app.task(bind=True, max_retries=3)
def process_watermark_batch(self, b64_files: list, filenames: list, user_id: str, author_name: str, strength: float):
    """
    处理大批量图片打水印任务
    """
    results = []
    sb = None
    embed_used = 0
    embed_total = 0
    assets_to_insert = []
    
    logger.info(f"====== 开始执行批量水印任务: {len(filenames)} 张图 by user: {user_id} ======")
    
    if user_id != "guest":
        sb = get_supabase_service_client()
        if sb:
            user_res = sb.table("profiles").select("quota_embed_used, quota_embed_total, quota_used").eq("id", user_id).limit(1).execute()
            if user_res.data:
                user_data = user_res.data[0]

                def _safe_int(val, default=0):
                    try:
                        return int(val) if val is not None else default
                    except Exception:
                        return default

                embed_used = _safe_int(user_data.get("quota_embed_used"), _safe_int(user_data.get("quota_used"), 0))
                embed_total = _safe_int(user_data.get("quota_embed_total"), 50)

    for i, b64_str in enumerate(b64_files):
        filename = filenames[i]
        try:
            if user_id != "guest" and sb and embed_total > 0 and embed_used >= embed_total:
                logger.warning(f"Quota exceeded for {user_id} on {filename}")
                results.append({"filename": filename, "status": "failed", "error": "额度不足"})
                continue
                    
            file_bytes = base64.b64decode(b64_str)
            res = WatermarkService.embed_watermark(
                file_bytes=file_bytes,
                filename=filename,
                user_id=user_id,
                author_name=author_name,
                strength=strength
            )
            
            # Update quota and Save asset via Supabase - 使用 id (UUID) 查询
            if not res or not res.get("success"):
                results.append({
                    "filename": filename,
                    "status": "failed",
                    "error": res.get("message") if isinstance(res, dict) else "嵌入失败",
                })
                continue

            if user_id != "guest" and sb:
                assets_to_insert.append({
                    "user_id": user_id,
                    "filename": res.get("filename"),
                    "fingerprint": res.get("fingerprint"),
                    "timestamp": datetime.now().isoformat(),
                    "psnr": res.get("psnr", 0),
                    "asset_type": "image"
                })
                embed_used += 1

            results.append({
                "filename": filename,
                "status": "success",
                "fingerprint": res.get("fingerprint"),
                "output_url": res.get("download_url")
            })
            logger.info(f"Processed: {filename}")
        except Exception as e:
            logger.error(f"Failed processing {filename}: {e}")
            results.append({"filename": filename, "status": "failed", "error": str(e)})

    if user_id != "guest" and sb:
        if assets_to_insert:
            chunk_size = 50
            for j in range(0, len(assets_to_insert), chunk_size):
                sb.table("watermarked_assets").insert(assets_to_insert[j:j + chunk_size]).execute()

        if embed_total > 0:
            sb.table("profiles").update({
                "quota_embed_used": embed_used,
                "quota_used": embed_used,
            }).eq("id", user_id).execute()

    return results

@celery_app.task
def run_infringement_crawler(target_keyword: str, platform: str = "all"):
    """
    全网监控爬虫任务（示例）
    """
    logger.info(f"====== 启动全网主动防御爬虫: {platform} 关键词: {target_keyword} ======")
    # 这里会使用 Scrapy + Playwright 启动耗时很久的抓取验证流程
    # 比如：模拟下拉、长图切片、指纹盲提取
    time.sleep(3) # 模拟爬取时间
    logger.info("爬虫已抓取 120 张疑似图片，正在排队进行底层盲水印分析...")
    return f"Crawler task completed for {target_keyword}"
