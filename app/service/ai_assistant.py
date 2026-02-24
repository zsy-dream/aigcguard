import httpx
import logging
from app.core.config import settings

logger = logging.getLogger("app")

class AIAssistantService:
    @staticmethod
    async def generate_takedown_notice(
        author_name: str,
        asset_name: str,
        infringing_url: str,
        similarity: float | None = None,
        tx_hash: str | None = None,
        block_height: str | int | None = None,
        evidence_points: list[str] | None = None,
    ) -> str:
        """调用 DeepSeek API 自动生成版权侵权下架通知函 (DMCA)"""
        url = "https://api.deepseek.com/chat/completions"
        headers = {
            "Authorization": f"Bearer {settings.DEEPSEEK_API_KEY}",
            "Content-Type": "application/json"
        }
        evidence_lines = []
        if similarity is not None:
            try:
                evidence_lines.append(f"- 技术比对相似度（系统置信度）: {float(similarity):.2f}%")
            except Exception:
                evidence_lines.append(f"- 技术比对相似度（系统置信度）: {similarity}")
        if tx_hash:
            evidence_lines.append(f"- 区块链存证 TX Hash: {tx_hash}")
        if block_height is not None:
            evidence_lines.append(f"- 区块高度/确认信息: {block_height}")
        if evidence_points:
            evidence_lines.extend([f"- {p}" for p in evidence_points if p])

        evidence_text = "\n".join(evidence_lines) if evidence_lines else "- 数字指纹/隐形水印检测与平台存证记录（可提供后台取证截图/记录）"
        
        prompt = f"""
你是一位专业的中国知识产权保护律师。请帮我起草一份发给侵权方（或平台方）的《侵权下架通知函》。

【以下是基本信息】
- 权利人（创作者）：{author_name}
- 原创作品名称：{asset_name}
- 发现侵权行为的链接：{infringing_url}

【可提供的证据要点】
{evidence_text}

【要求】
1. 态度严正，措辞专业，符合中国《著作权法》等法律规范。
2. 声明由于涉案作品包含了我国法律保护的内容，且我方拥有明确的**数字化确权证书与不可见隐藏水印证据**。
3. 明确要求对方在收到此函后 24 小时内立即删除侵权内容并停止传播。
4. 包含保留追究法律责任（如诉讼、索赔）的严正声明。
5. 只返回通知函的正文部分（落款可以提示留空位），不需要多余的问候语或解释。
"""

        payload = {
            "model": "deepseek-chat",
            "messages": [
                {"role": "system", "content": "You are a professional intellectual property lawyer."},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.3
        }
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                response = await client.post(url, headers=headers, json=payload)
                response.raise_for_status()
                data = response.json()
                return data['choices'][0]['message']['content'].strip()
            except Exception as e:
                logger.error(f"DeepSeek API Error: {e}")
                raise ValueError("抱歉，使用大模型自动生成下架函失败，请稍后重试。原因：" + str(e))
