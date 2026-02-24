"""
检测报告导出服务
使用DeepSeek AI生成专业的数字指纹对比分析报告
支持PDF/Word/JSON等多种格式导出
"""

import httpx
import json
import logging
from datetime import datetime
from typing import Dict, List, Optional
from dataclasses import dataclass
from app.core.config import settings
from app.service.enhanced_watermark import WatermarkInfo

logger = logging.getLogger("app")


@dataclass
class DetectionReportData:
    """检测报告数据结构"""
    detection_id: str
    detection_time: str
    image_filename: str
    has_watermark: bool
    
    # 指纹信息
    fingerprint_hash: Optional[str]
    fingerprint_strength: int
    fingerprint_level: str
    phash: Optional[str]
    
    # 水印详细信息
    watermark_info: Optional[Dict]
    
    # 匹配结果
    match_candidates: List[Dict]
    best_match: Optional[Dict]
    total_candidates: int
    
    # 分析结论
    verdict: str
    risk_level: str
    risk_description: str
    confidence_score: float
    suggested_actions: List[str]
    evidence_strength: int
    evidence_list: List[Dict]


class ReportService:
    """检测报告生成服务"""
    
    @staticmethod
    def _format_report_data(detection_result: Dict, image_filename: str) -> DetectionReportData:
        """将API返回的检测结果格式化为报告数据结构"""
        
        # 提取指纹信息（优先使用 extracted_fingerprint_detail，向后兼容 dict 形式的 extracted_fingerprint）
        fingerprint_detail = detection_result.get("extracted_fingerprint_detail") or (
            detection_result.get("extracted_fingerprint") if isinstance(detection_result.get("extracted_fingerprint"), dict) else {}
        )
        
        # 提取匹配信息
        match_summary = detection_result.get("match_summary", {})
        best_match = detection_result.get("best_match")
        candidates = detection_result.get("match_candidates", [])
        
        # 提取分析结论
        analysis = detection_result.get("analysis", {})
        risk_info = analysis.get("risk_level", {})
        evidence_info = analysis.get("evidence_strength", {})
        
        return DetectionReportData(
            detection_id=detection_result.get("detection_id", f"det_{int(datetime.now().timestamp())}"),
            detection_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            image_filename=image_filename,
            has_watermark=detection_result.get("has_watermark", False),
            fingerprint_hash=fingerprint_detail.get("fingerprint_hash", "N/A"),
            fingerprint_strength=fingerprint_detail.get("strength_score", 0),
            fingerprint_level=fingerprint_detail.get("strength_level", "未知"),
            phash=fingerprint_detail.get("phash"),
            watermark_info=detection_result.get("watermark_details"),
            match_candidates=candidates,
            best_match=best_match,
            total_candidates=match_summary.get("total_candidates", 0),
            verdict=analysis.get("verdict", "暂无分析结论"),
            risk_level=risk_info.get("level", "UNKNOWN"),
            risk_description=risk_info.get("description", "无法评估风险"),
            confidence_score=match_summary.get("confidence_score", {}).get("total_score", 0),
            suggested_actions=analysis.get("suggested_action", []),
            evidence_strength=evidence_info.get("total_strength", 0),
            evidence_list=evidence_info.get("evidence_list", [])
        )
    
    @staticmethod
    async def generate_ai_analysis_report(detection_result: Dict, image_filename: str) -> str:
        """
        调用DeepSeek API生成专业的AI分析报告
        
        Args:
            detection_result: 检测结果字典
            image_filename: 检测的图片文件名
            
        Returns:
            DeepSeek生成的专业分析报告文本
        """
        if not settings.DEEPSEEK_API_KEY:
            raise ValueError("DeepSeek API密钥未配置，无法生成AI分析报告")
        
        # 格式化数据
        data = ReportService._format_report_data(detection_result, image_filename)
        
        # 构建提示词
        prompt = ReportService._build_analysis_prompt(data)
        
        # 调用DeepSeek API
        url = "https://api.deepseek.com/chat/completions"
        headers = {
            "Authorization": f"Bearer {settings.DEEPSEEK_API_KEY}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": "deepseek-chat",
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "你是一位专业的数字取证专家和中国知识产权法律顾问。"
                        "你擅长分析数字水印检测结果，并出具具有法律参考价值的分析报告。"
                        "报告需客观、专业、详实，适合作为初步的证据材料。"
                        "你会关注证据链的时间线逻辑一致性、多维度交叉验证以及五维评分矩阵的综合判断。"
                    )
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            "temperature": 0.4,
            "max_tokens": 3000
        }
        
        try:
            async with httpx.AsyncClient(timeout=45.0) as client:
                response = await client.post(url, headers=headers, json=payload)
                response.raise_for_status()
                result = response.json()
                return result['choices'][0]['message']['content'].strip()
        except Exception as e:
            logger.error(f"DeepSeek报告生成失败: {e}")
            return ReportService._generate_local_fallback_report(data)
    
    @staticmethod
    def generate_enhanced_report(
        detection_result: Dict,
        image_filename: str,
        user_plan: str = "free",
        blockchain_data: Optional[Dict] = None
    ) -> Dict:
        """
        生成增强版报告（含五维评分和可视化数据）
        
        Args:
            detection_result: 检测结果
            image_filename: 文件名
            user_plan: 用户套餐（free/personal/pro/enterprise）
            blockchain_data: 区块链存证数据
        """
        from app.service.evidence_scoring import EvidenceScorer, FingerprintVisualizer
        
        # 格式化基础数据
        data = ReportService._format_report_data(detection_result, image_filename)
        
        # 计算五维评分（专业版及以上）
        five_dim_score = None
        if user_plan in ["personal", "pro", "enterprise"]:
            five_dim_score = EvidenceScorer.calculate_all_scores(detection_result, blockchain_data)
        
        # 生成比特热力图（专业版及以上）
        bit_heatmap = None
        if user_plan in ["pro", "enterprise"] and data.best_match:
            bit_heatmap = FingerprintVisualizer.generate_bit_heatmap(
                detection_result.get("extracted_fingerprint", ""),
                data.best_match.get("fingerprint", "")
            )
        
        # 生成雷达图数据
        radar_data = None
        if five_dim_score:
            radar_data = FingerprintVisualizer.generate_radar_chart_data(five_dim_score)
        
        # 生成时间线
        timeline = FingerprintVisualizer.generate_evidence_timeline(detection_result, blockchain_data)
        
        # 构建报告
        report = {
            "report_meta": {
                "report_id": data.detection_id,
                "report_type": "数字版权鉴定意见书" if user_plan in ["pro", "enterprise"] else "数字指纹检测报告",
                "generated_at": data.detection_time,
                "system_version": "AIGC-Guard-v2.1",
                "user_plan": user_plan,
                "format_version": "2.0"
            },
            "detection_summary": {
                "target_file": data.image_filename,
                "detection_result": "WATERMARK_FOUND" if data.has_watermark else "NO_WATERMARK",
                "risk_level": data.risk_level,
                "risk_description": data.risk_description,
                "overall_confidence": data.confidence_score,
                "five_dim_score": five_dim_score.to_dict() if five_dim_score else None,
                "confidence_level": five_dim_score.confidence_level if five_dim_score else "未评级",
                "legal_description": five_dim_score.legal_description if five_dim_score else ""
            },
            "visualizations": {
                "bit_heatmap": bit_heatmap,
                "radar_chart": radar_data,
                "evidence_timeline": timeline
            } if user_plan in ["pro", "enterprise"] else {},
            "technical_details": {
                "fingerprint": {
                    "hash_prefix": data.fingerprint_hash,
                    "strength_score": data.fingerprint_strength,
                    "strength_level": data.fingerprint_level,
                    "phash": data.phash
                },
                "watermark": data.watermark_info
            },
            "matching_analysis": {
                "total_candidates": data.total_candidates,
                "best_match": data.best_match,
                "top_candidates": data.match_candidates[:5]
            },
            "legal_assessment": {
                "verdict": data.verdict,
                "evidence_strength": data.evidence_strength,
                "evidence_chain": data.evidence_list,
                "is_admissible": data.evidence_strength >= 60,
                "applicable_laws": ["著作权法", "电子签名法", "网络安全法"]
            },
            "recommendations": {
                "actions": data.suggested_actions,
                "priority": "HIGH" if data.risk_level == "HIGH" else "MEDIUM" if data.risk_level == "MEDIUM" else "LOW"
            },
            "tier_features": {
                "free": ["基础相似度", "是否命中"],
                "personal": ["五维评分(简化)", "Markdown报告"],
                "pro": ["五维评分(完整)", "比特热力图", "雷达图", "时间线", "AI法律分析"],
                "enterprise": ["专家署名", "DMCA文书", "API数据包"]
            }
        }
        
        return report
    
    @staticmethod
    def _build_analysis_prompt(data: DetectionReportData) -> str:
        """构建DeepSeek AI分析报告的提示词（增强版）"""

        # 构建候选匹配列表描述
        candidates_desc = ""
        if data.match_candidates:
            candidates_desc = "\n候选匹配列表：\n"
            for i, cand in enumerate(data.match_candidates[:5], 1):
                cand_time = cand.get('creation_time', cand.get('timestamp', '未知'))
                candidates_desc += (
                    f"  {i}. 作者：{cand.get('author', '未知')}，"
                    f"相似度：{cand.get('similarity', 0)}%，"
                    f"置信度：{cand.get('confidence_level', '未知')}，"
                    f"确权时间：{cand_time}\n"
                )

        # 构建最佳匹配描述
        best_match_desc = "无匹配记录"
        if data.best_match:
            bm = data.best_match
            best_match_desc = f"""最佳匹配：
  - 作者：{bm.get('author_name', '未知')}
  - 相似度：{bm.get('similarity', 0)}%
  - 确权时间：{bm.get('creation_time', '未知')}
  - 匹配方法：{bm.get('match_method', '指纹比对')}
  - 片段匹配率：{bm.get('fingerprint_fragment_match', 'N/A')}%
  - 区块链TxHash：{bm.get('tx_hash', '无')}"""

        # 构建证据链描述
        evidence_desc = ""
        if data.evidence_list:
            evidence_desc = "\n证据链详情：\n"
            for ev in data.evidence_list:
                evidence_desc += f"  - {ev.get('type', '未知')}（强度{ev.get('strength', 0) * 100:.0f}%）：{ev.get('description', '')}\n"

        prompt = f"""请基于以下数字指纹检测结果，生成一份专业的版权鉴定分析报告。

## 检测基本信息
- 检测时间：{data.detection_time}
- 被检测文件：{data.image_filename}
- 检测结果：{"发现数字水印" if data.has_watermark else "未发现数字水印"}
- 风险等级：{data.risk_level}（{data.risk_description}）

## 技术检测数据
- 指纹哈希前缀：{data.fingerprint_hash}
- 指纹强度评分：{data.fingerprint_strength}/256（{data.fingerprint_level}）
- 感知哈希(pHash)：{data.phash if data.phash else "未计算"}
- 综合置信度：{data.confidence_score:.1f}%

## 匹配分析结果
{best_match_desc}
{candidates_desc}

## 证据评估
- 总证据强度：{data.evidence_strength}/100
- 系统判定：{data.verdict}
{evidence_desc}

## 建议操作
{'、'.join(data.suggested_actions) if data.suggested_actions else '暂无建议'}

---

请根据以上数据，撰写一份包含以下章节的专业鉴定报告：

1. **执行摘要**：简明扼要概述检测结论、风险等级、核心发现（50-80字即可）。

2. **技术分析**：
   - 数字指纹特征分析：解读指纹哈希前缀与强度分值的意义
   - 匹配算法原理说明（DCT频域指纹、汉明距离、感知哈希）
   - 相似度计算依据与阈值说明

3. **证据链时间线分析**（重要）：
   - 将检测中发现的各个指纹的确权时间（创作时间、嵌入时间、候选匹配确权时间、区块链存证时间、本次检测时间）按时间先后排列
   - 分析时间线的逻辑一致性（例：创作→嵌入→存证→检测 的合理顺序）
   - 判断是否存在时间倒序等异常（若创作时间晚于嵌入时间，应提示可能的异常）
   - 对比最佳匹配与候选匹配中不同指纹的确权时间差异

4. **法律风险评估**：
   - 基于《著作权法》《电子签名法》分析证据效力
   - 侵权可能性判定（是否构成实质性相似）
   - 证据链完整度评价
   - 综合风险判断（结合技术分析与时间线分析）

5. **维权策略建议**：
   - 根据风险等级给出分级建议
   - 高风险：建议立即维权的具体步骤（包括证据固定、平台投诉、法律诉讼）
   - 中风险：建议补充证据的方向
   - 低风险：日常防护建议

6. **技术局限性声明**：说明算法局限与适用范围

输出格式要求：
- 使用 Markdown 格式，每个章节使用 ## 二级标题
- 语言专业、客观、严谨
- 结论性表述使用谨慎措辞（如"技术鉴定推定"而非"确定侵权"）
- 适合作为初步维权证据或法律咨询参考
- 报告末尾附免责声明
"""
        return prompt

    @staticmethod
    def _generate_local_fallback_report(data: DetectionReportData) -> str:
        """当DeepSeek API不可用时，生成本地简化版报告"""
        
        report = f"""# 数字指纹检测报告（简化版）

> **注意**：本报告为系统本地生成（AI服务暂时不可用）

## 执行摘要

- **检测时间**: {data.detection_time}
- **被检测文件**: {data.image_filename}
- **检测结果**: {"发现数字水印" if data.has_watermark else "未发现数字水印"}
- **风险等级**: {data.risk_description}

## 技术检测详情

### 指纹特征
- **指纹哈希**: {data.fingerprint_hash}
- **强度评分**: {data.fingerprint_strength}/256 ({data.fingerprint_level})
- **感知哈希**: {data.phash if data.phash else "未计算"}

### 水印信息
"""
        
        if data.watermark_info:
            report += f"""
- **声明作者**: {data.watermark_info.get('author_name', '未知')}
- **创建时间**: {datetime.fromtimestamp(data.watermark_info.get('timestamp', 0)).strftime('%Y-%m-%d %H:%M:%S') if data.watermark_info.get('timestamp') else 'N/A'}
- **水印版本**: {data.watermark_info.get('version', '未知')}
"""
        else:
            report += "未提取到水印详细信息\n"
        
        report += f"""
## 匹配对比分析

### 最佳匹配
- **作者**: {data.best_match.get('author_name', '无') if data.best_match else '无匹配'}
- **相似度**: {data.best_match.get('similarity', 0) if data.best_match else 0}%
- **置信度**: {data.best_match.get('match_confidence', 'N/A') if data.best_match else 'N/A'}

### 候选列表（Top {min(len(data.match_candidates), 5)}）
"""
        
        for i, cand in enumerate(data.match_candidates[:5], 1):
            report += f"{i}. **{cand.get('author', '未知')}** - 相似度{cand.get('similarity', 0)}% ({cand.get('confidence_level', '未知')})\n"
        
        report += f"""
## 版权归属评估

{data.verdict}

## 风险提示与建议

"""
        for action in data.suggested_actions:
            report += f"- {action}\n"
        
        report += f"""
## 证据链详情

总证据强度: {data.evidence_strength}/100

"""
        for ev in data.evidence_list:
            report += f"- **{ev.get('type', '未知')}** (强度{ev.get('strength', 0) * 100:.0f}%): {ev.get('description', '')}\n"
        
        report += """
---
*本报告由智御·AIGC版权卫士系统自动生成*
*技术检测结果仅供参考，最终法律认定请以司法机构裁定为准*
"""
        
        return report
    
    @staticmethod
    def generate_structured_report(detection_result: Dict, image_filename: str, format: str = "json") -> Dict:
        """
        生成结构化报告数据，支持多种格式导出
        
        Args:
            detection_result: 检测结果
            image_filename: 文件名
            format: 报告格式 (json/markdown/pdf_ready)
            
        Returns:
            结构化报告数据
        """
        data = ReportService._format_report_data(detection_result, image_filename)
        
        report = {
            "report_meta": {
                "report_id": data.detection_id,
                "report_type": "数字指纹检测分析报告",
                "generated_at": data.detection_time,
                "system_version": "AIGC-Guard-v2.0",
                "format_version": "1.0"
            },
            "detection_summary": {
                "target_file": data.image_filename,
                "detection_result": "WATERMARK_FOUND" if data.has_watermark else "NO_WATERMARK",
                "risk_level": data.risk_level,
                "risk_description": data.risk_description,
                "overall_confidence": data.confidence_score
            },
            "technical_details": {
                "fingerprint": {
                    "hash_prefix": data.fingerprint_hash,
                    "strength_score": data.fingerprint_strength,
                    "strength_level": data.fingerprint_level,
                    "phash": data.phash
                },
                "watermark": data.watermark_info
            },
            "matching_analysis": {
                "total_candidates": data.total_candidates,
                "best_match": data.best_match,
                "top_candidates": data.match_candidates[:5]
            },
            "legal_assessment": {
                "verdict": data.verdict,
                "evidence_strength": data.evidence_strength,
                "evidence_chain": data.evidence_list,
                "is_admissible": data.evidence_strength >= 60
            },
            "recommendations": {
                "actions": data.suggested_actions,
                "priority": "HIGH" if data.risk_level == "HIGH" else "MEDIUM" if data.risk_level == "MEDIUM" else "LOW"
            },
            "disclaimer": {
                "text": "本报告为技术检测结果，仅供初步证据参考。最终法律认定请以司法机构裁定为准。",
                "jurisdiction": "中华人民共和国",
                "applicable_laws": ["著作权法", "网络安全法"]
            }
        }
        
        if format == "markdown":
            # 转换为Markdown格式
            report["markdown_content"] = ReportService._convert_to_markdown(report)
        
        return report
    
    @staticmethod
    def _convert_to_markdown(structured_report: Dict) -> str:
        """将结构化报告转换为Markdown格式"""
        
        meta = structured_report["report_meta"]
        summary = structured_report["detection_summary"]
        tech = structured_report["technical_details"]
        match = structured_report["matching_analysis"]
        legal = structured_report["legal_assessment"]
        rec = structured_report["recommendations"]
        
        md = f"""# 数字指纹检测报告

> **报告ID**: {meta['report_id']}  
> **生成时间**: {meta['generated_at']}  
> **系统版本**: {meta['system_version']}

---

## 执行摘要

**检测目标**: {summary['target_file']}  
**检测结果**: {"✅ 发现数字水印" if summary['detection_result'] == 'WATERMARK_FOUND' else "❌ 未发现数字水印"}  
**风险等级**: {'🔴 ' + summary['risk_level'] if summary['risk_level'] == 'HIGH' else '🟡 ' + summary['risk_level'] if summary['risk_level'] == 'MEDIUM' else '🟢 ' + summary['risk_level']}  
**综合置信度**: {summary['overall_confidence']:.1f}%

## 技术检测详情

### 指纹特征分析
- **指纹哈希**: `{tech['fingerprint']['hash_prefix']}`
- **强度评分**: {tech['fingerprint']['strength_score']}/256
- **强度等级**: {tech['fingerprint']['strength_level']}
- **感知哈希**: `{tech['fingerprint']['phash'] or "N/A"}`

### 水印信息
"""
        
        if tech['watermark']:
            md += f"""
| 字段 | 值 |
|------|-----|
| 声明作者 | {tech['watermark'].get('author_name', '未知')} |
| 创建时间 | {datetime.fromtimestamp(tech['watermark'].get('timestamp', 0)).strftime('%Y-%m-%d %H:%M:%S') if tech['watermark'].get('timestamp') else 'N/A'} |
| 水印版本 | {tech['watermark'].get('version', '未知')} |
"""
        else:
            md += "未提取到水印详细信息\n"
        
        md += f"""
## 匹配对比分析

### 最佳匹配
"""
        
        if match['best_match']:
            bm = match['best_match']
            md += f"""
| 字段 | 值 |
|------|-----|
| 作者 | **{bm.get('author_name', '未知')}** |
| 相似度 | {bm.get('similarity', 0)}% |
| 置信度 | {bm.get('match_confidence', 'N/A')} |
| 创建时间 | {bm.get('creation_time', '未知')} |
"""
        else:
            md += "无匹配记录\n"
        
        md += f"""
### TOP候选列表

| 排名 | 作者 | 相似度 | 置信度 |
|------|------|--------|--------|
"""
        
        for i, cand in enumerate(match['top_candidates'], 1):
            md += f"| {i} | {cand.get('author', '未知')} | {cand.get('similarity', 0)}% | {cand.get('confidence_level', '未知')} |\n"
        
        md += f"""
## 版权归属评估

{legal['verdict']}

## 证据链分析

**总证据强度**: {legal['evidence_strength']}/100 ({"可作为有效证据" if legal['is_admissible'] else "证据不足"})

"""
        
        for ev in legal['evidence_chain']:
            md += f"- **{ev.get('type', '未知')}** (强度: {ev.get('strength', 0) * 100:.0f}%)\n"
            md += f"  - {ev.get('description', '')}\n"
        
        md += f"""
## 建议行动

优先级: {'🔴 高' if rec['priority'] == 'HIGH' else '🟡 中' if rec['priority'] == 'MEDIUM' else '🟢 低'}

"""
        
        for i, action in enumerate(rec['actions'], 1):
            md += f"{i}. {action}\n"

        md += f"""

---

## 匹配依据与算法说明

本平台对“是否同源/是否侵权”的判定遵循**多证据融合**原则，按照证据强度由强到弱依次参考：

1. **数字指纹相似度（主依据，确定性证据）**
   - 从图像中提取不可见数字指纹特征，并与证据库中的原始资产指纹进行比对。
   - 指纹相似度越高，代表“同源”的确定性越强。

2. **感知哈希 pHash（辅助依据，相似性证据）**
   - 用于对压缩、缩放、轻微裁剪等处理后的图像进行相似性佐证。
   - pHash 属于辅助证据，不作为唯一确权依据。

3. **时间戳一致性（增强可信度）**
   - 若检测到水印内嵌时间戳，系统会与证据库记录时间进行合理性核验，并对综合评分进行加权。
   - 时间戳用于增强可信度与排序，不作为单独判定侵权的唯一依据。

4. **FAISS 深度向量检索（兜底依据，鲁棒性证据）**
   - 当指纹被极端破坏或无法稳定提取时，系统启用深度特征向量检索作为 fallback。
   - 向量检索更偏“高度疑似同源”的技术推定，报告中会以谨慎措辞呈现。

### 作者身份字段说明

- **user_id（UUID）**：平台账号的唯一身份标识，用于资产归属与权限控制（不可重复、不可伪造）。
- **display_name / author_name**：用于界面展示的昵称/署名，可能存在重名，仅用于可读性展示。

"""
        
        md += f"""
---

## 免责声明

> {structured_report['disclaimer']['text']}  
> 适用法律: {', '.join(structured_report['disclaimer']['applicable_laws'])}

---
*本报告由 智御·AIGC数字版权卫士 生成*  
*技术检测结果仅供参考，最终法律认定请以司法机构裁定为准*
"""
        
        return md
