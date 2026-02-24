import cv2
import os
import time
from typing import Dict
from algorithms.fingerprint_engine import FingerprintEngine
import subprocess

class VideoWatermarkService:
    @staticmethod
    def embed_video(
        input_path: str,
        output_path: str,
        fingerprint_str: str,
        author_id: str,
        max_seconds: int = 10,
        embed_every_seconds: float = 1.0,
    ) -> Dict[str, any]:
        """
        利用 OpenCV 在视频的关键帧（比如每秒第 1 帧）打入 DCT 二维图片盲水印
        并将视频通过 H.264 重编码。
        商业化版本通常会用 FFmpeg 进行更深层的 I-Frame 或者运动矢量隐藏，以此作为 MVP 演示。
        """
        if not os.path.exists(input_path):
            raise FileNotFoundError(f"Video file {input_path} not found.")

        cap = cv2.VideoCapture(input_path)
        fps = int(cap.get(cv2.CAP_PROP_FPS))
        if fps <= 0:
             fps = 25 # fallback
             
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        
        # We use standard H264 MP4
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))
        
        # 我们用频域盲水印引擎对单帧进行操作
        engine = FingerprintEngine(strength=0.15)
        
        frame_idx = 0
        watermarked_frames = 0

        max_frames = int(max(1, fps * max(1, int(max_seconds))))
        embed_step = max(1, int(round(fps * float(embed_every_seconds))))
        
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
                
            # 抽帧注入：默认每 1 秒注入 1 帧
            if frame_idx % embed_step == 0:
                watermarked_frame = engine.embed_dct(frame, fingerprint_str)
                out.write(watermarked_frame)
                watermarked_frames += 1
            else:
                out.write(frame)
                
            frame_idx += 1
            
            if frame_idx >= max_frames:
                break

        cap.release()
        out.release()
        
        return {
             "success": True,
             "total_frames_processed": frame_idx,
             "watermarked_frames": watermarked_frames,
             "fps": fps
             ,"processed_seconds": round(frame_idx / float(fps), 3),
             "embed_every_seconds": embed_every_seconds,
             "max_seconds": max_seconds,
        }
    
    @staticmethod
    def detect_video(input_path: str) -> Dict[str, any]:
         """
         从可疑盗用视频中提取水印（逐秒扫描）
         """
         cap = cv2.VideoCapture(input_path)
         fps = int(cap.get(cv2.CAP_PROP_FPS))
         if fps <= 0: fps = 25
         
         engine = FingerprintEngine()
         frame_idx = 0
         extracted_fingerprint = None
         
         max_seconds = 10
         detect_every_seconds = 0.5
         max_frames = int(max(1, fps * max_seconds))
         detect_step = max(1, int(round(fps * detect_every_seconds)))

         while cap.isOpened():
             ret, frame = cap.read()
             if not ret:
                 break
                 
             # 抽帧扫描：默认每 0.5 秒扫描 1 帧
             if frame_idx % detect_step == 0:
                 # 使用自适应 QIM 提取，兼容旧版 QIM_STEP=8 和新版 Q=30
                 extracted, _used_q = engine.extract_dct_adaptive(frame, length=256)
                 # 简单校验，如果提取出来的全 0 则没打上
                 if len(extracted.strip('0')) >= 8:
                      extracted_fingerprint = extracted
                      break # First hit wins in MVP
             
             frame_idx += 1
             if frame_idx >= max_frames:
                 break
                 
         cap.release()
         
         has_watermark = extracted_fingerprint is not None
         return {
             "success": True,
             "has_watermark": has_watermark,
             "extracted_fingerprint": extracted_fingerprint if has_watermark else "",
             "fps": fps,
             "processed_seconds": round(frame_idx / float(fps), 3),
             "detect_every_seconds": detect_every_seconds,
             "max_seconds": max_seconds,
         }
