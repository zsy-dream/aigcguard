from pydantic import BaseModel
from typing import Optional

class WatermarkResult(BaseModel):
    success: bool
    fingerprint: Optional[str] = None
    psnr: Optional[float] = None
    download_url: Optional[str] = None
    asset_id: Optional[int] = None
    quota_used: Optional[int] = None
    quota_total: Optional[int] = None
    quota_embed_used: Optional[int] = None
    quota_embed_total: Optional[int] = None
    quota_deducted: Optional[bool] = None
    processing_time_sec: Optional[float] = None
    message: str
    error: Optional[str] = None

class DetectionResult(BaseModel):
    success: bool
    has_watermark: bool
    # 向后兼容的字段
    extracted_fingerprint: Optional[str] = None  # 简化的指纹字符串
    phash: Optional[str] = None
    matched_asset: Optional[dict] = None
    confidence: float = 0.0
    is_original_author: bool = False
    message: str
    
    # 新增详细分析字段（可选，用于增强版）
    detection_id: Optional[str] = None
    detection_time_ms: Optional[float] = None
    
    # 详细的指纹信息
    extracted_fingerprint_detail: Optional[dict] = None  # 包含完整指纹、强度等
    watermark_details: Optional[dict] = None  # 水印详细信息（作者、时间戳等）
    
    # 匹配分析
    match_summary: Optional[dict] = None  # 匹配汇总
    match_candidates: Optional[list] = None  # 所有候选列表
    best_match: Optional[dict] = None  # 最佳匹配详情
    deep_learning_match: Optional[dict] = None  # FAISS匹配
    
    # 分析结论
    analysis: Optional[dict] = None  # 包含verdict、risk_level、suggested_action等
    
    # 历史数据标记
    is_historical: Optional[bool] = None
    suggested_action: Optional[str] = None

class Asset(BaseModel):
    id: int | str
    user_id: str
    filename: str
    fingerprint: str
    timestamp: str
    psnr: Optional[float] = None
    output_path: Optional[str] = None
    author_name: Optional[str] = None
    preview_url: Optional[str] = None
    tx_hash: Optional[str] = None
    block_height: Optional[int] = None
    asset_type: str = "image"

class Stats(BaseModel):
    total_assets: int
    active_monitors: int
    total_infringements: int
