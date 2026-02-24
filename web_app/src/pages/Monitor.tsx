import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Upload, Scan, Search, BadgeCheck, XCircle, FileImage, Layers, Trash2, Loader2, FileText, Check, Film, Zap, History, ChevronRight, Activity, Fingerprint, Download, Eye } from 'lucide-react';
import { watermark, auth } from '../services/api';
import { getValidToken } from '../lib/supabase';
import { PLAN_CONFIG, getPlanKey } from '../lib/planConfig';
import AssetThumbnail from '../components/AssetThumbnail';
import EvidenceVisualization from '../components/EvidenceVisualization';
import { useApp } from '../contexts/AppContext';

interface BatchFile {
    id: string;
    file: File;
    status: 'pending' | 'processing' | 'done' | 'error';
    result?: any;
    error?: string;
}

const getConfidenceBadgeClass = (level: string) => {
    if (!level) return 'bg-slate-500/10 border-slate-500/20 text-slate-300';
    if (level.includes('A')) return 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400';
    if (level.includes('B')) return 'bg-blue-500/10 border-blue-500/20 text-blue-400';
    if (level.includes('C')) return 'bg-amber-500/10 border-amber-500/20 text-amber-400';
    if (level.includes('D')) return 'bg-orange-500/10 border-orange-500/20 text-orange-400';
    return 'bg-slate-500/10 border-slate-500/20 text-slate-300';
};

const buildFiveDimScoreForDisplay = (dims: Record<string, number>) => {
    return {
        total_score: (dims.fingerprint + dims.temporal + dims.semantic + dims.robustness + dims.provenance) / 5,
        confidence_level: '均值',
        legal_description: '批量结果五维均值画像（用于趋势对比，不代表单条案件的法律结论）',
        dimensions: {
            fingerprint: { score: dims.fingerprint, weight: 0.4, description: '' },
            temporal: { score: dims.temporal, weight: 0.2, description: '' },
            semantic: { score: dims.semantic, weight: 0.15, description: '' },
            robustness: { score: dims.robustness, weight: 0.15, description: '' },
            provenance: { score: dims.provenance, weight: 0.1, description: '' },
        },
    };
};

const Monitor: React.FC = () => {
    const [mode, setMode] = useState<'single' | 'batch' | 'text' | 'video'>('single');
    const [user, setUser] = useState<any>(null);

    const portalTarget = typeof document !== 'undefined' ? document.body : null;

    useEffect(() => {
        document.title = "全网侵权监测 - AIGCGuard 溯源引擎";
        
        // 获取用户额度信息
        const fetchUser = async () => {
            try {
                const userData = await auth.me();
                setUser(userData);
            } catch (e) {
                // ignore
            }
        };
        fetchUser();
        
        // 监听额度更新事件
        const handleQuotaUpdate = () => fetchUser();
        window.addEventListener('quota-updated', handleQuotaUpdate);
        return () => window.removeEventListener('quota-updated', handleQuotaUpdate);
    }, []);

    const { state, setMonitorResult: setResult, setMonitorBatchFiles, setMonitorTextResult: setTextResult, setMonitorVideoResult: setVideoResult, pushToast } = useApp();

    const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
    const [upgradeFeatureName, setUpgradeFeatureName] = useState('');

    // Single Mode
    const [file, setFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const result = state.monitorResult;
    const [loading, setLoading] = useState(false);
    const singleInputRef = useRef<HTMLInputElement>(null);

    const [detectModalOpen, setDetectModalOpen] = useState(false);
    const [detectStatusText, setDetectStatusText] = useState('正在上传图片...');

    // Async Task Progress (异步任务进度条)
    const [asyncTaskId, setAsyncTaskId] = useState<string | null>(null);
    const [asyncProgress, setAsyncProgress] = useState<number>(0);
    const [asyncStage, setAsyncStage] = useState<string>('准备中...');
    const [asyncDetail, setAsyncDetail] = useState<string>('');
    const [isAsyncMode, setIsAsyncMode] = useState<boolean>(false);
    const progressTimerRef = useRef<number | null>(null);

    // 【检测状态持久化】页面切换后恢复检测状态
    const DETECT_SESSION_KEY = 'monitor_detection_session';
    
    // 保存检测会话状态到 sessionStorage
    const saveDetectionSession = useCallback(() => {
        if (!loading && !detectModalOpen) {
            sessionStorage.removeItem(DETECT_SESSION_KEY);
            return;
        }
        const session = {
            detectModalOpen,
            loading,
            detectStatusText,
            asyncTaskId,
            asyncProgress,
            asyncStage,
            asyncDetail,
            isAsyncMode,
            previewUrl,
            result,
            fileName: file?.name || null,
            fileSize: file?.size || null,
            fileType: file?.type || null,
            timestamp: Date.now()
        };
        sessionStorage.setItem(DETECT_SESSION_KEY, JSON.stringify(session));
    }, [detectModalOpen, loading, detectStatusText, asyncTaskId, asyncProgress, asyncStage, asyncDetail, isAsyncMode, previewUrl, result, file]);
    
    // 恢复检测会话状态
    const restoreDetectionSession = useCallback(() => {
        const stored = sessionStorage.getItem(DETECT_SESSION_KEY);
        if (!stored) return false;
        
        try {
            const session = JSON.parse(stored);
            // 检查状态是否过期（30分钟）
            if (Date.now() - session.timestamp > 30 * 60 * 1000) {
                sessionStorage.removeItem(DETECT_SESSION_KEY);
                return false;
            }
            
            // 【关键修复】如果检测已完成（有结果且不在 loading 状态），不恢复弹窗
            if (session.result && !session.loading) {
                console.log('[DetectionSession] 检测已完成，跳过恢复弹窗');
                sessionStorage.removeItem(DETECT_SESSION_KEY);
                return false;
            }
            
            console.log('[DetectionSession] 恢复检测状态:', session);
            
            // 恢复状态
            if (session.detectModalOpen) setDetectModalOpen(true);
            if (session.loading) setLoading(true);
            if (session.detectStatusText) setDetectStatusText(session.detectStatusText);
            if (session.asyncTaskId) {
                setAsyncTaskId(session.asyncTaskId);
                // 恢复异步任务轮询
                setTimeout(() => startPollingProgress(session.asyncTaskId), 100);
            }
            if (session.asyncProgress !== undefined) setAsyncProgress(session.asyncProgress);
            if (session.asyncStage) setAsyncStage(session.asyncStage);
            if (session.asyncDetail) setAsyncDetail(session.asyncDetail);
            if (session.isAsyncMode) setIsAsyncMode(true);
            if (session.previewUrl) setPreviewUrl(session.previewUrl);
            if (session.result) setResult(session.result);
            
            // 恢复文件信息（创建虚拟File对象用于显示，实际检测需要重新上传）
            if (session.fileName) {
                // 创建虚拟文件对象用于UI显示
                const dummyFile = new File([], session.fileName, { type: session.fileType || 'image/jpeg' });
                Object.defineProperty(dummyFile, 'size', { value: session.fileSize || 0 });
                setFile(dummyFile);
            }
            
            return true;
        } catch (e) {
            console.error('恢复检测会话失败:', e);
            sessionStorage.removeItem(DETECT_SESSION_KEY);
            return false;
        }
    }, []);
    
    // 清除检测会话状态
    const clearDetectionSession = useCallback(() => {
        sessionStorage.removeItem(DETECT_SESSION_KEY);
    }, []);

    // 组件挂载时恢复检测状态
    useEffect(() => {
        restoreDetectionSession();
    }, []);
    
    // 检测状态变化时保存到 sessionStorage
    useEffect(() => {
        saveDetectionSession();
    }, [saveDetectionSession]);

    // 清理轮询定时器
    const clearProgressTimer = () => {
        if (progressTimerRef.current) {
            window.clearInterval(progressTimerRef.current);
            progressTimerRef.current = null;
        }
    };

    // 轮询任务进度
    const startPollingProgress = (taskId: string) => {
        clearProgressTimer();
        
        const poll = async () => {
            try {
                const status = await watermark.getTaskStatus(taskId);
                
                if (status.progress) {
                    setAsyncProgress(status.progress.percentage || 0);
                    setAsyncStage(status.progress.stage || '处理中...');
                    setAsyncDetail(status.progress.detail || '');
                }
                
                // 任务完成
                if (status.status === 'completed' && status.result) {
                    clearProgressTimer();
                    setResult(status.result);
                    setAsyncProgress(100);
                    setAsyncStage('检测完成');
                    setAsyncDetail('分析完成');
                    setLoading(false);
                    setDetectModalOpen(false);
                    setIsAsyncMode(false);
                    
                    // 保存检测记录（兼容 matched_asset / best_match）
                    const matchedAssetAsync = status.result.matched_asset || (status.result.best_match ? {
                        id: status.result.best_match.author_id || status.result.best_match.id,
                        user_id: status.result.best_match.author_id,
                        author_name: status.result.best_match.author_name || '未知',
                        filename: status.result.best_match.filename || '',
                        timestamp: status.result.best_match.creation_time || '',
                        similarity: status.result.best_match.similarity || 0,
                    } : null);
                    const confidenceAsync = status.result.confidence || (status.result.best_match?.similarity ? status.result.best_match.similarity / 100 : 0);
                    saveDetectionRecord({
                        type: 'image',
                        filename: file?.name,
                        hasWatermark: status.result.has_watermark,
                        matchedAsset: matchedAssetAsync,
                        confidence: confidenceAsync,
                        message: status.result.message,
                        five_dim_score: status.result.five_dim_score,
                        confidence_level: status.result.confidence_level,
                        legal_description: status.result.legal_description,
                        legal_assessment: status.result.legal_assessment,
                        visualizations: status.result.visualizations,
                        analysis: status.result.analysis,
                        match_summary: status.result.match_summary,
                    });
                    syncCloudDetectionRecords({ silent: true });
                    
                    window.dispatchEvent(new Event('quota-updated'));
                    pushToast('异步检测完成', 'success');
                    clearDetectionSession(); // 清除检测会话状态
                }
                
                // 任务失败
                if (status.status === 'failed') {
                    clearProgressTimer();
                    setLoading(false);
                    setDetectModalOpen(false);
                    setIsAsyncMode(false);
                    pushToast(`检测失败: ${status.error_message || '未知错误'}`, 'error');
                    clearDetectionSession(); // 清除检测会话状态
                }
            } catch (e) {
                console.error('轮询进度失败:', e);
            }
        };
        
        // 立即执行一次，然后每 500ms 轮询
        poll();
        progressTimerRef.current = window.setInterval(poll, 500);
    };

    // 启动异步检测
    const startAsyncDetection = async () => {
        if (!file) return;
        
        setIsAsyncMode(true);
        setDetectModalOpen(true);
        setLoading(true);
        setAsyncProgress(0);
        setAsyncStage('提交任务...');
        setAsyncDetail('正在上传并创建检测任务');
        
        try {
            // 提交异步任务
            const response = await watermark.submitAsyncTask({
                task_type: 'image',
                file
            });
            
            if (response.task_id) {
                setAsyncTaskId(response.task_id);
                setAsyncStage('等待处理...');
                setAsyncDetail('任务已提交，正在排队');
                
                // 开始轮询进度
                startPollingProgress(response.task_id);
            } else {
                throw new Error('未获取到任务ID');
            }
        } catch (err: any) {
            console.error('提交异步任务失败:', err);
            setLoading(false);
            setDetectModalOpen(false);
            setIsAsyncMode(false);
            pushToast(`提交任务失败: ${err.message || '请重试'}`, 'error');
            clearDetectionSession(); // 清除检测会话状态
        }
    };

    // Batch Mode
    const batchFiles = state.monitorBatchFiles;
    const [batchProcessing, setBatchProcessing] = useState(false);
    const [batchProgress, setBatchProgress] = useState(0);
    const [currentBatchIndex, setCurrentBatchIndex] = useState(0);
    const [batchInlineNotice, setBatchInlineNotice] = useState<string | null>(null);
    const batchInputRef = useRef<HTMLInputElement>(null);

    // Text Mode
    const [textInput, setTextInput] = useState('');
    const textResult = state.monitorTextResult;

    // Video Mode
    const [videoFile, setVideoFile] = useState<File | null>(null);
    const videoResult = state.monitorVideoResult;
    const videoInputRef = useRef<HTMLInputElement>(null);

    const [batchDetailOpen, setBatchDetailOpen] = useState(false);
    const [batchAnalysisOpen, setBatchAnalysisOpen] = useState(false);

    // Text & Video detail modal
    const [textDetailModalOpen, setTextDetailModalOpen] = useState(false);
    const [videoDetailModalOpen, setVideoDetailModalOpen] = useState(false);

    // Detection History - 按用户ID隔离存储，避免换账号串号
    const [detectionHistory, setDetectionHistory] = useState<any[]>([]);
    const [cloudSyncing, setCloudSyncing] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [historyDetailOpen, setHistoryDetailOpen] = useState(false);
    const [historyDetailItem, setHistoryDetailItem] = useState<any>(null);

    const getCloudHistoryLimitByPlan = (plan: any) => PLAN_CONFIG[getPlanKey(plan)].cloudDetectionSyncLimit;

    const getLocalHistoryLimitByPlan = (plan: any) => PLAN_CONFIG[getPlanKey(plan)].localDetectionHistoryLimit;

    // 获取当前用户ID用于隔离存储
    const getCurrentUserId = () => {
        const token = localStorage.getItem('access_token');
        if (!token) return 'guest';
        try {
            // 简单解析JWT payload获取sub
            const base64 = token.split('.')[1];
            const json = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
            const payload = JSON.parse(json);
            return payload.sub || 'guest';
        } catch {
            return 'guest';
        }
    };

    // Load detection history from localStorage on mount (按用户隔离)
    useEffect(() => {
        const userId = getCurrentUserId();
        const storageKey = `detection_history_${userId}`;
        const stored = localStorage.getItem(storageKey);
        if (stored) {
            try {
                setDetectionHistory(JSON.parse(stored));
            } catch (e) {
                // ignore
            }
        }
    }, [user?.id]); // 当用户变化时重新加载

    // Save detection record (按用户隔离)
    const saveDetectionRecord = (record: any) => {
        const userId = getCurrentUserId();
        const storageKey = `detection_history_${userId}`;
        
        const newRecord = {
            ...record,
            id: Date.now().toString(),
            timestamp: new Date().toISOString()
        };
        const limit = getLocalHistoryLimitByPlan(user?.plan);
        const updated = [newRecord, ...detectionHistory].slice(0, limit);
        setDetectionHistory(updated);
        localStorage.setItem(storageKey, JSON.stringify(updated));
    };

    const mergeDetectionHistory = (incoming: any[]) => {
        const userId = getCurrentUserId();
        const storageKey = `detection_history_${userId}`;
        const existing = detectionHistory || [];

        const normalize = (r: any) => {
            const ts = r?.timestamp || r?.created_at || r?.createdAt || r?.time || null;
            const filename = r?.filename || r?.input_filename || r?.inputFilename || '';
            const conf = typeof r?.confidence === 'number' ? r.confidence : (typeof r?.confidence === 'string' ? Number(r.confidence) : null);
            return {
                ...r,
                timestamp: ts || new Date().toISOString(),
                filename,
                confidence: conf ?? r?.confidence,
            };
        };

        const keyOf = (r: any) => {
            const ts = r?.timestamp || '';
            const fn = r?.filename || '';
            const hw = r?.hasWatermark ?? r?.has_watermark ?? '';
            return `${ts}|${fn}|${hw}`;
        };

        const map = new Map<string, any>();
        for (const r of existing) map.set(keyOf(normalize(r)), normalize(r));
        for (const r of (incoming || [])) map.set(keyOf(normalize(r)), normalize(r));

        const merged = Array.from(map.values())
            .sort((a, b) => {
                const ta = new Date(a.timestamp || 0).getTime();
                const tb = new Date(b.timestamp || 0).getTime();
                return tb - ta;
            })
            .slice(0, getLocalHistoryLimitByPlan(user?.plan));

        setDetectionHistory(merged);
        localStorage.setItem(storageKey, JSON.stringify(merged));
    };

    const syncCloudDetectionRecords = async (opts?: { silent?: boolean }) => {
        const userId = getCurrentUserId();
        if (!userId || userId === 'guest') return;
        setCloudSyncing(true);
        try {
            const limit = getCloudHistoryLimitByPlan(user?.plan);
            const res: any = await watermark.getMyDetectionRecords(limit);
            const rows = res?.records || [];
            const mapped = rows.map((r: any) => ({
                id: `cloud_${r.id}`,
                type: (r?.metadata?.request_type || 'image') as any,
                filename: r.input_filename,
                hasWatermark: r.has_watermark,
                confidence: r.confidence,
                matchedAsset: r.matched_asset,
                candidates: r.candidates,
                fingerprint_prefix: r.fingerprint_prefix,
                timestamp: r.created_at,
                source: 'cloud',
            }));
            mergeDetectionHistory(mapped);
            if (!opts?.silent) pushToast('检测记录已同步', 'success');
        } catch (e: any) {
            if (!opts?.silent) pushToast('检测记录同步失败', 'error');
        } finally {
            setCloudSyncing(false);
        }
    };

    useEffect(() => {
        if (!showHistory) return;
        syncCloudDetectionRecords({ silent: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showHistory, user?.id]);

    // 清除当前用户的检测历史
    const clearDetectionHistory = () => {
        const userId = getCurrentUserId();
        const storageKey = `detection_history_${userId}`;
        localStorage.removeItem(storageKey);
        setDetectionHistory([]);
    };

    // Open history detail
    const openHistoryDetail = (item: any) => {
        setHistoryDetailItem(item);
        setHistoryDetailOpen(true);
    };

    const closeHistoryDetail = () => {
        setHistoryDetailOpen(false);
        setHistoryDetailItem(null);
    };

    // 计算批量检测统计数据
    const computeBatchStats = () => {
        const completed = batchFiles.filter(f => f.status === 'done' && f.result);
        const total = completed.length;
        const matched = completed.filter(f => f.result?.has_watermark).length;
        const unmatched = total - matched;
        
        const similarities = completed
            .filter(f => f.result?.best_match?.similarity)
            .map(f => f.result.best_match.similarity);
        
        const avgSimilarity = similarities.length > 0
            ? similarities.reduce((a, b) => a + b, 0) / similarities.length
            : 0;
        
        const maxSimilarity = similarities.length > 0 ? Math.max(...similarities) : 0;
        const minSimilarity = similarities.length > 0 ? Math.min(...similarities) : 0;
        
        return {
            total,
            matched,
            unmatched,
            matchRate: total > 0 ? (matched / total * 100).toFixed(1) : '0',
            avgSimilarity: avgSimilarity.toFixed(2),
            maxSimilarity: maxSimilarity.toFixed(2),
            minSimilarity: minSimilarity.toFixed(2),
            items: completed.map((f, idx) => ({
                idx: idx + 1,
                name: f.file.name,
                hasWatermark: f.result?.has_watermark,
                similarity: f.result?.best_match?.similarity || 0,
                author: f.result?.best_match?.author_name || f.result?.matched_asset?.author_name || '-'
            }))
        };
    };
    const [batchDetailItem, setBatchDetailItem] = useState<BatchFile | null>(null);
    const [batchErrorDetailOpen, setBatchErrorDetailOpen] = useState(false);
    const [batchErrorDetailItem, setBatchErrorDetailItem] = useState<BatchFile | null>(null);

    // Single Mode Handlers
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const selectedFile = e.target.files[0];
            setFile(selectedFile);
            setPreviewUrl(URL.createObjectURL(selectedFile));
            setResult(null);
        }
    };

    const handleSingleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            const droppedFile = e.dataTransfer.files[0];
            setFile(droppedFile);
            setPreviewUrl(URL.createObjectURL(droppedFile));
            setResult(null);
        }
    };

    const clearSingleFile = () => {
        setFile(null);
        setPreviewUrl(null);
        setResult(null);
        if (singleInputRef.current) singleInputRef.current.value = '';
    };

    const openBatchDetail = (item: BatchFile) => {
        setBatchDetailItem(item);
        setBatchDetailOpen(true);
    };

    const closeBatchDetail = () => {
        setBatchDetailOpen(false);
        setBatchDetailItem(null);
    };

    const downloadMarkdown = (content: string, fileName: string) => {
        const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
    };

    const downloadBlob = (blob: Blob, fileName: string) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
    };

    const exportHtmlBackend = async (markdown: string, fileName: string) => {
        if (!requireFeatureAccess('export_pdf', 'HTML 报告导出')) return;
        try {
            const token = await getValidToken();
            const reportId = `exp_${Date.now()}`;
            const res = await fetch('/api/report/export', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': token ? `Bearer ${token}` : ''
                },
                body: JSON.stringify({
                    report_id: reportId,
                    export_format: 'html',
                    markdown_content: markdown,
                    file_name: fileName
                })
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({} as any));
                pushToast(`HTML 导出失败: ${err?.detail || '未知错误'}`, 'error', 5000);
                return;
            }
            const blob = await res.blob();
            downloadBlob(blob, fileName);
            pushToast('HTML 已导出', 'success');
        } catch (e) {
            console.error(e);
            pushToast('HTML 导出失败', 'error');
        }
    };

    const exportPdfBackend = async (markdown: string, fileName: string, reportData?: any) => {
        if (!requireFeatureAccess('export_pdf', 'PDF 报告导出')) return;
        try {
            const token = await getValidToken();
            const reportId = `exp_${Date.now()}`;
            const res = await fetch('/api/report/export', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': token ? `Bearer ${token}` : ''
                },
                body: JSON.stringify({
                    report_id: reportId,
                    export_format: 'pdf',
                    markdown_content: markdown,
                    file_name: fileName,
                    report_data: reportData
                })
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({} as any));
                throw new Error(err?.detail || 'Backend PDF export failed');
            }
            const blob = await res.blob();
            downloadBlob(blob, fileName);
            pushToast('PDF 已导出', 'success');
        } catch (e) {
            console.error(e);
            pushToast('PDF 导出失败', 'error');
        }
    };

    const printPdfFrontend = (content: string, title: string) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        pushToast('请允许弹窗以使用PDF打印功能', 'error');
        return;
    }
    
    // 专业Markdown转HTML：分行处理，保留结构
    const lines = content.split('\n');
    let htmlLines: string[] = [];
    let inUl = false;
    let inOl = false;
    let inCodeBlock = false;
    let inTable = false;
    let tableRows: string[] = [];

    const inlineFmt = (s: string) =>
        s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
         .replace(/\*(.+?)\*/g, '<em>$1</em>')
         .replace(/`(.+?)`/g, '<code class="inline-code">$1</code>');

    const closeLists = () => {
        if (inUl) { htmlLines.push('</ul>'); inUl = false; }
        if (inOl) { htmlLines.push('</ol>'); inOl = false; }
    };

    const flushTable = () => {
        if (!inTable) return;
        let tableHtml = '<table class="report-table">';
        tableRows.forEach((row, ri) => {
            const cells = row.split('|||');
            const tag = ri === 0 ? 'th' : 'td';
            tableHtml += '<tr>' + cells.map(c => `<${tag}>${inlineFmt(c)}</${tag}>`).join('') + '</tr>';
        });
        tableHtml += '</table>';
        htmlLines.push(tableHtml);
        inTable = false;
        tableRows = [];
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // 代码块
        if (line.trim().startsWith('```')) {
            if (inCodeBlock) {
                htmlLines.push('</code></pre>');
                inCodeBlock = false;
            } else {
                closeLists(); flushTable();
                inCodeBlock = true;
                htmlLines.push('<pre class="code-block"><code>');
            }
            continue;
        }
        if (inCodeBlock) {
            htmlLines.push(line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '\n');
            continue;
        }
        
        // 表格
        if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
            closeLists();
            if (!inTable) { inTable = true; tableRows = []; }
            if (/^\|[\s\-:|]+\|$/.test(line.trim())) continue;
            const cells = line.split('|').filter(c => c.trim() !== '');
            tableRows.push(cells.map(c => c.trim()).join('|||'));
            continue;
        } else if (inTable) {
            flushTable();
        }
        
        // 空行
        if (line.trim() === '') {
            closeLists();
            htmlLines.push('<div class="spacer"></div>');
            continue;
        }
        
        // 标题
        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            closeLists();
            const level = headingMatch[1].length;
            htmlLines.push(`<h${level} class="heading-${level}">${inlineFmt(headingMatch[2])}</h${level}>`);
            continue;
        }
        
        // 无序列表
        const ulMatch = line.match(/^\s*[-*]\s+(.+)$/);
        if (ulMatch) {
            if (inOl) { htmlLines.push('</ol>'); inOl = false; }
            if (!inUl) { htmlLines.push('<ul class="report-list">'); inUl = true; }
            htmlLines.push(`<li>${inlineFmt(ulMatch[1])}</li>`);
            continue;
        }

        // 有序列表
        const olMatch = line.match(/^\s*\d+[.)\s]\s*(.+)$/);
        if (olMatch) {
            if (inUl) { htmlLines.push('</ul>'); inUl = false; }
            if (!inOl) { htmlLines.push('<ol class="report-ol">'); inOl = true; }
            htmlLines.push(`<li>${inlineFmt(olMatch[1])}</li>`);
            continue;
        }

        closeLists();
        
        // 分隔线
        if (/^---+$/.test(line.trim())) {
            htmlLines.push('<hr class="divider">');
            continue;
        }
        
        // 普通段落 - 内联格式化
        htmlLines.push(`<p class="paragraph">${inlineFmt(line)}</p>`);
    }
    closeLists();
    flushTable();
    if (inCodeBlock) htmlLines.push('</code></pre>');
    
    const htmlContent = htmlLines.join('\n');
    
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${title}</title>
            <style>
                @page { size: A4; margin: 20mm 15mm; }
                * { box-sizing: border-box; }
                body {
                    font-family: 'Microsoft YaHei', 'PingFang SC', 'Noto Sans CJK SC', 'Hiragino Sans GB', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
                    padding: 40px 50px;
                    max-width: 850px;
                    margin: 0 auto;
                    line-height: 1.9;
                    color: #1a1a2e;
                    background: #fff;
                    font-size: 13px;
                    word-break: break-all;
                    overflow-wrap: break-word;
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                }
                /* 报告头部 */
                .report-header {
                    text-align: center;
                    padding: 20px 0 15px;
                    border-bottom: 3px solid #6366f1;
                    margin-bottom: 25px;
                    page-break-inside: avoid;
                }
                .report-header h1 {
                    font-size: 22px;
                    color: #1e1b4b;
                    margin: 0 0 6px;
                    border: none;
                    padding: 0;
                }
                .report-header .meta {
                    font-size: 11px;
                    color: #6b7280;
                }
                /* 标题层级 */
                .heading-1 { font-size: 20px; color: #1e1b4b; border-bottom: 2px solid #6366f1; padding-bottom: 8px; margin: 28px 0 14px; page-break-after: avoid; }
                .heading-2 { font-size: 16px; color: #312e81; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; margin: 22px 0 10px; page-break-after: avoid; }
                .heading-3 { font-size: 14px; color: #4338ca; margin: 18px 0 8px; border: none; padding: 0; page-break-after: avoid; }
                .heading-4, .heading-5, .heading-6 { font-size: 13px; color: #4f46e5; margin: 14px 0 6px; border: none; padding: 0; page-break-after: avoid; }
                /* 段落 */
                .paragraph { margin: 6px 0; text-align: justify; word-break: break-all; overflow-wrap: break-word; }
                .spacer { height: 8px; }
                /* 列表 */
                .report-list { margin: 8px 0 8px 20px; padding: 0; page-break-inside: avoid; list-style: disc; }
                .report-list li { margin: 4px 0; padding-left: 4px; word-break: break-all; }
                .report-ol { margin: 8px 0 8px 20px; padding: 0; page-break-inside: avoid; list-style: decimal; }
                .report-ol li { margin: 4px 0; padding-left: 4px; word-break: break-all; }
                /* 表格 */
                .report-table { border-collapse: collapse; width: 100%; margin: 14px 0; font-size: 12px; page-break-inside: avoid; }
                .report-table th { background: #f1f5f9 !important; font-weight: 700; color: #1e293b; border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                .report-table td { border: 1px solid #e2e8f0; padding: 7px 10px; color: #334155; word-break: break-all; }
                .report-table tr:nth-child(even) td { background: #f8fafc !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                /* 代码 */
                .inline-code { background: #f1f5f9 !important; padding: 1px 5px; border-radius: 3px; font-family: 'Courier New', 'Consolas', monospace; font-size: 12px; color: #7c3aed; word-break: break-all; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                .code-block { background: #f8fafc !important; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 16px; overflow-x: auto; font-size: 12px; line-height: 1.5; margin: 10px 0; page-break-inside: avoid; white-space: pre-wrap; word-break: break-all; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                .code-block code { font-family: 'Courier New', 'Consolas', monospace; color: #1e293b; white-space: pre-wrap; }
                /* 分隔线 */
                .divider { border: none; border-top: 1px solid #e5e7eb; margin: 16px 0; }
                /* 粗体 */
                strong { color: #1e1b4b; }
                /* 页脚 */
                .report-footer { margin-top: 30px; padding-top: 12px; border-top: 2px solid #6366f1; text-align: center; font-size: 10px; color: #9ca3af; page-break-inside: avoid; }
                /* 打印按钮 */
                .toolbar { position: fixed; top: 0; left: 0; right: 0; background: #1e1b4b; padding: 10px 20px; display: flex; gap: 10px; justify-content: center; z-index: 100; box-shadow: 0 2px 10px rgba(0,0,0,0.15); }
                .toolbar button { padding: 8px 20px; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px; color: white; }
                .btn-print { background: #6366f1; }
                .btn-print:hover { background: #4f46e5; }
                .btn-close { background: #ef4444; }
                .btn-close:hover { background: #dc2626; }
                .content-area { margin-top: 50px; }
                @media print {
                    .toolbar { display: none !important; }
                    .content-area { margin-top: 0; }
                    body { padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    .report-table, .code-block, .report-list { page-break-inside: avoid; }
                    h1, h2, h3, h4, h5, h6 { page-break-after: avoid; }
                }
            </style>
        </head>
        <body>
            <div class="toolbar">
                <button class="btn-print" onclick="window.print()">🖨️ 打印 / 保存为PDF</button>
                <button class="btn-close" onclick="window.close()">✕ 关闭</button>
            </div>
            <div class="content-area">
                <div class="report-header">
                    <h1>📋 AIGCGuard 检测分析报告</h1>
                    <div class="meta">AIGC-Guard v1.0 · 生成时间: ${new Date().toLocaleString()} · 系统自动生成</div>
                </div>
                ${htmlContent}
                <div class="report-footer">
                    <p>本报告由 AIGCGuard 数字内容指纹嵌入与侵权全网监测平台自动生成</p>
                    <p>报告仅供参考，最终法律效力以司法机关认定为准 · © ${new Date().getFullYear()} AIGCGuard</p>
                </div>
            </div>
            <script>setTimeout(() => document.title = '${title.replace(/'/g, "\\'")}', 100);</script>
        </body>
        </html>
    `);
    printWindow.document.close();
    pushToast('已打开打印窗口，点击"打印"按钮保存为PDF', 'success');
    };

    const handleDetect = async () => {
        if (!file) return;
        // 大文件使用异步检测
        if (file.size > 5 * 1024 * 1024) {
            await startAsyncDetection();
            return;
        }
        setDetectModalOpen(true);
        setDetectStatusText('正在上传图片...');
        setLoading(true);
        const formData = new FormData();
        formData.append('image', file);

        const statusMessages = [
            '正在上传图片...',
            '正在提取隐写指纹特征...',
            '正在匹配云端指纹数据库...',
            '正在生成可信度评分与风险结论...',
        ];
        let statusIdx = 0;
        const timer = window.setInterval(() => {
            statusIdx = (statusIdx + 1) % statusMessages.length;
            setDetectStatusText(statusMessages[statusIdx]);
        }, 900);

        try {
            setDetectStatusText('正在完成检测...');
            const res: any = await watermark.detect(formData);

            setResult(res);
            syncCloudDetectionRecords({ silent: true });
            window.dispatchEvent(new Event('quota-updated'));
            pushToast('检测完成', 'success');
            clearDetectionSession(); // 清除检测会话状态
            
            // 保存检测记录（兼容 matched_asset / best_match）
            const matchedAsset = res.matched_asset || (res.best_match ? {
                id: res.best_match.author_id || res.best_match.id,
                user_id: res.best_match.author_id,
                author_name: res.best_match.author_name || '未知',
                filename: res.best_match.filename || '',
                timestamp: res.best_match.creation_time || '',
                similarity: res.best_match.similarity || 0,
            } : null);
            const confidence = res.confidence || (res.best_match?.similarity ? res.best_match.similarity / 100 : 0);
            saveDetectionRecord({
                type: 'image',
                filename: file.name,
                hasWatermark: res.has_watermark,
                matchedAsset,
                confidence,
                message: res.message,
                five_dim_score: res.five_dim_score,
                confidence_level: res.confidence_level,
                legal_description: res.legal_description,
                legal_assessment: res.legal_assessment,
                visualizations: res.visualizations,
                // 新增：保存分析结论和证据强度
                analysis: res.analysis,
                match_summary: res.match_summary,
            });
        } catch (err: any) {
            console.error(err);
            pushToast(`检测失败: ${err.response?.data?.detail || err.message || '网络错误，请检查后端服务是否正常运行'}`, 'error', 5000);
            clearDetectionSession(); // 清除检测会话状态
        } finally {
            window.clearInterval(timer);
            setLoading(false);
            setDetectModalOpen(false);
        }
    };

    // Text Mode Handlers
    const handleTextDetect = async () => {
        if (!textInput.trim()) return;
        setLoading(true);
        try {
            const res = await watermark.detectText({ text: textInput });
            setTextResult(res);
            
            // 保存文本检测记录
            saveDetectionRecord({
                type: 'text',
                filename: '文本检测_' + new Date().toLocaleTimeString(),
                hasWatermark: res.has_watermark,
                matchedAsset: res.matched_asset,
                confidence: res.confidence || 0,
                message: res.message,
                extracted_watermark: res.extracted_watermark,
                confidence_level: res.confidence_level,
                legal_description: res.legal_description,
                analysis: res.analysis,
            });
        } catch (err) {
            console.error(err);
            pushToast('文本溯源失败', 'error');
        } finally {
            setLoading(false);
        }
    };

    // Video Mode Handlers
    const handleVideoDetect = async () => {
        if (!videoFile) return;
        setLoading(true);
        const formData = new FormData();
        formData.append('video', videoFile);
        try {
            const res = await watermark.detectVideo(formData);
            setVideoResult(res);
            
            // 保存视频检测记录
            saveDetectionRecord({
                type: 'video',
                filename: videoFile.name,
                hasWatermark: res.has_watermark,
                matchedAsset: res.matched_asset,
                confidence: res.confidence || 0,
                message: res.message,
                extracted_fingerprint: res.extracted_fingerprint,
                processed_seconds: res.processed_seconds,
                confidence_level: res.confidence_level,
                legal_description: res.legal_description,
                analysis: res.analysis,
            });
        } catch (err) {
            console.error(err);
            pushToast('视频溯源失败', 'error');
        } finally {
            setLoading(false);
        }
    };

    // Batch Mode Handlers
    const [dmcaNotice, setDmcaNotice] = useState<string | null>(null);
    const [infringingUrl, setInfringingUrl] = useState('');
    const [evidencePoints, setEvidencePoints] = useState('');
    const [reportMarkdown, setReportMarkdown] = useState<string | null>(null);
    const [pdfExporting, setPdfExporting] = useState(false);
    // 缓存检测时自动生成的AI报告，用户点击下载时才触发
    const [cachedAiReport, setCachedAiReport] = useState<string | null>(null);

    // Unified Report Viewer (溯源/AI/DMCA 统一预览)
    const [viewerOpen, setViewerOpen] = useState(false);
    const [viewerTitle, setViewerTitle] = useState('');
    const [viewerHtml, setViewerHtml] = useState('');
    const [viewerMarkdown, setViewerMarkdown] = useState('');
    const [viewerType, setViewerType] = useState<'provenance' | 'ai' | 'dmca'>('provenance');
    const [viewerExporting, setViewerExporting] = useState(false);

    const escapeHtml = (s: string) => {
        return (s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    /** Markdown → 带内联样式的 HTML（暗色主题，适配预览弹窗 / 导出 HTML / PDF 打印） */
    const markdownToInlineStyledHtml = (md: string): string => {
        const lines = md.split('\n');
        const out: string[] = [];
        let inUl = false, inOl = false, inCode = false;
        let inTable = false;
        let tableRows: string[][] = [];

        const esc = (s: string) => (s || '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        const inlineFmt = (s: string) =>
            esc(s)
                .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#c084fc;font-weight:700;">$1</strong>')
                .replace(/\*(.+?)\*/g, '<em style="color:#94a3b8;font-style:italic;">$1</em>')
                .replace(/`(.+?)`/g, '<code style="background:rgba(0,0,0,0.3);padding:1px 5px;border-radius:3px;font-family:monospace;font-size:12px;color:#fb7185;">$1</code>');

        const closeList = () => {
            if (inUl) { out.push('</ul>'); inUl = false; }
            if (inOl) { out.push('</ol>'); inOl = false; }
        };

        const flushTable = () => {
            if (!inTable) return;
            let html = '<table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:12px;">';
            tableRows.forEach((cells, ri) => {
                const tag = ri === 0 ? 'th' : 'td';
                const st = ri === 0
                    ? 'background:rgba(255,255,255,0.08);font-weight:700;color:#e2e8f0;border:1px solid rgba(255,255,255,0.12);padding:8px 10px;text-align:left;'
                    : 'border:1px solid rgba(255,255,255,0.08);padding:7px 10px;color:#cbd5e1;';
                html += '<tr>' + cells.map(c => `<${tag} style="${st}">${inlineFmt(c)}</${tag}>`).join('') + '</tr>';
            });
            html += '</table>';
            out.push(html);
            inTable = false;
            tableRows = [];
        };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // 代码块
            if (line.trim().startsWith('```')) {
                if (inCode) { out.push('</code></pre>'); inCode = false; }
                else { closeList(); flushTable(); inCode = true; out.push('<pre style="background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:12px;margin:10px 0;overflow-x:auto;"><code style="font-family:monospace;font-size:12px;color:#e2e8f0;white-space:pre-wrap;">'); }
                continue;
            }
            if (inCode) { out.push(esc(line) + '\n'); continue; }

            // 表格
            if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
                closeList();
                if (!inTable) { inTable = true; tableRows = []; }
                if (/^\|[\s\-:|]+\|$/.test(line.trim())) continue;
                tableRows.push(line.split('|').slice(1, -1).map(c => c.trim()));
                continue;
            } else if (inTable) { flushTable(); }

            // 空行
            if (line.trim() === '') { closeList(); out.push('<div style="height:8px;"></div>'); continue; }

            // 标题
            const hm = line.match(/^(#{1,6})\s+(.+)$/);
            if (hm) {
                closeList();
                const lvl = hm[1].length;
                const styles: Record<number, string> = {
                    1: 'font-size:18px;font-weight:800;color:#fff;margin:20px 0 10px;padding-bottom:8px;border-bottom:2px solid rgba(192,132,252,0.3);',
                    2: 'font-size:16px;font-weight:700;color:#f1f5f9;margin:16px 0 8px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.1);',
                    3: 'font-size:14px;font-weight:700;color:#e2e8f0;margin:14px 0 6px;',
                    4: 'font-size:13px;font-weight:600;color:#cbd5e1;margin:12px 0 4px;',
                    5: 'font-size:12px;font-weight:600;color:#94a3b8;margin:10px 0 4px;',
                    6: 'font-size:12px;font-weight:600;color:#94a3b8;margin:8px 0 4px;',
                };
                out.push(`<div style="${styles[lvl] || styles[3]}">${inlineFmt(hm[2])}</div>`);
                continue;
            }

            // 无序列表
            const ulm = line.match(/^\s*[-*]\s+(.+)$/);
            if (ulm) {
                if (inOl) { out.push('</ol>'); inOl = false; }
                if (!inUl) { out.push('<ul style="margin:6px 0 6px 20px;padding:0;list-style:disc;">'); inUl = true; }
                out.push(`<li style="color:#cbd5e1;margin:3px 0;line-height:1.7;">${inlineFmt(ulm[1])}</li>`);
                continue;
            }

            // 有序列表
            const olm = line.match(/^\s*\d+[.)\s]\s*(.+)$/);
            if (olm) {
                if (inUl) { out.push('</ul>'); inUl = false; }
                if (!inOl) { out.push('<ol style="margin:6px 0 6px 20px;padding:0;list-style:decimal;">'); inOl = true; }
                out.push(`<li style="color:#cbd5e1;margin:3px 0;line-height:1.7;">${inlineFmt(olm[1])}</li>`);
                continue;
            }

            closeList();

            // 分隔线
            if (/^---+$/.test(line.trim())) { out.push('<hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:14px 0;">'); continue; }

            // 普通段落
            out.push(`<p style="color:#cbd5e1;margin:5px 0;line-height:1.8;word-break:break-word;">${inlineFmt(line)}</p>`);
        }
        closeList();
        flushTable();
        if (inCode) out.push('</code></pre>');
        return out.join('\n');
    };

    const buildUnifiedHtml = (opts: {
        title: string;
        subtitle?: string;
        accent?: 'blue' | 'violet' | 'rose';
        blocks: Array<{ label: string; value: string; tone?: 'normal' | 'strong' | 'muted' } | { kind: 'divider' } | { kind: 'pre'; label: string; value: string } | { kind: 'html'; value: string }>
    }) => {
        const accent = opts.accent || 'blue';
        const accentMap: Record<string, { primary: string; soft: string; border: string }> = {
            blue: { primary: '#60a5fa', soft: 'rgba(96,165,250,0.12)', border: 'rgba(96,165,250,0.22)' },
            violet: { primary: '#c084fc', soft: 'rgba(192,132,252,0.12)', border: 'rgba(192,132,252,0.22)' },
            rose: { primary: '#fb7185', soft: 'rgba(251,113,133,0.12)', border: 'rgba(251,113,133,0.22)' },
        };
        const a = accentMap[accent] || accentMap.blue;

        const renderBlock = (b: any) => {
            if (b?.kind === 'divider') {
                return `<div style="height:1px;background:rgba(255,255,255,0.10);margin:16px 0;"></div>`;
            }
            if (b?.kind === 'pre') {
                return `
<div style="background:rgba(0,0,0,0.28);border:1px solid rgba(255,255,255,0.10);border-radius:14px;padding:14px 14px 12px;">
  <div style="font-size:12px;color:#9ca3af;margin-bottom:8px;font-weight:700;letter-spacing:0.06em;">${escapeHtml(b.label || '')}</div>
  <pre style="margin:0;white-space:pre-wrap;word-break:break-word;line-height:1.8;font-size:12.5px;color:#e5e7eb;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;">${escapeHtml(b.value || '')}</pre>
</div>`;
            }
            if (b?.kind === 'html') {
                return `<div style="background:rgba(0,0,0,0.28);border:1px solid rgba(255,255,255,0.10);border-radius:14px;padding:14px;">${b.value || ''}</div>`;
            }
            const tone = b?.tone || 'normal';
            const valueColor = tone === 'muted' ? '#9ca3af' : tone === 'strong' ? a.primary : '#e5e7eb';
            const valueWeight = tone === 'strong' ? 800 : 600;
            return `
<div style="display:flex;gap:14px;align-items:flex-start;padding:10px 0;">
  <div style="width:140px;flex:0 0 140px;color:#9ca3af;font-size:12px;font-weight:700;letter-spacing:0.08em;">${escapeHtml(b.label || '')}</div>
  <div style="flex:1;color:${valueColor};font-size:13px;font-weight:${valueWeight};line-height:1.7;word-break:break-word;">${escapeHtml(b.value || '')}</div>
</div>`;
        };

        const body = `
<div style="padding:18px 18px 0;">
  <div style="background:${a.soft};border:1px solid ${a.border};border-radius:18px;padding:16px 16px 14px;">
    <div style="font-size:18px;font-weight:900;color:#fff;letter-spacing:0.02em;">${escapeHtml(opts.title)}</div>
    ${opts.subtitle ? `<div style="margin-top:6px;font-size:12px;color:#cbd5e1;">${escapeHtml(opts.subtitle)}</div>` : ''}
  </div>
  <div style="margin-top:14px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.10);border-radius:18px;padding:16px;">
    ${opts.blocks.map(renderBlock).join('')}
  </div>
</div>`;

        return body;
    };

    const buildUnifiedMarkdown = (title: string, lines: Array<[string, string]>, extra?: string) => {
        const out: string[] = [];
        out.push(`# ${title}`);
        out.push('');
        for (const [k, v] of lines) {
            out.push(`- **${k}**: ${v}`);
        }
        if (extra) {
            out.push('');
            out.push('---');
            out.push('');
            out.push(extra);
        }
        return out.join('\n');
    };

    /** Markdown → 打印友好 A4 排版 HTML（白底深色文字，保证 PDF 导出不受浏览器背景影响） */
    const markdownToA4Html = (md: string): string => {
        const lines = md.split('\n');
        const out: string[] = [];
        let inUl = false, inOl = false, inCode = false;
        let inTable = false;
        let tableRows: string[][] = [];
        const esc = (s: string) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const inlineFmt = (s: string) => esc(s)
            .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#1e1b4b;font-weight:700;">$1</strong>')
            .replace(/\*(.+?)\*/g, '<em style="color:#475569;">$1</em>')
            .replace(/`(.+?)`/g, '<code style="background:#eef2ff;padding:2px 6px;border-radius:3px;font-family:Consolas,\'Courier New\',monospace;font-size:12px;color:#4f46e5;">$1</code>');
        const closeList = () => { if (inUl) { out.push('</ul>'); inUl = false; } if (inOl) { out.push('</ol>'); inOl = false; } };
        const flushTable = () => {
            if (!inTable) return;
            let html = '<table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:12.5px;">';
            tableRows.forEach((cells, ri) => {
                const tag = ri === 0 ? 'th' : 'td';
                const st = ri === 0
                    ? 'background:#eef2ff;font-weight:700;color:#1e1b4b;border:1px solid #c7d2fe;padding:8px 10px;text-align:left;'
                    : 'border:1px solid #e0e7ff;padding:7px 10px;color:#334155;';
                html += '<tr>' + cells.map(c => `<${tag} style="${st}">${inlineFmt(c)}</${tag}>`).join('') + '</tr>';
            });
            html += '</table>'; out.push(html); inTable = false; tableRows = [];
        };
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim().startsWith('```')) { if (inCode) { out.push('</code></pre>'); inCode = false; } else { closeList(); flushTable(); inCode = true; out.push('<pre style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:14px 18px;margin:12px 0;overflow-x:auto;"><code style="font-family:Consolas,\'Courier New\',monospace;font-size:12px;color:#1e293b;white-space:pre-wrap;">'); } continue; }
            if (inCode) { out.push(esc(line) + '\n'); continue; }
            if (line.trim().startsWith('|') && line.trim().endsWith('|')) { closeList(); if (!inTable) { inTable = true; tableRows = []; } if (/^\|[\s\-:|]+\|$/.test(line.trim())) continue; tableRows.push(line.split('|').slice(1, -1).map(c => c.trim())); continue; } else if (inTable) { flushTable(); }
            if (line.trim() === '') { closeList(); out.push('<div style="height:8px;"></div>'); continue; }
            const hm = line.match(/^(#{1,6})\s+(.+)$/);
            if (hm) {
                closeList();
                const lvl = hm[1].length;
                const styles: Record<number, string> = {
                    1: 'font-size:20px;font-weight:800;color:#1e1b4b;margin:28px 0 14px;padding-bottom:10px;border-bottom:3px solid #6366f1;',
                    2: 'font-size:16px;font-weight:700;color:#312e81;margin:22px 0 10px;padding-bottom:8px;border-bottom:1.5px solid #a5b4fc;',
                    3: 'font-size:14px;font-weight:700;color:#4338ca;margin:18px 0 8px;',
                    4: 'font-size:13px;font-weight:600;color:#4f46e5;margin:14px 0 6px;',
                    5: 'font-size:12px;font-weight:600;color:#6366f1;margin:12px 0 4px;',
                    6: 'font-size:12px;font-weight:600;color:#6366f1;margin:10px 0 4px;',
                };
                out.push(`<div style="${styles[lvl] || styles[3]}">${inlineFmt(hm[2])}</div>`);
                continue;
            }
            const ulm = line.match(/^\s*[-*]\s+(.+)$/); if (ulm) { if (inOl) { out.push('</ol>'); inOl = false; } if (!inUl) { out.push('<ul style="margin:8px 0 8px 22px;padding:0;list-style:disc;">'); inUl = true; } out.push(`<li style="color:#334155;margin:4px 0;line-height:1.85;">${inlineFmt(ulm[1])}</li>`); continue; }
            const olm = line.match(/^\s*\d+[.)\s]\s*(.+)$/); if (olm) { if (inUl) { out.push('</ul>'); inUl = false; } if (!inOl) { out.push('<ol style="margin:8px 0 8px 22px;padding:0;list-style:decimal;">'); inOl = true; } out.push(`<li style="color:#334155;margin:4px 0;line-height:1.85;">${inlineFmt(olm[1])}</li>`); continue; }
            closeList();
            if (/^---+$/.test(line.trim())) { out.push('<hr style="border:none;border-top:1.5px solid #e0e7ff;margin:18px 0;">'); continue; }
            out.push(`<p style="color:#334155;margin:6px 0;line-height:1.9;text-align:justify;word-break:break-word;">${inlineFmt(line)}</p>`);
        }
        closeList(); flushTable(); if (inCode) out.push('</code></pre>');
        return out.join('\n');
    };

    const buildA4Document = (title: string, markdown: string) => {
        const bodyHtml = markdownToA4Html(markdown);
        const now = new Date().toLocaleString();
        return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${escapeHtml(title)}</title>
<style>
  @page{size:A4;margin:20mm 18mm}
  *{box-sizing:border-box}
  body{margin:0;padding:0;background:#fff;color:#1e293b;font-family:'Microsoft YaHei','PingFang SC','Noto Sans CJK SC','Hiragino Sans GB',system-ui,sans-serif;font-size:13px;line-height:1.9}
  .a4-page{max-width:210mm;min-height:297mm;margin:0 auto;padding:44px 54px}
  .report-header{text-align:center;padding:28px 0 20px;border-bottom:3px solid #6366f1;margin-bottom:30px}
  .report-header h1{font-size:24px;color:#1e1b4b;margin:0 0 8px;font-weight:800;letter-spacing:0.03em}
  .report-header .meta{font-size:11px;color:#6b7280;letter-spacing:0.02em}
  .report-footer{margin-top:40px;padding-top:16px;border-top:2px solid #6366f1;text-align:center;font-size:10px;color:#9ca3af}
  @media print{body{padding:0} .a4-page{padding:0;max-width:none;min-height:auto} .no-print{display:none!important}}
  .toolbar{position:fixed;top:0;left:0;right:0;background:#1e1b4b;padding:10px 20px;display:flex;gap:10px;justify-content:center;z-index:100}
  .toolbar button{padding:8px 22px;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-size:13px;color:white}
  .btn-print{background:#6366f1}.btn-print:hover{background:#4f46e5}
  .btn-close{background:#ef4444}.btn-close:hover{background:#dc2626}
  @media print{.toolbar{display:none!important}}
</style>
</head><body>
<div class="toolbar no-print"><button class="btn-print" onclick="window.print()">🖨️ 打印 / 保存为 PDF</button><button class="btn-close" onclick="window.close()">✕ 关闭</button></div>
<div class="a4-page" style="margin-top:50px;">
  <div class="report-header"><h1>📋 ${escapeHtml(title)}</h1><div class="meta">AIGCGuard 数字内容指纹嵌入与侵权全网监测平台 · 生成时间: ${escapeHtml(now)}</div></div>
  ${bodyHtml}
  <div class="report-footer"><p>本报告由 AIGCGuard 数字内容指纹嵌入与侵权全网监测平台自动生成</p><p>报告仅供参考，最终法律效力以司法机关认定为准 · © ${new Date().getFullYear()} AIGCGuard</p></div>
</div></body></html>`;
    };

    const exportHtmlFile = (_htmlBody: string, fileName: string) => {
        const doc = buildA4Document(viewerTitle || 'Report', viewerMarkdown || '');
        const blob = new Blob([doc], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
    };

    const exportPdfViaPrint = (_htmlBody: string, title: string) => {
        const w = window.open('', '_blank');
        if (!w) { pushToast('请允许弹窗以使用 PDF 导出', 'error'); return; }
        const doc = buildA4Document(title, viewerMarkdown || '');
        w.document.write(doc);
        w.document.close();
        w.focus();
        setTimeout(() => w.print(), 350);
    };

    const openUnifiedViewer = async (t: 'provenance' | 'ai' | 'dmca', ctx: { source: 'single' | 'batch' | 'history'; item?: any }) => {
        if (t === 'provenance') {
            if (!requireFeatureAccess('report_markdown', '溯源鉴定报告')) return;
        }
        if (t === 'ai') {
            if (!requireFeatureAccess('report_ai', 'DeepSeek AI 分析报告')) return;
        }
        if (t === 'dmca') {
            if (!requireFeatureAccess('dmca', 'DMCA 法务文书')) return;
        }

        setViewerType(t);
        setViewerExporting(true);
        try {
            const now = new Date().toLocaleString();
            const filename = ctx.source === 'single' ? (file?.name || 'unknown') : (ctx.item?.file?.name || ctx.item?.filename || 'unknown');
            const hasWm = ctx.source === 'single' ? !!result?.has_watermark : !!(ctx.item?.result?.has_watermark ?? ctx.item?.hasWatermark);
            const conf = ctx.source === 'single'
                ? (typeof result?.confidence === 'number' ? result.confidence : null)
                : (typeof ctx.item?.result?.confidence === 'number' ? ctx.item.result.confidence : typeof ctx.item?.confidence === 'number' ? ctx.item.confidence : null);
            const confPct = conf !== null ? `${(conf * 100).toFixed(2)}%` : '--';
            const matched = ctx.source === 'single'
                ? (result?.matched_asset || result?.best_match)
                : (ctx.item?.result?.matched_asset || ctx.item?.result?.best_match || ctx.item?.matchedAsset || null);
            const author = matched?.author_name || matched?.author || matched?.user_id || '未知';

            if (t === 'provenance') {
                const title = '溯源鉴定报告';
                const subtitle = `文件：${filename} · 生成时间：${now}`;
                const blocks: any[] = [
                    { label: '检测结果', value: hasWm ? '命中指纹（存在匹配）' : '未命中指纹', tone: hasWm ? 'strong' : 'muted' },
                    { label: '综合置信度', value: confPct, tone: hasWm ? 'strong' : 'normal' },
                    { label: '匹配作者', value: author, tone: 'strong' },
                    { kind: 'divider' },
                    { label: '法律说明', value: (ctx.source === 'single' ? (result?.legal_description || '') : (ctx.item?.legal_description || ctx.item?.result?.legal_description || '')) || '—', tone: 'muted' },
                    { label: '关键结论', value: (ctx.source === 'single' ? (result?.analysis?.verdict || '') : (ctx.item?.analysis?.verdict || ctx.item?.result?.analysis?.verdict || '')) || '—', tone: 'normal' },
                ];
                const html = buildUnifiedHtml({ title, subtitle, accent: 'blue', blocks });
                const md = buildUnifiedMarkdown(title, [
                    ['文件', filename],
                    ['生成时间', now],
                    ['检测结果', hasWm ? '命中指纹' : '未命中'],
                    ['综合置信度', confPct],
                    ['匹配作者', author],
                ], `法律说明：${(ctx.source === 'single' ? (result?.legal_description || '') : (ctx.item?.legal_description || ctx.item?.result?.legal_description || '')) || '—'}\n\n结论：${(ctx.source === 'single' ? (result?.analysis?.verdict || '') : (ctx.item?.analysis?.verdict || ctx.item?.result?.analysis?.verdict || '')) || '—'}`);

                setViewerTitle(title);
                setViewerHtml(html);
                setViewerMarkdown(md);
                setViewerOpen(true);
                return;
            }

            if (t === 'ai') {
                // Prefer cached markdown if available
                let md = ctx.source === 'single' ? (cachedAiReport || '') : (ctx.item?.aiMarkdown || ctx.item?.result?.aiMarkdown || '');

                if (!md) {
                    const token = await getValidToken();
                    const det = ctx.source === 'single' ? result : (ctx.item?.result || ctx.item);
                    const res = await fetch('/api/report/generate', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
                        body: JSON.stringify({ detection_result: det, image_filename: filename, report_format: 'ai_analysis' })
                    });
                    if (!res.ok) {
                        const err = await res.json().catch(() => ({}));
                        throw new Error(err?.detail || 'AI 报告生成失败');
                    }
                    const data = await res.json();
                    md = String(data.content || '');
                }

                const title = 'AI 分析报告';
                const subtitle = `文件：${filename} · 生成时间：${now}`;
                const html = buildUnifiedHtml({
                    title,
                    subtitle,
                    accent: 'violet',
                    blocks: [
                        { label: '检测结果', value: hasWm ? '命中指纹（存在匹配）' : '未命中指纹', tone: hasWm ? 'strong' : 'muted' },
                        { label: '综合置信度', value: confPct, tone: hasWm ? 'strong' : 'normal' },
                        { label: '匹配作者', value: author, tone: 'strong' },
                        { kind: 'divider' },
                        { kind: 'html', value: `<div style="font-size:12px;color:#9ca3af;margin-bottom:8px;font-weight:700;letter-spacing:0.06em;">AI 分析正文</div>${markdownToInlineStyledHtml(md)}` },
                    ],
                });

                setViewerTitle(title);
                setViewerHtml(html);
                setViewerMarkdown(md);
                setViewerOpen(true);
                if (ctx.source === 'single') setCachedAiReport(md);
                return;
            }

            // dmca
            let notice = ctx.source === 'single' ? (dmcaNotice || '') : (ctx.item?.dmcaNotice || ctx.item?.result?.dmcaNotice || '');
            if (!notice) {
                const det = ctx.source === 'single' ? result : (ctx.item?.result || ctx.item);
                const m = det?.matched_asset || det?.best_match || matched;
                if (!m?.id) throw new Error('该检测结果缺少匹配资产信息，无法生成 DMCA');
                const token = await getValidToken();
                const res = await fetch('/api/dmca/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': token ? `Bearer ${token}` : '' },
                    body: JSON.stringify({
                        asset_id: m.id,
                        infringing_url: (ctx.source === 'single' ? infringingUrl : (ctx.item?.batchDmcaUrl || ctx.item?.infringingUrl || ''))?.trim() || '发现于未知全网平台',
                        similarity: typeof m.similarity === 'number' ? m.similarity : undefined,
                        tx_hash: m?.tx_hash,
                        block_height: m?.block_height,
                        evidence_points: ((ctx.source === 'single' ? evidencePoints : (ctx.item?.batchDmcaEvidence || ctx.item?.evidencePoints || '')) || '')
                            .split('\n')
                            .map((s: string) => s.trim())
                            .filter(Boolean),
                    })
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err?.detail || 'DMCA 生成失败');
                }
                const data = await res.json();
                notice = String(data.notice_text || '');
            }

            const title = 'DMCA 公文';
            const subtitle = `文件：${filename} · 生成时间：${now}`;
            const html = buildUnifiedHtml({
                title,
                subtitle,
                accent: 'rose',
                blocks: [
                    { label: '匹配作者', value: author, tone: 'strong' },
                    { label: '综合置信度', value: confPct, tone: 'strong' },
                    { kind: 'divider' },
                    { kind: 'html', value: `<div style="font-size:12px;color:#9ca3af;margin-bottom:8px;font-weight:700;letter-spacing:0.06em;">DMCA 文书正文</div>${markdownToInlineStyledHtml(notice)}` },
                ],
            });
            const md = notice;

            setViewerTitle(title);
            setViewerHtml(html);
            setViewerMarkdown(md);
            setViewerOpen(true);
            if (ctx.source === 'single') setDmcaNotice(notice);
        } catch (e: any) {
            pushToast(e?.message || '打开预览失败', 'error', 5000);
        } finally {
            setViewerExporting(false);
        }
    };

    // Markdown 转 HTML 逐行解析器（支持标题/列表/表格/代码块/段落）
    const markdownToHtml = (md: string): string => {
        const lines = md.split('\n');
        const out: string[] = [];
        let inUl = false;
        let inOl = false;
        let inCode = false;
        let inTable = false;
        let tableRows: string[][] = [];

        const inline = (s: string) =>
            s
                .replace(/\*\*(.+?)\*\*/g, '<strong class="text-purple-400">$1</strong>')
                .replace(/\*(.+?)\*/g, '<em class="text-gray-400">$1</em>')
                .replace(/`(.+?)`/g, '<code class="bg-black/30 px-2 py-1 rounded text-sm font-mono text-pink-400">$1</code>');

        const closeList = () => {
            if (inUl) { out.push('</ul>'); inUl = false; }
            if (inOl) { out.push('</ol>'); inOl = false; }
        };

        const flushTable = () => {
            if (!inTable) return;
            let html = '<table class="w-full text-sm my-3 border-collapse">';
            tableRows.forEach((cells, ri) => {
                const tag = ri === 0 ? 'th' : 'td';
                const cls = ri === 0
                    ? 'bg-white/10 text-gray-200 font-bold px-3 py-2 border border-white/10 text-left'
                    : 'text-gray-300 px-3 py-2 border border-white/10';
                html += '<tr>' + cells.map(c => `<${tag} class="${cls}">${inline(c)}</${tag}>`).join('') + '</tr>';
            });
            html += '</table>';
            out.push(html);
            inTable = false;
            tableRows = [];
        };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // 代码块
            if (line.trim().startsWith('```')) {
                if (inCode) {
                    out.push('</code></pre>');
                    inCode = false;
                } else {
                    closeList(); flushTable();
                    inCode = true;
                    out.push('<pre class="bg-black/40 border border-white/10 rounded-lg p-3 my-3 overflow-x-auto text-sm leading-relaxed"><code class="font-mono text-gray-300">');
                }
                continue;
            }
            if (inCode) {
                out.push(line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '\n');
                continue;
            }

            // 表格行
            if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
                closeList();
                if (!inTable) { inTable = true; tableRows = []; }
                if (/^\|[\s\-:|]+\|$/.test(line.trim())) continue; // 分隔行
                const cells = line.split('|').slice(1, -1).map(c => c.trim());
                tableRows.push(cells);
                continue;
            } else if (inTable) {
                flushTable();
            }

            // 空行
            if (line.trim() === '') {
                closeList();
                out.push('<div class="h-3"></div>');
                continue;
            }

            // 标题
            const hm = line.match(/^(#{1,6})\s+(.+)$/);
            if (hm) {
                closeList();
                const lvl = hm[1].length;
                const cls = lvl === 1
                    ? 'text-2xl font-bold text-white mb-4 pb-2 border-b border-white/20'
                    : lvl === 2
                        ? 'text-xl font-bold text-white mb-3 mt-6 pb-2 border-b border-white/10'
                        : 'text-lg font-bold text-gray-200 mb-2 mt-4';
                out.push(`<h${lvl} class="${cls}">${inline(hm[2])}</h${lvl}>`);
                continue;
            }

            // 无序列表
            const ulm = line.match(/^\s*[-*]\s+(.+)$/);
            if (ulm) {
                if (inOl) { out.push('</ol>'); inOl = false; }
                if (!inUl) { out.push('<ul class="ml-5 my-2 space-y-1 list-disc">'); inUl = true; }
                out.push(`<li class="text-gray-300">${inline(ulm[1])}</li>`);
                continue;
            }

            // 有序列表
            const olm = line.match(/^\s*\d+[.)\s]\s*(.+)$/);
            if (olm) {
                if (inUl) { out.push('</ul>'); inUl = false; }
                if (!inOl) { out.push('<ol class="ml-5 my-2 space-y-1 list-decimal">'); inOl = true; }
                out.push(`<li class="text-gray-300">${inline(olm[1])}</li>`);
                continue;
            }

            closeList();

            // 分隔线
            if (/^---+$/.test(line.trim())) {
                out.push('<hr class="border-white/10 my-4">');
                continue;
            }

            // 普通段落
            out.push(`<p class="text-gray-300 mb-3 leading-relaxed">${inline(line)}</p>`);
        }
        closeList();
        flushTable();
        if (inCode) out.push('</code></pre>');
        return out.join('\n');
    };

    const generateReportMarkdownOnly = async (): Promise<string | null> => {
        if (!result) return null;
        try {
            const token = await getValidToken();
            const res = await fetch('/api/report/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': token ? `Bearer ${token}` : ''
                },
                body: JSON.stringify({
                    detection_result: result,
                    image_filename: file?.name || 'unknown',
                    report_format: 'markdown'
                })
            });
            if (!res.ok) {
                const errorText = await res.json();
                pushToast(`生成报告失败: ${errorText.detail || '未知错误'}`, 'error', 5000);
                return null;
            }
            const data = await res.json();
            const md = String(data.content || '');
            setReportMarkdown(md);
            return md;
        } catch (e) {
            console.error(e);
            pushToast('生成报告失败', 'error');
            return null;
        }
    };

    // 直接导出 PDF（从预览弹窗中调用）
    const handleExportPdfDirect = async () => {
        if (!requireFeatureAccess('export_pdf', 'PDF 报告导出')) return;

        setPdfExporting(true);
        let mdForExport: string | null = null;
        try {
            mdForExport = reportMarkdown || (await generateReportMarkdownOnly());
            if (!mdForExport) return;

            const token = await getValidToken();
            const reportId = `det_${Date.now()}`;
            const res = await fetch('/api/report/export', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': token ? `Bearer ${token}` : ''
                },
                body: JSON.stringify({
                    report_id: reportId,
                    export_format: 'pdf',
                    markdown_content: mdForExport,
                    file_name: `AIGC_Detection_Report_${Date.now()}.pdf`,
                    report_data: {
                        report_meta: {
                            report_id: reportId,
                            generated_at: new Date().toISOString(),
                            system_version: 'AIGC-Guard-v1.0',
                            user_plan: planKey,
                        },
                        detection_summary: {
                            target_file: file?.name || 'unknown',
                            detection_result: result?.has_watermark ? 'WATERMARK_FOUND' : 'NO_WATERMARK',
                            risk_level: result?.analysis?.risk_level?.level || result?.analysis?.risk_level || 'UNKNOWN',
                            risk_description: result?.analysis?.risk_level?.description || '',
                            overall_confidence: typeof result?.confidence === 'number' ? result.confidence * 100 : 0,
                            five_dim_score: result?.five_dim_score || null,
                            confidence_level: result?.confidence_level || undefined,
                            legal_description: result?.legal_description || undefined,
                        },
                        matching_analysis: {
                            best_match: result?.best_match || result?.matched_asset || undefined,
                            top_candidates: Array.isArray(result?.match_candidates) ? result.match_candidates.slice(0, 5) : undefined,
                            total_candidates: result?.match_candidates?.length || 0,
                        },
                        legal_assessment: result?.legal_assessment || {
                            verdict: result?.analysis?.verdict || '',
                            evidence_strength: result?.analysis?.evidence_strength?.total_strength || 0,
                            evidence_chain: result?.analysis?.evidence_strength?.evidence_list || [],
                            is_admissible: (result?.analysis?.evidence_strength?.total_strength || 0) >= 60,
                            applicable_laws: ['著作权法', '电子签名法', '网络安全法'],
                        },
                        recommendations: {
                            actions: result?.analysis?.suggested_action || [],
                            priority: result?.analysis?.risk_level?.level === 'HIGH' ? 'HIGH' : result?.analysis?.risk_level?.level === 'MEDIUM' ? 'MEDIUM' : 'LOW',
                        },
                        visualizations: {
                            bit_heatmap: result?.visualizations?.bit_heatmap || undefined,
                            timeline: result?.visualizations?.timeline || result?.visualizations?.evidence_timeline || undefined,
                        },
                    },
                })
            });
            if (!res.ok) throw new Error('Backend PDF export failed');
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `AIGC_Detection_Report_${Date.now()}.pdf`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.log('Backend PDF export failed, using frontend print fallback');
            if (!mdForExport) {
                pushToast('导出失败：请稍后重试', 'error');
                return;
            }
            printPdfFrontend(mdForExport, `AIGC检测报告 - ${file?.name || 'Unknown'}`);
        } finally {
            setPdfExporting(false);
        }
    };

    const normalizePlan = (plan: any): string => getPlanKey(plan);

    // 获取置信度阈值建议（根据套餐等级）
    const getConfidenceThresholdAdvice = (confidenceValue: number | null, planKey: string) => {
        if (confidenceValue === null) return null;
        
        const pct = confidenceValue * 100;
        const isProOrEnterprise = ['pro', 'enterprise'].includes(planKey);
        
        // 专业版/企业版：更严格的阈值策略
        if (isProOrEnterprise) {
            if (pct >= 85) {
                return {
                    level: 'high',
                    title: '⚠️ 高置信度侵权（专业版严格阈值 ≥85%）',
                    description: '建议立即维权：匹配度极高，证据链完整，可直接导出DMCA下架通知函。',
                    action: 'immediate',
                    color: 'text-red-400 border-red-500/30 bg-red-500/10'
                };
            } else if (pct >= 70) {
                return {
                    level: 'medium',
                    title: '⚡ 中置信度疑似侵权（专业版严格阈值 70-85%）',
                    description: '建议人工复核：相似度较高，建议结合上链凭证（TxID/时间戳）进行二次确认。',
                    action: 'review',
                    color: 'text-orange-400 border-orange-500/30 bg-orange-500/10'
                };
            } else {
                return {
                    level: 'low',
                    title: '✓ 低置信度安全范围（专业版严格阈值 <70%）',
                    description: '通常为安全范围：相似度较低，但仍建议为作品添加数字指纹以防未来被盗用。',
                    action: 'safe',
                    color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
                };
            }
        }
        
        // 免费版/个人版：基础阈值策略
        if (pct >= 80) {
            return {
                level: 'high',
                title: '⚠️ 高置信度侵权（≥80%）',
                description: '建议直接维权：匹配度较高，可导出报告并结合上链凭证进行维权。',
                action: 'immediate',
                color: 'text-red-400 border-red-500/30 bg-red-500/10'
            };
        } else if (pct >= 60) {
            return {
                level: 'medium',
                title: '⚡ 中置信度疑似侵权（60-80%）',
                description: '建议人工复核：相似度中等，建议查看完整溯源鉴定报告进行确认。',
                action: 'review',
                color: 'text-orange-400 border-orange-500/30 bg-orange-500/10'
            };
        } else {
            return {
                level: 'low',
                title: '✓ 低置信度安全范围（<60%）',
                description: '通常为安全范围：暂未发现明显侵权特征，建议为作品添加数字指纹保护。',
                action: 'safe',
                color: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
            };
        }
    };

    // 检查是否有严格阈值策略权限
    const hasStrictThresholdAccess = (planKey: string) => {
        return ['pro', 'enterprise'].includes(planKey);
    };

    const planKey = normalizePlan(user?.plan);
    const isFreePlan = !!user && planKey === 'free';

    const openUpgradeModal = (featureName: string) => {
        setUpgradeFeatureName(featureName);
        setUpgradeModalOpen(true);
    };

    const hasFeatureAccess = (feature: 'report_markdown' | 'report_ai' | 'export_pdf' | 'dmca') => {
        if (!user) return false;
        if (user.role === 'admin') return true;
        return !!PLAN_CONFIG[getPlanKey(user?.plan)]?.features?.[feature];
    };

    const requireFeatureAccess = (feature: 'report_markdown' | 'report_ai' | 'export_pdf' | 'dmca', featureName: string) => {
        if (!hasFeatureAccess(feature)) {
            openUpgradeModal(featureName);
            return false;
        }
        return true;
    };

    const handleBatchFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const newFiles = Array.from(e.target.files).map(f => ({
                id: Math.random().toString(36).substr(2, 9),
                file: f,
                status: 'pending' as const
            }));
            setMonitorBatchFiles((prev: BatchFile[]) => [...prev, ...newFiles]);
        }
    };

    const handleBatchDrop = (e: React.DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer.files) {
            const newFiles = Array.from(e.dataTransfer.files).map(f => ({
                id: Math.random().toString(36).substr(2, 9),
                file: f,
                status: 'pending' as const
            }));
            setMonitorBatchFiles((prev: BatchFile[]) => [...prev, ...newFiles]);
        }
    };

    const startBatchDetection = async () => {
        setBatchProcessing(true);
        setBatchProgress(0);
        setCurrentBatchIndex(0);
        setBatchInlineNotice(null);
        const candidates = batchFiles.filter((f) => f.status !== 'done');
        const total = candidates.length;

        // 并发数：5 (批量检测最佳性能)
        const concurrency = 5;
        let nextIndex = 0;
        let completed = 0;
        let aborted = false;

        const runOne = async () => {
            while (true) {
                if (aborted) return;
                const idx = nextIndex;
                nextIndex += 1;
                if (idx >= candidates.length) return;

                const item = candidates[idx];
                setCurrentBatchIndex(idx);

                setMonitorBatchFiles((prev: BatchFile[]) =>
                    prev.map((f) => (f.id === item.id ? { ...f, status: 'processing' } : f))
                );

                const formData = new FormData();
                formData.append('image', item.file);

                try {
                    const res: any = await watermark.detect(formData);
                    const anyRes: any = res;
                    setMonitorBatchFiles((prev: BatchFile[]) =>
                        prev.map((f) => (f.id === item.id ? { ...f, status: 'done', result: res } : f))
                    );
                    // 同步写入本地检测记录（兼容 matched_asset / best_match）
                    const batchMatchedAsset = anyRes?.matched_asset || (anyRes?.best_match ? {
                        id: anyRes.best_match.author_id || anyRes.best_match.id,
                        user_id: anyRes.best_match.author_id,
                        author_name: anyRes.best_match.author_name || '未知',
                        filename: anyRes.best_match.filename || '',
                        timestamp: anyRes.best_match.creation_time || '',
                        similarity: anyRes.best_match.similarity || 0,
                    } : null);
                    const batchConfidence = anyRes?.confidence || (anyRes?.best_match?.similarity ? anyRes.best_match.similarity / 100 : 0);
                    saveDetectionRecord({
                        type: 'image',
                        filename: item.file?.name,
                        hasWatermark: anyRes?.has_watermark,
                        matchedAsset: batchMatchedAsset,
                        confidence: batchConfidence,
                        message: anyRes?.message,
                        five_dim_score: anyRes?.five_dim_score,
                        confidence_level: anyRes?.confidence_level,
                        legal_description: anyRes?.legal_description,
                        legal_assessment: anyRes?.legal_assessment,
                        visualizations: anyRes?.visualizations,
                        analysis: anyRes?.analysis,
                        match_summary: anyRes?.match_summary,
                    });
                    syncCloudDetectionRecords({ silent: true });
                    window.dispatchEvent(new Event('quota-updated'));
                } catch (err: any) {
                    const status = err?.response?.status;
                    const detail = err?.response?.data?.detail;
                    if (status === 402) {
                        aborted = true;
                        const msg = typeof detail === 'string' && detail.trim().length > 0 ? detail : '您的检测额度已用完，请升级后继续。';
                        setBatchInlineNotice(msg);
                        // 第一提示在当前页展示，然后再弹窗
                        window.setTimeout(() => openUpgradeModal('批量检测额度不足'), 400);
                    }
                    setMonitorBatchFiles((prev: BatchFile[]) =>
                        prev.map((f) => (f.id === item.id ? { ...f, status: 'error', error: 'Failed' } : f))
                    );
                } finally {
                    completed += 1;
                    setBatchProgress(Math.round((completed / Math.max(total, 1)) * 100));
                }
            }
        };

        const workers = Array.from({ length: Math.min(concurrency, total) }, () => runOne());
        await Promise.all(workers);
        setBatchProgress(100);
        setBatchProcessing(false);
    };

    return (
        <div className="max-w-5xl mx-auto space-y-8 animate-enter">
            {detectModalOpen && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50 animate-enter">
                    <div className="glass-card w-full max-w-md border-purple-500/30">
                        <div className="p-6 border-b border-white/10 flex items-center justify-between bg-purple-500/10 rounded-t-2xl">
                            <div className="text-lg font-bold text-white flex items-center gap-2">
                                <Loader2 className="animate-spin" size={18} />
                                {isAsyncMode ? '异步检测中' : '正在检测'}
                            </div>
                            <div className="text-xs text-gray-400">
                                {isAsyncMode ? `进度 ${asyncProgress.toFixed(1)}%` : '请耐心等待'}
                            </div>
                        </div>
                        <div className="p-6 space-y-4">
                            {/* 异步进度条模式 */}
                            {isAsyncMode ? (
                                <>
                                    <div className="space-y-3">
                                        <div className="flex justify-between items-center">
                                            <span className="text-sm text-gray-300 font-medium">{asyncStage}</span>
                                            <span className="text-sm text-purple-400 font-bold">{asyncProgress.toFixed(1)}%</span>
                                        </div>
                                        <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
                                            <div 
                                                className="h-full bg-gradient-to-r from-purple-500 via-pink-500 to-purple-500 transition-all duration-500 ease-out"
                                                style={{ width: `${Math.min(asyncProgress, 100)}%` }}
                                            />
                                        </div>
                                        <p className="text-xs text-gray-500">{asyncDetail || '正在处理中...'}</p>
                                    </div>
                                    
                                    <div className="flex items-center gap-2 text-xs text-gray-500 bg-black/20 p-3 rounded-lg">
                                        <Activity size={14} className="text-purple-400" />
                                        <span>异步检测模式：您可以关闭此窗口，稍后查看结果</span>
                                    </div>
                                    
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => {
                                                clearProgressTimer();
                                                setDetectModalOpen(false);
                                            }}
                                            className="flex-1 px-4 py-2 bg-gray-700 text-gray-300 rounded-lg text-sm hover:bg-gray-600 transition-colors"
                                        >
                                            后台运行
                                        </button>
                                        {asyncTaskId && (
                                            <button
                                                onClick={async () => {
                                                    try {
                                                        await watermark.cancelTask(asyncTaskId);
                                                        pushToast('任务已取消', 'info');
                                                        clearProgressTimer();
                                                        setDetectModalOpen(false);
                                                        setLoading(false);
                                                    } catch (e) {
                                                        pushToast('取消失败', 'error');
                                                    }
                                                }}
                                                className="px-4 py-2 bg-red-500/20 text-red-400 rounded-lg text-sm hover:bg-red-500/30 transition-colors"
                                            >
                                                取消
                                            </button>
                                        )}
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="text-sm text-gray-200 mb-2">{detectStatusText}</div>
                                    <div className="text-xs text-gray-500">检测过程将进行特征提取与云端指纹库匹配，耗时取决于网络与服务器负载。</div>
                                    <div className="mt-5 h-2 bg-gray-800 rounded-full overflow-hidden">
                                        <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 animate-pulse" style={{ width: '70%' }} />
                                    </div>
                                    {isFreePlan && (
                                        <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                                            <p className="text-xs text-amber-400">升级个人版/专业版可解锁：AI 报告、PDF 导出、DMCA 法务文书等</p>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Unified Report Viewer Modal */}
            {portalTarget && viewerOpen &&
                createPortal(
                    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-[90]" onClick={() => setViewerOpen(false)}>
                        <div className="glass-card w-full max-w-3xl border-blue-500/30 max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                            <div className="p-6 border-b border-white/10 flex justify-between items-center bg-blue-500/10 rounded-t-2xl flex-shrink-0">
                                <div>
                                    <div className="text-lg font-bold text-white flex items-center gap-2">
                                        <FileText className="text-blue-400" size={20} />
                                        {viewerTitle}
                                    </div>
                                <div className="text-xs text-gray-400 mt-1">
                                        {hasFeatureAccess('export_pdf')
                                            ? '统一预览 · 支持导出 PDF / HTML / Markdown'
                                            : '统一预览 · 在线查看（导出功能需升级）'}
                                    </div>
                                </div>
                                <button onClick={() => setViewerOpen(false)} className="text-gray-400 hover:text-white">
                                    <XCircle size={22} />
                                </button>
                            </div>
                            <div className="p-6 overflow-y-auto flex-1 min-h-0">
                                <div className="rounded-2xl overflow-hidden border border-white/10">
                                    <div dangerouslySetInnerHTML={{ __html: viewerHtml }} />
                                </div>
                            </div>
                            <div className="p-4 border-t border-white/10 flex gap-3 bg-black/20 flex-shrink-0">
                                {hasFeatureAccess('export_pdf') ? (
                                    <>
                                        <button
                                            onClick={() => exportPdfViaPrint(viewerHtml, viewerTitle || 'Report')}
                                            className="flex-1 min-w-[120px] flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl hover:shadow-lg hover:shadow-emerald-500/20 transition-all font-bold text-sm"
                                        >
                                            <BadgeCheck size={16} />导出 PDF
                                        </button>
                                        <button
                                            onClick={() => exportHtmlFile(viewerHtml, `AIGC_${viewerType}_${Date.now()}.html`)}
                                            className="flex-1 min-w-[120px] px-4 py-2.5 bg-gradient-to-r from-sky-600 to-indigo-600 text-white rounded-xl hover:shadow-lg hover:shadow-sky-500/20 transition-all text-sm"
                                        >
                                            导出 HTML
                                        </button>
                                        <button
                                            onClick={() => {
                                                downloadMarkdown(viewerMarkdown || '', `AIGC_${viewerType}_${Date.now()}.md`);
                                                pushToast('已下载', 'success');
                                            }}
                                            className="flex-1 min-w-[120px] px-4 py-2.5 bg-gradient-to-r from-fuchsia-600 to-purple-600 text-white rounded-xl hover:shadow-lg hover:shadow-fuchsia-500/20 transition-all text-sm"
                                        >
                                            下载 Markdown
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        onClick={() => openUpgradeModal('报告导出（PDF / HTML / Markdown）')}
                                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-700/60 text-gray-400 border border-gray-600/50 rounded-xl transition-all text-sm hover:bg-gray-700/80"
                                    >
                                        <Download size={16} />
                                        导出功能需升级至个人版及以上
                                    </button>
                                )}
                                <button onClick={() => setViewerOpen(false)} className="px-4 py-2.5 bg-white/5 border border-white/10 text-gray-300 rounded-xl hover:bg-white/10 transition-all text-sm">
                                    关闭
                                </button>
                            </div>
                        </div>
                    </div>,
                    portalTarget
                )}

            {/* Header & Mode Switch */}
            <div className="text-center mb-6 sm:mb-8 relative flex flex-col md:flex-row justify-between items-start md:items-center gap-4 sm:gap-6">
                <div className="text-left">
                    <h1 className="text-2xl sm:text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-500 mb-2 inline-flex items-center gap-3">
                        <Scan className="text-purple-400 shrink-0" size={28} />
                        全网侵权监测 (Detection)
                    </h1>
                    <p className="text-gray-400 max-w-2xl text-sm">
                        溯源模式：提取隐藏数字指纹，在全球数据库中检索匹配原始版权信息。
                    </p>
                </div>

                <div className="w-full md:w-auto flex flex-col sm:flex-row items-stretch sm:items-center gap-3 bg-black/40 p-2 rounded-2xl border border-white/10 shadow-[0_0_0_1px_rgba(255,255,255,0.06)]">
                    <button
                        onClick={() => setShowHistory(true)}
                        className="flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-xl border border-white/15 bg-white/5 text-sm font-semibold text-gray-200 hover:bg-white/10 hover:border-white/25 transition-all"
                    >
                        <History size={14} />
                        检测记录（{detectionHistory.length}）
                        <ChevronRight size={14} className="text-gray-500" />
                    </button>

                    <div className="flex flex-1 bg-black/30 p-1 rounded-xl border border-white/10">
                        <button
                            onClick={() => setMode('single')}
                            className={`flex-1 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all flex items-center justify-center gap-1.5 sm:gap-2 ${mode === 'single' ? 'bg-purple-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                        >
                            <FileImage size={14} /> 单图
                        </button>
                        <button
                            onClick={() => setMode('batch')}
                            className={`flex-1 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all flex items-center justify-center gap-1.5 sm:gap-2 ${mode === 'batch' ? 'bg-pink-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                        >
                            <Layers size={14} /> 批量
                        </button>
                        <button
                            onClick={() => setMode('text')}
                            className={`flex-1 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all flex items-center justify-center gap-1.5 sm:gap-2 ${mode === 'text' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                        >
                            <FileText size={14} /> 文本
                        </button>
                        <button
                            onClick={() => setMode('video')}
                            className={`flex-1 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all flex items-center justify-center gap-1.5 sm:gap-2 ${mode === 'video' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                        >
                            <Film size={14} /> 视频
                        </button>
                    </div>
                </div>
            </div>

            {mode === 'single' ? (
                // === Single Mode ===
                <>
                    {/* 技术说明 */}
                    <div className="mb-4 p-4 bg-purple-500/5 border border-purple-500/20 rounded-xl">
                        <div className="flex items-start gap-3">
                            <Fingerprint className="text-purple-400 shrink-0 mt-0.5" size={16} />
                            <div>
                                <div className="text-sm text-purple-300 font-medium mb-1">DCT频域盲水印检测技术</div>
                                <p className="text-xs text-gray-400 leading-relaxed">
                                    采用离散余弦变换(DCT)将图像转换到频域，通过量化索引调制(QIM)提取隐藏的数字指纹。支持抗JPEG压缩、裁剪等攻击，无需原图即可盲提取256位SHA256哈希指纹。
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="glass-card p-4 sm:p-6 md:p-10 flex flex-col items-center gap-6 sm:gap-8 relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-purple-500 to-transparent opacity-50"></div>
                        <div className="w-full max-w-md">
                            {!file ? (
                                <label 
                                    className="flex flex-col items-center justify-center h-48 border-2 border-dashed border-gray-600 rounded-2xl cursor-pointer hover:border-purple-400 hover:bg-white/5 transition-all group"
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={handleSingleDrop}
                                >
                                    <Upload size={40} className="text-gray-500 group-hover:text-purple-400 transition-colors mb-4" />
                                    <span className="text-gray-300 font-medium">上传待检测图片</span>
                                    <span className="text-gray-500 text-xs mt-2">支持拖拽上传</span>
                                    <input type="file" ref={singleInputRef} onChange={handleFileChange} className="hidden" accept="image/*" />
                                </label>
                            ) : (
                                <div className="relative rounded-2xl overflow-hidden border-2 border-purple-500/30">
                                    <img 
                                        src={previewUrl || ''} 
                                        alt="Preview" 
                                        className="w-full h-48 object-contain bg-black/40"
                                    />
                                    <button
                                        onClick={clearSingleFile}
                                        className="absolute top-2 right-2 p-2 bg-black/60 text-white rounded-full hover:bg-red-500/80 transition-colors"
                                    >
                                        <XCircle size={18} />
                                    </button>
                                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 py-2 px-4">
                                        <span className="text-white text-sm truncate">{file.name}</span>
                                    </div>
                                </div>
                            )}
                        </div>

                        <button
                            onClick={handleDetect}
                            disabled={!file || loading}
                            className={`px-12 py-4 rounded-xl font-bold text-lg flex items-center gap-3 transition-all
                                ${!file || loading
                                    ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                                    : 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-500/30 hover:scale-105'
                                }
                            `}
                        >
                            {loading ? (
                                <>
                                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    正在全网溯源...
                                </>
                            ) : (
                                <>
                                    <Search size={20} />
                                    开始溯源匹配
                                </>
                            )}
                        </button>
                    </div>

                    {result && (
                        <div className="glass-card p-4 sm:p-6 md:p-8 animate-enter border-t-4 border-t-purple-500">
                            <div className="flex flex-col sm:flex-row items-start gap-4 sm:gap-6">
                                <div className={`p-3 sm:p-4 rounded-full shrink-0 ${result.has_watermark ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                                    {result.has_watermark ? <BadgeCheck size={32} /> : <XCircle size={32} />}
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-xl font-bold text-white mb-2">
                                        {result.has_watermark ? '检测到数字指纹' : '未发现数字指纹'}
                                    </h3>
                                    {result.confidence_level && (
                                        <div className="mb-3">
                                            <span className={`inline-flex items-center px-3 py-1.5 rounded-xl border text-xs font-bold ${getConfidenceBadgeClass(String(result.confidence_level))}`}>
                                                {String(result.confidence_level)}
                                            </span>
                                        </div>
                                    )}

                                    {/* 根据套餐等级显示置信度阈值建议 */}
                                    {result.has_watermark && (() => {
                                        const confidenceValue = typeof result.confidence === 'number'
                                            ? result.confidence
                                            : (typeof result.best_match?.similarity === 'number' ? result.best_match.similarity / 100 : null);
                                        if (confidenceValue === null) return null;
                                        
                                        const advice = getConfidenceThresholdAdvice(confidenceValue, planKey);
                                        if (!advice) return null;
                                        
                                        return (
                                            <div className={`mb-4 p-4 rounded-xl border ${advice.color}`}>
                                                <div className="flex items-start gap-3">
                                                    <div className="flex-1">
                                                        <div className="font-bold text-sm mb-1">{advice.title}</div>
                                                        <div className="text-xs opacity-90 leading-relaxed">{advice.description}</div>
                                                        {hasStrictThresholdAccess(planKey) && (
                                                            <div className="mt-2 text-[10px] opacity-70 flex items-center gap-1">
                                                                <Zap size={10} />
                                                                专业版严格阈值策略已启用（≥85%高置信度 / ≥70%中置信度）
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })()}
                                    <p className="text-gray-400 mb-6">{result.message}</p>

                                    {/* 无指纹检测结果的安全提示 */}
                                    {!result.has_watermark && (
                                        <div className="mb-6 p-5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
                                            <div className="flex items-start gap-4">
                                                <div className="p-3 bg-emerald-500/20 rounded-full shrink-0">
                                                    <BadgeCheck className="text-emerald-400" size={24} />
                                                </div>
                                                <div className="flex-1">
                                                    <div className="text-emerald-400 font-bold mb-2">
                                                        安全检测结果
                                                    </div>
                                                    <p className="text-sm text-gray-300 leading-relaxed mb-4">
                                                        该照片「{file?.name || '未知文件'}」已完成全网溯源检测，
                                                        <span className="text-emerald-400 font-semibold">暂未发现数字指纹信息</span>，
                                                        目前相对安全。但为防止未来被盗用，建议立即为作品添加数字指纹保护。
                                                    </p>
                                                    <div className="flex flex-wrap gap-3">
                                                        <button
                                                            onClick={() => window.location.href = '/fingerprint'}
                                                            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-xl hover:shadow-lg hover:shadow-cyan-500/20 transition-all font-bold text-sm"
                                                        >
                                                            <Fingerprint size={16} />
                                                            去嵌入指纹
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                const fileName = file?.name || 'Unknown';
                                                                const fileSize = ((file?.size || 0) / 1024).toFixed(2);
                                                                const timestamp = new Date().toLocaleString();
                                                                const certId = Date.now();
                                                                const htmlContent = `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AIGCGuard Detection Certificate - ${fileName}</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { 
        font-family: 'Courier New', 'Arial', sans-serif;
        background: #0f172a;
        color: #e2e8f0;
        padding: 0;
      }
      .page {
        width: 210mm;
        height: 297mm;
        background: white;
        color: #0f172a;
        margin: 0 auto;
        padding: 20mm;
        box-shadow: 0 0 20px rgba(0,0,0,0.3);
        position: relative;
      }
      .header {
        background: linear-gradient(90deg, #34d399 0%, #10b981 100%);
        color: #0f172a;
        padding: 20px;
        text-align: center;
        border-radius: 8px;
        margin-bottom: 25px;
      }
      .header h1 {
        font-size: 24px;
        margin-bottom: 5px;
        font-weight: bold;
      }
      .header p {
        font-size: 12px;
        opacity: 0.8;
      }
      .section {
        margin-bottom: 20px;
        padding: 15px;
        border: 1px solid #34d399;
        border-radius: 6px;
        background: #f9fafb;
      }
      .section-title {
        color: #34d399;
        font-weight: bold;
        margin-bottom: 10px;
        font-size: 13px;
      }
      .info-row {
        display: flex;
        margin-bottom: 8px;
        font-size: 12px;
      }
      .info-label {
        font-weight: bold;
        width: 120px;
        color: #0f172a;
      }
      .info-value {
        flex: 1;
        word-break: break-all;
        color: #374151;
      }
      .footer {
        text-align: center;
        padding-top: 20px;
        border-top: 1px solid #34d399;
        margin-top: 30px;
        font-size: 11px;
        color: #6b7280;
      }
      .actions {
        display: flex;
        gap: 10px;
        margin-bottom: 20px;
        justify-content: center;
      }
      button {
        padding: 10px 20px;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-weight: bold;
        font-size: 12px;
      }
      .btn-download {
        background: #34d399;
        color: white;
      }
      .btn-print {
        background: #60a5fa;
        color: white;
      }
      .btn-close {
        background: #ef4444;
        color: white;
      }
      @media print {
        body { background: white; }
        .page { box-shadow: none; width: 100%; height: 100%; margin: 0; padding: 0; }
        .actions { display: none; }
      }
    </style>
  </head>
  <body>
    <div class="actions">
      <button class="btn-download" onclick="downloadPDF()">📥 下载 PDF</button>
      <button class="btn-print" onclick="window.print()">🖨️ 打印</button>
      <button class="btn-close" onclick="window.close()">✕ 关闭</button>
    </div>
    <div class="page">
      <div class="header">
        <h1>📚 AIGCGuard 数字内容检测凭证</h1>
        <p>Digital Content Fingerprint Detection Certificate</p>
      </div>
      
      <div class="section">
        <div class="section-title">📋 文件信息 | FILE INFORMATION</div>
        <div class="info-row">
          <div class="info-label">文件名称:</div>
          <div class="info-value">${fileName}</div>
        </div>
        <div class="info-row">
          <div class="info-label">文件大小:</div>
          <div class="info-value">${fileSize} KB</div>
        </div>
        <div class="info-row">
          <div class="info-label">检测时间:</div>
          <div class="info-value">${timestamp}</div>
        </div>
      </div>
      
      <div class="section">
        <div class="section-title">✓ 检测结果 | DETECTION RESULT</div>
        <div class="info-row">
          <div class="info-label">检测状态:</div>
          <div class="info-value">✓ 未检测到数字指纹 (No Watermark Found)</div>
        </div>
        <div class="info-row">
          <div class="info-label">安全等级:</div>
          <div class="info-value">100% 安全 (Safe)</div>
        </div>
        <div class="info-row">
          <div class="info-label">建议:</div>
          <div class="info-value">为该作品添加数字指纹以获得更好的保护</div>
        </div>
      </div>
      
      <div class="section">
        <div class="section-title">🔐 法律意见 | LEGAL OPINION</div>
        <div class="info-row">
          <div class="info-value">该文件目前不存在明显的侵权特征。然而，为进一步保证你的法律权益，我们强烈建议立即为该作品添加数字指纹。</div>
        </div>
      </div>
      
      <div class="footer">
        <p>🔑 凭证 ID: ${certId}</p>
        <p>📅 日期: 2026-02-24 | 发证机构: AIGCGuard.top</p>
        <p style="margin-top: 10px; font-size: 10px; opacity: 0.7;">本凭证可作为法律根据使用。验证真伪：<a href="https://aigcguard.top/verify" style="color: #34d399;">aigcguard.top/verify</a></p>
      </div>
    </div>
    
    <script>
      function downloadPDF() {
        // 简易 PDF 生成：使用 html2pdf 库
        const element = document.querySelector('.page');
        const opt = {
          margin: 0,
          filename: 'AIGCGuard_Certificate_${certId}.pdf',
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2 },
          jsPDF: { format: 'a4', orientation: 'portrait' }
        };
        
        // 如果没有 html2pdf 库，使用浏览器自整下载功能
        if (typeof html2pdf === 'undefined') {
          const blob = new Blob([document.documentElement.outerHTML], { type: 'text/html' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'AIGCGuard_Certificate_${certId}.html';
          a.click();
          alert('�\udc4b 打印或使用浏览器菜单下载为 PDF');
        }
      }
    </script>
  </body>
</html>
`;
                                                                const newWindow = window.open();
                                                                if (newWindow) {
                                                                    newWindow.document.write(htmlContent);
                                                                    newWindow.document.close();
                                                                }
                                                            }}
                                                            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl hover:shadow-lg hover:shadow-emerald-500/20 transition-all font-bold text-sm"
                                                        >
                                                            <FileText size={16} />
                                                            💺 轻松下载凭证
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {result.is_historical && (
                                        <div className="mb-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl animate-pulse">
                                            <div className="flex items-center gap-2 text-blue-400 font-bold mb-1 font-sans">
                                                <Zap size={16} /> 发现匹配的历史指纹特征
                                            </div>
                                            <p className="text-xs text-blue-400/70">
                                                该特征点已被算法锁定为【合规版权】，但其资产档案属于旧版迁移数据。您可以联系顾问申请一键关联至您的当前账户。
                                            </p>
                                        </div>
                                    )}

                                    {(() => {
                                        const asset = result.matched_asset || result.best_match;
                                        if (!asset) return null;
                                        const token = localStorage.getItem('access_token') || '';
                                        const assetFilename = asset.filename || asset.original_filename || asset.file_name || asset.name;
                                        const assetPreviewUrl = asset.preview_url || asset.thumbnail_url || asset.cover_url;
                                        const confidenceValue = typeof result.confidence === 'number'
                                            ? result.confidence
                                            : (typeof asset.similarity === 'number' ? asset.similarity / 100 : null);
                                        const confidencePct = confidenceValue !== null
                                            ? `${(confidenceValue * 100).toFixed(2)}%`
                                            : (typeof asset.similarity === 'number' ? `${asset.similarity.toFixed(2)}%` : '--');
                                        const confidenceClass = confidenceValue === null
                                            ? 'text-gray-400'
                                            : confidenceValue >= 0.8
                                                ? 'text-red-400'
                                                : confidenceValue >= 0.6
                                                    ? 'text-orange-400'
                                                    : 'text-emerald-400';
                                        return (
                                            <>
                                                <div className="bg-white/5 rounded-xl p-6 border border-white/10 flex flex-col md:flex-row gap-6 relative overflow-hidden">
                                                    {asset.is_cloud_record && (
                                                        <div className="absolute top-2 right-2 px-2 py-0.5 bg-cyan-600/20 text-cyan-400 text-[10px] font-bold rounded border border-cyan-500/30">
                                                            Cloud Proof
                                                        </div>
                                                    )}
                                                    <div className="w-full md:w-32 h-32 rounded-lg overflow-hidden border border-white/10 bg-black/40 flex-shrink-0">
                                                        <AssetThumbnail
                                                            src={
                                                                assetPreviewUrl
                                                                    ? `${String(assetPreviewUrl)}${String(assetPreviewUrl).includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
                                                                    : assetFilename
                                                                        ? `/api/image/${encodeURIComponent(String(assetFilename))}?token=${encodeURIComponent(token)}`
                                                                        : ''
                                                            }
                                                            className="w-full h-full object-cover"
                                                        />
                                                    </div>
                                                    <div className="flex-1">
                                                        <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">匹配到的原始资产信息</h4>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-sm">
                                                            <div>
                                                                <span className="text-gray-500 block mb-1">原始文件名</span>
                                                                <span className="text-white font-mono break-all">{assetFilename || '未知'}</span>
                                                            </div>
                                                            <div>
                                                                <span className="text-gray-500 block mb-1">版权所有者</span>
                                                                <span className="text-purple-400 font-bold">{asset.author_name || asset.user_id || '未知'}</span>
                                                            </div>
                                                            <div>
                                                                <span className="text-gray-500 block mb-1">确权时间</span>
                                                                <span className="text-white">{asset.timestamp || asset.creation_time || '未知'}</span>
                                                            </div>
                                                            <div>
                                                                <span className="text-gray-500 block mb-1">置信度 (Confidence)</span>
                                                                <span className={`${confidenceClass} font-bold`}>{confidencePct}</span>
                                                            </div>
                                                        </div>
                                                        {!assetPreviewUrl && !assetFilename && (
                                                            <div className="mt-3 text-xs text-gray-500">
                                                                该匹配记录未返回原图预览地址，当前仅展示元数据。
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="mt-4 space-y-3">
                                                    <div className="flex flex-wrap gap-3 justify-center">
                                                        <button
                                                            onClick={() => openUnifiedViewer('provenance', { source: 'single' })}
                                                            disabled={viewerExporting}
                                                            className="flex items-center justify-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:shadow-lg hover:shadow-blue-500/20 transition-all font-bold text-sm disabled:opacity-50"
                                                        >
                                                            {viewerExporting && viewerType === 'provenance' ? (
                                                                <Loader2 size={16} className="animate-spin" />
                                                            ) : (
                                                                <FileText size={16} />
                                                            )}
                                                            查看溯源鉴定报告
                                                        </button>

                                                        <button
                                                            onClick={() => openUnifiedViewer('ai', { source: 'single' })}
                                                            disabled={viewerExporting}
                                                            className={`flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl hover:shadow-lg transition-all font-bold text-sm disabled:opacity-50 ${
                                                                hasFeatureAccess('report_ai')
                                                                    ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:shadow-violet-500/20'
                                                                    : 'bg-gray-700/60 text-gray-400 border border-gray-600/50'
                                                            }`}
                                                        >
                                                            {viewerExporting && viewerType === 'ai' ? (
                                                                <Loader2 size={16} className="animate-spin" />
                                                            ) : (
                                                                <Zap size={16} />
                                                            )}
                                                            查看 AI 分析报告
                                                            {!hasFeatureAccess('report_ai') && <span className="text-[10px] ml-1 opacity-70">个人版+</span>}
                                                        </button>

                                                        <button
                                                            onClick={() => openUnifiedViewer('dmca', { source: 'single' })}
                                                            disabled={viewerExporting}
                                                            className={`flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm transition-all disabled:opacity-50 ${
                                                                hasFeatureAccess('dmca')
                                                                    ? 'bg-gradient-to-r from-red-500 to-rose-600 text-white hover:shadow-lg hover:shadow-red-500/20'
                                                                    : 'bg-gray-700/60 text-gray-400 border border-gray-600/50'
                                                            }`}
                                                        >
                                                            {viewerExporting && viewerType === 'dmca' ? (
                                                                <Loader2 size={16} className="animate-spin" />
                                                            ) : (
                                                                <FileText size={16} />
                                                            )}
                                                            查看 DMCA 公文
                                                            {!hasFeatureAccess('dmca') && <span className="text-[10px] ml-1 opacity-70">专业版+</span>}
                                                        </button>
                                                    </div>
                                                </div>
                                            </>
                                        );
                                    })()}

                                    {result.five_dim_score && (
                                        <div className="mt-6">
                                            <EvidenceVisualization 
                                                fiveDimScore={result.five_dim_score}
                                                bitHeatmap={result.visualizations?.bit_heatmap}
                                                timeline={result.visualizations?.timeline}
                                            />
                                        </div>
                                    )}

                                    {(result.match_candidates || result.best_match || result.analysis) && (
                                        <div className="mt-6 bg-black/30 border border-white/10 rounded-xl p-5">
                                            <div className="text-sm font-bold text-gray-200 mb-3">候选匹配与分析</div>

                                            {Array.isArray(result.match_candidates) && result.match_candidates.length > 0 && (
                                                <div className="space-y-2">
                                                    <div className="text-xs text-gray-500">Top 候选（最多显示 5 条）</div>
                                                    <div className="space-y-2">
                                                        {result.match_candidates.slice(0, 5).map((c: any, idx: number) => {
                                                            const sim = typeof c.similarity === 'number' ? c.similarity : 0;
                                                            const isHighRisk = sim >= 80;
                                                            const isMediumRisk = sim >= 60 && sim < 80;
                                                            return (
                                                                <div key={idx} className="flex items-center justify-between bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                                                                    <div className="min-w-0">
                                                                        <div className="text-xs text-gray-400">#{c.rank ?? (idx + 1)} · {c.match_method || '指纹匹配'}</div>
                                                                        <div className="text-sm text-white truncate">
                                                                            {c.author || c.author_name || '未知作者'}
                                                                        </div>
                                                                    </div>
                                                                    <div className="text-right flex-shrink-0">
                                                                        <div className={`text-sm font-bold ${isHighRisk ? 'text-red-400' : isMediumRisk ? 'text-orange-400' : 'text-emerald-400'}`}>
                                                                            {sim.toFixed ? `${sim.toFixed(2)}%` : `${sim}%`}
                                                                        </div>
                                                                        <div className="text-[10px] text-gray-500">{isHighRisk ? '高相似警示' : c.confidence_level || ''}</div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}

                                            {result.best_match && (
                                                <div className="mt-4">
                                                    <div className="text-xs text-gray-500 mb-2">最佳匹配（增强版字段）</div>
                                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                                                        <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                                                            <div className="text-xs text-gray-500">作者</div>
                                                            <div className="text-white font-bold break-all">{result.best_match.author_name || result.best_match.author_id || '未知'}</div>
                                                        </div>
                                                        <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                                                            <div className="text-xs text-gray-500">相似度</div>
                                                            {(() => {
                                                                const sim = typeof result.best_match.similarity === 'number' ? result.best_match.similarity : 0;
                                                                return (
                                                                    <div className={`font-bold ${sim >= 80 ? 'text-red-400' : sim >= 60 ? 'text-orange-400' : 'text-emerald-400'}`}>
                                                                        {sim.toFixed ? `${sim.toFixed(2)}%` : `${sim}%`}
                                                                    </div>
                                                                );
                                                            })()}
                                                        </div>
                                                        <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                                                            <div className="text-xs text-gray-500">确权时间</div>
                                                            <div className="text-white">{result.best_match.creation_time || '未知'}</div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            {result.analysis?.verdict ? (
                                                <div className="mt-4">
                                                    <div className="text-xs text-gray-500 mb-2">结论</div>
                                                    <div className="text-gray-200 text-sm leading-relaxed whitespace-pre-wrap">{result.analysis.verdict}</div>
                                                </div>
                                            ) : (
                                                <div className="mt-4">
                                                    <div className="text-xs text-gray-500 mb-2">专业鉴定结论</div>
                                                    <div className="text-gray-200 text-sm leading-relaxed space-y-2">
                                                        {(() => {
                                                            const confidenceValue = typeof result.confidence === 'number'
                                                                ? result.confidence
                                                                : (typeof result.best_match?.similarity === 'number' ? result.best_match.similarity / 100 : null);
                                                            const pctNum = confidenceValue !== null ? confidenceValue * 100 : 0;
                                                            const pct = confidenceValue !== null ? pctNum.toFixed(2) : '--';
                                                            
                                                            if (!result.has_watermark) {
                                                                return (
                                                                    <>
                                                                        <p><strong>检测结果：</strong>未发现数字指纹特征。</p>
                                                                        <p><strong>法律评估：</strong>该内容暂未被已知版权资产库识别，相对处于安全范围内。</p>
                                                                        <p><strong>建议措施：</strong></p>
                                                                        <ul className="list-disc list-inside ml-2 space-y-1 text-xs">
                                                                            <li>为您的原创作品立即添加数字指纹，建立版权证据链</li>
                                                                            <li>定期监测新发布内容，及时发现潜在侵权</li>
                                                                            <li>建议保留原创发布记录和创作过程凭证</li>
                                                                        </ul>
                                                                    </>
                                                                );
                                                            } else if (pctNum >= 85) {
                                                                return (
                                                                    <>
                                                                        <p><strong>检测结果：</strong>高度匹配（相似度 {pct}%）- 强烈建议立即采取行动。</p>
                                                                        <p><strong>法律评估：</strong>该内容与已知版权资产的匹配度极高，证据链完整。根据《著作权法》，原作品所有者享有完全的法律保护。</p>
                                                                        <p><strong>建议措施：</strong></p>
                                                                        <ul className="list-disc list-inside ml-2 space-y-1 text-xs">
                                                                            <li>立即导出本报告作为法律证据</li>
                                                                            <li>结合区块链确权凭证（TxID/时间戳）形成完整证据链</li>
                                                                            <li>专业版用户可直接生成DMCA下架通知函进行维权</li>
                                                                            <li>必要时联系法律顾问启动侵权诉讼程序</li>
                                                                        </ul>
                                                                    </>
                                                                );
                                                            } else if (pctNum >= 70) {
                                                                return (
                                                                    <>
                                                                        <p><strong>检测结果：</strong>中度匹配（相似度 {pct}%）- 建议进一步人工复核。</p>
                                                                        <p><strong>法律评估：</strong>该内容与已知版权资产存在较高相似度，但建议进行深入分析以确保证据的法律有效性。</p>
                                                                        <p><strong>建议措施：</strong></p>
                                                                        <ul className="list-disc list-inside ml-2 space-y-1 text-xs">
                                                                            <li>查看详细的溯源鉴定报告，核实关键特征点</li>
                                                                            <li>获取原作品的区块链确权凭证进行交叉验证</li>
                                                                            <li>收集侵权发布的具体时间、来源等背景信息</li>
                                                                            <li>可联系平台顾问进行专业评审后再决定维权策略</li>
                                                                        </ul>
                                                                    </>
                                                                );
                                                            } else {
                                                                return (
                                                                    <>
                                                                        <p><strong>检测结果：</strong>低度匹配（相似度 {pct}%）- 暂无明显侵权特征。</p>
                                                                        <p><strong>法律评估：</strong>相似度在可接受范围内，暂不构成明显侵权。可能为巧合或独立创作。</p>
                                                                        <p><strong>建议措施：</strong></p>
                                                                        <ul className="list-disc list-inside ml-2 space-y-1 text-xs">
                                                                            <li>持续监测后续发展，若相似度升高应及时告警</li>
                                                                            <li>为自己的作品添加数字指纹以获得更强的保护</li>
                                                                            <li>保持对行业动态的关注</li>
                                                                        </ul>
                                                                    </>
                                                                );
                                                            }
                                                        })()}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                </>
            ) : mode === 'batch' ? (
                // === Batch Mode ===
                <>
                <div className="space-y-4">
                    {batchInlineNotice && (
                        <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                            <div className="text-sm text-amber-300 font-medium mb-1">批量检测提示</div>
                            <div className="text-xs text-gray-300 leading-relaxed">{batchInlineNotice}</div>
                        </div>
                    )}
                    {/* 技术说明 */}
                    <div className="mb-4 p-4 bg-pink-500/5 border border-pink-500/20 rounded-xl">
                        <div className="flex items-start gap-3">
                            <Layers className="text-pink-400 shrink-0 mt-0.5" size={16} />
                            <div>
                                <div className="text-sm text-pink-300 font-medium mb-1">批量并发溯源检测</div>
                                <p className="text-xs text-gray-400 leading-relaxed">
                                    支持同时上传多张图片进行并发检测，自动提取数字指纹并在云端数据库中检索匹配结果。系统将自动保存检测记录，并支持一键导出报告与DMCA维权文书。
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="glass-card p-8 flex flex-col gap-6">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                        <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                            <Layers className="text-purple-400" />
                            批量监测队列
                        </h2>
                        <div className="flex flex-wrap gap-3 sm:gap-4 w-full sm:w-auto">
                            <button
                                onClick={() => setMonitorBatchFiles([])}
                                disabled={batchProcessing}
                                className="text-sm text-gray-400 hover:text-red-400 flex items-center gap-2"
                            >
                                <Trash2 size={16} /> 清空
                            </button>
                            <button
                                onClick={startBatchDetection}
                                disabled={batchFiles.length === 0 || batchProcessing}
                                className={`flex-1 sm:flex-none px-4 sm:px-6 py-2 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all
                                    ${batchFiles.length === 0 || batchProcessing
                                        ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                                        : 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg'
                                    }`}
                            >
                                {batchProcessing ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
                                {batchProcessing ? `扫描中 (${currentBatchIndex + 1}/${batchFiles.length})` : '开始批量扫描'}
                            </button>
                        </div>
                    </div>

                    {/* Progress Bar */}
                    {batchProcessing && (
                        <div className="space-y-2">
                            <div className="flex justify-between text-xs text-gray-400">
                                <span>批量扫描进度</span>
                                <span>{batchProgress}%</span>
                            </div>
                            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                                <div 
                                    className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"
                                    style={{ width: `${batchProgress}%` }}
                                />
                            </div>
                            <p className="text-xs text-gray-500">
                                正在处理第 {currentBatchIndex + 1} 张，共 {batchFiles.length} 张
                            </p>
                        </div>
                    )}

                    <div
                        className="border-2 border-dashed border-white/10 hover:border-pink-500/50 hover:bg-white/5 rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all"
                        onClick={() => batchInputRef.current?.click()}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={handleBatchDrop}
                    >
                        <Upload className="text-gray-400 mb-2" size={32} />
                        <p className="text-sm text-gray-300">点击或拖拽添加更多图片</p>
                        <input type="file" ref={batchInputRef} onChange={handleBatchFileChange} className="hidden" accept="image/*" multiple />
                    </div>

                    <div className="space-y-2">
                        {/* 批量分析按钮 - 有完成项时显示 */}
                        {batchFiles.some(f => f.status === 'done') && (
                            <div className="flex justify-end mb-4">
                                <button
                                    onClick={() => setBatchAnalysisOpen(true)}
                                    className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-lg text-sm font-medium flex items-center gap-2 hover:shadow-lg hover:shadow-blue-500/20 transition-all"
                                >
                                    <Layers size={16} />
                                    查看批量对比分析
                                </button>
                            </div>
                        )}
                        {batchFiles.map((item) => (
                            <div
                                key={item.id}
                                className="bg-white/5 rounded-lg p-4 flex items-center justify-between border border-white/5 hover:bg-white/10 transition-colors"
                                onClick={() => item.status === 'done' && item.result ? openBatchDetail(item) : undefined}
                                role={item.status === 'done' && item.result ? 'button' : undefined}
                                tabIndex={item.status === 'done' && item.result ? 0 : -1}
                            >
                                <div className="flex items-center gap-4">
                                    <div className="w-14 h-14 bg-black/40 rounded overflow-hidden flex-shrink-0 border border-white/10">
                                        {(item.file?.type || '').startsWith('image/') ? (
                                            <img
                                                src={URL.createObjectURL(item.file)}
                                                className="w-full h-full object-cover"
                                                onLoad={(e) => URL.revokeObjectURL((e.target as HTMLImageElement).src)}
                                                alt=""
                                            />
                                        ) : (
                                            <FileImage size={24} className="text-gray-500" />
                                        )}
                                    </div>
                                    <div>
                                        <div className="text-white font-medium">{item.file.name}</div>
                                        <div className="text-xs text-gray-500 font-mono">{(item.file.size / 1024).toFixed(1)} KB</div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-4">
                                    {item.status === 'pending' && <span className="text-xs bg-gray-800 px-2 py-1 rounded text-gray-400">等待中</span>}
                                    {item.status === 'processing' && <span className="text-xs text-blue-400 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> 分析中...</span>}
                                    {item.status === 'error' && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setBatchErrorDetailItem(item); setBatchErrorDetailOpen(true); }}
                                            className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 border border-red-500/20 bg-red-500/10 px-2 py-1 rounded-lg transition-colors"
                                        >
                                            <XCircle size={12} />
                                            失败 · 查看详情
                                        </button>
                                    )}

                                    {item.status === 'done' && item.result && (
                                        <div className="flex items-center gap-4">
                                            {item.result.has_watermark ? (
                                                <div className="flex items-center gap-2 text-green-400 bg-green-900/20 px-3 py-1 rounded-full">
                                                    <BadgeCheck size={14} />
                                                    <span className="text-xs font-bold">发现指纹</span>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2 text-gray-400 bg-gray-800 px-3 py-1 rounded-full">
                                                    <XCircle size={14} />
                                                    <span className="text-xs">未发现</span>
                                                </div>
                                            )}

                                            {item.result.confidence_level && (
                                                <span className={`px-2 py-1 rounded-lg border text-[10px] font-bold ${getConfidenceBadgeClass(String(item.result.confidence_level))}`}>
                                                    {String(item.result.confidence_level).split('-')[0]}
                                                </span>
                                            )}

                                            {item.result.matched_asset && (
                                                <div className="text-xs text-purple-400">
                                                    Author: {item.result.matched_asset.author_name}
                                                </div>
                                            )}
                                            <div className="text-[10px] text-gray-500">点击查看详情</div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        {batchFiles.length === 0 && (
                            <div className="text-center text-gray-600 py-10">暂无任务</div>
                        )}
                    </div>
                </div>
                </div>

                    {/* 批量对比分析弹窗 - 固定中间显示 */}
                    {portalTarget &&
                        batchAnalysisOpen &&
                        createPortal(
                            <div
                                className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-[60] animate-enter"
                                onClick={() => setBatchAnalysisOpen(false)}
                            >
                                <div
                                    className="glass-card w-full max-w-4xl border-cyan-500/30 max-h-[85vh] flex flex-col min-h-0 overflow-hidden"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <div className="p-6 border-b border-white/10 flex justify-between items-center bg-cyan-500/10 rounded-t-2xl flex-shrink-0">
                                        <div>
                                            <div className="text-lg font-bold text-white">批量检测对比分析</div>
                                            <div className="text-xs text-gray-400 font-mono mt-1">统计汇总与相似度对比</div>
                                        </div>
                                        <button onClick={() => setBatchAnalysisOpen(false)} className="text-gray-400 hover:text-white">
                                            <XCircle size={22} />
                                        </button>
                                    </div>

                                    <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar flex-1 min-h-0">
                                    {(() => {
                                        const stats = computeBatchStats();

                                        const scored = batchFiles
                                            .filter((f) => f.status === 'done' && f.result?.five_dim_score?.dimensions)
                                            .map((f) => f.result.five_dim_score.dimensions);

                                        const meanDims = scored.length
                                            ? {
                                                  fingerprint: scored.reduce((s, d) => s + (Number(d.fingerprint?.score) || 0), 0) / scored.length,
                                                  temporal: scored.reduce((s, d) => s + (Number(d.temporal?.score) || 0), 0) / scored.length,
                                                  semantic: scored.reduce((s, d) => s + (Number(d.semantic?.score) || 0), 0) / scored.length,
                                                  robustness: scored.reduce((s, d) => s + (Number(d.robustness?.score) || 0), 0) / scored.length,
                                                  provenance: scored.reduce((s, d) => s + (Number(d.provenance?.score) || 0), 0) / scored.length,
                                              }
                                            : null;

                                        const meanScore = meanDims ? buildFiveDimScoreForDisplay(meanDims) : null;

                                        return (
                                            <>
                                                {meanScore && (
                                                    <div className="bg-black/30 border border-white/10 rounded-xl p-4">
                                                        <div className="flex items-center justify-between mb-3">
                                                            <div className="text-sm font-bold text-gray-200">五维证据评分（批量均值）</div>
                                                            <div className="text-xs text-gray-500">样本数: {scored.length}</div>
                                                        </div>
                                                        <EvidenceVisualization fiveDimScore={meanScore} />
                                                    </div>
                                                )}

                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                                    <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
                                                        <div className="text-2xl font-bold text-white">{stats.total}</div>
                                                        <div className="text-xs text-gray-500 mt-1">检测总数</div>
                                                    </div>
                                                    <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 text-center">
                                                        <div className="text-2xl font-bold text-green-400">{stats.matched}</div>
                                                        <div className="text-xs text-gray-500 mt-1">匹配成功</div>
                                                    </div>
                                                    <div className="bg-gray-500/10 border border-gray-500/20 rounded-xl p-4 text-center">
                                                        <div className="text-2xl font-bold text-gray-400">{stats.unmatched}</div>
                                                        <div className="text-xs text-gray-500 mt-1">未匹配</div>
                                                    </div>
                                                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 text-center">
                                                        <div className="text-2xl font-bold text-blue-400">{stats.matchRate}%</div>
                                                        <div className="text-xs text-gray-500 mt-1">匹配率</div>
                                                    </div>
                                                </div>

                                                {stats.total > 0 && stats.items.some((i) => i.similarity > 0) && (
                                                    <div className="bg-black/30 border border-white/10 rounded-xl p-4">
                                                        <div className="text-sm font-bold text-gray-200 mb-3">相似度统计</div>
                                                        <div className="grid grid-cols-3 gap-4 text-center">
                                                            <div>
                                                                <div className="text-lg font-bold text-emerald-400">{stats.avgSimilarity}%</div>
                                                                <div className="text-xs text-gray-500">平均相似度</div>
                                                            </div>
                                                            <div>
                                                                <div className="text-lg font-bold text-green-400">{stats.maxSimilarity}%</div>
                                                                <div className="text-xs text-gray-500">最高相似度</div>
                                                            </div>
                                                            <div>
                                                                <div className="text-lg font-bold text-gray-400">{stats.minSimilarity}%</div>
                                                                <div className="text-xs text-gray-500">最低相似度</div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}

                                                {stats.items.length > 0 && (
                                                    <div className="bg-black/30 border border-white/10 rounded-xl p-4">
                                                        <div className="text-sm font-bold text-gray-200 mb-4">相似度对比图</div>
                                                        <div className="space-y-3">
                                                            {stats.items.map((item, idx) => (
                                                                <div key={idx} className="flex items-center gap-3">
                                                                    <div className="w-8 text-xs text-gray-500 text-right">#{item.idx}</div>
                                                                    <div className="flex-1 min-w-0">
                                                                        <div className="flex items-center justify-between mb-1">
                                                                            <span className="text-xs text-gray-400 truncate max-w-[150px]" title={item.name}>
                                                                                {item.name}
                                                                            </span>
                                                                            <span
                                                                                className={`text-xs font-mono font-bold ${item.similarity >= 80 ? 'text-red-400' : item.similarity >= 60 ? 'text-orange-400' : item.hasWatermark ? 'text-emerald-400' : 'text-gray-500'}`}
                                                                            >
                                                                                {item.similarity > 0 ? `${item.similarity.toFixed(2)}%` : '-'}
                                                                            </span>
                                                                        </div>
                                                                        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                                                                            <div
                                                                                className={`h-full rounded-full transition-all duration-500 ${item.similarity >= 80 ? 'bg-gradient-to-r from-red-500 to-orange-500' : item.similarity >= 60 ? 'bg-gradient-to-r from-orange-500 to-yellow-500' : item.hasWatermark ? 'bg-gradient-to-r from-emerald-500 to-green-400' : 'bg-gray-600'}`}
                                                                                style={{ width: `${Math.min(item.similarity, 100)}%` }}
                                                                            />
                                                                        </div>
                                                                        {item.hasWatermark && item.author && (
                                                                            <div className="text-[10px] text-gray-500 mt-0.5">作者: {item.author}</div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {stats.total === 0 && <div className="text-center text-gray-500 py-8">暂无完成的检测数据</div>}
                                            </>
                                        );
                                    })()}
                                    </div>
                                </div>
                            </div>,
                            portalTarget
                        )}

                    {/* 批量检测详情弹窗 - 固定中间显示 */}
                    {portalTarget &&
                        batchDetailOpen &&
                        batchDetailItem?.result &&
                        (() => {
                            const item = batchDetailItem!;
                            if (!item?.result) return null;
                            return createPortal(
                                <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-[60] animate-enter" onClick={closeBatchDetail}>
                                    <div
                                        className="glass-card w-full max-w-3xl border-purple-500/30 max-h-[85vh] flex flex-col min-h-0 overflow-hidden"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <div className="p-6 border-b border-white/10 flex justify-between items-center bg-purple-500/10 rounded-t-2xl flex-shrink-0">
                                            <div>
                                                <div className="text-lg font-bold text-white">批量检测详情</div>
                                                <div className="text-xs text-gray-400 font-mono mt-1">{item.file?.name}</div>
                                            </div>
                                            <button onClick={closeBatchDetail} className="text-gray-400 hover:text-white">
                                                <XCircle size={22} />
                                            </button>
                                        </div>

                                        <div className="p-6 space-y-4 overflow-y-auto custom-scrollbar flex-1 min-h-0">
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                                            <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                                                <div className="text-xs text-gray-500">是否检测到指纹</div>
                                                <div
                                                    className={`font-bold ${item.result.has_watermark ? 'text-emerald-400' : 'text-rose-400'}`}
                                                >
                                                    {item.result.has_watermark ? '是' : '否'}
                                                </div>
                                            </div>
                                            <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                                                <div className="text-xs text-gray-500">置信度</div>
                                                <div className="text-white font-bold">
                                                    {typeof item.result.confidence === 'number'
                                                        ? `${(item.result.confidence * 100).toFixed(2)}%`
                                                        : '--'}
                                                </div>
                                            </div>
                                            <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                                                <div className="text-xs text-gray-500">指纹Hash片段</div>
                                                <div className="text-white font-mono break-all">
                                                    {item.result.extracted_fingerprint_detail?.fingerprint_hash ||
                                                        (item.result.extracted_fingerprint
                                                            ? String(item.result.extracted_fingerprint).slice(0, 32)
                                                            : 'N/A')}
                                                </div>
                                            </div>
                                        </div>

                                        {item.result.best_match && (
                                            <div className="bg-black/30 border border-white/10 rounded-xl p-4">
                                                <div className="text-sm font-bold text-gray-200 mb-3">最佳匹配</div>
                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                                                    <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                                                        <div className="text-xs text-gray-500">作者</div>
                                                        <div className="text-white font-bold break-all">
                                                            {item.result.best_match.author_name ||
                                                                item.result.best_match.author_id ||
                                                                '未知'}
                                                        </div>
                                                    </div>
                                                    <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                                                        <div className="text-xs text-gray-500">相似度</div>
                                                        {(() => {
                                                            const sim =
                                                                typeof item.result.best_match.similarity === 'number'
                                                                    ? item.result.best_match.similarity
                                                                    : 0;
                                                            return (
                                                                <div
                                                                    className={`font-bold ${sim >= 80 ? 'text-red-400' : sim >= 60 ? 'text-orange-400' : 'text-emerald-400'}`}
                                                                >
                                                                    {sim.toFixed ? `${sim.toFixed(2)}%` : `${sim}%`}
                                                                </div>
                                                            );
                                                        })()}
                                                    </div>
                                                    <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                                                        <div className="text-xs text-gray-500">确权时间</div>
                                                        <div className="text-white">
                                                            {item.result.best_match.creation_time || '未知'}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {Array.isArray(item.result.match_candidates) &&
                                            item.result.match_candidates.length > 0 && (
                                                <div className="bg-black/30 border border-white/10 rounded-xl p-4">
                                                    <div className="text-sm font-bold text-gray-200 mb-3">候选列表（Top5）</div>
                                                    <div className="space-y-2">
                                                        {item.result.match_candidates.slice(0, 5).map((c: any, idx: number) => {
                                                            const sim = typeof c.similarity === 'number' ? c.similarity : 0;
                                                            const isHighRisk = sim >= 80;
                                                            const isMediumRisk = sim >= 60 && sim < 80;
                                                            return (
                                                                <div
                                                                    key={idx}
                                                                    className="flex items-center justify-between bg-white/5 border border-white/10 rounded-lg px-3 py-2"
                                                                >
                                                                    <div className="min-w-0">
                                                                        <div className="text-xs text-gray-400">
                                                                            #{c.rank ?? idx + 1} · {c.match_method || '指纹匹配'}
                                                                        </div>
                                                                        <div className="text-sm text-white truncate">
                                                                            {c.author || c.author_name || '未知作者'}
                                                                        </div>
                                                                    </div>
                                                                    <div className="text-right flex-shrink-0">
                                                                        <div
                                                                            className={`text-sm font-bold ${isHighRisk ? 'text-red-400' : isMediumRisk ? 'text-orange-400' : 'text-emerald-400'}`}
                                                                        >
                                                                            {sim.toFixed ? `${sim.toFixed(2)}%` : `${sim}%`}
                                                                        </div>
                                                                        <div className="text-[10px] text-gray-500">
                                                                            {isHighRisk ? '高相似警示' : c.confidence_level || ''}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}

                                        {item.result.analysis?.verdict && (
                                            <div className="bg-black/30 border border-white/10 rounded-xl p-4">
                                                <div className="text-sm font-bold text-gray-200 mb-3">结论</div>
                                                <div className="text-gray-200 text-sm leading-relaxed whitespace-pre-wrap">
                                                    {item.result.analysis.verdict}
                                                </div>
                                            </div>
                                        )}

                                        {/* 命中：统一三入口（溯源/AI/DMCA），导出在预览弹窗中 */}
                                        {item.result.has_watermark ? (
                                        <div className="flex flex-col md:flex-row flex-wrap gap-3 pt-2">
                                            <button
                                                onClick={() => openUnifiedViewer('provenance', { source: 'batch', item })}
                                                disabled={viewerExporting}
                                                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:shadow-lg hover:shadow-blue-500/20 transition-all font-bold text-sm disabled:opacity-50"
                                            >
                                                {viewerExporting && viewerType === 'provenance' ? (
                                                    <Loader2 size={16} className="animate-spin" />
                                                ) : (
                                                    <FileText size={16} />
                                                )}
                                                查看溯源鉴定报告
                                            </button>
                                            <button
                                                onClick={() => openUnifiedViewer('ai', { source: 'batch', item })}
                                                disabled={viewerExporting}
                                                className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl hover:shadow-lg transition-all font-bold text-sm disabled:opacity-50 ${
                                                    hasFeatureAccess('report_ai')
                                                        ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:shadow-violet-500/20'
                                                        : 'bg-gray-700/60 text-gray-400 border border-gray-600/50'
                                                }`}
                                            >
                                                {viewerExporting && viewerType === 'ai' ? (
                                                    <Loader2 size={16} className="animate-spin" />
                                                ) : (
                                                    <Zap size={16} />
                                                )}
                                                查看 AI 分析报告
                                                {!hasFeatureAccess('report_ai') && <span className="text-[10px] ml-1 opacity-70">个人版+</span>}
                                            </button>
                                            <button
                                                onClick={() => openUnifiedViewer('dmca', { source: 'batch', item })}
                                                disabled={viewerExporting}
                                                className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold text-sm transition-all disabled:opacity-50 ${
                                                    hasFeatureAccess('dmca')
                                                        ? 'bg-gradient-to-r from-red-500 to-rose-600 text-white hover:shadow-lg hover:shadow-red-500/20'
                                                        : 'bg-gray-700/60 text-gray-400 border border-gray-600/50'
                                                }`}
                                            >
                                                {viewerExporting && viewerType === 'dmca' ? (
                                                    <Loader2 size={16} className="animate-spin" />
                                                ) : (
                                                    <FileText size={16} />
                                                )}
                                                查看 DMCA 公文
                                                {!hasFeatureAccess('dmca') && <span className="text-[10px] ml-1 opacity-70">专业版+</span>}
                                            </button>
                                        </div>
                                        ) : (
                                        <div className="p-5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
                                            <div className="flex items-start gap-4">
                                                <div className="p-3 bg-emerald-500/20 rounded-full shrink-0">
                                                    <BadgeCheck className="text-emerald-400" size={24} />
                                                </div>
                                                <div className="flex-1">
                                                    <div className="text-emerald-400 font-bold mb-2">安全检测结果</div>
                                                    <p className="text-sm text-gray-300 leading-relaxed mb-4">
                                                        该照片「{item.file?.name || '未知文件'}」已完成全网溯源检测，
                                                        <span className="text-emerald-400 font-semibold">暂未发现数字指纹信息</span>，
                                                        目前相对安全。但为防止未来被盗用，建议立即为作品添加数字指纹保护。
                                                    </p>
                                                    <div className="flex flex-wrap gap-3">
                                                        <button
                                                            onClick={() => { closeBatchDetail(); window.location.href = '/fingerprint'; }}
                                                            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-xl hover:shadow-lg hover:shadow-cyan-500/20 transition-all font-bold text-sm"
                                                        >
                                                            <Fingerprint size={16} />
                                                            去嵌入指纹
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                const fileName = item.file?.name || 'Unknown';
                                                                const timestamp = new Date().toLocaleString();
                                                                const certId = Date.now();
                                                                const htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>AIGCGuard Detection Certificate - ${fileName}</title><style>* { margin: 0; padding: 0; box-sizing: border-box; } body { font-family: 'Courier New', 'Arial', sans-serif; background: #0f172a; color: #e2e8f0; padding: 0; } .page { width: 210mm; height: 297mm; background: white; color: #0f172a; margin: 0 auto; padding: 20mm; box-shadow: 0 0 20px rgba(0,0,0,0.3); position: relative; } .header { background: linear-gradient(90deg, #34d399 0%, #10b981 100%); color: #0f172a; padding: 20px; text-align: center; border-radius: 8px; margin-bottom: 25px; } .header h1 { font-size: 24px; margin-bottom: 5px; font-weight: bold; } .header p { font-size: 12px; opacity: 0.8; } .section { margin-bottom: 20px; padding: 15px; border: 1px solid #34d399; border-radius: 6px; background: #f9fafb; } .section-title { color: #34d399; font-weight: bold; margin-bottom: 10px; font-size: 13px; } .info-row { display: flex; margin-bottom: 8px; font-size: 12px; } .info-label { font-weight: bold; width: 120px; color: #0f172a; } .info-value { flex: 1; word-break: break-all; color: #374151; } .footer { text-align: center; padding-top: 20px; border-top: 1px solid #34d399; margin-top: 30px; font-size: 11px; color: #6b7280; } .actions { display: flex; gap: 10px; margin-bottom: 20px; justify-content: center; } button { padding: 10px 20px; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 12px; } .btn-print { background: #60a5fa; color: white; } .btn-close { background: #ef4444; color: white; } @media print { body { background: white; } .page { box-shadow: none; width: 100%; height: 100%; margin: 0; padding: 0; } .actions { display: none; } }</style></head><body><div class="actions"><button class="btn-print" onclick="window.print()">🖨️ 打印 / 保存为PDF</button><button class="btn-close" onclick="window.close()">✕ 关闭</button></div><div class="page"><div class="header"><h1>📚 AIGCGuard 数字内容检测凭证</h1><p>Digital Content Fingerprint Detection Certificate</p></div><div class="section"><div class="section-title">📋 文件信息 | FILE INFORMATION</div><div class="info-row"><div class="info-label">文件名称:</div><div class="info-value">${fileName}</div></div><div class="info-row"><div class="info-label">检测时间:</div><div class="info-value">${timestamp}</div></div></div><div class="section"><div class="section-title">✓ 检测结果 | DETECTION RESULT</div><div class="info-row"><div class="info-label">检测状态:</div><div class="info-value">✓ 未检测到数字指纹 (No Watermark Found)</div></div><div class="info-row"><div class="info-label">安全等级:</div><div class="info-value">100% 安全 (Safe)</div></div><div class="info-row"><div class="info-label">建议:</div><div class="info-value">为该作品添加数字指纹以获得更好的保护</div></div></div><div class="section"><div class="section-title">🔐 法律意见 | LEGAL OPINION</div><div class="info-row"><div class="info-value">该文件目前不存在明显的侵权特征。然而，为进一步保证你的法律权益，我们强烈建议立即为该作品添加数字指纹。</div></div></div><div class="footer"><p>🔑 凭证 ID: ${certId}</p><p>📅 日期: ${new Date().toLocaleDateString()} | 发证机构: AIGCGuard</p></div></div></body></html>`;
                                                                const newWindow = window.open();
                                                                if (newWindow) { newWindow.document.write(htmlContent); newWindow.document.close(); }
                                                            }}
                                                            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl hover:shadow-lg hover:shadow-emerald-500/20 transition-all font-bold text-sm"
                                                        >
                                                            <FileText size={16} />
                                                            下载检测凭证
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        )}
                                    </div>
                                </div>
                            </div>, portalTarget
                        );
                    })()}
                </>
            ) : mode === 'text' ? (
                <div className="space-y-4">
                    <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl">
                        <div className="flex items-start gap-3">
                            <FileText className="text-blue-400 shrink-0 mt-0.5" size={16} />
                            <div>
                                <div className="text-sm text-blue-300 font-medium mb-1">Unicode零宽字符隐写检测技术</div>
                                <p className="text-xs text-gray-400 leading-relaxed">
                                    扫描文本中的\u200d边界标记，提取\u200b(0)和\u200c(1)构成的二进制流，还原隐藏的版权元数据。支持检测洗稿、复制粘贴等侵权行为，水印随文本传播而保留。
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-enter">
                    <div className="glass-card p-10 flex flex-col gap-6">
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <FileText size={24} className="text-blue-400" />
                            待检测文本溯源
                        </h2>
                        <textarea
                            value={textInput}
                            onChange={(e) => setTextInput(e.target.value)}
                            placeholder="在此粘贴可疑文本..."
                            className="bg-black/30 border border-white/10 rounded-xl p-6 text-gray-300 w-full h-80 resize-none transition-all placeholder:text-gray-600 focus:border-blue-500/50 outline-none custom-scrollbar"
                        ></textarea>
                        <button
                            onClick={handleTextDetect}
                            disabled={!textInput.trim() || loading}
                            className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all
                                ${!textInput.trim() || loading
                                    ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                                    : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/30 hover:scale-[1.02]'
                                }
                            `}
                        >
                            {loading ? <Loader2 className="animate-spin" /> : <Search />}
                            {loading ? '全网特征比对中...' : '开始文本深度溯源'}
                        </button>
                    </div>

                    <div className="glass-card p-6 sm:p-10 flex flex-col min-h-[400px]">
                        {textResult ? (
                            <div className="w-full space-y-5 animate-enter">
                                {/* Result Banner */}
                                <div className={`flex items-center gap-4 p-5 rounded-2xl ${textResult.has_watermark ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/20'}`}>
                                    <div className={`p-3 rounded-full shrink-0 ${textResult.has_watermark ? 'bg-green-500 text-white shadow-lg shadow-green-500/30' : 'bg-red-500 text-white shadow-lg shadow-red-500/30'}`}>
                                        {textResult.has_watermark ? <BadgeCheck size={28} /> : <XCircle size={28} />}
                                    </div>
                                    <div>
                                        <h3 className={`text-xl font-bold ${textResult.has_watermark ? 'text-green-400' : 'text-red-400'}`}>
                                            {textResult.has_watermark ? '检测到数字水印' : '未检测到版权水印'}
                                        </h3>
                                        <p className="text-gray-400 text-sm">{textResult.message}</p>
                                        {textResult.has_watermark && textResult.extracted_watermark && (
                                            <div className="mt-2 p-2 bg-black/30 rounded-lg">
                                                <p className="text-xs text-gray-500">提取的元数据:</p>
                                                <code className="text-xs text-green-300 font-mono break-all">{textResult.extracted_watermark}</code>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* 风险评估卡片 */}
                                {(() => {
                                    const conf = typeof textResult.confidence === 'number' ? textResult.confidence * 100 : 0;
                                    const riskLevel = conf >= 80 ? 'HIGH' : conf >= 50 ? 'MEDIUM' : 'LOW';
                                    const riskConfig = {
                                        HIGH: { label: '高风险', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', barColor: 'from-red-500 to-rose-500', icon: '⚠️', desc: '检测到隶属版权元数据，疑似未授权复制或洗稿，建议立即采取维权措施' },
                                        MEDIUM: { label: '中风险', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', barColor: 'from-amber-500 to-orange-500', icon: '⚡', desc: '存在隶写特征但不完整，可能经过了部分改写，建议人工复核' },
                                        LOW: { label: '低风险', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', barColor: 'from-emerald-500 to-teal-500', icon: '✓', desc: '未发现隶写水印特征，建议为原创文本添加隶写保护' },
                                    };
                                    const risk = riskConfig[riskLevel];
                                    return (
                                        <div className={`p-4 rounded-xl border ${risk.bg}`}>
                                            <div className="flex items-center justify-between mb-3">
                                                <span className={`text-sm font-bold ${risk.color} flex items-center gap-1.5`}>
                                                    {risk.icon} 风险等级：{risk.label}
                                                </span>
                                                <span className="text-xs text-gray-500 font-mono">
                                                    置信度 {conf.toFixed(1)}%
                                                </span>
                                            </div>
                                            <div className="h-2 bg-black/30 rounded-full overflow-hidden mb-2">
                                                <div
                                                    className={`h-full bg-gradient-to-r ${risk.barColor} transition-all duration-500`}
                                                    style={{ width: `${Math.min(conf, 100)}%` }}
                                                />
                                            </div>
                                            <p className="text-xs text-gray-400 leading-relaxed">{risk.desc}</p>
                                        </div>
                                    );
                                })()}

                                {/* 检测统计 */}
                                <div className="grid grid-cols-3 gap-3">
                                    <div className="bg-black/30 p-3 rounded-xl border border-white/5 text-center">
                                        <span className="text-[10px] text-gray-500 uppercase block mb-1">置信度</span>
                                        <span className={`text-lg font-mono font-bold ${
                                            (textResult.confidence || 0) >= 0.8 ? 'text-red-400' :
                                            (textResult.confidence || 0) >= 0.5 ? 'text-amber-400' : 'text-emerald-400'
                                        }`}>{((textResult.confidence || 0) * 100).toFixed(1)}<span className="text-[10px] text-gray-600 font-normal">%</span></span>
                                    </div>
                                    <div className="bg-black/30 p-3 rounded-xl border border-white/5 text-center">
                                        <span className="text-[10px] text-gray-500 uppercase block mb-1">检测方式</span>
                                        <span className="text-xs font-mono text-blue-400 font-bold">{textResult.analysis?.method || '零宽字符扫描'}</span>
                                    </div>
                                    <div className="bg-black/30 p-3 rounded-xl border border-white/5 text-center">
                                        <span className="text-[10px] text-gray-500 uppercase block mb-1">水印状态</span>
                                        <span className={`text-xs font-bold ${textResult.has_watermark ? 'text-green-400' : 'text-gray-400'}`}>
                                            {textResult.has_watermark ? '已检出' : '未发现'}
                                        </span>
                                    </div>
                                </div>

                                {/* 查看完整报告按钮 */}
                                <button
                                    onClick={() => setTextDetailModalOpen(true)}
                                    className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/20 hover:scale-[1.02]"
                                >
                                    <Eye size={16} />
                                    查看完整检测报告
                                </button>

                                {/* 未检测到水印时的快速引导 */}
                                {!textResult.has_watermark && (
                                    <button
                                        onClick={() => window.location.href = '/fingerprint'}
                                        className="w-full py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10"
                                    >
                                        <Fingerprint size={14} />
                                        去嵌入文本水印保护
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-center opacity-30">
                                <FileText size={80} className="mx-auto mb-4 text-gray-400" />
                                <p className="text-xl">等待文本输入...</p>
                                <p className="text-sm mt-2">系统将对比 Unicode 零宽特征点</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            ) : (
                // === Video Mode Detection ===
                <div className="space-y-4">
                    {/* 技术说明 */}
                    <div className="p-4 bg-indigo-500/5 border border-indigo-500/20 rounded-xl">
                        <div className="flex items-start gap-3">
                            <Film className="text-indigo-400 shrink-0 mt-0.5" size={16} />
                            <div>
                                <div className="text-sm text-indigo-300 font-medium mb-1">视频抽帧DCT盲水印检测技术</div>
                                <p className="text-xs text-gray-400 leading-relaxed">
                                    每0.5秒抽取关键帧进行DCT频域分析，提取256位数字指纹。支持H.264编码视频的盲提取，无需原始视频即可定位版权归属，抗转码、压缩等攻击。
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-enter">
                    <div className="glass-card p-10 flex flex-col gap-6">
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <Film size={24} className="text-indigo-400" />
                            待检测视频溯源
                        </h2>
                        <div
                            className={`flex-1 min-h-[250px] border-2 border-dashed rounded-2xl flex flex-col items-center justify-center cursor-pointer transition-all ${videoFile ? 'border-indigo-500/50 bg-indigo-500/5' : 'border-white/10 hover:border-indigo-500/30'}`}
                            onClick={() => videoInputRef.current?.click()}
                        >
                            {videoFile ? (
                                <div className="text-center">
                                    <Film size={48} className="text-indigo-400 mx-auto mb-2" />
                                    <p className="text-white font-medium">{videoFile!.name}</p>
                                    <p className="text-gray-500 text-xs">{(videoFile!.size / 1024 / 1024).toFixed(2)} MB</p>
                                </div>
                            ) : (
                                <div className="text-center text-gray-500">
                                    <Upload size={32} className="mx-auto mb-2" />
                                    <p>点击或拖拽上传可疑视频</p>
                                    <p className="text-[10px] mt-1">支持关键帧检测技术</p>
                                </div>
                            )}
                            <input type="file" ref={videoInputRef} onChange={(e) => setVideoFile(e.target.files?.[0] || null)} className="hidden" accept="video/*" />
                        </div>
                        <button
                            onClick={handleVideoDetect}
                            disabled={!videoFile || loading}
                            className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all
                                ${!videoFile || loading
                                    ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                                    : 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/30 hover:scale-[1.02]'
                                }
                            `}
                        >
                            {loading ? <Loader2 className="animate-spin" /> : <Search />}
                            {loading ? '正在分析视频流...' : '启动视频深度检索'}
                        </button>
                    </div>

                    <div className="glass-card p-6 sm:p-10 flex flex-col min-h-[400px]">
                        {videoResult ? (
                            <div className="w-full space-y-5 animate-enter">
                                {/* Result Banner */}
                                <div className={`flex items-center gap-4 p-5 rounded-2xl ${videoResult.has_watermark ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/20'}`}>
                                    <div className={`p-3 rounded-full shrink-0 ${videoResult.has_watermark ? 'bg-green-500 text-white shadow-lg shadow-green-500/30' : 'bg-red-500 text-white shadow-lg shadow-red-500/30'}`}>
                                        {videoResult.has_watermark ? <BadgeCheck size={28} /> : <XCircle size={28} />}
                                    </div>
                                    <div>
                                        <h3 className={`text-xl font-bold ${videoResult.has_watermark ? 'text-green-400' : 'text-red-400'}`}>
                                            {videoResult.has_watermark ? '指纹匹配成功' : '未定位到授权指纹'}
                                        </h3>
                                        <p className="text-gray-400 text-sm">{videoResult.message}</p>
                                    </div>
                                </div>

                                {/* 风险评估卡片 */}
                                {(() => {
                                    const conf = typeof videoResult.confidence === 'number' ? videoResult.confidence * 100 : 0;
                                    const riskLevel = conf >= 80 ? 'HIGH' : conf >= 50 ? 'MEDIUM' : 'LOW';
                                    const riskConfig = {
                                        HIGH: { label: '高风险', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', barColor: 'from-red-500 to-rose-500', icon: '⚠️', desc: '匹配度极高，疑似未授权使用，建议立即采取维权措施' },
                                        MEDIUM: { label: '中风险', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', barColor: 'from-amber-500 to-orange-500', icon: '⚡', desc: '存在一定相似性，建议人工复核确认是否侵权' },
                                        LOW: { label: '低风险', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', barColor: 'from-emerald-500 to-teal-500', icon: '✓', desc: '未发现明显侵权特征，建议为作品添加指纹保护' },
                                    };
                                    const risk = riskConfig[riskLevel];
                                    return (
                                        <div className={`p-4 rounded-xl border ${risk.bg}`}>
                                            <div className="flex items-center justify-between mb-3">
                                                <span className={`text-sm font-bold ${risk.color} flex items-center gap-1.5`}>
                                                    {risk.icon} 风险等级：{risk.label}
                                                </span>
                                                <span className="text-xs text-gray-500 font-mono">
                                                    置信度 {conf.toFixed(1)}%
                                                </span>
                                            </div>
                                            <div className="h-2 bg-black/30 rounded-full overflow-hidden mb-2">
                                                <div
                                                    className={`h-full bg-gradient-to-r ${risk.barColor} transition-all duration-500`}
                                                    style={{ width: `${Math.min(conf, 100)}%` }}
                                                />
                                            </div>
                                            <p className="text-xs text-gray-400 leading-relaxed">{risk.desc}</p>
                                        </div>
                                    );
                                })()}

                                {/* 视频检测统计 */}
                                <div className="grid grid-cols-3 gap-3">
                                    <div className="bg-black/30 p-3 rounded-xl border border-white/5 text-center">
                                        <span className="text-[10px] text-gray-500 uppercase block mb-1">检测时长</span>
                                        <span className="text-lg font-mono text-cyan-400 font-bold">{videoResult.processed_seconds ? videoResult.processed_seconds : '<1'}<span className="text-[10px] text-gray-600 font-normal">秒</span></span>
                                    </div>
                                    <div className="bg-black/30 p-3 rounded-xl border border-white/5 text-center">
                                        <span className="text-[10px] text-gray-500 uppercase block mb-1">置信度</span>
                                        <span className={`text-lg font-mono font-bold ${
                                            (videoResult.confidence || 0) >= 0.8 ? 'text-red-400' :
                                            (videoResult.confidence || 0) >= 0.5 ? 'text-amber-400' : 'text-emerald-400'
                                        }`}>{((videoResult.confidence || 0) * 100).toFixed(1)}<span className="text-[10px] text-gray-600 font-normal">%</span></span>
                                    </div>
                                    <div className="bg-black/30 p-3 rounded-xl border border-white/5 text-center">
                                        <span className="text-[10px] text-gray-500 uppercase block mb-1">检测方式</span>
                                        <span className="text-xs font-mono text-indigo-400 font-bold">{videoResult.analysis?.method || 'DCT盲提取'}</span>
                                    </div>
                                </div>

                                {/* 查看完整报告按钮 */}
                                <button
                                    onClick={() => setVideoDetailModalOpen(true)}
                                    className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/20 hover:scale-[1.02]"
                                >
                                    <Eye size={16} />
                                    查看完整检测报告
                                </button>

                                {/* 未检测到指纹时的快速引导 */}
                                {!videoResult.has_watermark && (
                                    <button
                                        onClick={() => window.location.href = '/fingerprint'}
                                        className="w-full py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10"
                                    >
                                        <Fingerprint size={14} />
                                        去嵌入视频指纹保护
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-center opacity-30">
                                <Film size={80} className="mx-auto mb-4 text-gray-400" />
                                <p className="text-xl">等待视频分析</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            )}

            {/* 文本检测详情弹窗 */}
            {portalTarget && textDetailModalOpen && textResult && createPortal(
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-[60] animate-enter" onClick={() => setTextDetailModalOpen(false)}>
                    <div className="bg-gray-900 border border-blue-500/20 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                        {/* Modal Header */}
                        <div className="flex items-center justify-between p-5 border-b border-white/10 bg-blue-500/10 rounded-t-2xl flex-shrink-0">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                <FileText className="text-blue-400" size={20} />
                                文本检测完整报告
                            </h3>
                            <button onClick={() => setTextDetailModalOpen(false)} className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
                                <XCircle size={22} />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="p-5 overflow-y-auto flex-1 min-h-0 space-y-5 custom-scrollbar">
                            {/* Result Banner */}
                            <div className={`flex items-center gap-4 p-4 rounded-xl ${textResult.has_watermark ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/20'}`}>
                                <div className={`p-2.5 rounded-full shrink-0 ${textResult.has_watermark ? 'bg-green-500 text-white shadow-lg shadow-green-500/30' : 'bg-red-500 text-white shadow-lg shadow-red-500/30'}`}>
                                    {textResult.has_watermark ? <BadgeCheck size={22} /> : <XCircle size={22} />}
                                </div>
                                <div>
                                    <h3 className={`text-lg font-bold ${textResult.has_watermark ? 'text-green-400' : 'text-red-400'}`}>
                                        {textResult.has_watermark ? '检测到数字水印' : '未检测到版权水印'}
                                    </h3>
                                    <p className="text-gray-400 text-sm">{textResult.message}</p>
                                    {textResult.has_watermark && textResult.extracted_watermark && (
                                        <div className="mt-2 p-2 bg-black/30 rounded-lg">
                                            <p className="text-xs text-gray-500">提取的元数据:</p>
                                            <code className="text-xs text-green-300 font-mono break-all">{textResult.extracted_watermark}</code>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* 检测统计 */}
                            <div className="grid grid-cols-3 gap-3">
                                <div className="bg-black/30 p-3 rounded-xl border border-white/5 text-center">
                                    <span className="text-[10px] text-gray-500 uppercase block mb-1">置信度</span>
                                    <span className={`text-lg font-mono font-bold ${
                                        (textResult.confidence || 0) >= 0.8 ? 'text-red-400' :
                                        (textResult.confidence || 0) >= 0.5 ? 'text-amber-400' : 'text-emerald-400'
                                    }`}>{((textResult.confidence || 0) * 100).toFixed(1)}<span className="text-[10px] text-gray-600 font-normal">%</span></span>
                                </div>
                                <div className="bg-black/30 p-3 rounded-xl border border-white/5 text-center">
                                    <span className="text-[10px] text-gray-500 uppercase block mb-1">检测方式</span>
                                    <span className="text-xs font-mono text-blue-400 font-bold">{textResult.analysis?.method || '零宽字符扫描'}</span>
                                </div>
                                <div className="bg-black/30 p-3 rounded-xl border border-white/5 text-center">
                                    <span className="text-[10px] text-gray-500 uppercase block mb-1">水印状态</span>
                                    <span className={`text-xs font-bold ${textResult.has_watermark ? 'text-green-400' : 'text-gray-400'}`}>
                                        {textResult.has_watermark ? '已检出' : '未发现'}
                                    </span>
                                </div>
                            </div>

                            {/* 分析报告卡片 */}
                            {textResult.analysis && (
                                <div className="bg-white/5 rounded-xl p-5 border border-white/5 space-y-3">
                                    <div className="flex justify-between items-center pb-3 border-b border-white/5">
                                        <span className="text-gray-400 text-xs font-bold uppercase tracking-widest">检测结果分析</span>
                                        {textResult.confidence_level && (
                                            <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border ${
                                                String(textResult.confidence_level).includes('A') || textResult.confidence_level === '高'
                                                    ? 'bg-green-500/10 text-green-400 border-green-500/20'
                                                    : String(textResult.confidence_level).includes('B') || textResult.confidence_level === '中'
                                                        ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                                                        : 'bg-gray-500/10 text-gray-400 border-gray-500/20'
                                            }`}>置信等级: {textResult.confidence_level}</span>
                                        )}
                                    </div>
                                    <p className="text-sm text-gray-300 leading-relaxed">{textResult.analysis.verdict}</p>
                                    {textResult.analysis.evidence_strength && (
                                        <div className="pt-2 space-y-2">
                                            <div className="flex justify-between items-center">
                                                <span className="text-xs text-gray-500">证据强度评分</span>
                                                <span className="text-xs font-mono text-purple-400 font-bold">
                                                    {typeof textResult.analysis.evidence_strength === 'number' ? textResult.analysis.evidence_strength : (textResult.analysis.evidence_strength?.total_strength || 0)}/100
                                                </span>
                                            </div>
                                            <div className="h-1.5 bg-black/30 rounded-full overflow-hidden">
                                                <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500" style={{ width: `${Math.min(typeof textResult.analysis.evidence_strength === 'number' ? textResult.analysis.evidence_strength : (textResult.analysis.evidence_strength?.total_strength || 0), 100)}%` }} />
                                            </div>
                                        </div>
                                    )}
                                    {textResult.legal_description && (
                                        <p className="text-xs text-gray-500 pt-2 border-t border-white/5">
                                            <span className="text-gray-400 font-medium">法律评估：</span> {textResult.legal_description}
                                        </p>
                                    )}
                                    {textResult.analysis.method && (
                                        <p className="text-[10px] text-gray-600 mt-1">检测方法：{textResult.analysis.method}</p>
                                    )}
                                </div>
                            )}

                            {/* 建议操作 */}
                            {(() => {
                                const conf = typeof textResult.confidence === 'number' ? textResult.confidence * 100 : 0;
                                const suggestions = textResult.analysis?.suggested_action || (
                                    textResult.has_watermark ? (
                                        conf >= 80
                                            ? ['立即保存检测结果作为洗稿/抄袭证据', '联系原作者确认是否授权发布', '可将提取的元数据作为维权依据']
                                            : ['建议人工对比原文与疑似文本', '检查隶写特征是否被部分清除', '考虑使用更强的嵌入策略重新保护']
                                    ) : ['为您的原创文本添加零宽字符水印保护', '定期监测全网以防洗稿抄袭', '在发布前始终嵌入版权元数据']
                                );
                                return (
                                    <div className="bg-black/20 rounded-xl p-4 border border-white/5">
                                        <div className="text-xs text-gray-400 font-bold uppercase tracking-widest mb-3 flex items-center gap-1.5">
                                            <Zap size={12} className="text-amber-400" /> 建议操作
                                        </div>
                                        <ul className="space-y-2">
                                            {(Array.isArray(suggestions) ? suggestions : []).map((s: string, idx: number) => (
                                                <li key={idx} className="flex items-start gap-2 text-xs text-gray-300">
                                                    <span className="text-blue-400 mt-0.5 shrink-0">›</span>
                                                    <span>{s}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                );
                            })()}

                            {/* 版权匹配详情 */}
                            {textResult.matched_asset && (
                                <div className="bg-white/5 rounded-xl p-5 border border-white/5 space-y-4">
                                    <div className="flex justify-between items-center pb-3 border-b border-white/5">
                                        <span className="text-gray-400 text-xs font-bold uppercase tracking-widest">版权匹配详情</span>
                                        <span className="px-2.5 py-1 bg-green-500/10 text-green-400 rounded-lg text-[10px] font-bold border border-green-500/20">✓ 已匹配</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <p className="text-[10px] text-gray-500 mb-1">版权所有者</p>
                                            <p className="text-sm font-bold text-white">{textResult.matched_asset.author_name}</p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] text-gray-500 mb-1">匹配置信度</p>
                                            <p className={`font-mono text-sm font-bold ${
                                                (textResult.confidence || 0) >= 0.8 ? 'text-red-400' :
                                                (textResult.confidence || 0) >= 0.5 ? 'text-amber-400' : 'text-emerald-400'
                                            }`}>{((textResult.confidence || 0) * 100).toFixed(2)}%</p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] text-gray-500 mb-1">存证时间</p>
                                            <p className="text-white font-mono text-xs">{textResult.matched_asset.timestamp}</p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] text-gray-500 mb-1">匹配方法</p>
                                            <p className="text-white font-mono text-xs">Unicode零宽字符</p>
                                        </div>
                                        <div className="col-span-2">
                                            <p className="text-[10px] text-gray-500 mb-1">资产唯一标识 (CID)</p>
                                            <p className="text-[10px] font-mono text-gray-400 bg-black/40 p-2 rounded break-all">{textResult.matched_asset.id}</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* 未检测到水印时的引导 */}
                            {!textResult.has_watermark && (
                                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4">
                                    <div className="flex items-start gap-3">
                                        <BadgeCheck className="text-emerald-400 shrink-0 mt-0.5" size={16} />
                                        <div>
                                            <div className="text-sm text-emerald-300 font-medium mb-1">安全提示</div>
                                            <p className="text-xs text-gray-400 leading-relaxed mb-3">
                                                该文本未检测到已知零宽字符水印。为保护您的原创内容，建议立即嵌入隶写水印。
                                            </p>
                                            <button
                                                onClick={() => { setTextDetailModalOpen(false); window.location.href = '/fingerprint'; }}
                                                className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-lg text-xs font-bold hover:shadow-lg hover:shadow-cyan-500/20 transition-all"
                                            >
                                                <Fingerprint size={14} />
                                                去嵌入文本水印
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Modal Footer */}
                        <div className="p-4 border-t border-white/10 bg-black/20 flex-shrink-0 space-y-3">
                            <div className="flex flex-wrap gap-3 justify-center">
                                <button
                                    onClick={() => openUnifiedViewer('provenance', { source: 'batch', item: { file: { name: '文本检测_' + new Date().toLocaleTimeString() }, result: textResult } })}
                                    disabled={viewerExporting}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:shadow-lg hover:shadow-blue-500/20 transition-all font-bold text-sm disabled:opacity-50"
                                >
                                    {viewerExporting && viewerType === 'provenance' ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                                    查看溯源鉴定报告
                                </button>
                                <button
                                    onClick={() => openUnifiedViewer('ai', { source: 'batch', item: { file: { name: '文本检测_' + new Date().toLocaleTimeString() }, result: textResult } })}
                                    disabled={viewerExporting}
                                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl hover:shadow-lg transition-all font-bold text-sm disabled:opacity-50 ${
                                        hasFeatureAccess('report_ai')
                                            ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:shadow-violet-500/20'
                                            : 'bg-gray-700/60 text-gray-400 border border-gray-600/50'
                                    }`}
                                >
                                    {viewerExporting && viewerType === 'ai' ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                                    查看 AI 分析报告
                                    {!hasFeatureAccess('report_ai') && <span className="text-[10px] ml-1 opacity-70">个人版+</span>}
                                </button>
                                <button
                                    onClick={() => openUnifiedViewer('dmca', { source: 'batch', item: { file: { name: '文本检测_' + new Date().toLocaleTimeString() }, result: textResult } })}
                                    disabled={viewerExporting}
                                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all disabled:opacity-50 ${
                                        hasFeatureAccess('dmca')
                                            ? 'bg-gradient-to-r from-red-500 to-rose-600 text-white hover:shadow-lg hover:shadow-red-500/20'
                                            : 'bg-gray-700/60 text-gray-400 border border-gray-600/50'
                                    }`}
                                >
                                    {viewerExporting && viewerType === 'dmca' ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                                    查看 DMCA 公文
                                    {!hasFeatureAccess('dmca') && <span className="text-[10px] ml-1 opacity-70">专业版+</span>}
                                </button>
                            </div>
                            <div className="flex justify-end">
                                <button
                                    onClick={() => setTextDetailModalOpen(false)}
                                    className="px-5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 transition-all text-sm"
                                >
                                    关闭
                                </button>
                            </div>
                        </div>
                    </div>
                </div>,
                portalTarget
            )}

            {/* 视频检测详情弹窗 */}
            {portalTarget && videoDetailModalOpen && videoResult && createPortal(
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-[60] animate-enter" onClick={() => setVideoDetailModalOpen(false)}>
                    <div className="bg-gray-900 border border-indigo-500/20 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                        {/* Modal Header */}
                        <div className="flex items-center justify-between p-5 border-b border-white/10 bg-indigo-500/10 rounded-t-2xl flex-shrink-0">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                <Film className="text-indigo-400" size={20} />
                                视频检测完整报告
                            </h3>
                            <button onClick={() => setVideoDetailModalOpen(false)} className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
                                <XCircle size={22} />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="p-5 overflow-y-auto flex-1 min-h-0 space-y-5 custom-scrollbar">
                            {/* Result Banner */}
                            <div className={`flex items-center gap-4 p-4 rounded-xl ${videoResult.has_watermark ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/20'}`}>
                                <div className={`p-2.5 rounded-full shrink-0 ${videoResult.has_watermark ? 'bg-green-500 text-white shadow-lg shadow-green-500/30' : 'bg-red-500 text-white shadow-lg shadow-red-500/30'}`}>
                                    {videoResult.has_watermark ? <BadgeCheck size={22} /> : <XCircle size={22} />}
                                </div>
                                <div>
                                    <h3 className={`text-lg font-bold ${videoResult.has_watermark ? 'text-green-400' : 'text-red-400'}`}>
                                        {videoResult.has_watermark ? '指纹匹配成功' : '未定位到授权指纹'}
                                    </h3>
                                    <p className="text-gray-400 text-sm">{videoResult.message}</p>
                                </div>
                            </div>

                            {/* 视频检测统计 */}
                            <div className="grid grid-cols-3 gap-3">
                                <div className="bg-black/30 p-3 rounded-xl border border-white/5 text-center">
                                    <span className="text-[10px] text-gray-500 uppercase block mb-1">检测时长</span>
                                    <span className="text-lg font-mono text-cyan-400 font-bold">{videoResult.processed_seconds ? videoResult.processed_seconds : '<1'}<span className="text-[10px] text-gray-600 font-normal">秒</span></span>
                                </div>
                                <div className="bg-black/30 p-3 rounded-xl border border-white/5 text-center">
                                    <span className="text-[10px] text-gray-500 uppercase block mb-1">置信度</span>
                                    <span className={`text-lg font-mono font-bold ${
                                        (videoResult.confidence || 0) >= 0.8 ? 'text-red-400' :
                                        (videoResult.confidence || 0) >= 0.5 ? 'text-amber-400' : 'text-emerald-400'
                                    }`}>{((videoResult.confidence || 0) * 100).toFixed(1)}<span className="text-[10px] text-gray-600 font-normal">%</span></span>
                                </div>
                                <div className="bg-black/30 p-3 rounded-xl border border-white/5 text-center">
                                    <span className="text-[10px] text-gray-500 uppercase block mb-1">检测方式</span>
                                    <span className="text-xs font-mono text-indigo-400 font-bold">{videoResult.analysis?.method || 'DCT盲提取'}</span>
                                </div>
                            </div>

                            {/* 分析报告卡片 */}
                            {videoResult.analysis && (
                                <div className="bg-white/5 rounded-xl p-5 border border-white/5 space-y-3">
                                    <div className="flex justify-between items-center pb-3 border-b border-white/5">
                                        <span className="text-gray-400 text-xs font-bold uppercase tracking-widest">检测结果分析</span>
                                        {videoResult.confidence_level && (
                                            <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border ${
                                                String(videoResult.confidence_level).includes('A') || videoResult.confidence_level === '高'
                                                    ? 'bg-green-500/10 text-green-400 border-green-500/20'
                                                    : String(videoResult.confidence_level).includes('B') || videoResult.confidence_level === '中'
                                                        ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                                                        : 'bg-gray-500/10 text-gray-400 border-gray-500/20'
                                            }`}>置信等级: {videoResult.confidence_level}</span>
                                        )}
                                    </div>
                                    <p className="text-sm text-gray-300 leading-relaxed">{videoResult.analysis.verdict}</p>
                                    {videoResult.analysis.evidence_strength && (
                                        <div className="pt-2 space-y-2">
                                            <div className="flex justify-between items-center">
                                                <span className="text-xs text-gray-500">证据强度评分</span>
                                                <span className="text-xs font-mono text-purple-400 font-bold">
                                                    {typeof videoResult.analysis.evidence_strength === 'number' ? videoResult.analysis.evidence_strength : (videoResult.analysis.evidence_strength?.total_strength || 0)}/100
                                                </span>
                                            </div>
                                            <div className="h-1.5 bg-black/30 rounded-full overflow-hidden">
                                                <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500" style={{ width: `${Math.min(typeof videoResult.analysis.evidence_strength === 'number' ? videoResult.analysis.evidence_strength : (videoResult.analysis.evidence_strength?.total_strength || 0), 100)}%` }} />
                                            </div>
                                        </div>
                                    )}
                                    {videoResult.legal_description && (
                                        <p className="text-xs text-gray-500 pt-2 border-t border-white/5">
                                            <span className="text-gray-400 font-medium">法律评估：</span> {videoResult.legal_description}
                                        </p>
                                    )}
                                    {videoResult.analysis.method && (
                                        <p className="text-[10px] text-gray-600 mt-1">检测方法：{videoResult.analysis.method}</p>
                                    )}
                                </div>
                            )}

                            {/* 建议操作 */}
                            {(() => {
                                const conf = typeof videoResult.confidence === 'number' ? videoResult.confidence * 100 : 0;
                                const suggestions = videoResult.analysis?.suggested_action || (
                                    videoResult.has_watermark ? (
                                        conf >= 80
                                            ? ['立即导出溯源报告作为维权依据', '准备 DMCA 下架通知函', '保留视频截图作为侵权证据']
                                            : ['建议人工复核匹配结果', '对比原始视频与可疑视频', '联系版权所有者确认授权情况']
                                    ) : ['为该视频添加数字指纹保护', '定期执行全网监测以防盗用', '考虑升级专业版获取更强保护']
                                );
                                return (
                                    <div className="bg-black/20 rounded-xl p-4 border border-white/5">
                                        <div className="text-xs text-gray-400 font-bold uppercase tracking-widest mb-3 flex items-center gap-1.5">
                                            <Zap size={12} className="text-amber-400" /> 建议操作
                                        </div>
                                        <ul className="space-y-2">
                                            {(Array.isArray(suggestions) ? suggestions : []).map((s: string, idx: number) => (
                                                <li key={idx} className="flex items-start gap-2 text-xs text-gray-300">
                                                    <span className="text-indigo-400 mt-0.5 shrink-0">›</span>
                                                    <span>{s}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                );
                            })()}

                            {/* 版权匹配详情 */}
                            {videoResult.has_watermark && videoResult.matched_asset && (
                                <div className="bg-white/5 rounded-xl p-5 border border-white/5 space-y-4">
                                    <div className="flex justify-between items-center pb-3 border-b border-white/5">
                                        <span className="text-gray-400 text-xs font-bold uppercase tracking-widest">视频版权匹配详情</span>
                                        <span className="px-2.5 py-1 bg-green-500/10 text-green-400 rounded-lg text-[10px] font-bold border border-green-500/20">✓ 已匹配</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <p className="text-[10px] text-gray-500 mb-1">原始视频作者</p>
                                            <p className="text-sm font-bold text-white">{videoResult.matched_asset.author_name}</p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] text-gray-500 mb-1">匹配准确度</p>
                                            <p className={`font-mono text-sm font-bold ${
                                                (videoResult.confidence || 0) >= 0.8 ? 'text-red-400' :
                                                (videoResult.confidence || 0) >= 0.5 ? 'text-amber-400' : 'text-emerald-400'
                                            }`}>{((videoResult.confidence || 0) * 100).toFixed(2)}%</p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] text-gray-500 mb-1">确权时间</p>
                                            <p className="text-white font-mono text-xs">{videoResult.matched_asset.timestamp}</p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] text-gray-500 mb-1">提取指纹</p>
                                            <p className="text-white font-mono text-xs">{videoResult.extracted_fingerprint ? `${String(videoResult.extracted_fingerprint).slice(0, 16)}...` : 'N/A'}</p>
                                        </div>
                                        <div className="col-span-2">
                                            <p className="text-[10px] text-gray-500 mb-1">资产唯一标识 (CID)</p>
                                            <p className="text-[10px] font-mono text-gray-400 bg-black/40 p-2 rounded break-all">{videoResult.matched_asset.id}</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* 未检测到指纹时的引导 */}
                            {!videoResult.has_watermark && (
                                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4">
                                    <div className="flex items-start gap-3">
                                        <BadgeCheck className="text-emerald-400 shrink-0 mt-0.5" size={16} />
                                        <div>
                                            <div className="text-sm text-emerald-300 font-medium mb-1">安全提示</div>
                                            <p className="text-xs text-gray-400 leading-relaxed mb-3">
                                                该视频未检测到已知数字指纹。为保护您的视频版权，建议立即嵌入数字指纹。
                                            </p>
                                            <button
                                                onClick={() => { setVideoDetailModalOpen(false); window.location.href = '/fingerprint'; }}
                                                className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-lg text-xs font-bold hover:shadow-lg hover:shadow-cyan-500/20 transition-all"
                                            >
                                                <Fingerprint size={14} />
                                                去嵌入视频指纹
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Modal Footer */}
                        <div className="p-4 border-t border-white/10 bg-black/20 flex-shrink-0 space-y-3">
                            <div className="flex flex-wrap gap-3 justify-center">
                                <button
                                    onClick={() => openUnifiedViewer('provenance', { source: 'batch', item: { file: { name: videoFile?.name || '视频检测' }, result: videoResult } })}
                                    disabled={viewerExporting}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:shadow-lg hover:shadow-blue-500/20 transition-all font-bold text-sm disabled:opacity-50"
                                >
                                    {viewerExporting && viewerType === 'provenance' ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                                    查看溯源鉴定报告
                                </button>
                                <button
                                    onClick={() => openUnifiedViewer('ai', { source: 'batch', item: { file: { name: videoFile?.name || '视频检测' }, result: videoResult } })}
                                    disabled={viewerExporting}
                                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl hover:shadow-lg transition-all font-bold text-sm disabled:opacity-50 ${
                                        hasFeatureAccess('report_ai')
                                            ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:shadow-violet-500/20'
                                            : 'bg-gray-700/60 text-gray-400 border border-gray-600/50'
                                    }`}
                                >
                                    {viewerExporting && viewerType === 'ai' ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                                    查看 AI 分析报告
                                    {!hasFeatureAccess('report_ai') && <span className="text-[10px] ml-1 opacity-70">个人版+</span>}
                                </button>
                                <button
                                    onClick={() => openUnifiedViewer('dmca', { source: 'batch', item: { file: { name: videoFile?.name || '视频检测' }, result: videoResult } })}
                                    disabled={viewerExporting}
                                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition-all disabled:opacity-50 ${
                                        hasFeatureAccess('dmca')
                                            ? 'bg-gradient-to-r from-red-500 to-rose-600 text-white hover:shadow-lg hover:shadow-red-500/20'
                                            : 'bg-gray-700/60 text-gray-400 border border-gray-600/50'
                                    }`}
                                >
                                    {viewerExporting && viewerType === 'dmca' ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                                    查看 DMCA 公文
                                    {!hasFeatureAccess('dmca') && <span className="text-[10px] ml-1 opacity-70">专业版+</span>}
                                </button>
                            </div>
                            <div className="flex justify-end">
                                <button
                                    onClick={() => setVideoDetailModalOpen(false)}
                                    className="px-5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 transition-all text-sm"
                                >
                                    关闭
                                </button>
                            </div>
                        </div>
                    </div>
                </div>,
                portalTarget
            )}

            {/* 批量检测失败详情弹窗 */}
            {portalTarget && batchErrorDetailOpen && batchErrorDetailItem &&
                createPortal(
                    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-[70]" onClick={() => { setBatchErrorDetailOpen(false); setBatchErrorDetailItem(null); }}>
                        <div className="glass-card w-full max-w-md border-red-500/30" onClick={(e) => e.stopPropagation()}>
                            <div className="p-6 border-b border-white/10 flex justify-between items-center bg-red-500/10 rounded-t-2xl">
                                <div>
                                    <div className="text-lg font-bold text-white flex items-center gap-2">
                                        <XCircle className="text-red-400" size={20} />
                                        检测失败详情
                                    </div>
                                    <div className="text-xs text-gray-400 mt-1 font-mono">{batchErrorDetailItem.file?.name}</div>
                                </div>
                                <button onClick={() => { setBatchErrorDetailOpen(false); setBatchErrorDetailItem(null); }} className="text-gray-400 hover:text-white">
                                    <XCircle size={22} />
                                </button>
                            </div>
                            <div className="p-6 space-y-4">
                                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
                                    <div className="text-sm font-bold text-red-400 mb-2">错误信息</div>
                                    <div className="text-sm text-gray-300 font-mono break-all">
                                        {batchErrorDetailItem.error || '未知错误，请重试'}
                                    </div>
                                </div>
                                <div className="text-xs text-gray-500 space-y-1.5">
                                    <p>· 文件名：{batchErrorDetailItem.file?.name}</p>
                                    <p>· 文件大小：{((batchErrorDetailItem.file?.size || 0) / 1024).toFixed(1)} KB</p>
                                    <p className="text-gray-600">· 可能原因：文件格式不支持、网络超时、服务器负载过高</p>
                                </div>
                                <button
                                    onClick={() => { setBatchErrorDetailOpen(false); setBatchErrorDetailItem(null); }}
                                    className="w-full px-4 py-2.5 bg-white/5 border border-white/10 text-gray-300 rounded-xl hover:bg-white/10 transition-all text-sm"
                                >
                                    关闭
                                </button>
                            </div>
                        </div>
                    </div>,
                    portalTarget
                )}

            {portalTarget &&
                upgradeModalOpen &&
                createPortal(
                    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-[80]" onClick={() => setUpgradeModalOpen(false)}>
                        <div className="glass-card w-full max-w-md border-amber-500/30" onClick={(e) => e.stopPropagation()}>
                            <div className="p-6 border-b border-white/10 flex justify-between items-center bg-amber-500/10 rounded-t-2xl">
                                <div>
                                    <div className="text-lg font-bold text-white">需要升级权限</div>
                                    <div className="text-xs text-gray-400 mt-1">当前功能：{upgradeFeatureName || '高级功能'}</div>
                                </div>
                                <button onClick={() => setUpgradeModalOpen(false)} className="text-gray-400 hover:text-white">
                                    <XCircle size={22} />
                                </button>
                            </div>
                            <div className="p-6 space-y-4">
                                <div className="text-sm text-gray-300 leading-relaxed">
                                    该功能属于付费权限范围。请升级到专业版/企业版后再使用。
                                </div>
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setUpgradeModalOpen(false)}
                                        className="flex-1 px-4 py-2.5 bg-white/5 border border-white/10 text-gray-300 rounded-xl hover:bg-white/10 transition-all text-sm"
                                    >
                                        取消
                                    </button>
                                    <button
                                        onClick={() => {
                                            setUpgradeModalOpen(false);
                                            window.location.href = '/pricing';
                                        }}
                                        className="flex-1 px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-xl hover:shadow-lg hover:shadow-amber-500/20 transition-all font-bold text-sm"
                                    >
                                        去升级
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>,
                    portalTarget
                )}

            {/* Detection History Modal */}
            {portalTarget &&
                showHistory &&
                createPortal(
                    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-enter" onClick={() => setShowHistory(false)}>
                        <div className="glass-card w-full max-w-2xl border-white/10 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                            <div className="p-6 border-b border-white/10 flex justify-between items-center flex-shrink-0">
                                <div>
                                    <div className="text-lg font-bold text-white">检测记录</div>
                                    <div className="text-xs text-gray-500 mt-1">
                                        {(() => {
                                            const localLimit = getLocalHistoryLimitByPlan(user?.plan);
                                            const planKey = getPlanKey(user?.plan);
                                            const reached = detectionHistory.length >= localLimit;
                                            return (
                                                <>
                                                    本地共 {detectionHistory.length} 条（最多保留 {localLimit} 条）
                                                    {reached && planKey !== 'pro' && planKey !== 'enterprise' && (
                                                        <span className="text-amber-400 ml-1">已达上限，升级专业版可保留更多</span>
                                                    )}
                                                </>
                                            );
                                        })()}
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={() => syncCloudDetectionRecords()}
                                        disabled={cloudSyncing}
                                        className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 transition-all disabled:opacity-50"
                                    >
                                        {cloudSyncing ? '同步中...' : '云端同步'}
                                    </button>
                                    <button
                                        onClick={() => {
                                            clearDetectionHistory();
                                            pushToast('已清空检测记录', 'success');
                                        }}
                                        className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 transition-all"
                                    >
                                        清空
                                    </button>
                                    <button onClick={() => setShowHistory(false)} className="text-gray-400 hover:text-white">
                                        <XCircle size={22} />
                                    </button>
                                </div>
                            </div>
                            <div className="p-6 space-y-3 overflow-y-auto custom-scrollbar flex-1 min-h-0">
                                {detectionHistory.length === 0 ? (
                                    <div className="text-sm text-gray-500 text-center py-8">暂无检测记录</div>
                                ) : (
                                    detectionHistory.map((h) => (
                                        <div
                                            key={h.id}
                                            className="bg-white/5 border border-white/10 rounded-xl p-4 cursor-pointer hover:bg-white/10 hover:border-white/20 transition-all"
                                            onClick={() => openHistoryDetail(h)}
                                        >
                                            <div className="flex items-center justify-between gap-4">
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-sm text-white truncate">{h.filename || '未命名'}</div>
                                                    <div className="text-[11px] text-gray-500 font-mono mt-1">{h.timestamp}</div>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    {h.confidence_level && (
                                                        <span className={`px-2 py-1 rounded-lg border text-[10px] font-bold ${getConfidenceBadgeClass(String(h.confidence_level))}`}>
                                                            {String(h.confidence_level).split('-')[0]}
                                                        </span>
                                                    )}
                                                    <div className={`text-xs font-bold ${h.hasWatermark ? 'text-green-400' : 'text-gray-400'}`}>{h.hasWatermark ? '命中指纹' : '未命中'}</div>
                                                    <ChevronRight size={14} className="text-gray-500" />
                                                </div>
                                            </div>
                                            {h.matchedAsset && (
                                                <div className="mt-3 text-xs text-gray-400">
                                                    作者：<span className="text-purple-300 font-bold">{h.matchedAsset.author_name || h.matchedAsset.user_id}</span>
                                                    {h.confidence && <span className="ml-2 text-green-400">置信度: {(h.confidence * 100).toFixed(1)}%</span>}
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}

                                <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                                    <p className="text-xs text-amber-400 text-center">💡 本地最多保存 50 条检测记录，升级专业版/企业版可云端无限存储并支持历史记录高级检索</p>
                                </div>
                            </div>
                        </div>
                    </div>, portalTarget
                )}

            {/* History Detail Modal */}
            {portalTarget &&
                historyDetailOpen &&
                historyDetailItem &&
                createPortal(
                    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50 animate-enter" onClick={closeHistoryDetail}>
                        <div className="glass-card w-full max-w-3xl border-purple-500/30 max-h-[85vh] flex flex-col min-h-0" onClick={(e) => e.stopPropagation()}>
                            <div className="p-6 border-b border-white/10 flex justify-between items-center bg-purple-500/10 rounded-t-2xl flex-shrink-0">
                                <div>
                                    <div className="text-lg font-bold text-white">检测详情</div>
                                    <div className="text-xs text-gray-400 font-mono mt-1">{historyDetailItem.filename || '未命名'}</div>
                                </div>
                                <button onClick={closeHistoryDetail} className="text-gray-400 hover:text-white">
                                    <XCircle size={22} />
                                </button>
                            </div>

                        <div className="p-6 space-y-4 overflow-y-auto custom-scrollbar flex-1 min-h-0">
                            {/* 基本信息 */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                                <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                                    <div className="text-xs text-gray-500">检测结果</div>
                                    <div className={`font-bold ${historyDetailItem.hasWatermark ? 'text-emerald-400' : 'text-gray-400'}`}>
                                        {historyDetailItem.hasWatermark ? '命中指纹' : '未命中'}
                                    </div>
                                </div>
                                <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                                    <div className="text-xs text-gray-500">检测时间</div>
                                    <div className="text-white text-xs">{historyDetailItem.timestamp}</div>
                                </div>
                                <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                                    <div className="text-xs text-gray-500">置信度</div>
                                    <div className="text-white font-bold">
                                        {historyDetailItem.confidence ? `${(historyDetailItem.confidence * 100).toFixed(2)}%` : '--'}
                                    </div>
                                </div>
                            </div>

                            {historyDetailItem.confidence_level && (
                                <div className="flex items-center gap-3">
                                    <span className={`px-3 py-1.5 rounded-xl border text-xs font-bold ${getConfidenceBadgeClass(String(historyDetailItem.confidence_level))}`}>
                                        {String(historyDetailItem.confidence_level)}
                                    </span>
                                    {historyDetailItem.legal_description && (
                                        <div className="text-xs text-gray-400">{String(historyDetailItem.legal_description)}</div>
                                    )}
                                </div>
                            )}

                            {/* 分析结论与建议 */}
                            {historyDetailItem.analysis && (
                                <div className="bg-black/30 border border-white/10 rounded-xl p-4 space-y-3">
                                    <div className="text-sm font-bold text-gray-200">检测分析结论</div>
                                    {historyDetailItem.analysis.verdict && (
                                        <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                                            {String(historyDetailItem.analysis.verdict)}
                                        </div>
                                    )}
                                    {historyDetailItem.analysis.risk_level && (
                                        <div className="flex items-center gap-2 mt-2">
                                            <span className={`inline-block w-2.5 h-2.5 rounded-full ${
                                                historyDetailItem.analysis.risk_level.color === 'red' ? 'bg-red-500' :
                                                historyDetailItem.analysis.risk_level.color === 'orange' ? 'bg-orange-500' :
                                                historyDetailItem.analysis.risk_level.color === 'yellow' ? 'bg-yellow-500' : 'bg-gray-500'
                                            }`} />
                                            <span className="text-xs text-gray-400">{historyDetailItem.analysis.risk_level.description}</span>
                                        </div>
                                    )}
                                    {historyDetailItem.analysis.suggested_action && Array.isArray(historyDetailItem.analysis.suggested_action) && (
                                        <div className="mt-2 space-y-1">
                                            <div className="text-xs text-gray-500 font-bold">建议操作</div>
                                            {historyDetailItem.analysis.suggested_action.map((s: string, i: number) => (
                                                <div key={i} className="text-xs text-gray-400">{s}</div>
                                            ))}
                                        </div>
                                    )}
                                    {historyDetailItem.analysis.evidence_strength && (
                                        <div className="mt-2 flex items-center gap-3">
                                            <div className="text-xs text-gray-500">证据强度</div>
                                            <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full transition-all ${
                                                        historyDetailItem.analysis.evidence_strength.total_strength >= 70 ? 'bg-green-500' :
                                                        historyDetailItem.analysis.evidence_strength.total_strength >= 40 ? 'bg-yellow-500' : 'bg-gray-500'
                                                    }`}
                                                    style={{ width: `${Math.min(historyDetailItem.analysis.evidence_strength.total_strength, 100)}%` }}
                                                />
                                            </div>
                                            <span className="text-xs text-gray-400 font-mono">{historyDetailItem.analysis.evidence_strength.total_strength}/100</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* 综合置信度评分 */}
                            {historyDetailItem.match_summary?.confidence_score && (
                                <div className="bg-black/30 border border-white/10 rounded-xl p-4">
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="text-sm font-bold text-gray-200">综合置信度评分</div>
                                        <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${
                                            historyDetailItem.match_summary.confidence_score.confidence_level === '高' ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                                            historyDetailItem.match_summary.confidence_score.confidence_level === '中' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' :
                                            'bg-gray-500/20 text-gray-400 border border-gray-500/30'
                                        }`}>
                                            {historyDetailItem.match_summary.confidence_score.confidence_level}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className="flex-1 h-3 bg-gray-800 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all"
                                                style={{ width: `${Math.min(historyDetailItem.match_summary.confidence_score.total_score, 100)}%` }}
                                            />
                                        </div>
                                        <span className="text-sm text-white font-bold">{historyDetailItem.match_summary.confidence_score.total_score}</span>
                                        <span className="text-xs text-gray-500">/ {historyDetailItem.match_summary.confidence_score.max_score}</span>
                                    </div>
                                    {historyDetailItem.match_summary.confidence_score.factors && (
                                        <div className="space-y-1">
                                            {historyDetailItem.match_summary.confidence_score.factors.map((f: string, i: number) => (
                                                <div key={i} className="text-[11px] text-gray-500 font-mono">{f}</div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {historyDetailItem.five_dim_score && (
                                <EvidenceVisualization
                                    fiveDimScore={historyDetailItem.five_dim_score}
                                    bitHeatmap={historyDetailItem.visualizations?.bit_heatmap}
                                    timeline={historyDetailItem.visualizations?.timeline}
                                />
                            )}

                            {/* 匹配资产信息 */}
                            {historyDetailItem.matchedAsset && (
                                <div className="bg-black/30 border border-white/10 rounded-xl p-4">
                                    <div className="text-sm font-bold text-gray-200 mb-3">匹配到的原始资产</div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                                        <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                                            <div className="text-xs text-gray-500">版权所有者</div>
                                            <div className="text-white font-bold">{historyDetailItem.matchedAsset.author_name || historyDetailItem.matchedAsset.user_id || '未知'}</div>
                                        </div>
                                        <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                                            <div className="text-xs text-gray-500">确权时间</div>
                                            <div className="text-white">{historyDetailItem.matchedAsset.timestamp || '未知'}</div>
                                        </div>
                                        <div className="bg-white/5 border border-white/10 rounded-lg p-3 md:col-span-2">
                                            <div className="text-xs text-gray-500">资产 ID</div>
                                            <div className="text-white font-mono text-xs break-all">{historyDetailItem.matchedAsset.id}</div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* 操作按钮 - 统一三入口（溯源/AI/DMCA），导出在预览弹窗中 */}
                            {historyDetailItem.hasWatermark ? (
                                <div className="flex flex-col md:flex-row flex-wrap gap-3 pt-2">
                                    <button
                                        onClick={() => openUnifiedViewer('provenance', { source: 'history', item: historyDetailItem })}
                                        disabled={viewerExporting}
                                        className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:shadow-lg hover:shadow-blue-500/20 transition-all font-bold text-sm disabled:opacity-50"
                                    >
                                        {viewerExporting && viewerType === 'provenance' ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                                        查看溯源鉴定报告
                                    </button>

                                    <button
                                        onClick={() => openUnifiedViewer('ai', { source: 'history', item: historyDetailItem })}
                                        disabled={viewerExporting}
                                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl hover:shadow-lg transition-all font-bold text-sm disabled:opacity-50 ${
                                            hasFeatureAccess('report_ai')
                                                ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:shadow-violet-500/20'
                                                : 'bg-gray-700/60 text-gray-400 border border-gray-600/50'
                                        }`}
                                    >
                                        {viewerExporting && viewerType === 'ai' ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                                        查看 AI 分析报告
                                        {!hasFeatureAccess('report_ai') && <span className="text-[10px] ml-1 opacity-70">个人版+</span>}
                                    </button>

                                    <button
                                        onClick={() => openUnifiedViewer('dmca', { source: 'history', item: historyDetailItem })}
                                        disabled={viewerExporting}
                                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold text-sm transition-all disabled:opacity-50 ${
                                            hasFeatureAccess('dmca')
                                                ? 'bg-gradient-to-r from-red-500 to-rose-600 text-white hover:shadow-lg hover:shadow-red-500/20'
                                                : 'bg-gray-700/60 text-gray-400 border border-gray-600/50'
                                        }`}
                                    >
                                        {viewerExporting && viewerType === 'dmca' ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                                        查看 DMCA 公文
                                        {!hasFeatureAccess('dmca') && <span className="text-[10px] ml-1 opacity-70">专业版+</span>}
                                    </button>
                                </div>
                            ) : (
                                /* 未命中：引导用户去嵌入指纹或下载安全凭证 */
                                <div className="p-5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
                                    <div className="flex items-start gap-4">
                                        <div className="p-3 bg-emerald-500/20 rounded-full shrink-0">
                                            <BadgeCheck className="text-emerald-400" size={24} />
                                        </div>
                                        <div className="flex-1">
                                            <div className="text-emerald-400 font-bold mb-2">安全检测结果</div>
                                            <p className="text-sm text-gray-300 leading-relaxed mb-4">
                                                该照片「{historyDetailItem.filename || '未知文件'}」已完成全网溯源检测，
                                                <span className="text-emerald-400 font-semibold">暂未发现数字指纹信息</span>，
                                                目前相对安全。但为防止未来被盗用，建议立即为作品添加数字指纹保护。
                                            </p>
                                            <div className="flex flex-wrap gap-3">
                                                <button
                                                    onClick={() => { closeHistoryDetail(); window.location.href = '/fingerprint'; }}
                                                    className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-xl hover:shadow-lg hover:shadow-cyan-500/20 transition-all font-bold text-sm"
                                                >
                                                    <Fingerprint size={16} />
                                                    去嵌入指纹
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        const fileName = historyDetailItem.filename || 'Unknown';
                                                        const timestamp = historyDetailItem.timestamp || new Date().toLocaleString();
                                                        const certId = Date.now();
                                                        const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>AIGCGuard Detection Certificate - ${fileName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Courier New', 'Arial', sans-serif; background: #0f172a; color: #e2e8f0; padding: 0; }
    .page { width: 210mm; height: 297mm; background: white; color: #0f172a; margin: 0 auto; padding: 20mm; box-shadow: 0 0 20px rgba(0,0,0,0.3); position: relative; }
    .header { background: linear-gradient(90deg, #34d399 0%, #10b981 100%); color: #0f172a; padding: 20px; text-align: center; border-radius: 8px; margin-bottom: 25px; }
    .header h1 { font-size: 24px; margin-bottom: 5px; font-weight: bold; }
    .header p { font-size: 12px; opacity: 0.8; }
    .section { margin-bottom: 20px; padding: 15px; border: 1px solid #34d399; border-radius: 6px; background: #f9fafb; }
    .section-title { color: #34d399; font-weight: bold; margin-bottom: 10px; font-size: 13px; }
    .info-row { display: flex; margin-bottom: 8px; font-size: 12px; }
    .info-label { font-weight: bold; width: 120px; color: #0f172a; }
    .info-value { flex: 1; word-break: break-all; color: #374151; }
    .footer { text-align: center; padding-top: 20px; border-top: 1px solid #34d399; margin-top: 30px; font-size: 11px; color: #6b7280; }
    .actions { display: flex; gap: 10px; margin-bottom: 20px; justify-content: center; }
    button { padding: 10px 20px; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 12px; }
    .btn-print { background: #60a5fa; color: white; }
    .btn-close { background: #ef4444; color: white; }
    @media print { body { background: white; } .page { box-shadow: none; width: 100%; height: 100%; margin: 0; padding: 0; } .actions { display: none; } }
  </style>
</head>
<body>
  <div class="actions">
    <button class="btn-print" onclick="window.print()">🖨️ 打印 / 保存为PDF</button>
    <button class="btn-close" onclick="window.close()">✕ 关闭</button>
  </div>
  <div class="page">
    <div class="header"><h1>📚 AIGCGuard 数字内容检测凭证</h1><p>Digital Content Fingerprint Detection Certificate</p></div>
    <div class="section">
      <div class="section-title">📋 文件信息 | FILE INFORMATION</div>
      <div class="info-row"><div class="info-label">文件名称:</div><div class="info-value">${fileName}</div></div>
      <div class="info-row"><div class="info-label">检测时间:</div><div class="info-value">${timestamp}</div></div>
    </div>
    <div class="section">
      <div class="section-title">✓ 检测结果 | DETECTION RESULT</div>
      <div class="info-row"><div class="info-label">检测状态:</div><div class="info-value">✓ 未检测到数字指纹 (No Watermark Found)</div></div>
      <div class="info-row"><div class="info-label">安全等级:</div><div class="info-value">100% 安全 (Safe)</div></div>
      <div class="info-row"><div class="info-label">建议:</div><div class="info-value">为该作品添加数字指纹以获得更好的保护</div></div>
    </div>
    <div class="section">
      <div class="section-title">🔐 法律意见 | LEGAL OPINION</div>
      <div class="info-row"><div class="info-value">该文件目前不存在明显的侵权特征。然而，为进一步保证你的法律权益，我们强烈建议立即为该作品添加数字指纹。</div></div>
    </div>
    <div class="footer">
      <p>🔑 凭证 ID: ${certId}</p>
      <p>📅 日期: ${new Date().toLocaleDateString()} | 发证机构: AIGCGuard</p>
    </div>
  </div>
</body>
</html>`;
                                                        const newWindow = window.open();
                                                        if (newWindow) { newWindow.document.write(htmlContent); newWindow.document.close(); }
                                                    }}
                                                    className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl hover:shadow-lg hover:shadow-emerald-500/20 transition-all font-bold text-sm"
                                                >
                                                    <FileText size={16} />
                                                    轻松下载凭证
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>, portalTarget
            )}
        </div>
    );
};

export default Monitor;
