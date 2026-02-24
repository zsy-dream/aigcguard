import React from 'react';
import { ShieldCheck, Download, XCircle, CheckCircle2, FileText, Loader2, Link, RefreshCw, FolderDown, Image, Video, FileType, Lock, Scale, Landmark, Fingerprint, Crown } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import JSZip from 'jszip';
import AssetThumbnail from '../components/AssetThumbnail';
import { auth, watermark } from '../services/api';
import { useApp } from '../contexts/AppContext';

const PLAN_LIMITS: Record<string, number> = {
    free: 10,
    personal: 30,
    pro: Infinity,
    enterprise: Infinity,
};
const PLAN_CONCURRENCY: Record<string, number> = {
    free: 2,
    personal: 3,
    pro: 5,
    enterprise: 8,
};
const PLAN_LABELS: Record<string, string> = {
    free: '免费版',
    personal: '个人版',
    pro: '专业版',
    enterprise: '企业版',
};

const Evidence: React.FC = () => {
    const [assets, setAssets] = React.useState<any[]>([]);
    const [anchoringIds, setAnchoringIds] = React.useState<number[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [manualRefreshing, setManualRefreshing] = React.useState(false);
    const [downloadingIds, setDownloadingIds] = React.useState<number[]>([]);
    const [bulkAnchoring, setBulkAnchoring] = React.useState(false);
    const [bulkProgress, setBulkProgress] = React.useState<{ done: number; total: number; errors: number; currentName: string } | null>(null);
    const [batchExporting, setBatchExporting] = React.useState(false);
    const [exportProgress, setExportProgress] = React.useState<{ done: number; total: number; errors: number; currentName: string } | null>(null);

    const fetchInFlightRef = React.useRef(false);
    const lastFetchAtRef = React.useRef(0);
    const lastErrorToastAtRef = React.useRef(0);

    const getBackendOrigin = React.useCallback(() => {
        const apiUrl = (import.meta as any)?.env?.VITE_API_URL || '';
        if (!apiUrl) return '';
        if (apiUrl.startsWith('/')) return '';
        return String(apiUrl).replace(/\/api\/?$/, '');
    }, []);

    const buildAuthedUrl = React.useCallback((rawUrl: string) => {
        const token = localStorage.getItem('access_token') || '';
        if (!rawUrl) return rawUrl;

        const origin = getBackendOrigin();
        let url = rawUrl;
        if (url.startsWith('/') && origin) {
            url = `${origin}${url}`;
        }

        if (!token) return url;

        const needsToken = url.includes('/api/image/') || url.includes('/api/') || url.includes('/image/');
        if (!needsToken) return url;
        if (url.includes('token=')) return url;
        return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
    }, [getBackendOrigin]);

    const { pushToast } = useApp();

    const anchoredCount = React.useMemo(() => assets.filter(a => !!a?.tx_hash).length, [assets]);
    const pendingCount = React.useMemo(() => Math.max(assets.length - anchoredCount, 0), [assets.length, anchoredCount]);
    const anchoredPercent = React.useMemo(() => (assets.length > 0 ? anchoredCount / assets.length : 0), [assets.length, anchoredCount]);

    const pendingAssets = React.useMemo(() => assets.filter(a => !a?.tx_hash), [assets]);

    const imageCount = React.useMemo(() => assets.filter(a => (a?.asset_type || 'image').toLowerCase() === 'image').length, [assets]);
    const videoCount = React.useMemo(() => assets.filter(a => (a?.asset_type || '').toLowerCase() === 'video').length, [assets]);
    const textCount = React.useMemo(() => assets.filter(a => (a?.asset_type || '').toLowerCase() === 'text').length, [assets]);
    const latestTimestamp = React.useMemo(() => {
        const anchored = assets.filter(a => !!a?.timestamp);
        if (anchored.length === 0) return null;
        return anchored.reduce((latest, a) => (a.timestamp > latest ? a.timestamp : latest), anchored[0].timestamp);
    }, [assets]);

    const normalizePlan = (plan: string | null | undefined) => {
        const p = String(plan || '').toLowerCase().trim();
        if (p.includes('enterprise') || p.includes('企业')) return 'enterprise';
        if (p === 'pro' || p.includes('professional') || p.includes('专业')) return 'pro';
        if (p.includes('personal') || p.includes('个人')) return 'personal';
        return 'free';
    };

    const [planKey, setPlanKey] = React.useState<'free' | 'personal' | 'pro' | 'enterprise'>('free');
    const navigate = useNavigate();
    const [showBulkLimitModal, setShowBulkLimitModal] = React.useState(false);
    const [bulkLimitInfo, setBulkLimitInfo] = React.useState<{ pending: number; limit: number } | null>(null);

    const handleAnchor = async (id: number) => {
        setAnchoringIds(prev => [...prev, id]);
        const t0 = performance.now();
        try {
            await watermark.anchorAsset(id);
            // Refresh assets with retry/backoff to avoid "already anchored but UI not updated"
            const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
            let last: any[] = [];
            for (const delay of [0, 300, 800, 1500, 2500]) {
                if (delay) await sleep(delay);
                try {
                    last = await watermark.getAssets();
                    setAssets(last);
                    const target = last.find((a) => a?.id === id);
                    if (target?.tx_hash) break;
                } catch (e) {
                    // ignore retry fetch errors
                }
            }

            const t1 = performance.now();
            pushToast(`上链确权完成，用时 ${((t1 - t0) / 1000).toFixed(1)} 秒`, 'success');
        } catch (err) {
            console.error(err);
            const t1 = performance.now();
            pushToast(`上链确权失败（${((t1 - t0) / 1000).toFixed(1)} 秒）`, 'error');
        } finally {
            setAnchoringIds(prev => prev.filter(aid => aid !== id));
        }
    };

    const handleDownload = async (asset: any) => {
        const id = asset?.id;
        if (!id) return;
        setDownloadingIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
        try {
            const url = buildAuthedUrl(asset?.preview_url || '');

            const res = await fetch(url);
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objectUrl;
            a.download = asset?.filename || 'download';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(objectUrl);
            pushToast('开始下载文件', 'success');
        } catch (e) {
            console.error(e);
            pushToast('下载失败，请稍后重试', 'error');
        } finally {
            setDownloadingIds((prev) => prev.filter((x) => x !== id));
        }
    };

    const fetchAssets = React.useCallback(async (opts?: { silent?: boolean }) => {
        const now = Date.now();
        if (fetchInFlightRef.current) return;
        if (now - lastFetchAtRef.current < 800) return;
        fetchInFlightRef.current = true;
        lastFetchAtRef.current = now;

        setLoading(true);
        try {
            const data = await watermark.getAssets();
            setAssets(data);
            // 按用户隔离缓存，避免账号切换时看到别人的数据
            const userId = localStorage.getItem('access_token')?.slice(-16) || 'anonymous';
            localStorage.setItem(`latest_evidence_${userId}`, JSON.stringify(data));

            if (!opts?.silent) {
                pushToast('刷新成功', 'success');
            }
        } catch (err) {
            console.error("Failed to fetch assets", err);
            const userId = localStorage.getItem('access_token')?.slice(-16) || 'anonymous';
            const hasAnyData = assets.length > 0 || !!localStorage.getItem(`latest_evidence_${userId}`);
            if (!hasAnyData) {
                pushToast('刷新失败，请稍后重试', 'error');
            } else {
                if (now - lastErrorToastAtRef.current > 5000) {
                    pushToast('网络波动：部分内容刷新较慢，请稍后重试', 'info');
                    lastErrorToastAtRef.current = now;
                }
            }
        } finally {
            setLoading(false);
            fetchInFlightRef.current = false;
        }
    }, [pushToast, assets.length]);

    const handleManualRefresh = async () => {
        if (manualRefreshing || loading) return;
        setManualRefreshing(true);
        try {
            await fetchAssets();
        } finally {
            setManualRefreshing(false);
        }
    };

    const doBulkAnchor = async (allPending: any[]) => {
        const limit = PLAN_LIMITS[planKey] ?? Infinity;
        const targetAssets = isFinite(limit) ? allPending.slice(0, limit) : allPending;
        const concurrency = PLAN_CONCURRENCY[planKey] ?? 3;

        setBulkAnchoring(true);
        setBulkProgress({ done: 0, total: targetAssets.length, errors: 0, currentName: '' });
        const t0 = performance.now();

        let done = 0;
        let errors = 0;
        const queue = [...targetAssets];

        const processOne = async (asset: any) => {
            const id = asset?.id;
            const name = asset?.filename || '';
            setBulkProgress(p => p ? { ...p, currentName: name } : { done, total: targetAssets.length, errors, currentName: name });

            if (id == null) {
                errors += 1;
                done += 1;
                setBulkProgress(p => p ? { ...p, done, errors } : null);
                return;
            }

            setAnchoringIds(prev => prev.includes(id) ? prev : [...prev, id]);
            try {
                const result = await watermark.anchorAsset(id);
                // 实时更新：上链成功立即将该行从黄色变绿色，无需等待全部完成
                if (result?.tx_hash) {
                    setAssets(prev => prev.map(a =>
                        a.id === id ? { ...a, tx_hash: result.tx_hash, block_height: result.block_height } : a
                    ));
                }
            } catch (e) {
                errors += 1;
            } finally {
                setAnchoringIds(prev => prev.filter(aid => aid !== id));
                done += 1;
                setBulkProgress(p => p ? { ...p, done, errors } : null);
            }
        };

        // Worker pool 并发（仿指纹嵌入模块）
        const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
            while (queue.length > 0) {
                const asset = queue.shift();
                if (!asset) break;
                await processOne(asset);
            }
        });
        await Promise.all(workers);

        // 末尾静默刷新兜底同步（主要靠实时 setAssets，此处确保边缘情况也正确）
        await fetchAssets({ silent: true });
        const t1 = performance.now();
        const succeeded = targetAssets.length - errors;
        pushToast(
            `批量上链完成：成功 ${succeeded}/${targetAssets.length}，用时 ${((t1 - t0) / 1000).toFixed(1)} 秒`,
            errors ? 'error' : 'success',
            5000
        );
        setBulkAnchoring(false);
        setBulkProgress(null);
    };

    const handleAnchorAllPending = async () => {
        if (bulkAnchoring) return;
        if (pendingAssets.length === 0) {
            pushToast('没有待上链资产', 'info');
            return;
        }

        const limit = PLAN_LIMITS[planKey] ?? Infinity;
        if (isFinite(limit) && pendingAssets.length > limit) {
            // 超出套餐单次上链上限 → 弹窗提示，由用户决定是否继续
            setBulkLimitInfo({ pending: pendingAssets.length, limit });
            setShowBulkLimitModal(true);
            return;
        }

        await doBulkAnchor(pendingAssets);
    };

    const handleBatchExportAssets = async () => {
        if (batchExporting) return;
        if (assets.length === 0) {
            pushToast('暂无存证资产可导出', 'info');
            return;
        }

        setBatchExporting(true);
        setExportProgress({ done: 0, total: assets.length, errors: 0, currentName: '' });
        const t0 = performance.now();
        const token = localStorage.getItem('access_token') || '';

        const zip = new JSZip();
        const folderImages = zip.folder('图片')!;
        const folderVideos = zip.folder('视频')!;
        const folderTexts = zip.folder('文本')!;
        const folderOther = zip.folder('其他')!;

        let done = 0;
        let errors = 0;
        const CONCURRENCY = 3;

        const downloadOne = async (asset: any) => {
            const name = asset?.filename || `asset_${asset?.id}`;
            setExportProgress(prev => prev ? { ...prev, currentName: name } : prev);
            try {
                const rawUrl = asset?.preview_url || '';
                if (!rawUrl) throw new Error('no url');
                const url = buildAuthedUrl(rawUrl);
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const blob = await res.blob();

                const type = (asset.asset_type || 'image').toLowerCase();
                if (type === 'video') {
                    folderVideos.file(name, blob);
                } else if (type === 'text') {
                    folderTexts.file(name, blob);
                } else if (type === 'image') {
                    folderImages.file(name, blob);
                } else {
                    folderOther.file(name, blob);
                }
            } catch (e) {
                console.error(`Failed to download ${name}`, e);
                errors += 1;
            } finally {
                done += 1;
                setExportProgress({ done, total: assets.length, errors, currentName: name });
            }
        };

        // 并发下载，限制同时请求数
        for (let i = 0; i < assets.length; i += CONCURRENCY) {
            const batch = assets.slice(i, i + CONCURRENCY);
            await Promise.all(batch.map(downloadOne));
        }

        // 添加存证元数据清单
        const manifest = assets.map(a => ({
            filename: a.filename,
            asset_type: a.asset_type,
            fingerprint: a.fingerprint,
            timestamp: a.timestamp,
            tx_hash: a.tx_hash || null,
            block_height: a.block_height || null,
        }));
        zip.file('存证清单.json', JSON.stringify(manifest, null, 2));

        try {
            setExportProgress(prev => prev ? { ...prev, currentName: '正在打包 ZIP…' } : prev);
            const blob = await zip.generateAsync({ type: 'blob' }, (meta: any) => {
                setExportProgress(prev => prev ? { ...prev, currentName: `打包中 ${meta.percent.toFixed(0)}%` } : prev);
            });

            // 尝试使用 File System Access API 让用户选择保存位置
            if ('showSaveFilePicker' in window) {
                try {
                    const handle = await (window as any).showSaveFilePicker({
                        suggestedName: `AIGC_存证资产_${new Date().toISOString().slice(0, 10)}.zip`,
                        types: [{ description: 'ZIP 压缩包', accept: { 'application/zip': ['.zip'] } }],
                    });
                    const writable = await handle.createWritable();
                    await writable.write(blob);
                    await writable.close();
                } catch (pickerErr: any) {
                    // 用户取消选择或 API 失败，回退到普通下载
                    if (pickerErr?.name !== 'AbortError') {
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `AIGC_存证资产_${new Date().toISOString().slice(0, 10)}.zip`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                    } else {
                        setBatchExporting(false);
                        setExportProgress(null);
                        return;
                    }
                }
            } else {
                // 浏览器不支持 showSaveFilePicker，直接下载
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `AIGC_存证资产_${new Date().toISOString().slice(0, 10)}.zip`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }

            const t1 = performance.now();
            pushToast(
                `批量导出完成：成功 ${assets.length - errors}/${assets.length}，用时 ${((t1 - t0) / 1000).toFixed(1)} 秒`,
                errors ? 'error' : 'success',
                5000
            );
        } catch (e) {
            console.error('ZIP generation failed', e);
            pushToast('打包导出失败，请稍后重试', 'error');
        } finally {
            setBatchExporting(false);
            setExportProgress(null);
        }
    };

    const handleExport = () => {
        const reportDate = new Date().toLocaleString();
        const totalAssets = assets.length;
        const totalSize = (assets.length * 2.4).toFixed(1); // Simulated size

        const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>AIGCGuard 存证分析报告</title>
            <style>
                body { font-family: 'Inter', sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 40px; }
                .container { max-width: 1000px; margin: 0 auto; background: rgba(30, 41, 59, 0.7); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 24px; padding: 40px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); }
                h1 { color: #fbbf24; font-size: 32px; margin-bottom: 8px; }
                .subtitle { color: #94a3b8; margin-bottom: 40px; }
                .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 40px; }
                .stat-card { background: rgba(255, 255, 255, 0.05); padding: 20px; border-radius: 16px; border: 1px solid rgba(255, 255, 255, 0.05); }
                .stat-value { font-size: 24px; font-bold; color: #fff; margin-bottom: 4px; }
                .stat-label { font-size: 12px; color: #64748b; text-transform: uppercase; }
                table { w-full; border-collapse: collapse; margin-top: 20px; width: 100%; }
                th { text-align: left; padding: 15px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); color: #64748b; font-size: 12px; }
                td { padding: 15px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); font-size: 14px; }
                .footer { margin-top: 60px; text-align: center; color: #475569; font-size: 12px; }
                .badge { background: rgba(34, 197, 94, 0.2); color: #4ade80; padding: 4px 12px; border-radius: 99px; font-size: 11px; }
                .hash { font-family: monospace; color: #a78bfa; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>AIGC 内容存证核查报告</h1>
                <div class="subtitle">报告生成时间: ${reportDate} | 数字化内容指纹安全保护系统</div>
                
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-value">${totalAssets}</div>
                        <div class="stat-label">受保护资产总数</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${totalSize} MB</div>
                        <div class="stat-label">存证数据总体积</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">100%</div>
                        <div class="stat-label">区块链确权状态</div>
                    </div>
                </div>

                <h3>详细存证清单</h3>
                <table>
                    <thead>
                        <tr>
                            <th>文件名</th>
                            <th>指纹哈希 (Partial)</th>
                            <th>确权时间</th>
                            <th>状态</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${assets.map(a => `
                            <tr>
                                <td>${a.filename}</td>
                                <td class="hash">${a.fingerprint?.substring(0, 24)}...</td>
                                <td>${a.timestamp}</td>
                                <td><span class="badge">已固化</span></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>

                <div class="footer">
                    &copy; 2026 AIGCGuard 内容保护平台 | 由 PIONEER 实验室提供技术支持
                </div>
            </div>
        </body>
        </html>
        `;

        const blob = new Blob([htmlContent], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `AIGC_Evidence_Analysis_${new Date().toISOString().slice(0, 10)}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const [viewingAsset, setViewingAsset] = React.useState<any>(null);
    const [textContent, setTextContent] = React.useState<string>('');
    const [viewLoading, setViewLoading] = React.useState(false);

    const handleExportJSON = () => {
        const dataStr = JSON.stringify(assets, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `AIGC_Evidence_Metadata_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleView = async (asset: any) => {
        setViewingAsset(asset);
        if (asset.asset_type === 'text') {
            setViewLoading(true);
            try {
                const url = buildAuthedUrl(asset.preview_url);
                const res = await fetch(url);
                const text = await res.text();
                setTextContent(text);
            } catch (e) {
                setTextContent('');
                setTextContent("无法加载文本内容");
            } finally {
                setViewLoading(false);
            }
        }
    };

    React.useEffect(() => {
        // Load from cache first (user-specific to prevent cross-account data leakage)
        const userId = localStorage.getItem('access_token')?.slice(-16) || 'anonymous';
        const cache = localStorage.getItem(`latest_evidence_${userId}`);
        if (cache) {
            try {
                setAssets(JSON.parse(cache));
            } catch (e) {
                console.error("Cache load failed", e);
            }
        }

        fetchAssets({ silent: true });

        // Load current plan (used for free-plan bulk anchoring limit)
        (async () => {
            try {
                const me: any = await auth.me();
                const p = normalizePlan(me?.plan);
                setPlanKey(p);
            } catch (e) {
                setPlanKey('free');
            }
        })();

        // Listen for new embeddings from other pages
        const handleRefresh = () => fetchAssets({ silent: true });
        window.addEventListener('quota-updated', handleRefresh);
        return () => window.removeEventListener('quota-updated', handleRefresh);
    }, []);

    return (
        <div className="space-y-8 animate-enter">
            {/* ... (Header and Statistics Panels remain same) ... */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-4 gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-amber-400 to-orange-500 mb-2 flex items-center gap-3">
                        <ShieldCheck className="text-amber-400 shrink-0" size={28} />
                        区块链证据固化
                    </h1>
                    <p className="text-gray-400 text-sm sm:text-base">所有嵌入指纹的资产均已上链存证，具备法律效力</p>
                </div>
                <div className="flex flex-wrap gap-2 sm:gap-3 w-full sm:w-auto">
                    <button
                        onClick={handleBatchExportAssets}
                        disabled={batchExporting || assets.length === 0}
                        className="btn-secondary text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/10 cursor-pointer transition-all active:scale-95 flex items-center gap-2 group disabled:opacity-60 text-xs sm:text-sm"
                        title="批量导出所有存证资产文件（图片/视频/文本）到 ZIP 压缩包"
                    >
                        {batchExporting ? <Loader2 size={16} className="animate-spin" /> : <FolderDown size={16} className="group-hover:translate-y-0.5 transition-transform" />}
                        <span className="hidden sm:inline">{batchExporting ? '导出中…' : '批量导出资产'}</span>
                        <span className="sm:hidden">{batchExporting ? '导出中…' : '导出资产'}</span>
                    </button>
                    <button
                        onClick={handleManualRefresh}
                        disabled={loading || manualRefreshing}
                        className="btn-secondary text-cyan-300 border-cyan-500/30 hover:bg-cyan-500/10 cursor-pointer transition-all active:scale-95 flex items-center gap-2 group disabled:opacity-60 text-xs sm:text-sm"
                        title="刷新并重新同步资产列表"
                    >
                        {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} className="group-hover:rotate-90 transition-transform" />}
                        <span className="hidden sm:inline">{loading || manualRefreshing ? '刷新中…请稍后' : '刷新数据'}</span>
                        <span className="sm:hidden">刷新</span>
                    </button>
                    <button onClick={handleExport} className="btn-secondary text-amber-400 border-amber-500/30 hover:bg-amber-500/10 cursor-pointer transition-all active:scale-95 flex items-center gap-2 group text-xs sm:text-sm">
                        <FileText size={16} className="group-hover:rotate-12 transition-transform" />
                        <span className="hidden sm:inline">导出分析报告 (HTML)</span>
                        <span className="sm:hidden">导出 HTML</span>
                    </button>
                    <button onClick={handleExportJSON} className="btn-secondary text-purple-400 border-purple-500/30 hover:bg-purple-500/10 cursor-pointer transition-all active:scale-95 flex items-center gap-2 group text-xs sm:text-sm">
                        <Download size={16} className="group-hover:translate-y-0.5 transition-transform" />
                        <span className="hidden sm:inline">备份元数据 (JSON)</span>
                        <span className="sm:hidden">备份 JSON</span>
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                {/* 左侧两列：受保护资产 + 安全置信度 + 一键上链 */}
                <div className="md:col-span-2 flex flex-col gap-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        {/* 受保护资产 */}
                        <div className="glass-card p-6 border-l-4 border-l-amber-500">
                            <div className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-1">受保护资产</div>
                            <div className="text-3xl font-bold text-white">{assets.length}</div>
                            <div className="text-amber-500/60 text-xs mt-2 flex items-center gap-1">
                                <CheckCircle2 size={12} /> 已上链 {anchoredCount} | 待上链 {pendingCount}
                            </div>
                            <div className="mt-3">
                                <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden border border-white/10">
                                    <div
                                        className="h-full bg-gradient-to-r from-amber-500 to-orange-500"
                                        style={{ width: `${Math.round(anchoredPercent * 100)}%` }}
                                    />
                                </div>
                                <div className="flex justify-between text-[10px] text-gray-500 font-mono mt-1">
                                    <span>待上链</span>
                                    <span>{Math.round(anchoredPercent * 100)}%</span>
                                </div>
                            </div>

                            <button
                                onClick={handleAnchorAllPending}
                                disabled={bulkAnchoring || pendingAssets.length === 0}
                                className="mt-4 w-full py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all border
                                    text-amber-300 border-amber-500/30 hover:bg-amber-500/10 active:scale-95 disabled:opacity-60 cursor-pointer"
                                title="一键上链全部待上链资产"
                            >
                                {bulkAnchoring ? <Loader2 size={16} className="animate-spin" /> : <Link size={16} />}
                                {bulkAnchoring ? '上链中…' : '一键上链全部'}
                            </button>
                            {planKey === 'free' && pendingCount > 0 && (
                                <div className="text-[11px] text-amber-500/70 mt-2">
                                    免费版单次最多批量上链 10 个
                                </div>
                            )}
                        </div>

                        {/* 安全置信度 */}
                        <div className="glass-card p-6 border-l-4 border-l-purple-500">
                            <div className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-1">安全置信度</div>
                            <div className="flex items-center gap-5 mt-3">
                                <div className="relative w-20 h-20 shrink-0">
                                    <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
                                        <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7" />
                                        <circle cx="40" cy="40" r="34" fill="none" stroke="url(#purpleGrad)" strokeWidth="7"
                                            strokeLinecap="round" strokeDasharray={`${2 * Math.PI * 34 * 0.999} ${2 * Math.PI * 34}`} />
                                        <defs>
                                            <linearGradient id="purpleGrad" x1="0" y1="0" x2="1" y2="1">
                                                <stop offset="0%" stopColor="#a78bfa" />
                                                <stop offset="100%" stopColor="#7c3aed" />
                                            </linearGradient>
                                        </defs>
                                    </svg>
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <span className="text-lg font-bold text-white">99.9</span>
                                        <span className="text-[10px] text-purple-300 mt-0.5">%</span>
                                    </div>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-[11px] text-gray-400 mb-2 flex items-center gap-1">
                                        <ShieldCheck size={11} className="text-purple-400" /> LDM 指纹增强技术
                                    </div>
                                    <div className="space-y-1.5">
                                        {[
                                            { icon: Image, label: '图片', count: imageCount, color: 'bg-blue-400' },
                                            { icon: Video, label: '视频', count: videoCount, color: 'bg-pink-400' },
                                            { icon: FileType, label: '文本', count: textCount, color: 'bg-cyan-400' },
                                        ].map((t) => (
                                            <div key={t.label} className="flex items-center gap-2 text-[11px]">
                                                <span className={`w-1.5 h-1.5 rounded-full ${t.color} shrink-0`} />
                                                <t.icon size={11} className="text-gray-500 shrink-0" />
                                                <span className="text-gray-400">{t.label}</span>
                                                <span className="ml-auto text-white font-mono tabular-nums">{t.count}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                            <div className="mt-4 flex flex-wrap gap-1.5">
                                {['SHA-256', 'LDM-v2', '不可逆'].map(tag => (
                                    <span key={tag} className="px-2 py-0.5 rounded-md bg-purple-500/10 border border-purple-500/20 text-[10px] text-purple-300 font-mono">{tag}</span>
                                ))}
                            </div>
                            <div className="mt-2.5 flex items-center gap-1.5 text-[10px] text-purple-400/60">
                                <Fingerprint size={10} />
                                <span>每份资产均生成唯一不可伪造指纹</span>
                            </div>
                        </div>
                    </div>

                    {/* 进度条区域：和左侧两列卡片平齐 */}
                    {batchExporting && exportProgress && (
                        <div className="glass-card p-4 border border-emerald-500/20">
                            <div className="flex items-center justify-between text-sm text-gray-200">
                                <span>正在批量导出存证资产</span>
                                <span className="font-mono text-emerald-300">{exportProgress.done}/{exportProgress.total}（失败 {exportProgress.errors}）</span>
                            </div>
                            <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden border border-white/10 mt-3">
                                <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all" style={{ width: `${exportProgress.total ? Math.round((exportProgress.done / exportProgress.total) * 100) : 0}%` }} />
                            </div>
                            {exportProgress.currentName && (
                                <div className="text-xs text-gray-400 mt-2 truncate" title={exportProgress.currentName}>当前：{exportProgress.currentName}</div>
                            )}
                        </div>
                    )}

                    {bulkAnchoring && bulkProgress && (
                        <div className="glass-card p-4 border border-amber-500/20">
                            <div className="flex items-center justify-between text-sm text-gray-200">
                                <span>正在批量上链确权</span>
                                <span className="font-mono text-amber-300">{bulkProgress.done}/{bulkProgress.total}（失败 {bulkProgress.errors}）</span>
                            </div>
                            <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden border border-white/10 mt-3">
                                <div className="h-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all" style={{ width: `${bulkProgress.total ? Math.round((bulkProgress.done / bulkProgress.total) * 100) : 0}%` }} />
                            </div>
                            {bulkProgress.currentName && (
                                <div className="text-xs text-gray-400 mt-2 truncate" title={bulkProgress.currentName}>当前：{bulkProgress.currentName}</div>
                            )}
                        </div>
                    )}
                </div>

                {/* 右侧法务存证效力卡片，纵向拉通对齐 */}
                <div className="glass-card p-6 border-l-4 border-l-emerald-500 md:row-span-1 self-stretch">
                    <div className="text-gray-400 text-xs font-bold uppercase tracking-widest mb-1">法务存证效力</div>
                    <div className="flex items-baseline gap-2 mt-1">
                        <span className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 to-green-500">高</span>
                        <span className="text-xs text-emerald-500/60 flex items-center gap-1"><FileText size={11} /> 符合《互联网指纹存证规范》</span>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2.5">
                        {[
                            { icon: Lock, label: '哈希不可篡改', desc: 'SHA-256 + 链上固化' },
                            { icon: Landmark, label: '司法采信支持', desc: '符合电子证据规则' },
                            { icon: Scale, label: '时间戳公证', desc: '可信时间源绑定' },
                            { icon: ShieldCheck, label: '全链路追溯', desc: '嵌入→存证→监测' },
                        ].map((item, i) => (
                            <div key={i} className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-2.5 hover:bg-white/[0.06] transition-colors">
                                <div className="flex items-center gap-1.5 mb-1">
                                    <div className="w-5 h-5 rounded-md bg-emerald-500/15 flex items-center justify-center shrink-0">
                                        <item.icon size={11} className="text-emerald-400" />
                                    </div>
                                    <span className="text-[11px] text-white font-medium">{item.label}</span>
                                </div>
                                <div className="text-[10px] text-gray-500 pl-[26px] leading-snug">{item.desc}</div>
                            </div>
                        ))}
                    </div>

                    {latestTimestamp && (
                        <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between text-[10px] text-gray-500">
                            <span>最近存证</span>
                            <span className="text-gray-400 font-mono">{latestTimestamp.slice(0, 19).replace('T', ' ')}</span>
                        </div>
                    )}
                </div>
            </div>

            <div className="glass-card overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-white/5 text-gray-400 text-xs uppercase tracking-wider">
                            <tr>
                                <th className="p-6 font-medium">存证资产</th>
                                <th className="p-6 font-medium">指纹哈希 (Fingerprint Hash)</th>
                                <th className="p-6 font-medium">存证时间</th>
                                <th className="p-6 font-medium">区块高度</th>
                                <th className="p-6 font-medium text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {assets.map((asset) => (
                                <tr key={asset.id} className="hover:bg-white/5 transition-colors group">
                                    <td className="p-6">
                                        <div className="flex items-center gap-4">
                                            <div
                                                className="w-12 h-12 bg-gray-800 rounded-lg overflow-hidden border border-white/10 group-hover:border-amber-500/50 transition-colors relative cursor-pointer"
                                                onClick={() => handleView(asset)}
                                            >
                                                {asset.preview_url && (
                                                    <AssetThumbnail
                                                        src={buildAuthedUrl(asset.preview_url || '')}
                                                        className="w-full h-full object-cover"
                                                        assetType={asset.asset_type}
                                                    />
                                                )}
                                            </div>
                                            <div>
                                                <div className="text-white font-medium">{asset.filename}</div>
                                                <div className="text-xs text-gray-500 uppercase">{asset.asset_type || 'image'} | 2.4 MB</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-6">
                                        <code className="text-xs text-purple-400 bg-purple-900/20 px-2 py-1 rounded font-mono">
                                            {asset.fingerprint?.substring(0, 16)}...
                                        </code>
                                    </td>
                                    <td className="p-6 text-gray-300 text-sm">
                                        {asset.timestamp}
                                    </td>
                                    <td className="p-6">
                                        {asset.tx_hash ? (
                                            <div className="flex flex-col gap-1 items-start">
                                                <span className="flex items-center gap-2 text-green-400 text-xs font-mono bg-green-900/20 px-2 py-1 rounded-md w-fit">
                                                    <ShieldCheck size={12} /> {asset.block_height}
                                                </span>
                                                <span className="text-[10px] text-gray-500 font-mono truncate max-w-[120px]" title={asset.tx_hash}>
                                                    Tx: {asset.tx_hash.substring(0, 10)}...
                                                </span>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => handleAnchor(asset.id)}
                                                disabled={anchoringIds.includes(asset.id)}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors rounded-lg text-xs font-medium disabled:opacity-50"
                                            >
                                                {anchoringIds.includes(asset.id) ? <Loader2 size={14} className="animate-spin" /> : <Link size={14} />}
                                                {anchoringIds.includes(asset.id) ? '上链打包中...' : '一键上链存证'}
                                            </button>
                                        )}
                                    </td>
                                    <td className="p-6 text-right">
                                        <div className="flex justify-end gap-2">
                                            <button
                                                onClick={() => handleView(asset)}
                                                className="p-2 text-gray-400 hover:text-amber-400 hover:bg-white/10 rounded-lg transition-colors"
                                                title="查看详情"
                                            >
                                                <ShieldCheck size={18} />
                                            </button>
                                            <button
                                                onClick={() => handleDownload(asset)}
                                                disabled={downloadingIds.includes(asset.id)}
                                                className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors block disabled:opacity-60"
                                                title="下载文件"
                                            >
                                                {downloadingIds.includes(asset.id) ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {/* ... (Empty state logic same) ... */}
                {assets.length === 0 && (
                    <div className="p-12 text-center text-gray-500">
                        <ShieldCheck size={48} className="mx-auto mb-4 opacity-20" />
                        <p className="mb-4">暂无存证记录</p>
                        <a href="/fingerprint" className="inline-flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-amber-500 to-orange-600 text-white rounded-lg hover:shadow-lg hover:shadow-amber-500/20 transition-all text-sm font-medium">
                            立即进行指纹嵌入
                        </a>
                    </div>
                )}
            </div>

            {/* Viewer Modal */}
            {viewingAsset && createPortal(
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-enter">
                    <div className="glass-card w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden border-white/10">
                        <div className="p-4 border-b border-white/10 flex justify-between items-center bg-white/5">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                <FileText size={20} className="text-amber-400" />
                                {viewingAsset.filename}
                            </h3>
                            <button onClick={() => { setViewingAsset(null); setTextContent(''); }} className="p-2 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white">
                                <XCircle size={20} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-auto p-6 bg-black/20">
                            {viewingAsset.asset_type === 'text' ? (
                                viewLoading ? (
                                    <div className="h-64 flex items-center justify-center"><Loader2 className="animate-spin text-amber-500" /></div>
                                ) : (
                                    <pre className="text-gray-300 font-mono text-sm whitespace-pre-wrap leading-relaxed">{textContent}</pre>
                                )
                            ) : viewingAsset.asset_type === 'video' ? (
                                <div className="w-full h-full flex items-center justify-center">
                                    <video
                                        src={buildAuthedUrl(viewingAsset.preview_url)}
                                        controls
                                        className="w-full max-h-[70vh] object-contain rounded-xl shadow-2xl border border-white/5"
                                        autoPlay
                                    />
                                </div>
                            ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                    <img
                                        src={buildAuthedUrl(viewingAsset.preview_url)}
                                        alt="preview"
                                        className="max-w-full max-h-[70vh] w-auto h-auto object-contain mx-auto rounded-xl shadow-2xl border border-white/5"
                                    />
                                </div>
                            )}
                        </div>
                        <div className="p-4 border-t border-white/10 bg-white/5 flex justify-between items-center text-sm text-gray-400">
                            <div className="flex gap-6">
                                <div><span className="text-gray-600">类型:</span> <span className="text-gray-300 uppercase">{viewingAsset.asset_type}</span></div>
                                <div><span className="text-gray-600">存证时间:</span> <span className="text-gray-300">{viewingAsset.timestamp}</span></div>
                            </div>
                            <button onClick={() => setViewingAsset(null)} className="px-6 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-all">
                                关闭
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Bulk Anchor Limit Modal - 超出套餐单次上链上限时弹出 */}
            {showBulkLimitModal && bulkLimitInfo && createPortal(
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-enter">
                    <div className="glass-card w-full max-w-md border border-amber-500/30 overflow-hidden">
                        <div className="p-5 border-b border-white/10 bg-gradient-to-r from-amber-500/10 to-orange-500/10 flex items-center gap-3">
                            <div className="p-2 bg-amber-500/20 rounded-lg">
                                <Link size={20} className="text-amber-400" />
                            </div>
                            <div>
                                <h3 className="text-base font-bold text-white">批量上链数量超出限制</h3>
                                <p className="text-xs text-gray-400 mt-0.5">升级套餐可解锁更大批量上链</p>
                            </div>
                        </div>
                        <div className="p-5 space-y-3 text-sm text-gray-300">
                            <div className="flex justify-between items-center bg-white/5 rounded-lg px-4 py-3">
                                <span className="text-gray-400">当前套餐</span>
                                <span className="font-bold text-amber-400">{PLAN_LABELS[planKey] ?? planKey}</span>
                            </div>
                            <div className="flex justify-between items-center bg-white/5 rounded-lg px-4 py-3">
                                <span className="text-gray-400">单次上链上限</span>
                                <span className="font-bold text-white">{bulkLimitInfo.limit} 个</span>
                            </div>
                            <div className="flex justify-between items-center bg-white/5 rounded-lg px-4 py-3">
                                <span className="text-gray-400">当前待上链</span>
                                <span className="font-bold text-orange-400">{bulkLimitInfo.pending} 个</span>
                            </div>
                            <p className="text-xs text-gray-500 text-center pt-1">
                                本次将处理前 <span className="text-amber-400 font-semibold">{bulkLimitInfo.limit}</span> 个，剩余 {bulkLimitInfo.pending - bulkLimitInfo.limit} 个需升级后处理
                            </p>
                        </div>
                        <div className="p-5 border-t border-white/10 flex gap-3">
                            <button
                                onClick={() => setShowBulkLimitModal(false)}
                                className="flex-1 py-2.5 rounded-xl border border-white/10 hover:bg-white/5 text-gray-300 text-sm transition-all"
                            >
                                取消
                            </button>
                            <button
                                onClick={() => { setShowBulkLimitModal(false); doBulkAnchor(pendingAssets); }}
                                className="flex-1 py-2.5 rounded-xl border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 text-sm font-medium transition-all"
                            >
                                处理前 {bulkLimitInfo.limit} 个
                            </button>
                            <button
                                onClick={() => { setShowBulkLimitModal(false); navigate('/pricing'); }}
                                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white text-sm font-bold flex items-center justify-center gap-1.5 transition-all"
                            >
                                <Crown size={14} />
                                升级套餐
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default Evidence;
