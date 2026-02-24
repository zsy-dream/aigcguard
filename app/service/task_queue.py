"""
异步任务队列服务
支持图像/视频检测的异步处理和进度追踪
"""

import asyncio
import uuid
import time
from typing import Dict, Optional, Callable, Any
from dataclasses import dataclass, field
from enum import Enum
import logging

logger = logging.getLogger("app")


class TaskStatus(Enum):
    PENDING = "pending"      # 等待中
    PROCESSING = "processing"  # 处理中
    COMPLETED = "completed"    # 完成
    FAILED = "failed"         # 失败
    CANCELLED = "cancelled"    # 已取消


@dataclass
class TaskProgress:
    """任务进度信息"""
    current: int = 0          # 当前进度 (0-100)
    total: int = 100          # 总进度
    stage: str = ""           # 当前阶段描述
    detail: str = ""          # 详细状态
    timestamp: float = field(default_factory=time.time)


@dataclass
class DetectionTask:
    """检测任务"""
    task_id: str
    user_id: str
    task_type: str  # 'image', 'video', 'batch'
    file_name: str
    file_path: Optional[str] = None
    status: TaskStatus = field(default_factory=lambda: TaskStatus.PENDING)
    progress: TaskProgress = field(default_factory=lambda: TaskProgress())
    result: Optional[Dict] = None
    error_message: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    completed_at: Optional[float] = None


class TaskQueue:
    """异步任务队列管理器"""
    
    def __init__(self, max_workers: int = 3):
        self.tasks: Dict[str, DetectionTask] = {}
        self.queue: asyncio.Queue = asyncio.Queue()
        self.max_workers = max_workers
        self._workers: list = []
        self._running = False
        
    async def start(self):
        """启动任务处理器"""
        if self._running:
            return
        self._running = True
        
        # 启动工作线程
        for i in range(self.max_workers):
            worker = asyncio.create_task(self._worker_loop(f"worker-{i}"))
            self._workers.append(worker)
            
        logger.info(f"任务队列已启动，{self.max_workers} 个 workers")
        
    async def stop(self):
        """停止任务处理器"""
        self._running = False
        
        # 取消所有 worker
        for worker in self._workers:
            worker.cancel()
            
        self._workers.clear()
        logger.info("任务队列已停止")
        
    async def _worker_loop(self, worker_id: str):
        """工作线程循环"""
        while self._running:
            try:
                task_id = await asyncio.wait_for(self.queue.get(), timeout=1.0)
                task = self.tasks.get(task_id)
                
                if task and task.status == TaskStatus.PENDING:
                    await self._process_task(task)
                    
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                logger.error(f"Worker {worker_id} 出错: {e}")
                
    async def _process_task(self, task: DetectionTask):
        """处理单个任务"""
        try:
            if task.status == TaskStatus.CANCELLED:
                return
            task.status = TaskStatus.PROCESSING
            task.updated_at = time.time()
            
            # 根据任务类型调用相应处理器
            if task.task_type == 'image':
                await self._process_image_detection(task)
            elif task.task_type == 'video':
                await self._process_video_detection(task)
            elif task.task_type == 'batch':
                await self._process_batch_detection(task)
            else:
                raise ValueError(f"未知任务类型: {task.task_type}")
                
            task.status = TaskStatus.COMPLETED
            task.completed_at = time.time()
            
        except Exception as e:
            logger.error(f"任务 {task.task_id} 处理失败: {e}")
            task.status = TaskStatus.FAILED
            task.error_message = str(e)
            task.completed_at = time.time()
            
        task.updated_at = time.time()
        
    async def _process_image_detection(self, task: DetectionTask):
        """处理图像检测任务 - 实际调用检测服务"""
        from app.service.enhanced_watermark import EnhancedWatermarkService
        from app.service.evidence_scoring import EvidenceScorer, FingerprintVisualizer
        from app.utils.supabase import get_supabase_service_client
        import os
        
        # 从任务存储路径获取文件内容
        file_path = task.file_path
        if not file_path or not os.path.exists(file_path):
            raise ValueError(f"文件不存在: {file_path}")
        
        # 更新进度：开始处理
        task.progress = TaskProgress(
            current=10, 
            total=100, 
            stage="特征提取", 
            detail="正在提取数字指纹特征..."
        )
        
        # 读取文件内容
        with open(file_path, 'rb') as f:
            file_content = f.read()
        
        # 使用增强版水印服务进行检测
        service = EnhancedWatermarkService()
        
        # 更新进度
        task.progress = TaskProgress(
            current=40, 
            total=100, 
            stage="云端匹配", 
            detail="与云端指纹数据库进行比对..."
        )
        await asyncio.sleep(0.1)  # 短暂休眠让其他任务有机会执行
        
        # 执行检测
        result = service.detect_watermark(file_content, task.file_name)
        
        # 更新进度
        task.progress = TaskProgress(
            current=70, 
            total=100, 
            stage="五维评分", 
            detail="正在计算证据评分..."
        )
        
        # 计算五维评分
        try:
            # 获取区块链数据（如果存在匹配资产）
            blockchain_data = None
            if result.get("best_match") and result["best_match"].get("id"):
                sb = get_supabase_service_client()
                if sb:
                    try:
                        asset_res = sb.table("watermarked_assets").select("tx_hash, block_height, timestamp").eq("id", result["best_match"]["id"]).execute()
                        if asset_res.data:
                            blockchain_data = asset_res.data[0]
                    except:
                        pass
            
            # 计算五维评分
            five_dim_score = EvidenceScorer.calculate_all_scores(result, blockchain_data)
            result["five_dim_score"] = five_dim_score.to_dict()
            result["confidence_level"] = five_dim_score.confidence_level
            result["legal_description"] = five_dim_score.legal_description
            
            # 生成可视化数据
            if five_dim_score:
                result["visualizations"] = {
                    "radar_chart": FingerprintVisualizer.generate_radar_chart_data(five_dim_score),
                    "timeline": FingerprintVisualizer.generate_evidence_timeline(result, blockchain_data)
                }
                
                # 比特热力图（如果存在匹配）
                if result.get("best_match") and result.get("extracted_fingerprint"):
                    result["visualizations"]["bit_heatmap"] = FingerprintVisualizer.generate_bit_heatmap(
                        result["extracted_fingerprint"],
                        result["best_match"].get("fingerprint", "")
                    )
        except Exception as e:
            logger.warning(f"五维评分计算失败: {e}")
            # 评分失败不影响检测结果
        
        # 保存检测结果到任务结果
        task.result = result
        
        # 更新进度：完成
        task.progress = TaskProgress(
            current=100, 
            total=100, 
            stage="检测完成", 
            detail="分析完成"
        )
        
        # 清理临时文件
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
        except:
            pass
        
    async def _process_video_detection(self, task: DetectionTask):
        """处理视频检测任务"""
        # 视频检测需要更多阶段
        stages = [
            (15, "视频解码", "正在解码视频文件..."),
            (30, "关键帧提取", "提取关键帧用于分析..."),
            (50, "指纹提取", "从关键帧中提取数字指纹..."),
            (75, "云端匹配", "与云端指纹库进行比对..."),
            (100, "检测完成", "视频分析完成"),
        ]
        
        for current, stage, detail in stages:
            task.progress = TaskProgress(current=current, total=100, stage=stage, detail=detail)
            await asyncio.sleep(1.0)  # 模拟处理时间
            
    async def _process_batch_detection(self, task: DetectionTask):
        """处理批量检测任务"""
        # 批量检测需要跟踪每个文件
        task.progress = TaskProgress(
            current=0, 
            total=100, 
            stage="批量处理", 
            detail="准备处理批量文件..."
        )
        
    def submit_task(
        self,
        user_id: str,
        task_type: str,
        file_name: str,
        file_path: Optional[str] = None,
        file_content: Optional[bytes] = None,
    ) -> str:
        """提交新任务"""
        task_id = f"task_{uuid.uuid4().hex[:12]}"
        
        task = DetectionTask(
            task_id=task_id,
            user_id=user_id,
            task_type=task_type,
            file_name=file_name,
            file_path=file_path,
            status=TaskStatus.PENDING,
            progress=TaskProgress(current=0, total=100, stage="等待中", detail="任务已提交，等待处理...")
        )
        
        self.tasks[task_id] = task
        
        # 将任务ID加入队列
        asyncio.create_task(self.queue.put(task_id))
        
        logger.info(f"任务 {task_id} 已提交 (类型: {task_type}, 用户: {user_id})")
        return task_id
        
    def get_task(self, task_id: str) -> Optional[DetectionTask]:
        """获取任务状态"""
        return self.tasks.get(task_id)
        
    def get_user_tasks(self, user_id: str, limit: int = 20) -> list:
        """获取用户的任务列表"""
        user_tasks = [
            task for task in self.tasks.values() 
            if task.user_id == user_id
        ]
        # 按创建时间倒序
        user_tasks.sort(key=lambda x: x.created_at, reverse=True)
        return user_tasks[:limit]
        
    def cancel_task(self, task_id: str) -> bool:
        """取消任务"""
        task = self.tasks.get(task_id)
        if task and task.status in [TaskStatus.PENDING, TaskStatus.PROCESSING]:
            task.status = TaskStatus.CANCELLED
            task.completed_at = time.time()
            return True
        return False
        
    def cleanup_old_tasks(self, max_age_hours: float = 24):
        """清理过期任务"""
        current_time = time.time()
        expired_tasks = [
            task_id for task_id, task in self.tasks.items()
            if (current_time - task.created_at) > (max_age_hours * 3600)
        ]
        for task_id in expired_tasks:
            del self.tasks[task_id]
        
        if expired_tasks:
            logger.info(f"已清理 {len(expired_tasks)} 个过期任务")


# 全局任务队列实例
task_queue = TaskQueue(max_workers=3)


async def start_task_queue():
    """启动任务队列（在应用启动时调用）"""
    await task_queue.start()
    
async def stop_task_queue():
    """停止任务队列（在应用关闭时调用）"""
    await task_queue.stop()
