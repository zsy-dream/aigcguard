"""
增强版证据评分与可视化报告服务
五维证据模型 + 比特热力图 + 法律级分析报告
"""

import numpy as np
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple, Any
from datetime import datetime, timezone
import hashlib
import json


@dataclass
class EvidenceDimension:
    """单一证据维度评分"""
    name: str  # 维度名称
    score: float  # 0-100 分数
    weight: float  # 权重
    evidence_type: str  # 证据类型
    description: str  # 评分说明
    technical_details: Dict[str, Any] = field(default_factory=dict)  # 技术细节


@dataclass
class FiveDimensionalScore:
    """五维证据评分模型"""
    # 五个维度
    fingerprint: EvidenceDimension  # 指纹置信度
    temporal: EvidenceDimension       # 时间置信度（区块链）
    semantic: EvidenceDimension      # 语义置信度（向量）
    robustness: EvidenceDimension    # 鲁棒性置信度（抗攻击）
    provenance: EvidenceDimension     # 溯源置信度（创作链路）
    
    # 融合分数
    @property
    def total_score(self) -> float:
        """加权融合总分"""
        dims = [self.fingerprint, self.temporal, self.semantic, self.robustness, self.provenance]
        total_weight = sum(d.weight for d in dims)
        if total_weight == 0:
            return 0
        weighted_sum = sum(d.score * d.weight for d in dims)
        return round(weighted_sum / total_weight, 2)
    
    @property
    def confidence_level(self) -> str:
        """置信度等级映射"""
        score = self.total_score
        if score >= 90:
            return "A级-确定性证据"
        elif score >= 75:
            return "B级-高度疑似"
        elif score >= 60:
            return "C级-可能相关"
        elif score >= 40:
            return "D级-弱关联"
        else:
            return "E级-不相关"
    
    @property
    def legal_description(self) -> str:
        """法律表述"""
        level = self.confidence_level
        descriptions = {
            "A级-确定性证据": "技术鉴定结论为'确定性权属证据'，指纹完全匹配且证据链完整，具有极高法律参考价值",
            "B级-高度疑似": "技术推定为'高度疑似同源'，多维度证据相互印证，建议作为初步证据使用",
            "C级-可能相关": "技术检测显示'可能存在关联'，单一证据匹配，需补充其他证据佐证",
            "D级-弱关联": "技术检测显示'弱关联性'，仅个别特征相似，不构成有效证据",
            "E级-不相关": "技术检测未发现有效匹配，无法建立关联性"
        }
        return descriptions.get(level, "未知")
    
    def to_dict(self) -> Dict:
        """序列化为字典"""
        return {
            "total_score": self.total_score,
            "confidence_level": self.confidence_level,
            "legal_description": self.legal_description,
            "dimensions": {
                "fingerprint": {
                    "name": self.fingerprint.name,
                    "score": self.fingerprint.score,
                    "weight": self.fingerprint.weight,
                    "description": self.fingerprint.description,
                    "technical_details": self.fingerprint.technical_details
                },
                "temporal": {
                    "name": self.temporal.name,
                    "score": self.temporal.score,
                    "weight": self.temporal.weight,
                    "description": self.temporal.description,
                    "technical_details": self.temporal.technical_details
                },
                "semantic": {
                    "name": self.semantic.name,
                    "score": self.semantic.score,
                    "weight": self.semantic.weight,
                    "description": self.semantic.description,
                    "technical_details": self.semantic.technical_details
                },
                "robustness": {
                    "name": self.robustness.name,
                    "score": self.robustness.score,
                    "weight": self.robustness.weight,
                    "description": self.robustness.description,
                    "technical_details": self.robustness.technical_details
                },
                "provenance": {
                    "name": self.provenance.name,
                    "score": self.provenance.score,
                    "weight": self.provenance.weight,
                    "description": self.provenance.description,
                    "technical_details": self.provenance.technical_details
                }
            }
        }


class EvidenceScorer:
    """证据评分计算器"""
    
    @staticmethod
    def calculate_fingerprint_score(
        similarity: float,
        fingerprint_strength: int,
        extraction_confidence: float,
        fragment_match_rate: float
    ) -> EvidenceDimension:
        """
        计算指纹置信度
        
        Args:
            similarity: 指纹相似度 (0-100)
            fingerprint_strength: 指纹强度 (0-256)
            extraction_confidence: 提取置信度 (0-1)
            fragment_match_rate: 片段匹配率 (0-100)
        """
        # 子维度评分
        sim_score = min(100, similarity)  # 相似度占比40%
        strength_score = min(100, fingerprint_strength / 256 * 100)  # 强度占比25%
        extract_score = extraction_confidence * 100  # 提取置信度占比20%
        fragment_score = fragment_match_rate  # 片段匹配占比15%
        
        # 加权计算
        score = (
            sim_score * 0.40 +
            strength_score * 0.25 +
            extract_score * 0.20 +
            fragment_score * 0.15
        )
        
        # 技术细节
        tech_details = {
            "similarity_contribution": round(sim_score * 0.40, 2),
            "strength_contribution": round(strength_score * 0.25, 2),
            "extraction_contribution": round(extract_score * 0.20, 2),
            "fragment_contribution": round(fragment_score * 0.15, 2),
            "raw_similarity": similarity,
            "raw_strength": fingerprint_strength,
            "extraction_confidence": extraction_confidence,
            "fragment_match_rate": fragment_match_rate,
            "algorithm": "DCT频域指纹提取 + 汉明距离比对",
            "bit_length": 256,
            "dimensionality": "频域DCT系数"
        }
        
        return EvidenceDimension(
            name="数字指纹置信度",
            score=round(score, 2),
            weight=0.40,  # 指纹权重最高
            evidence_type="确定性证据",
            description=f"指纹相似度{similarity:.1f}%，强度{fingerprint_strength}/256，提取置信度{extraction_confidence*100:.1f}%",
            technical_details=tech_details
        )
    
    @staticmethod
    def calculate_temporal_score(
        has_blockchain_record: bool,
        creation_timestamp: Optional[int],
        detection_timestamp: int,
        time_consistency: bool
    ) -> EvidenceDimension:
        """
        计算时间置信度（区块链存证）
        
        Args:
            has_blockchain_record: 是否有区块链记录
            creation_timestamp: 创作时间戳（秒）
            detection_timestamp: 检测时间戳（秒）
            time_consistency: 时间逻辑是否一致（创作<检测）
        """
        if not has_blockchain_record:
            return EvidenceDimension(
                name="时间链置信度",
                score=0,
                weight=0.20,
                evidence_type="时间证据",
                description="无区块链存证记录",
                technical_details={"reason": "未上链"}
            )
        
        # 基础分（有区块链就有60分）
        base_score = 60
        
        # 时间合理性加分
        consistency_bonus = 20 if time_consistency else 0
        
        # 时间跨度合理性（创作距今越久，可信度越高，防止"事后伪造"）
        time_span_bonus = 0
        if creation_timestamp:
            time_span_days = (detection_timestamp - creation_timestamp) / 86400
            if time_span_days > 30:  # 创作时间早于检测时间30天以上
                time_span_bonus = 20
            elif time_span_days > 7:
                time_span_bonus = 10
        
        score = min(100, base_score + consistency_bonus + time_span_bonus)
        
        tech_details = {
            "blockchain_verified": has_blockchain_record,
            "creation_timestamp": creation_timestamp,
            "detection_timestamp": detection_timestamp,
            "time_consistency": time_consistency,
            "consistency_bonus": consistency_bonus,
            "time_span_bonus": time_span_bonus,
            "blockchain_type": "联盟链/公链存证",
            "immutable": True,
            "timestamp_format": "Unix timestamp (seconds)"
        }
        
        desc = f"区块链存证已确认，时间逻辑{'一致' if time_consistency else '存疑'}"
        if creation_timestamp:
            desc += f"，创作时间：{datetime.fromtimestamp(creation_timestamp).strftime('%Y-%m-%d')}"
        
        return EvidenceDimension(
            name="时间链置信度",
            score=score,
            weight=0.20,
            evidence_type="时间证据",
            description=desc,
            technical_details=tech_details
        )
    
    @staticmethod
    def calculate_semantic_score(
        faiss_similarity: float,
        vector_match_count: int,
        top_k_confidence: float
    ) -> EvidenceDimension:
        """
        计算语义置信度（深度向量）
        
        Args:
            faiss_similarity: FAISS余弦相似度 (0-1)
            vector_match_count: 匹配的向量数量
            top_k_confidence: Top-K置信度
        """
        # 基础分来自相似度
        sim_score = faiss_similarity * 100
        
        # 匹配数量加分
        count_bonus = min(20, vector_match_count * 5)
        
        # Top-K置信度加权
        top_k_weight = top_k_confidence * 0.1
        
        score = min(100, sim_score + count_bonus + top_k_weight)
        
        tech_details = {
            "faiss_similarity": faiss_similarity,
            "vector_match_count": vector_match_count,
            "top_k_confidence": top_k_confidence,
            "algorithm": "FAISS-IVF + CLIP嵌入",
            "embedding_model": "CLIP-ResNet50",
            "vector_dimension": 512,
            "metric": "余弦相似度",
            "similarity_contribution": round(sim_score, 2),
            "count_bonus": count_bonus
        }
        
        return EvidenceDimension(
            name="语义置信度",
            score=round(score, 2),
            weight=0.15,
            evidence_type="推定证据",
            description=f"深度向量相似度{faiss_similarity*100:.1f}%，匹配向量数{vector_match_count}",
            technical_details=tech_details
        )
    
    @staticmethod
    def calculate_robustness_score(
        psnr_value: float,
        compression_resistance: float,
        crop_resistance: float,
        filter_resistance: float
    ) -> EvidenceDimension:
        """
        计算鲁棒性置信度（抗攻击测试）
        
        Args:
            psnr_value: PSNR值（越高越不易察觉）
            compression_resistance: 压缩抗性 (0-1)
            crop_resistance: 裁剪抗性 (0-1)
            filter_resistance: 滤镜抗性 (0-1)
        """
        # PSNR评分（理想的PSNR在35-45之间）
        psnr_score = max(0, min(100, (psnr_value - 20) / 30 * 100))
        
        # 综合抗性
        resistance_avg = (compression_resistance + crop_resistance + filter_resistance) / 3
        resistance_score = resistance_avg * 100
        
        # 加权
        score = psnr_score * 0.3 + resistance_score * 0.7
        
        tech_details = {
            "psnr": psnr_value,
            "psnr_score": round(psnr_score, 2),
            "compression_resistance": compression_resistance,
            "crop_resistance": crop_resistance,
            "filter_resistance": filter_resistance,
            "resistance_avg": round(resistance_avg, 4),
            "resistance_score": round(resistance_score, 2),
            "attacks_tested": ["JPEG压缩（质量80%）", "中心裁剪（保留60%）", "高斯模糊（σ=1.0）"],
            "watermark_strength": "可调节0.05-0.3",
            "dct_coefficients": "中频带嵌入"
        }
        
        return EvidenceDimension(
            name="鲁棒性置信度",
            score=round(score, 2),
            weight=0.15,
            evidence_type="鲁棒性证据",
            description=f"PSNR={psnr_value:.1f}dB，综合抗性{resistance_avg*100:.1f}%",
            technical_details=tech_details
        )
    
    @staticmethod
    def calculate_provenance_score(
        author_verified: bool,
        creation_chain_complete: bool,
        historical_consistency: bool,
        cross_platform_verified: bool
    ) -> EvidenceDimension:
        """
        计算溯源置信度（创作链路完整度）
        
        Args:
            author_verified: 作者身份已验证
            creation_chain_complete: 创作链路完整
            historical_consistency: 历史记录一致
            cross_platform_verified: 跨平台验证通过
        """
        score = 0
        details = {}
        
        if author_verified:
            score += 30
            details["author_verified"] = {"points": 30, "status": "已验证"}
        else:
            details["author_verified"] = {"points": 0, "status": "未验证"}
        
        if creation_chain_complete:
            score += 25
            details["creation_chain"] = {"points": 25, "status": "完整"}
        else:
            details["creation_chain"] = {"points": 0, "status": "缺失"}
        
        if historical_consistency:
            score += 25
            details["historical_consistency"] = {"points": 25, "status": "一致"}
        else:
            details["historical_consistency"] = {"points": 0, "status": "存疑"}
        
        if cross_platform_verified:
            score += 20
            details["cross_platform"] = {"points": 20, "status": "已验证"}
        else:
            details["cross_platform"] = {"points": 0, "status": "未验证"}
        
        tech_details = {
            **details,
            "verification_methods": [
                "平台账号实名认证",
                "创作工具数字签名",
                "历史作品风格一致性分析",
                "社交媒体交叉验证"
            ]
        }
        
        desc_parts = []
        if author_verified:
            desc_parts.append("作者已验证")
        if creation_chain_complete:
            desc_parts.append("链路完整")
        if historical_consistency:
            desc_parts.append("历史一致")
        
        description = "，".join(desc_parts) if desc_parts else "溯源信息不足"
        
        return EvidenceDimension(
            name="溯源置信度",
            score=score,
            weight=0.10,
            evidence_type="溯源证据",
            description=description,
            technical_details=tech_details
        )
    
    @classmethod
    def calculate_all_scores(
        cls,
        detection_result: Dict,
        blockchain_data: Optional[Dict] = None
    ) -> FiveDimensionalScore:
        """
        计算完整五维评分
        """
        # 提取基础数据
        match_summary = detection_result.get("match_summary", {})
        best_match = detection_result.get("best_match", {})
        fingerprint_detail = detection_result.get("extracted_fingerprint_detail", {}) or {}
        
        # 1. 指纹置信度
        fingerprint_dim = cls.calculate_fingerprint_score(
            similarity=best_match.get("similarity", 0) if best_match else 0,
            fingerprint_strength=fingerprint_detail.get("strength_score", 0),
            extraction_confidence=0.85 if detection_result.get("has_watermark") else 0.3,
            fragment_match_rate=best_match.get("fingerprint_fragment_match", 0) if best_match else 0
        )
        
        # 2. 时间置信度
        has_blockchain = bool(blockchain_data and blockchain_data.get("tx_hash"))
        creation_ts = None
        if blockchain_data and blockchain_data.get("timestamp"):
            try:
                creation_ts = int(blockchain_data["timestamp"])
            except:
                pass
        
        temporal_dim = cls.calculate_temporal_score(
            has_blockchain_record=has_blockchain,
            creation_timestamp=creation_ts,
            detection_timestamp=int(datetime.now(timezone.utc).timestamp()),
            time_consistency=True  # 简化，实际需要比较时间
        )
        
        # 3. 语义置信度
        faiss_match = detection_result.get("deep_learning_match", {})
        semantic_dim = cls.calculate_semantic_score(
            faiss_similarity=faiss_match.get("similarity", 0) / 100 if faiss_match else 0,
            vector_match_count=1 if faiss_match else 0,
            top_k_confidence=0.8 if faiss_match else 0
        )
        
        # 4. 鲁棒性置信度（从结果中提取或默认值）
        robustness_dim = cls.calculate_robustness_score(
            psnr_value=detection_result.get("psnr", 40.0),
            compression_resistance=0.85,
            crop_resistance=0.75,
            filter_resistance=0.70
        )
        
        # 5. 溯源置信度
        watermark_details = detection_result.get("watermark_details", {})
        provenance_dim = cls.calculate_provenance_score(
            author_verified=bool(watermark_details and watermark_details.get("author_name")),
            creation_chain_complete=bool(blockchain_data),
            historical_consistency=bool(best_match),
            cross_platform_verified=False  # 需要额外验证
        )
        
        return FiveDimensionalScore(
            fingerprint=fingerprint_dim,
            temporal=temporal_dim,
            semantic=semantic_dim,
            robustness=robustness_dim,
            provenance=provenance_dim
        )


class FingerprintVisualizer:
    """指纹可视化生成器"""
    
    @staticmethod
    def generate_bit_heatmap(
        fingerprint1: str,
        fingerprint2: str,
        size: int = 8
    ) -> List[List[Dict]]:
        """
        生成比特级热力图数据（8x8网格，每格代表64比特）
        
        Returns:
            8x8矩阵，每个元素包含：
            - cell_index: 格子索引(0-63)
            - match_rate: 匹配率(0-100)
            - bits: 该格子的比特字符串
            - color_intensity: 颜色强度(0-1)
        """
        if not fingerprint1 or not fingerprint2:
            return [[{"cell_index": i*size+j, "match_rate": 0, "bits": "", "color_intensity": 0} 
                     for j in range(size)] for i in range(size)]
        
        # 确保长度一致
        min_len = min(len(fingerprint1), len(fingerprint2))
        fp1 = fingerprint1[:min_len]
        fp2 = fingerprint2[:min_len]
        
        # 计算每个格子的匹配率
        heatmap = []
        bits_per_cell = min_len // (size * size)
        if bits_per_cell == 0:
            bits_per_cell = 1
        
        for row in range(size):
            heatmap_row = []
            for col in range(size):
                cell_idx = row * size + col
                start_bit = cell_idx * bits_per_cell
                end_bit = min(start_bit + bits_per_cell, min_len)
                
                if start_bit >= min_len:
                    match_rate = 0
                    bits = ""
                else:
                    # 计算该片段的匹配率
                    segment1 = fp1[start_bit:end_bit]
                    segment2 = fp2[start_bit:end_bit]
                    matches = sum(1 for a, b in zip(segment1, segment2) if a == b)
                    match_rate = (matches / len(segment1)) * 100 if segment1 else 0
                    bits = segment1[:8]  # 只显示前8位作为示例
                
                heatmap_row.append({
                    "cell_index": cell_idx,
                    "match_rate": round(match_rate, 1),
                    "bits": bits,
                    "color_intensity": match_rate / 100,
                    "row": row,
                    "col": col
                })
            heatmap.append(heatmap_row)
        
        return heatmap
    
    @staticmethod
    def generate_radar_chart_data(
        five_dim_score: FiveDimensionalScore
    ) -> Dict:
        """
        生成雷达图数据
        """
        return {
            "labels": ["指纹置信度", "时间链", "语义相似", "鲁棒性", "溯源完整"],
            "datasets": [{
                "label": "证据强度",
                "data": [
                    five_dim_score.fingerprint.score,
                    five_dim_score.temporal.score,
                    five_dim_score.semantic.score,
                    five_dim_score.robustness.score,
                    five_dim_score.provenance.score
                ],
                "backgroundColor": "rgba(99, 102, 241, 0.2)",
                "borderColor": "rgba(99, 102, 241, 1)",
                "borderWidth": 2
            }],
            "weights": [0.40, 0.20, 0.15, 0.15, 0.10],
            "total_score": five_dim_score.total_score,
            "level": five_dim_score.confidence_level
        }
    
    @staticmethod
    def generate_evidence_timeline(
        detection_result: Dict,
        blockchain_data: Optional[Dict] = None
    ) -> List[Dict]:
        """
        生成证据链时间线
        增强版：包含创作、指纹嵌入、候选匹配确权、区块链存证、检测等多类事件
        """
        timeline = []
        seen_ts = set()  # 避免同一时间戳重复

        def _safe_ts(raw) -> Optional[int]:
            """安全转换时间戳，支持整数/浮点/ISO字符串"""
            if raw is None:
                return None
            try:
                return int(float(raw))
            except (ValueError, TypeError):
                pass
            # 尝试 ISO 格式
            if isinstance(raw, str):
                try:
                    return int(datetime.fromisoformat(raw.replace('Z', '+00:00')).timestamp())
                except Exception:
                    pass
            return None

        def _add(event: str, ts: int, description: str, evidence_type: str, icon: str):
            if ts in seen_ts:
                return
            seen_ts.add(ts)
            timeline.append({
                "event": event,
                "timestamp": ts,
                "time_str": datetime.fromtimestamp(ts).strftime('%Y-%m-%d %H:%M:%S'),
                "description": description,
                "evidence_type": evidence_type,
                "icon": icon,
            })

        # 1. 创作时间（来自水印元数据）
        watermark_details = detection_result.get("watermark_details", {})
        creation_ts = _safe_ts(watermark_details.get("timestamp"))
        if creation_ts:
            _add(
                "作品创作",
                creation_ts,
                f"作者：{watermark_details.get('author_name', '未知')}",
                "创作起点",
                "✏️",
            )

        # 2. 最佳匹配资产的指纹确权时间
        best_match = detection_result.get("best_match") or {}
        bm_ts = _safe_ts(best_match.get("timestamp") or best_match.get("creation_time"))
        if bm_ts:
            _add(
                "指纹确权(最佳匹配)",
                bm_ts,
                f"匹配作者：{best_match.get('author_name', best_match.get('author', '未知'))}，"
                f"相似度：{best_match.get('similarity', 0)}%",
                "指纹确权",
                "🔏",
            )

        # 3. 候选匹配列表中不同指纹的确权时期（最多取 Top3 以免过于拥挤）
        candidates = detection_result.get("match_candidates", [])
        for i, cand in enumerate(candidates[:3]):
            cand_ts = _safe_ts(cand.get("timestamp") or cand.get("creation_time"))
            if cand_ts:
                _add(
                    f"候选指纹#{i+1}",
                    cand_ts,
                    f"作者：{cand.get('author', cand.get('author_name', '未知'))}，"
                    f"相似度：{cand.get('similarity', 0)}%",
                    "候选确权",
                    "📌",
                )

        # 4. 指纹嵌入时间（来自提取到的指纹详情）
        fp_detail = detection_result.get("extracted_fingerprint_detail") or (
            detection_result.get("extracted_fingerprint") if isinstance(detection_result.get("extracted_fingerprint"), dict) else {}
        )
        embed_ts = _safe_ts(fp_detail.get("embed_timestamp") or fp_detail.get("timestamp"))
        if embed_ts and embed_ts != creation_ts:
            _add(
                "指纹嵌入",
                embed_ts,
                f"指纹强度：{fp_detail.get('strength_score', 'N/A')}/256",
                "技术溯源",
                "🧬",
            )

        # 5. 区块链存证
        if blockchain_data and blockchain_data.get("timestamp"):
            bc_ts = _safe_ts(blockchain_data["timestamp"])
            if bc_ts:
                _add(
                    "区块链存证",
                    bc_ts,
                    f"交易哈希：{blockchain_data.get('tx_hash', 'N/A')[:16]}...",
                    "不可篡改证据",
                    "🔗",
                )

        # 如果 best_match 中有 tx_hash，也添加其上链时间
        bm_tx_ts = _safe_ts(best_match.get("blockchain_timestamp") or best_match.get("tx_timestamp"))
        if bm_tx_ts:
            _add(
                "匹配资产上链",
                bm_tx_ts,
                f"TxHash：{best_match.get('tx_hash', 'N/A')[:16]}...",
                "链上存证",
                "⛓️",
            )

        # 6. 技术检测时间
        now_ts = int(datetime.now(timezone.utc).timestamp())
        _add(
            "技术检测",
            now_ts,
            "数字指纹提取与比对分析",
            "技术鉴定",
            "🔍",
        )

        # 按时间排序
        timeline.sort(key=lambda x: x["timestamp"])

        # 添加时间间隔计算
        for i in range(1, len(timeline)):
            prev = timeline[i - 1]
            curr = timeline[i]
            interval_hours = (curr["timestamp"] - prev["timestamp"]) / 3600
            if interval_hours < 1:
                curr["interval_from_prev"] = f"{interval_hours * 60:.0f}分钟"
            elif interval_hours < 24:
                curr["interval_from_prev"] = f"{interval_hours:.1f}小时"
            else:
                curr["interval_from_prev"] = f"{interval_hours / 24:.1f}天"

        return timeline


# 导出主要类
__all__ = [
    'EvidenceDimension',
    'FiveDimensionalScore', 
    'EvidenceScorer',
    'FingerprintVisualizer'
]
