"""
DMCA 文书 PDF 生成服务
生成正式的法律维权文书 PDF
"""

import io
from typing import Dict, Optional
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib.colors import HexColor, black
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import logging

logger = logging.getLogger("app")


class DMCAPDFService:
    """DMCA 文书 PDF 生成服务"""
    
    FONT_NAME = 'SimHei'
    
    @staticmethod
    def _get_chinese_font():
        """获取中文字体路径"""
        import os
        
        possible_paths = [
            '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
            '/System/Library/Fonts/PingFang.ttc',
            'C:/Windows/Fonts/simhei.ttf',
            'C:/Windows/Fonts/simsun.ttc',
        ]
        
        for path in possible_paths:
            if os.path.exists(path):
                return path
        return None
    
    @classmethod
    def _register_fonts(cls):
        """注册中文字体"""
        try:
            font_path = cls._get_chinese_font()
            if font_path:
                pdfmetrics.registerFont(TTFont(cls.FONT_NAME, font_path))
                return True
        except Exception as e:
            logger.warning(f"中文字体注册失败: {e}")
        return False
    
    @classmethod
    def generate_dmca_pdf(
        cls,
        dmca_content: str,
        author_name: str,
        asset_name: str,
        infringing_url: str,
        similarity: float,
        evidence_data: Optional[Dict] = None
    ) -> bytes:
        """
        生成 DMCA 维权文书 PDF
        
        Args:
            dmca_content: DMCA 文书内容
            author_name: 权利人名称
            asset_name: 作品名称
            infringing_url: 侵权链接
            similarity: 相似度
            evidence_data: 证据数据（可选）
            
        Returns:
            PDF 文件字节内容
        """
        has_chinese_font = cls._register_fonts()
        
        buffer = io.BytesIO()
        
        doc = SimpleDocTemplate(
            buffer,
            pagesize=A4,
            rightMargin=2.5*cm,
            leftMargin=2.5*cm,
            topMargin=2.5*cm,
            bottomMargin=2.5*cm
        )
        
        styles = getSampleStyleSheet()
        
        # 自定义样式
        title_style = ParagraphStyle(
            'DMCTitle',
            parent=styles['Heading1'],
            fontSize=20,
            textColor=HexColor('#1e293b'),
            spaceAfter=30,
            alignment=1,  # 居中
            fontName=cls.FONT_NAME if has_chinese_font else 'Helvetica-Bold'
        )
        
        heading_style = ParagraphStyle(
            'DMCAHeading',
            parent=styles['Heading2'],
            fontSize=14,
            textColor=HexColor('#334155'),
            spaceAfter=12,
            spaceBefore=20,
            fontName=cls.FONT_NAME if has_chinese_font else 'Helvetica-Bold'
        )
        
        body_style = ParagraphStyle(
            'DMCABody',
            parent=styles['Normal'],
            fontSize=11,
            textColor=HexColor('#475569'),
            leading=20,
            firstLineIndent=22,  # 首行缩进
            fontName=cls.FONT_NAME if has_chinese_font else 'Helvetica'
        )
        
        info_style = ParagraphStyle(
            'DMCAInfo',
            parent=styles['Normal'],
            fontSize=10,
            textColor=HexColor('#64748b'),
            leading=16,
            fontName=cls.FONT_NAME if has_chinese_font else 'Helvetica'
        )
        
        story = []
        
        # 标题
        story.append(Paragraph("数字版权侵权下架通知函", title_style))
        story.append(Spacer(1, 20))
        
        # 文书编号和日期
        doc_id = f"DMCA-{datetime.now().strftime('%Y%m%d')}-{hash(author_name) % 10000:04d}"
        story.append(Paragraph(f"<b>文书编号：</b>{doc_id}", info_style))
        story.append(Paragraph(f"<b>生成日期：</b>{datetime.now().strftime('%Y年%m月%d日')}", info_style))
        story.append(Spacer(1, 15))
        
        # 分隔线
        story.append(HRFlowable(width="100%", thickness=1, color=HexColor('#e2e8f0')))
        story.append(Spacer(1, 15))
        
        # 案件信息摘要
        story.append(Paragraph("一、案件信息摘要", heading_style))
        
        info_data = [
            ['权利人（申诉方）', author_name],
            ['涉嫌侵权作品', asset_name],
            ['侵权内容链接', infringing_url],
            ['技术比对相似度', f'{similarity:.2f}%' if similarity else '待检测'],
            ['证据链状态', '已区块链存证' if evidence_data and evidence_data.get('tx_hash') else '已技术取证'],
        ]
        
        info_table = Table(info_data, colWidths=[4*cm, 10*cm])
        info_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, -1), HexColor('#f8fafc')),
            ('TEXTCOLOR', (0, 0), (0, -1), HexColor('#475569')),
            ('TEXTCOLOR', (1, 0), (1, -1), HexColor('#334155')),
            ('ALIGN', (0, 0), (0, -1), 'LEFT'),
            ('ALIGN', (1, 0), (1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#e2e8f0')),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ]))
        story.append(info_table)
        story.append(Spacer(1, 20))
        
        # 正式通知函内容
        story.append(Paragraph("二、正式通知内容", heading_style))
        
        # 处理正文内容，按段落分割
        paragraphs = dmca_content.split('\n\n')
        for para in paragraphs:
            if para.strip():
                # 检查是否是标题行
                if para.strip().startswith('【') and para.strip().endswith('】'):
                    story.append(Paragraph(para.strip(), heading_style))
                else:
                    story.append(Paragraph(para.strip(), body_style))
                story.append(Spacer(1, 10))
        
        # 证据附件说明
        if evidence_data:
            story.append(Spacer(1, 20))
            story.append(Paragraph("三、技术证据附件", heading_style))
            
            evidence_items = []
            if evidence_data.get('tx_hash'):
                evidence_items.append(['区块链存证哈希', evidence_data['tx_hash'][:20] + '...'])
            if evidence_data.get('block_height'):
                evidence_items.append(['区块高度', str(evidence_data['block_height'])])
            if evidence_data.get('fingerprint_match'):
                evidence_items.append(['数字指纹匹配度', f"{evidence_data['fingerprint_match']:.2f}%"])
            if evidence_data.get('timestamp'):
                evidence_items.append(['取证时间', evidence_data['timestamp']])
            
            if evidence_items:
                ev_table = Table(evidence_items, colWidths=[4*cm, 10*cm])
                ev_table.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (0, -1), HexColor('#ede9fe')),
                    ('TEXTCOLOR', (0, 0), (-1, -1), HexColor('#5b21b6')),
                    ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#c4b5fd')),
                    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                    ('TOPPADDING', (0, 0), (-1, -1), 6),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
                ]))
                story.append(ev_table)
        
        # 法律声明
        story.append(Spacer(1, 30))
        story.append(Paragraph("四、法律效力声明", heading_style))
        
        legal_text = """
        本通知函基于《中华人民共和国著作权法》《信息网络传播权保护条例》等相关法律法规生成。
        权利人已对上述内容的真实性承担法律责任。如贵方对侵权认定存在异议，请于收到本函后24小时内
        与权利人联系协商解决。逾期未处理，权利人保留采取进一步法律行动的权利。
        """
        story.append(Paragraph(legal_text, body_style))
        
        # 落款区域
        story.append(Spacer(1, 40))
        story.append(HRFlowable(width="40%", thickness=0.5, color=HexColor('#94a3b8'), hAlign='RIGHT'))
        story.append(Spacer(1, 10))
        
        signature_style = ParagraphStyle(
            'Signature',
            parent=styles['Normal'],
            fontSize=11,
            textColor=HexColor('#475569'),
            alignment=2,  # 右对齐
            fontName=cls.FONT_NAME if has_chinese_font else 'Helvetica'
        )
        
        story.append(Paragraph("权利人签名：_________________", signature_style))
        story.append(Spacer(1, 8))
        story.append(Paragraph(f"日期：{datetime.now().strftime('%Y年%m月%d日')}", signature_style))
        story.append(Spacer(1, 8))
        story.append(Paragraph("（盖章有效）", signature_style))
        
        # 页脚
        def add_page_footer(canvas, doc):
            canvas.saveState()
            canvas.setFont('Helvetica', 8)
            canvas.setFillColor(HexColor('#94a3b8'))
            
            footer_text = f"智御·AIGC数字版权卫士 | 本文件由AI辅助生成，仅供维权参考 | {doc_id}"
            canvas.drawString(2.5*cm, 1.5*cm, footer_text)
            
            page_num = canvas.getPageNumber()
            canvas.drawRightString(A4[0] - 2.5*cm, 1.5*cm, f"第 {page_num} 页")
            
            canvas.restoreState()
        
        # 生成 PDF
        doc.build(story, onFirstPage=add_page_footer, onLaterPages=add_page_footer)
        
        pdf_content = buffer.getvalue()
        buffer.close()
        
        return pdf_content


# 导出快捷函数
def generate_dmca_pdf_document(
    dmca_content: str,
    author_name: str,
    asset_name: str,
    infringing_url: str,
    similarity: float = 0,
    evidence_data: Optional[Dict] = None
) -> bytes:
    """
    快捷函数：生成 DMCA PDF 文档
    """
    return DMCAPDFService.generate_dmca_pdf(
        dmca_content=dmca_content,
        author_name=author_name,
        asset_name=asset_name,
        infringing_url=infringing_url,
        similarity=similarity,
        evidence_data=evidence_data
    )
