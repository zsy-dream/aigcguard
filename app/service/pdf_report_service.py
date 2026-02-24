"""
增强版 PDF 报告生成服务
支持可视化图表嵌入（雷达图、热力图）
"""

import io
import base64
from typing import Dict, Optional, Any
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm, cm
from reportlab.lib.colors import HexColor, white, black, Color
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, 
    Image, PageBreak, HRFlowable
)
from reportlab.graphics.shapes import Drawing, Rect, String, Polygon
from reportlab.graphics.charts.textlabels import Label
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import logging

logger = logging.getLogger("app")


class PDFReportService:
    """PDF 报告生成服务"""
    
    # 中文字体配置
    FONT_NAME = 'SimHei'
    FONT_PATH = None  # 使用系统默认路径或需要时指定
    
    @staticmethod
    def _get_chinese_font():
        """获取中文字体路径"""
        import os
        
        # 尝试常见的中文字体路径（优先级从高到低）
        possible_paths = [
            'C:/Windows/Fonts/simhei.ttf',  # Windows 黑体
            'C:/Windows/Fonts/msyh.ttc',    # Windows 微软雅黑
            'C:/Windows/Fonts/simsun.ttc',   # Windows 宋体
            'C:/Windows/Fonts/simkai.ttf',   # Windows 楷体
            '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',  # Linux
            '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
            '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
            '/System/Library/Fonts/PingFang.ttc',  # macOS
            '/System/Library/Fonts/STHeiti Light.ttc',
        ]
        
        for path in possible_paths:
            if os.path.exists(path):
                return path
        
        return None
    
    @classmethod
    def _register_fonts(cls):
        """注册中文字体"""
        try:
            # 检查是否已注册
            try:
                pdfmetrics.getFont(cls.FONT_NAME)
                return True
            except KeyError:
                pass
            
            font_path = cls._get_chinese_font()
            if font_path:
                if font_path.endswith('.ttc'):
                    # TTC 文件需要指定 subfont index
                    pdfmetrics.registerFont(TTFont(cls.FONT_NAME, font_path, subfontIndex=0))
                else:
                    pdfmetrics.registerFont(TTFont(cls.FONT_NAME, font_path))
                logger.info(f"中文字体注册成功: {font_path}")
                return True
        except Exception as e:
            logger.warning(f"中文字体注册失败: {e}")
        return False
    
    @staticmethod
    def generate_radar_chart_base64(dimensions: Dict[str, float], size: int = 400) -> str:
        """
        生成雷达图并返回 base64 编码
        
        Args:
            dimensions: {'指纹置信': 85, '时间链': 70, ...}
            size: 图片尺寸
        """
        try:
            labels = list(dimensions.keys())
            values = list(dimensions.values())
            
            # 闭合数据
            values += values[:1]
            angles = np.linspace(0, 2 * np.pi, len(labels), endpoint=False).tolist()
            angles += angles[:1]
            
            fig, ax = plt.subplots(figsize=(size/100, size/100), subplot_kw=dict(polar=True))
            
            # 绘制雷达图
            ax.fill(angles, values, color='#6366f1', alpha=0.25)
            ax.plot(angles, values, color='#6366f1', linewidth=2)
            ax.scatter(angles[:-1], values[:-1], color='#6366f1', s=50, zorder=5)
            
            # 设置标签
            ax.set_xticks(angles[:-1])
            ax.set_xticklabels(labels, fontsize=10)
            ax.set_ylim(0, 100)
            
            # 添加网格
            ax.grid(True, linestyle='--', alpha=0.5)
            ax.set_facecolor('#f8fafc')
            
            # 添加数值标签
            for angle, value, label in zip(angles[:-1], values[:-1], labels):
                ax.text(angle, value + 8, f'{value:.0f}', 
                       ha='center', va='center', fontsize=9, fontweight='bold')
            
            plt.tight_layout()
            
            # 保存为 base64
            buffer = io.BytesIO()
            plt.savefig(buffer, format='png', dpi=100, bbox_inches='tight', 
                       facecolor='white', edgecolor='none')
            buffer.seek(0)
            image_base64 = base64.b64encode(buffer.read()).decode()
            plt.close()
            
            return image_base64
        except Exception as e:
            logger.error(f"雷达图生成失败: {e}")
            return ""

    @classmethod
    def generate_timeline_chart_base64(cls, timeline: list, width: int = 900, height: int = 220) -> str:
        """生成证据链时间轴图并返回 base64 编码。

        timeline item 形如：
        {"event": "作品创作", "timestamp": 1700000000, "time_str": "2025-01-01 12:00:00", ...}
        """
        try:
            if not timeline or len(timeline) == 0:
                return ""

            font_prop = None
            try:
                from matplotlib import font_manager
                font_path = cls._get_chinese_font()
                if font_path:
                    font_prop = font_manager.FontProperties(fname=font_path)
            except Exception:
                font_prop = None

            # 仅保留带 timestamp 的事件
            points = []
            for it in timeline:
                if not isinstance(it, dict):
                    continue
                ts = it.get('timestamp')
                if ts is None:
                    continue
                try:
                    ts_int = int(ts)
                except Exception:
                    continue
                points.append({
                    'ts': ts_int,
                    'event': str(it.get('event') or it.get('name') or '事件'),
                    'time_str': str(it.get('time_str') or it.get('time') or ''),
                })

            if len(points) == 0:
                return ""

            points.sort(key=lambda x: x['ts'])

            # 映射到 [0,1] 的横坐标，避免极大时间差导致不可视
            min_ts = points[0]['ts']
            max_ts = points[-1]['ts']
            span = max(max_ts - min_ts, 1)
            xs = [(p['ts'] - min_ts) / span for p in points]
            ys = [0.0 for _ in points]

            fig, ax = plt.subplots(figsize=(width / 100, height / 100))
            ax.set_facecolor('white')

            # 主时间轴
            ax.hlines(0.0, 0.0, 1.0, color='#cbd5e1', linewidth=3, zorder=1)

            # 事件点
            ax.scatter(xs, ys, s=120, color='#6366f1', edgecolors='white', linewidth=2, zorder=3)

            # 标签：交错上下显示
            for i, (x, p) in enumerate(zip(xs, points)):
                dy = 0.18 if i % 2 == 0 else -0.22
                label = p['event']
                if p['time_str']:
                    label = f"{p['event']}\n{p['time_str']}"

                ax.annotate(
                    label,
                    xy=(x, 0.0),
                    xytext=(x, dy),
                    textcoords='data',
                    ha='center',
                    va='center',
                    fontsize=9,
                    color='#334155',
                    arrowprops=dict(arrowstyle='-', color='#94a3b8', lw=1.2),
                    bbox=dict(boxstyle='round,pad=0.25', fc='#f8fafc', ec='#e2e8f0', alpha=1.0),
                    fontproperties=font_prop,
                )

            ax.set_xlim(-0.03, 1.03)
            ax.set_ylim(-0.6, 0.6)
            ax.axis('off')
            plt.tight_layout()

            buffer = io.BytesIO()
            plt.savefig(buffer, format='png', dpi=150, bbox_inches='tight', facecolor='white', edgecolor='none')
            buffer.seek(0)
            image_base64 = base64.b64encode(buffer.read()).decode()
            plt.close()
            return image_base64
        except Exception as e:
            logger.error(f"时间轴图生成失败: {e}")
            return ""
    
    @staticmethod
    def generate_heatmap_base64(heatmap_data: list, size: int = 300) -> str:
        """
        生成热力图并返回 base64 编码
        
        Args:
            heatmap_data: 8x8 的匹配率矩阵
            size: 图片尺寸
        """
        try:
            if not heatmap_data or len(heatmap_data) == 0:
                return ""
            
            # 展平数据为 8x8 矩阵
            matrix = np.zeros((8, 8))
            for row_idx, row in enumerate(heatmap_data[:8]):
                for col_idx, cell in enumerate(row[:8]):
                    if isinstance(cell, dict):
                        matrix[row_idx, col_idx] = cell.get('match_rate', 0)
                    else:
                        matrix[row_idx, col_idx] = cell
            
            fig, ax = plt.subplots(figsize=(size/100, size/100))
            
            # 创建热力图
            colors = ['#e2e8f0', '#818cf8', '#6366f1', '#4f46e5']
            cmap = plt.matplotlib.colors.LinearSegmentedColormap.from_list('custom', colors)
            
            im = ax.imshow(matrix, cmap=cmap, aspect='equal', vmin=0, vmax=100)
            
            # 添加数值标签
            for i in range(8):
                for j in range(8):
                    value = matrix[i, j]
                    text_color = 'white' if value > 50 else '#64748b'
                    ax.text(j, i, f'{value:.0f}',
                           ha='center', va='center', color=text_color, fontsize=8)
            
            # 隐藏坐标轴
            ax.set_xticks([])
            ax.set_yticks([])
            ax.spines['top'].set_visible(False)
            ax.spines['right'].set_visible(False)
            ax.spines['bottom'].set_visible(False)
            ax.spines['left'].set_visible(False)
            
            plt.tight_layout()
            
            buffer = io.BytesIO()
            plt.savefig(buffer, format='png', dpi=100, bbox_inches='tight',
                       facecolor='white', edgecolor='none')
            buffer.seek(0)
            image_base64 = base64.b64encode(buffer.read()).decode()
            plt.close()
            
            return image_base64
        except Exception as e:
            logger.error(f"热力图生成失败: {e}")
            return ""
    
    @classmethod
    async def generate_enhanced_pdf_report(
        cls,
        report_data: Dict[str, Any],
        output_path: Optional[str] = None
    ) -> bytes:
        """
        生成增强版 PDF 报告（含可视化图表）
        
        Args:
            report_data: 报告数据（包含五维评分、可视化数据等）
            output_path: 输出路径（可选）
            
        Returns:
            PDF 文件字节内容
        """
        # 注册字体
        has_chinese_font = cls._register_fonts()
        table_font = cls.FONT_NAME if has_chinese_font else 'Helvetica'
        
        # 创建 PDF 缓冲区
        buffer = io.BytesIO()
        
        # 创建 PDF 文档
        doc = SimpleDocTemplate(
            buffer,
            pagesize=A4,
            rightMargin=2*cm,
            leftMargin=2*cm,
            topMargin=2*cm,
            bottomMargin=2*cm
        )
        
        # 样式定义
        styles = getSampleStyleSheet()
        
        # 自定义样式
        title_style = ParagraphStyle(
            'CustomTitle',
            parent=styles['Heading1'],
            fontSize=24,
            textColor=HexColor('#1e293b'),
            spaceAfter=30,
            alignment=1  # 居中
        )
        
        heading2_style = ParagraphStyle(
            'CustomHeading2',
            parent=styles['Heading2'],
            fontSize=16,
            textColor=HexColor('#334155'),
            spaceAfter=12,
            spaceBefore=20
        )
        
        heading3_style = ParagraphStyle(
            'CustomHeading3',
            parent=styles['Heading3'],
            fontSize=13,
            textColor=HexColor('#475569'),
            spaceAfter=8,
            spaceBefore=12
        )
        
        normal_style = ParagraphStyle(
            'CustomNormal',
            parent=styles['Normal'],
            fontSize=10,
            textColor=HexColor('#64748b'),
            leading=16
        )
        
        if has_chinese_font:
            for style in [title_style, heading2_style, heading3_style, normal_style]:
                style.fontName = cls.FONT_NAME
        
        # 构建文档内容
        story = []
        section_num = 0  # 动态章节编号
        section_labels = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
        
        def next_section(title: str):
            nonlocal section_num
            label = section_labels[section_num] if section_num < len(section_labels) else str(section_num + 1)
            section_num += 1
            return f"{label}、{title}"
        
        # === 封面 ===
        five_dim = report_data.get('detection_summary', {}).get('five_dim_score', {})
        total_score = five_dim.get('total_score', 0) if five_dim else 0
        level = five_dim.get('confidence_level', '未评级') if five_dim else '未评级'
        
        level_colors = {
            'A级': '#10b981',
            'B级': '#3b82f6',
            'C级': '#f59e0b',
            'D级': '#ef4444',
        }
        level_color = level_colors.get(level[:2] if level else '', '#64748b')
        
        story.append(Paragraph("数字版权鉴定意见书", title_style))
        story.append(Spacer(1, 10))
        
        # 副标题：报告元信息
        meta = report_data.get('report_meta', {})
        sub_title_style = ParagraphStyle(
            'SubTitle', parent=normal_style, fontSize=9,
            textColor=HexColor('#94a3b8'), alignment=1, leading=14
        )
        if has_chinese_font:
            sub_title_style.fontName = cls.FONT_NAME
        story.append(Paragraph(
            f"报告ID: {meta.get('report_id', 'N/A')[:16]} &nbsp;&nbsp;|&nbsp;&nbsp; "
            f"生成时间: {meta.get('generated_at', datetime.now().isoformat())[:19]} &nbsp;&nbsp;|&nbsp;&nbsp; "
            f"系统版本: {meta.get('system_version', 'AIGC-Guard')}",
            sub_title_style
        ))
        story.append(Spacer(1, 15))
        
        # 评分卡片
        score_data = [
            ['综合评分', '证据等级', '用户套餐'],
            [
                f'{total_score:.1f}分',
                level,
                meta.get('user_plan', 'free').upper()
            ]
        ]
        score_table = Table(score_data, colWidths=[5.5*cm, 5.5*cm, 5.5*cm])
        score_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), HexColor('#f1f5f9')),
            ('TEXTCOLOR', (0, 0), (-1, 0), HexColor('#64748b')),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, -1), table_font),
            ('FONTSIZE', (0, 0), (-1, 0), 10),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 10),
            ('BACKGROUND', (0, 1), (-1, 1), HexColor('#f8fafc')),
            ('TEXTCOLOR', (0, 1), (0, 1), HexColor('#6366f1')),
            ('TEXTCOLOR', (1, 1), (1, 1), HexColor(level_color)),
            ('TEXTCOLOR', (2, 1), (2, 1), HexColor('#475569')),
            ('FONTSIZE', (0, 1), (-1, 1), 14),
            ('TOPPADDING', (0, 1), (-1, 1), 12),
            ('BOTTOMPADDING', (0, 1), (-1, 1), 12),
            ('GRID', (0, 0), (-1, -1), 1, HexColor('#e2e8f0')),
        ]))
        story.append(score_table)
        story.append(Spacer(1, 12))
        
        # 检测结果摘要描述
        summary = report_data.get('detection_summary', {})
        result_label = '发现数字水印' if summary.get('detection_result') == 'WATERMARK_FOUND' else '未发现数字水印'
        _conf_val = summary.get('overall_confidence', 0)
        try:
            _conf_val = float(_conf_val) if _conf_val else 0
        except (ValueError, TypeError):
            _conf_val = 0
        abstract_text = (
            f"本次检测针对文件『{summary.get('target_file', 'N/A')}』进行数字指纹提取与比对分析，"
            f"检测结果为{result_label}，风险等级{summary.get('risk_level', 'N/A')}，"
            f"综合置信度{_conf_val:.1f}%。"
        )
        if summary.get('legal_description'):
            abstract_text += f" {summary.get('legal_description')[:60]}"
        abstract_style = ParagraphStyle(
            'Abstract', parent=normal_style, fontSize=9,
            textColor=HexColor('#475569'), leading=15,
            borderWidth=1, borderColor=HexColor('#e2e8f0'),
            borderPadding=10, backColor=HexColor('#f8fafc'),
        )
        if has_chinese_font:
            abstract_style.fontName = cls.FONT_NAME
        story.append(Paragraph(abstract_text, abstract_style))
        story.append(Spacer(1, 25))
        
        # === 检测摘要 ===
        story.append(Paragraph(next_section('检测摘要'), heading2_style))
        summary = report_data.get('detection_summary', {})
        
        # 用表格展示摘要，更整洁
        result_label = '✅ 发现数字水印' if summary.get('detection_result') == 'WATERMARK_FOUND' else '❌ 未发现数字水印'
        confidence_level_str = summary.get('confidence_level', '')
        legal_desc_str = summary.get('legal_description', '')
        
        # 安全获取置信度值
        overall_conf = summary.get('overall_confidence', 0)
        try:
            overall_conf = float(overall_conf) if overall_conf else 0
        except (ValueError, TypeError):
            overall_conf = 0
        
        risk_level_str = summary.get('risk_level', 'N/A')
        risk_desc_str = summary.get('risk_description', '')
        risk_display = f"{risk_level_str}（{risk_desc_str}）" if risk_desc_str else risk_level_str
        
        summary_rows = [
            ['检测目标', summary.get('target_file', 'N/A')],
            ['检测结果', result_label],
            ['风险等级', risk_display],
            ['综合置信度', f"{overall_conf:.1f}%"],
        ]
        if confidence_level_str:
            summary_rows.append(['证据等级', confidence_level_str])
        if legal_desc_str:
            summary_rows.append(['法律表述', legal_desc_str[:60]])
        
        summary_table = Table(summary_rows, colWidths=[4*cm, 13*cm])
        summary_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (0, -1), HexColor('#f8fafc')),
            ('TEXTCOLOR', (0, 0), (0, -1), HexColor('#64748b')),
            ('TEXTCOLOR', (1, 0), (1, -1), HexColor('#1e293b')),
            ('ALIGN', (0, 0), (0, -1), 'RIGHT'),
            ('ALIGN', (1, 0), (1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, -1), table_font),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('LEFTPADDING', (0, 0), (-1, -1), 10),
            ('RIGHTPADDING', (0, 0), (-1, -1), 10),
            ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#e2e8f0')),
        ]))
        story.append(summary_table)
        story.append(Spacer(1, 20))
        
        # === 五维证据评分（含雷达图） ===
        if five_dim and five_dim.get('dimensions'):
            story.append(Paragraph(next_section('五维证据评分矩阵'), heading2_style))
            
            dims = five_dim.get('dimensions', {})
            radar_data = {
                '指纹置信': dims.get('fingerprint', {}).get('score', 0),
                '时间链': dims.get('temporal', {}).get('score', 0),
                '语义相似': dims.get('semantic', {}).get('score', 0),
                '鲁棒性': dims.get('robustness', {}).get('score', 0),
                '溯源完整': dims.get('provenance', {}).get('score', 0),
            }
            
            radar_base64 = cls.generate_radar_chart_base64(radar_data)
            if radar_base64:
                radar_img_data = base64.b64decode(radar_base64)
                radar_img = Image(io.BytesIO(radar_img_data), width=12*cm, height=12*cm)
                story.append(radar_img)
                story.append(Spacer(1, 10))
            
            # 维度详情表格
            dim_data = [['维度', '评分', '权重', '说明']]
            dim_names = {
                'fingerprint': '指纹置信度',
                'temporal': '时间链置信度',
                'semantic': '语义置信度',
                'robustness': '鲁棒性置信度',
                'provenance': '溯源置信度'
            }
            
            for key, name in dim_names.items():
                dim_info = dims.get(key, {})
                desc = dim_info.get('description', '')
                # 截断时确保不在中文字符中间断开
                desc_display = desc[:50] + ('...' if len(desc) > 50 else '')
                dim_data.append([
                    name,
                    f"{dim_info.get('score', 0):.1f}",
                    f"{int(dim_info.get('weight', 0) * 100)}%",
                    desc_display
                ])
            
            dim_table = Table(dim_data, colWidths=[3.5*cm, 2*cm, 2*cm, 9.5*cm], repeatRows=1)
            dim_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), HexColor('#6366f1')),
                ('TEXTCOLOR', (0, 0), (-1, 0), white),
                ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                ('ALIGN', (3, 1), (3, -1), 'LEFT'),
                ('FONTNAME', (0, 0), (-1, -1), table_font),
                ('FONTSIZE', (0, 0), (-1, -1), 9),
                ('BOTTOMPADDING', (0, 0), (-1, 0), 10),
                ('TOPPADDING', (0, 1), (-1, -1), 6),
                ('BOTTOMPADDING', (0, 1), (-1, -1), 6),
                ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#e2e8f0')),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [HexColor('#ffffff'), HexColor('#f8fafc')]),
            ]))
            story.append(dim_table)
            story.append(Spacer(1, 20))
        
        # === 指纹比特热力图（仅当存在时生成章节） ===
        viz = report_data.get('visualizations', {})
        bit_heatmap = viz.get('bit_heatmap')
        if bit_heatmap:
            story.append(Paragraph(next_section('指纹比特级匹配热力图'), heading2_style))
            story.append(Paragraph(
                "下图展示64位指纹的8×8网格匹配热力图，每个格子代表一个比特片段的匹配率。颜色越深表示匹配度越高。",
                normal_style
            ))
            story.append(Spacer(1, 10))
            
            heatmap_base64 = cls.generate_heatmap_base64(bit_heatmap)
            if heatmap_base64:
                heatmap_img_data = base64.b64decode(heatmap_base64)
                heatmap_img = Image(io.BytesIO(heatmap_img_data), width=10*cm, height=10*cm)
                story.append(heatmap_img)
            story.append(Spacer(1, 20))

        # === 证据链时间线（仅当存在时生成章节） ===
        timeline = viz.get('timeline') or viz.get('evidence_timeline') or viz.get('evidenceTimeline')
        if timeline:
            story.append(Paragraph(next_section('证据链时间线'), heading2_style))
            story.append(Paragraph(
                "下图展示本次检测相关的关键时间点（创作/嵌入指纹/区块链存证/检测等），用于辅助说明证据链的时间一致性与权属先后顺序。",
                normal_style
            ))
            story.append(Spacer(1, 10))

            timeline_base64 = cls.generate_timeline_chart_base64(timeline)
            if timeline_base64:
                timeline_img_data = base64.b64decode(timeline_base64)
                timeline_img = Image(io.BytesIO(timeline_img_data), width=16*cm, height=4*cm)
                story.append(timeline_img)
            
            # 时间线事件详情表格
            story.append(Spacer(1, 8))
            tl_data = [['事件', '时间', '证据类型', '说明', '间隔']]
            for ev in timeline:
                if not isinstance(ev, dict):
                    continue
                tl_data.append([
                    ev.get('event', ''),
                    ev.get('time_str', ''),
                    ev.get('evidence_type', ''),
                    (ev.get('description', '') or '')[:35],
                    ev.get('interval_from_prev', '--')
                ])
            if len(tl_data) > 1:
                tl_table = Table(tl_data, colWidths=[2.8*cm, 3.8*cm, 2.5*cm, 5.4*cm, 2.5*cm], repeatRows=1)
                tl_table.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, 0), HexColor('#f1f5f9')),
                    ('TEXTCOLOR', (0, 0), (-1, 0), HexColor('#64748b')),
                    ('FONTNAME', (0, 0), (-1, -1), table_font),
                    ('FONTSIZE', (0, 0), (-1, -1), 9),
                    ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                    ('ALIGN', (2, 1), (2, -1), 'LEFT'),
                    ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#e2e8f0')),
                    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [HexColor('#ffffff'), HexColor('#f8fafc')]),
                    ('TOPPADDING', (0, 0), (-1, -1), 5),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
                ]))
                story.append(tl_table)
            story.append(Spacer(1, 20))
        
        # === 匹配结果分析 ===
        story.append(Paragraph(next_section('匹配结果分析'), heading2_style))
        match_analysis = report_data.get('matching_analysis', {})
        best_match = match_analysis.get('best_match')
        
        if best_match:
            match_rows = [
                ['最佳匹配作者', best_match.get('author_name', '未知')],
                ['相似度', f"{best_match.get('similarity', 0)}%"],
                ['确权时间', best_match.get('creation_time', '未知')],
            ]
            if best_match.get('match_method'):
                match_rows.append(['匹配方法', best_match.get('match_method')])
            if best_match.get('fingerprint_fragment_match'):
                match_rows.append(['片段匹配率', f"{best_match.get('fingerprint_fragment_match', 0):.1f}%"])
            
            match_table = Table(match_rows, colWidths=[4*cm, 13*cm])
            match_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (0, -1), HexColor('#f8fafc')),
                ('TEXTCOLOR', (0, 0), (0, -1), HexColor('#64748b')),
                ('FONTNAME', (0, 0), (-1, -1), table_font),
                ('FONTSIZE', (0, 0), (-1, -1), 10),
                ('ALIGN', (0, 0), (0, -1), 'RIGHT'),
                ('TOPPADDING', (0, 0), (-1, -1), 5),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
                ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#e2e8f0')),
            ]))
            story.append(match_table)
            story.append(Spacer(1, 10))
        else:
            story.append(Paragraph("未匹配到原始资产记录。", normal_style))
            story.append(Spacer(1, 10))
        
        # 候选列表
        top_candidates = match_analysis.get('top_candidates', [])
        if top_candidates:
            story.append(Paragraph("候选匹配列表（Top 5）：", heading3_style))
            cand_data = [['排名', '作者', '相似度', '匹配方法', '置信度']]
            for i, cand in enumerate(top_candidates[:5], 1):
                cand_data.append([
                    str(i),
                    cand.get('author', cand.get('author_name', '未知'))[:16],
                    f"{cand.get('similarity', 0):.1f}%",
                    cand.get('match_method', '指纹')[:8],
                    cand.get('confidence_level', '未知')
                ])
            
            cand_table = Table(cand_data, colWidths=[1.5*cm, 4.5*cm, 2.5*cm, 4*cm, 4.5*cm])
            cand_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), HexColor('#f1f5f9')),
                ('TEXTCOLOR', (0, 0), (-1, 0), HexColor('#64748b')),
                ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                ('ALIGN', (1, 1), (1, -1), 'LEFT'),
                ('FONTNAME', (0, 0), (-1, -1), table_font),
                ('FONTSIZE', (0, 0), (-1, -1), 9),
                ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#e2e8f0')),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [HexColor('#ffffff'), HexColor('#f8fafc')]),
            ]))
            story.append(cand_table)
        story.append(Spacer(1, 20))
        
        # === 法律评估 ===
        legal = report_data.get('legal_assessment', {})
        if legal:
            story.append(Paragraph(next_section('法律评估'), heading2_style))
            
            legal_rows = [
                ['鉴定结论', legal.get('verdict', 'N/A')[:50]],
                ['证据强度', f"{legal.get('evidence_strength', 0)}/100"],
                ['证据可采性', '可作为有效证据' if legal.get('is_admissible') else '证据不足，建议补充'],
                ['适用法律', ', '.join(legal.get('applicable_laws', []))],
            ]
            legal_table = Table(legal_rows, colWidths=[4*cm, 13*cm])
            legal_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (0, -1), HexColor('#f8fafc')),
                ('TEXTCOLOR', (0, 0), (0, -1), HexColor('#64748b')),
                ('FONTNAME', (0, 0), (-1, -1), table_font),
                ('FONTSIZE', (0, 0), (-1, -1), 10),
                ('ALIGN', (0, 0), (0, -1), 'RIGHT'),
                ('TOPPADDING', (0, 0), (-1, -1), 5),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
                ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#e2e8f0')),
            ]))
            story.append(legal_table)
            
            # 证据链明细
            evidence_chain = legal.get('evidence_chain', [])
            if evidence_chain:
                story.append(Spacer(1, 8))
                story.append(Paragraph("证据链明细：", heading3_style))
                ev_data = [['证据类型', '强度', '说明']]
                for ev in evidence_chain:
                    ev_data.append([
                        ev.get('type', '未知'),
                        f"{ev.get('strength', 0) * 100:.0f}%",
                        ev.get('description', '')[:40]
                    ])
                ev_table = Table(ev_data, colWidths=[4*cm, 2.5*cm, 10.5*cm])
                ev_table.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, 0), HexColor('#f1f5f9')),
                    ('TEXTCOLOR', (0, 0), (-1, 0), HexColor('#64748b')),
                    ('FONTNAME', (0, 0), (-1, -1), table_font),
                    ('FONTSIZE', (0, 0), (-1, -1), 9),
                    ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                    ('ALIGN', (2, 1), (2, -1), 'LEFT'),
                    ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#e2e8f0')),
                    ('ROWBACKGROUNDS', (0, 1), (-1, -1), [HexColor('#ffffff'), HexColor('#f8fafc')]),
                ]))
                story.append(ev_table)
            story.append(Spacer(1, 20))
        
        # === 维权建议 ===
        rec = report_data.get('recommendations', {})
        if rec and rec.get('actions'):
            story.append(Paragraph(next_section('维权建议'), heading2_style))
            priority_map = {'HIGH': '🔴 高优先级', 'MEDIUM': '🟡 中优先级', 'LOW': '🟢 低优先级'}
            story.append(Paragraph(
                f"<b>优先级：</b>{priority_map.get(rec.get('priority', ''), rec.get('priority', 'N/A'))}",
                normal_style
            ))
            story.append(Spacer(1, 6))
            for i, action in enumerate(rec['actions'], 1):
                story.append(Paragraph(f"{i}. {action}", normal_style))
            story.append(Spacer(1, 20))
        
        # === 技术局限性声明 ===
        story.append(Paragraph(next_section('技术局限性声明'), heading2_style))
        disclaimer = """
        本报告为技术检测结果，基于DCT频域数字指纹提取、汉明距离相似度比对、
        感知哈希(pHash)以及FAISS深度向量检索等算法生成。
        检测结果受原始图像质量、压缩程度、编辑处理等因素影响。
        最终法律认定请以司法机构裁定为准。报告结论不构成法律意见。
        """
        story.append(Paragraph(disclaimer, normal_style))
        story.append(Spacer(1, 30))
        
        # 签章区
        story.append(HRFlowable(width="100%", thickness=1, color=HexColor('#e2e8f0')))
        story.append(Spacer(1, 10))
        sign_style = ParagraphStyle(
            'SignOff', parent=normal_style, fontSize=9,
            textColor=HexColor('#94a3b8'), alignment=2, leading=14  # 右对齐
        )
        if has_chinese_font:
            sign_style.fontName = cls.FONT_NAME
        gen_time = report_data.get('report_meta', {}).get('generated_at', datetime.now().isoformat())[:19]
        story.append(Paragraph(
            f"本报告由 智御·AIGC数字版权卫士 系统自动生成<br/>"
            f"生成时间：{gen_time}<br/>"
            f"技术检测结果仅供参考，最终法律认定请以司法机构裁定为准",
            sign_style
        ))
        
        # 添加页脚（每页显示）
        def add_page_footer(canvas, doc):
            canvas.saveState()
            canvas.setFont('Helvetica', 8)
            canvas.setFillColor(HexColor('#94a3b8'))
            
            # 页脚文字
            footer_text = f"智御·AIGC数字版权卫士 | 报告ID: {report_data.get('report_meta', {}).get('report_id', 'N/A')[:12]}"
            canvas.drawString(2*cm, 1*cm, footer_text)
            
            # 页码
            page_num = canvas.getPageNumber()
            canvas.drawRightString(A4[0] - 2*cm, 1*cm, f"第 {page_num} 页")
            
            canvas.restoreState()
        
        # 生成 PDF
        doc.build(story, onFirstPage=add_page_footer, onLaterPages=add_page_footer)
        
        # 获取 PDF 内容
        pdf_content = buffer.getvalue()
        buffer.close()
        
        # 如果指定了输出路径，保存到文件
        if output_path:
            with open(output_path, 'wb') as f:
                f.write(pdf_content)
        
        return pdf_content


# 导出函数
async def generate_pdf_report_with_visualizations(report_data: Dict) -> bytes:
    """
    快捷函数：生成带可视化的 PDF 报告
    """
    return await PDFReportService.generate_enhanced_pdf_report(report_data)
