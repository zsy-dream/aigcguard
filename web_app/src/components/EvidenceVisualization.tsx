import React, { useEffect, useRef, useState } from 'react';

interface FiveDimScore {
  total_score: number;
  confidence_level: string;
  legal_description: string;
  dimensions: {
    fingerprint: { score: number; weight: number; description: string };
    temporal: { score: number; weight: number; description: string };
    semantic: { score: number; weight: number; description: string };
    robustness: { score: number; weight: number; description: string };
    provenance: { score: number; weight: number; description: string };
  };
}

interface EvidenceVisualizationProps {
  fiveDimScore: FiveDimScore;
  bitHeatmap?: any[][];
  timeline?: any[];
}

/**
 * 五维证据评分可视化组件
 * 包含：雷达图、比特热力图、时间线
 */
export const EvidenceVisualization: React.FC<EvidenceVisualizationProps> = ({
  fiveDimScore,
  bitHeatmap,
  timeline
}) => {
  const radarCanvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredDim, setHoveredDim] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string; value: number } | null>(null);

  const labels = ['指纹置信', '时间链', '语义相似', '鲁棒性', '溯源完整'];
  const dimKeys: (keyof FiveDimScore['dimensions'])[] = ['fingerprint', 'temporal', 'semantic', 'robustness', 'provenance'];

  // 绘制雷达图（支持高亮）
  useEffect(() => {
    if (!radarCanvasRef.current || !fiveDimScore) return;
    
    const canvas = radarCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const size = 280;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);

    const centerX = size / 2;
    const centerY = size / 2;
    const radius = 100;

    const dims = dimKeys.map(k => fiveDimScore.dimensions[k].score);

    // 清空画布
    ctx.clearRect(0, 0, size, size);

    // 绘制背景网格（5个等级）
    for (let i = 1; i <= 5; i++) {
      ctx.beginPath();
      ctx.strokeStyle = i === 5 ? 'rgba(99, 102, 241, 0.3)' : 'rgba(148, 163, 184, 0.15)';
      ctx.lineWidth = i === 5 ? 2 : 1;
      
      for (let j = 0; j < 5; j++) {
        const angle = (Math.PI * 2 / 5) * j - Math.PI / 2;
        const r = (radius / 5) * i;
        const x = centerX + Math.cos(angle) * r;
        const y = centerY + Math.sin(angle) * r;
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }

    // 绘制轴线（高亮当前hover维度）
    for (let i = 0; i < 5; i++) {
      const angle = (Math.PI * 2 / 5) * i - Math.PI / 2;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      
      ctx.beginPath();
      const isHovered = hoveredDim === i;
      ctx.strokeStyle = isHovered ? 'rgba(99, 102, 241, 0.9)' : 'rgba(148, 163, 184, 0.3)';
      ctx.lineWidth = isHovered ? 2.5 : 1;
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(x, y);
      ctx.stroke();

      // 标签（高亮颜色）
      const labelX = centerX + Math.cos(angle) * (radius + 25);
      const labelY = centerY + Math.sin(angle) * (radius + 25);
      ctx.font = isHovered ? 'bold 13px -apple-system, BlinkMacSystemFont, sans-serif' : '12px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillStyle = isHovered ? '#6366f1' : '#94a3b8';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labels[i], labelX, labelY);
    }

    // 绘制数据区域
    ctx.beginPath();
    ctx.fillStyle = 'rgba(99, 102, 241, 0.25)';
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.9)';
    ctx.lineWidth = 2;
    
    for (let i = 0; i < 5; i++) {
      const angle = (Math.PI * 2 / 5) * i - Math.PI / 2;
      const value = Math.min(100, Math.max(0, dims[i]));
      const r = (value / 100) * radius;
      const x = centerX + Math.cos(angle) * r;
      const y = centerY + Math.sin(angle) * r;
      
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 绘制数据点（hover时放大）
    for (let i = 0; i < 5; i++) {
      const angle = (Math.PI * 2 / 5) * i - Math.PI / 2;
      const value = Math.min(100, Math.max(0, dims[i]));
      const r = (value / 100) * radius;
      const x = centerX + Math.cos(angle) * r;
      const y = centerY + Math.sin(angle) * r;
      
      const isHovered = hoveredDim === i;
      
      ctx.beginPath();
      ctx.fillStyle = isHovered ? '#818cf8' : '#6366f1';
      ctx.arc(x, y, isHovered ? 7 : 4, 0, Math.PI * 2);
      ctx.fill();
      
      // 数值标签（hover时显示更大更亮）
      ctx.font = isHovered ? 'bold 13px sans-serif' : 'bold 11px sans-serif';
      ctx.fillStyle = isHovered ? '#c7d2fe' : '#e2e8f0';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const labelOffset = isHovered ? 18 : 15;
      const labelX = x + Math.cos(angle) * labelOffset;
      const labelY = y + Math.sin(angle) * labelOffset;
      ctx.fillText(`${Math.round(value)}`, labelX, labelY);
    }
  }, [fiveDimScore, hoveredDim]);

  // 等级颜色映射
  const getLevelColor = (level: string) => {
    if (level.includes('A')) return 'from-emerald-500 to-teal-500';
    if (level.includes('B')) return 'from-blue-500 to-indigo-500';
    if (level.includes('C')) return 'from-amber-500 to-orange-500';
    if (level.includes('D')) return 'from-orange-500 to-red-500';
    return 'from-slate-500 to-gray-500';
  };

  return (
    <div className="space-y-6">
      {/* 总分和等级 */}
      <div className="flex items-center gap-6 p-4 bg-slate-800/50 rounded-xl border border-slate-700">
        <div className={`w-20 h-20 rounded-full bg-gradient-to-br ${getLevelColor(fiveDimScore.confidence_level)} flex items-center justify-center`}>
          <div className="text-center">
            <div className="text-2xl font-bold text-white">{fiveDimScore.total_score.toFixed(0)}</div>
            <div className="text-xs text-white/80">分</div>
          </div>
        </div>
        <div className="flex-1">
          <div className="text-lg font-bold text-white mb-1">{fiveDimScore.confidence_level}</div>
          <div className="text-sm text-slate-400">{fiveDimScore.legal_description}</div>
        </div>
      </div>

      {/* 雷达图 */}
      <div className="p-4 bg-slate-800/30 rounded-xl border border-slate-700 relative">
        <h4 className="text-sm font-semibold text-slate-300 mb-4">五维证据评分雷达图</h4>
        <div className="flex justify-center relative">
          <canvas 
            ref={radarCanvasRef}
            onMouseMove={(e) => {
              const rect = radarCanvasRef.current?.getBoundingClientRect();
              if (!rect) return;
              const x = e.clientX - rect.left - 140; // 140 = size/2
              const y = e.clientY - rect.top - 140;
              
              // 计算角度（-PI/2 起始，顺时针）
              let angle = Math.atan2(y, x);
              // 转换为与轴线对齐的索引（-PI/2 为 0号轴）
              // 轴线角度: i * 72deg - 90deg
              // 映射到 0-4 的维度索引
              let normalizedAngle = angle + Math.PI / 2;
              if (normalizedAngle < 0) normalizedAngle += Math.PI * 2;
              
              // 每个维度占 72度，中心对齐
              const dimIndex = Math.round(normalizedAngle / (Math.PI * 2 / 5)) % 5;
              
              setHoveredDim(dimIndex);
              
              const dims = dimKeys.map(k => fiveDimScore.dimensions[k].score);
              setTooltip({
                x: e.clientX - rect.left + 10,
                y: e.clientY - rect.top - 30,
                label: labels[dimIndex],
                value: dims[dimIndex]
              });
            }}
            onMouseLeave={() => {
              setHoveredDim(null);
              setTooltip(null);
            }}
          />
          
          {/* 悬浮提示框 */}
          {tooltip && (
            <div 
              className="absolute px-2 py-1 bg-slate-900/90 border border-indigo-500/50 rounded-lg text-xs pointer-events-none z-10 shadow-lg"
              style={{ left: tooltip.x, top: tooltip.y }}
            >
              <div className="text-indigo-300 font-semibold">{tooltip.label}</div>
              <div className="text-slate-200">{tooltip.value.toFixed(1)}分</div>
            </div>
          )}
        </div>
        
        {/* 维度详情 */}
        <div className="grid grid-cols-2 gap-3 mt-4">
          {Object.entries(fiveDimScore.dimensions).map(([key, dim]) => {
            const labelMap: Record<string, string> = {
              fingerprint: '指纹置信度',
              temporal: '时间链置信度',
              semantic: '语义置信度',
              robustness: '鲁棒性置信度',
              provenance: '溯源置信度'
            };
            return (
              <div key={key} className="p-3 bg-slate-700/50 rounded-lg">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs text-slate-400">{labelMap[key]}</span>
                  <span className="text-xs font-semibold text-indigo-400">{dim.score.toFixed(1)}分</span>
                </div>
                <div className="h-1.5 bg-slate-600 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all"
                    style={{ width: `${dim.score}%` }}
                  />
                </div>
                <div className="text-xs text-slate-500 mt-1">权重 {Math.round(dim.weight * 100)}%</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 比特热力图 */}
      {bitHeatmap && bitHeatmap.length > 0 && (
        <div className="p-4 bg-slate-800/30 rounded-xl border border-slate-700">
          <h4 className="text-sm font-semibold text-slate-300 mb-4">指纹比特级匹配热力图</h4>
          <div className="grid grid-cols-8 gap-1">
            {bitHeatmap.flat().map((cell, idx) => (
              <div
                key={idx}
                className="aspect-square rounded flex items-center justify-center text-xs font-mono cursor-help transition-all hover:scale-110"
                style={{
                  backgroundColor: cell.match_rate > 80 
                    ? `rgba(99, 102, 241, ${0.2 + cell.color_intensity * 0.8})`
                    : cell.match_rate > 50
                    ? `rgba(251, 191, 36, ${0.2 + cell.color_intensity * 0.8})`
                    : `rgba(148, 163, 184, ${0.1 + cell.color_intensity * 0.3})`,
                  color: cell.match_rate > 50 ? '#e2e8f0' : '#64748b'
                }}
                title={`位置 ${cell.cell_index}: 匹配率 ${cell.match_rate.toFixed(1)}%\n比特片段: ${cell.bits}`}
              >
                {cell.match_rate > 50 ? (cell.match_rate / 10).toFixed(0) : '·'}
              </div>
            ))}
          </div>
          <div className="flex justify-center gap-4 mt-3 text-xs text-slate-500">
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-indigo-500/60 rounded"></span> 高匹配 (80-100%)</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-amber-500/60 rounded"></span> 中匹配 (50-80%)</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-slate-500/30 rounded"></span> 低匹配 (&lt;50%)</span>
          </div>
        </div>
      )}

      {/* 证据链时间线 */}
      {timeline && timeline.length > 0 && (
        <div className="p-4 bg-slate-800/30 rounded-xl border border-slate-700">
          <h4 className="text-sm font-semibold text-slate-300 mb-4">证据链时间线</h4>
          <div className="relative">
            {/* 时间线轴线 */}
            <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gradient-to-b from-indigo-500 via-purple-500 to-slate-600" />
            
            <div className="space-y-4">
              {timeline.map((event, idx) => (
                <div key={idx} className="relative flex items-start gap-4 pl-10">
                  {/* 节点 */}
                  <div className="absolute left-2 w-4 h-4 rounded-full bg-slate-800 border-2 border-indigo-500 flex items-center justify-center">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                  </div>
                  
                  <div className="flex-1 p-3 bg-slate-700/30 rounded-lg">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-slate-200">{event.event}</span>
                      <span className="text-xs text-slate-500">{event.time_str}</span>
                    </div>
                    <div className="text-xs text-slate-400">{event.description}</div>
                    {event.interval_from_prev && (
                      <div className="text-xs text-slate-500 mt-1">
                        ↓ 间隔: {event.interval_from_prev}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EvidenceVisualization;
