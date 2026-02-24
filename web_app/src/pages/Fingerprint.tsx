import React, { useState, useRef, useEffect } from 'react';
import { Upload, Sliders, ShieldCheck, Download, Loader2, Fingerprint as FingerprintIcon, FileImage, Layers, Trash2, CheckCircle2, XCircle, FileText, Film, Copy, Eye, X, AlertTriangle } from 'lucide-react';
import { watermark, auth } from '../services/api';
import { QuotaUpgradeModal } from '../components/QuotaUpgradeModal';
import { useApp } from '../contexts/AppContext';
import { supabase } from '../lib/supabase';

interface BatchFile {
    id: string;
    file: File;
    status: 'pending' | 'uploading' | 'processing' | 'done' | 'error';
    result?: any;
    error?: string;
    errorCode?: string;
    quotaDeducted?: boolean;
    uploadProgress?: number;
}

const Fingerprint: React.FC = () => {
    const { state, setEmbeddingResult: setResult, setBatchFiles, setTextResult, setVideoResult,
            setFingerprintMode, setFingerprintStrength, setFingerprintAuthor, setFingerprintTextInput } = useApp();
    
    // Use persisted workflow config from sessionStorage
    const [mode, setModeLocal] = useState<'single' | 'batch' | 'text' | 'video'>(state.fingerprintMode);
    const [strength, setStrengthLocal] = useState(state.fingerprintStrength);
    const [author, setAuthorLocal] = useState(state.fingerprintAuthor);
    const [textInput, setTextInputLocal] = useState(state.fingerprintTextInput);
    const [showQuotaModal, setShowQuotaModal] = useState(false);
    const [quotaInfo, setQuotaInfo] = useState({ used: 0, total: 10 });
    const [isExhausted, setIsExhausted] = useState(false);

    const [accessToken, setAccessToken] = useState<string>(() => localStorage.getItem('access_token') || '');

    React.useEffect(() => {
        document.title = "数字指纹嵌入 - AIGC 内容版权保护专家";
        checkQuota();
    }, []);

    React.useEffect(() => {
        const hydrateToken = async () => {
            const existing = localStorage.getItem('access_token');
            if (existing) {
                setAccessToken(existing);
                return;
            }
            try {
                const { data: { session } } = await supabase.auth.getSession();
                const token = session?.access_token || '';
                if (token) {
                    localStorage.setItem('access_token', token);
                    setAccessToken(token);
                }
            } catch (e) {
                // ignore
            }
        };
        hydrateToken();
    }, []);

    // Check user quota on load
    const checkQuota = async () => {
        try {
            const user = await auth.me();
            if (user) {
                const used = user.quota_used || 0;
                const total = user.quota_total || 10;
                setQuotaInfo({ used, total });

                // Show warning if less than 20% remaining
                const remaining = total - used;
                const percent = total > 0 ? (remaining / total) : 0;
                if (percent <= 0.2 && remaining > 0) {
                    setIsExhausted(false);
                    setShowQuotaModal(true);
                } else if (remaining <= 0) {
                    setIsExhausted(true);
                    setShowQuotaModal(true);
                }
            }
        } catch (e) {
            console.log('Quota check skipped for guest');
        }
    };

    // Sync workflow config to sessionStorage when changed
    const setMode = (newMode: 'single' | 'batch' | 'text' | 'video') => {
        setModeLocal(newMode);
        setFingerprintMode(newMode);
    };
    const setStrength = (newStrength: number) => {
        setStrengthLocal(newStrength);
        setFingerprintStrength(newStrength);
    };
    const setAuthor = (newAuthor: string) => {
        setAuthorLocal(newAuthor);
        setFingerprintAuthor(newAuthor);
    };
    const setTextInput = (newText: string) => {
        setTextInputLocal(newText);
        setFingerprintTextInput(newText);
    };

    // Single Mode State
    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [syncNotice, setSyncNotice] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Time tracking - persist via sessionStorage to survive navigation
    const [embedApiTimeMs, setEmbedApiTimeMs] = useState<number | null>(null);
    const [embedTotalTimeMs, setEmbedTotalTimeMs] = useState<number | null>(null);
    const embedStartRef = useRef<number | null>(null);
    const result = state.embeddingResult;

    // Restore timing from sessionStorage on mount
    useEffect(() => {
        const savedApi = sessionStorage.getItem('embed_time_api');
        const savedTotal = sessionStorage.getItem('embed_time_total');
        if (savedApi) setEmbedApiTimeMs(parseFloat(savedApi));
        if (savedTotal) setEmbedTotalTimeMs(parseFloat(savedTotal));
    }, []);

    // Persist timing to sessionStorage
    useEffect(() => {
        if (embedApiTimeMs != null) sessionStorage.setItem('embed_time_api', String(embedApiTimeMs));
    }, [embedApiTimeMs]);

    useEffect(() => {
        if (embedTotalTimeMs != null) sessionStorage.setItem('embed_time_total', String(embedTotalTimeMs));
    }, [embedTotalTimeMs]);

    // NOTE: Removed the "clear on mount" effect that was causing state loss when navigating away and back
    // The result, file, and preview are now preserved across navigation

    const getBackendOrigin = React.useCallback(() => {
        const apiUrl = (import.meta as any)?.env?.VITE_API_URL || '';
        if (!apiUrl) return '';
        if (String(apiUrl).startsWith('/')) return '';
        return String(apiUrl).replace(/\/api\/?$/, '');
    }, []);

    const buildAuthedUrl = React.useCallback((rawUrl: string) => {
        const token = accessToken || '';
        if (!rawUrl) return rawUrl;

        const origin = getBackendOrigin();
        let url = rawUrl;
        if (url.startsWith('/') && origin) {
            url = `${origin}${url}`;
        }

        if (!token) return url;

        // Only append token for our backend endpoints (they require token=... in query)
        const needsToken = url.includes('/api/image/') || url.includes('/api/uploads/') || url.includes('/api/') || url.includes('/image/');
        if (!needsToken) return url;

        if (url.includes('token=')) return url;
        return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
    }, [accessToken, getBackendOrigin]);

    // Batch Mode State
    const batchFiles = state.batchFiles;
    const [batchDetailItem, setBatchDetailItem] = useState<BatchFile | null>(null);
    const [batchProcessing, setBatchProcessing] = useState(false);
    const [batchProgress, setBatchProgress] = useState<{ done: number; total: number; currentName: string } | null>(null);
    const batchInputRef = useRef<HTMLInputElement>(null);

    // Text Mode State
    const textResult = state.textResult;

    // Video Mode State
    const [videoFile, setVideoFile] = useState<File | null>(null);
    const videoResult = state.videoResult;
    const videoInputRef = useRef<HTMLInputElement>(null);
    const [videoUploadProgress, setVideoUploadProgress] = useState<number>(0);
    const [videoProcessStage, setVideoProcessStage] = useState<number>(0);
    const [videoModalOpen, setVideoModalOpen] = useState(false);
    const videoStageTimerRef = useRef<number | null>(null);

    // Single Mode Handlers
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const f = e.target.files[0];
            setFile(f);
            setPreview(URL.createObjectURL(f));
            setEmbedApiTimeMs(null);
            setEmbedTotalTimeMs(null);
            embedStartRef.current = null;
            setSyncNotice(null);
            setError(null);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            const f = e.dataTransfer.files[0];
            setFile(f);
            setPreview(URL.createObjectURL(f));
            setResult(null); // Clear previous result
            setEmbedApiTimeMs(null);
            setEmbedTotalTimeMs(null);
            embedStartRef.current = null;
            setSyncNotice(null);
            setError(null);
        }
    };

    const handleSubmit = async () => {
        if (!file) return;
        setLoading(true);
        setError(null);
        setEmbedApiTimeMs(null);
        setEmbedTotalTimeMs(null);
        const startTime = performance.now();
        embedStartRef.current = startTime;

        const formData = new FormData();
        formData.append('image', file);
        formData.append('strength', strength.toString());
        formData.append('author_name', author);

        try {
            const t0 = performance.now();
            const res = await watermark.embed(formData);
            const t1 = performance.now();
            setEmbedApiTimeMs(t1 - t0);
            setEmbedTotalTimeMs(t1 - startTime);
            if (res.success) {
                setResult(res);
                setSyncNotice('已同步到个人证据库，证据固化页将自动刷新');
                // 触发全局额度更新事件
                window.dispatchEvent(new Event('quota-updated'));
            } else {
                const errorMsg = res.error === 'WATERMARK_EXISTS' ? '该图片已有数字指纹，无需重复嵌入。如需覆盖请联系管理员。'
                    : res.error === 'INVALID_IMAGE' ? '图片格式无法解析，请换用 JPG/PNG 格式重试'
                    : res.message || '嵌入失败';
                setError(res.quota_deducted === false ? `${errorMsg}（未扣费）` : errorMsg);
            }
        } catch (err: any) {
            // Handle 402 Payment Required - quota exhausted
            if (err.response?.status === 402) {
                setIsExhausted(true);
                setShowQuotaModal(true);
                setError('额度已用完，请升级套餐');
            } else {
                setError(err.response?.data?.detail || err.response?.data?.message || '嵌入失败，请重试');
            }
        } finally {
            setLoading(false);
        }
    };

    // Text Mode Handlers
    const handleTextSubmit = async () => {
        if (!textInput.trim()) return;
        setLoading(true);
        setError(null);
        try {
            const res = await watermark.embedText({ text: textInput, author_name: author });
            if (res.success) {
                setTextResult(res);
                window.dispatchEvent(new Event('quota-updated'));
            } else {
                setError(res.message);
            }
        } catch (err: any) {
            setError(err.response?.data?.detail || '文本隐写嵌入失败');
        } finally {
            setLoading(false);
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        alert('已复制到剪贴板！');
    };

    // Video Mode Handlers
    const handleVideoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setVideoFile(e.target.files[0]);
            setVideoResult(null);
            setError(null);
        }
    };

    const videoStages = [
        { label: '上传视频文件', desc: '正在将视频传输到处理服务器...' },
        { label: '抽取关键帧', desc: '每0.5秒抽取关键帧进行DCT频域分析...' },
        { label: '嵌入数字指纹', desc: '在频域系数中嵌入256位SHA256指纹...' },
        { label: 'H.264 编码', desc: '重新编码视频流，保留指纹完整性...' },
        { label: '生成下载链接', desc: '云端存证并生成安全下载链接...' },
    ];

    const handleVideoSubmit = async () => {
        if (!videoFile) return;
        setLoading(true);
        setError(null);
        setVideoUploadProgress(0);
        setVideoProcessStage(0);
        setVideoModalOpen(true);

        const formData = new FormData();
        formData.append('video', videoFile);
        formData.append('author_name', author);

        try {
            // 上传完成后自动推进处理阶段
            let uploadDone = false;
            videoStageTimerRef.current = window.setInterval(() => {
                if (!uploadDone) return;
                setVideoProcessStage(prev => {
                    if (prev < videoStages.length - 1) return prev + 1;
                    return prev;
                });
            }, 2500);

            const res = await watermark.embedVideo(formData, {
                onUploadProgress: (evt: any) => {
                    const total = evt?.total || 0;
                    const loaded = evt?.loaded || 0;
                    if (total > 0) {
                        const pct = Math.min(100, Math.round((loaded / total) * 100));
                        setVideoUploadProgress(pct);
                        if (pct >= 100 && !uploadDone) {
                            uploadDone = true;
                            setVideoProcessStage(1);
                        }
                    }
                }
            });

            if (videoStageTimerRef.current) {
                window.clearInterval(videoStageTimerRef.current);
                videoStageTimerRef.current = null;
            }

            if (res.success) {
                setVideoProcessStage(videoStages.length - 1);
                setVideoResult(res);
                window.dispatchEvent(new Event('quota-updated'));
            } else {
                setError(res.message);
            }
        } catch (err: any) {
            if (videoStageTimerRef.current) {
                window.clearInterval(videoStageTimerRef.current);
                videoStageTimerRef.current = null;
            }
            setError(err.response?.data?.detail || '视频水印嵌入失败');
        } finally {
            setLoading(false);
            setVideoModalOpen(false);
        }
    };

    // Batch Mode Handlers
    const handleBatchFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const newFiles = Array.from(e.target.files).map(f => ({
                id: Math.random().toString(36).substr(2, 9),
                file: f,
                status: 'pending' as const
            }));
            setBatchFiles((prev: BatchFile[]) => [...prev, ...newFiles]);
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
            setBatchFiles((prev: BatchFile[]) => [...prev, ...newFiles]);
        }
    };

    const removeBatchFile = (id: string) => {
        setBatchFiles((prev: BatchFile[]) => prev.filter(f => f.id !== id));
    };

    const startBatchProcessing = async () => {
        setBatchProcessing(true);
        const total = batchFiles.filter(f => f.status !== 'done').length;
        setBatchProgress({ done: 0, total, currentName: '' });

        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

        let done = 0;
        const concurrency = 5;
        const queue = batchFiles.filter(f => f.status !== 'done');

        const processOne = async (item: BatchFile) => {
            setBatchProgress((p) => (p ? { ...p, currentName: item.file?.name || '' } : { done, total, currentName: item.file?.name || '' }));
            setBatchFiles((prev: BatchFile[]) => prev.map(f => f.id === item.id ? { ...f, status: 'uploading', uploadProgress: 0 } : f));

            const formData = new FormData();
            formData.append('image', item.file);
            formData.append('strength', strength.toString());
            formData.append('author_name', author);

            try {
                const res = await watermark.embed(formData, {
                    onUploadProgress: (evt: any) => {
                        const totalBytes = evt?.total || 0;
                        const loadedBytes = evt?.loaded || 0;
                        if (totalBytes > 0) {
                            const pct = Math.max(0, Math.min(100, Math.round((loadedBytes / totalBytes) * 100)));
                            setBatchFiles((prev: BatchFile[]) => prev.map((f) => f.id === item.id ? { ...f, status: pct >= 100 ? 'processing' : 'uploading', uploadProgress: pct } : f));
                        }
                    }
                });
                if (res.success) {
                    setBatchFiles((prev: BatchFile[]) => prev.map(f => f.id === item.id ? { ...f, status: 'done', result: res } : f));
                    window.dispatchEvent(new Event('quota-updated'));
                } else {
                    const errorMsg = res.error === 'WATERMARK_EXISTS' ? '该图片已有指纹，无需重复嵌入'
                        : res.error === 'INVALID_IMAGE' ? '图片格式无法解析'
                        : res.error === 'EMBED_FAILED' ? '嵌入处理失败'
                        : res.message || '嵌入失败';
                    setBatchFiles((prev: BatchFile[]) => prev.map(f => f.id === item.id ? { ...f, status: 'error', error: errorMsg, errorCode: res.error, quotaDeducted: res.quota_deducted === true } : f));
                }
            } catch (err: any) {
                const detail = err.response?.data?.detail || err.response?.data?.message || '网络异常，请重试';
                setBatchFiles((prev: BatchFile[]) => prev.map(f => f.id === item.id ? { ...f, status: 'error', error: detail, quotaDeducted: false } : f));
            } finally {
                done += 1;
                setBatchProgress((p) => (p ? { ...p, done } : { done, total, currentName: '' }));
                await sleep(0);
            }
        };

        const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
            while (queue.length > 0) {
                const item = queue.shift();
                if (!item) break;
                await processOne(item);
            }
        });

        await Promise.all(workers);

        setBatchProcessing(false);
        setBatchProgress(null);

        // 延迟触发额度刷新：后端异步落库需要时间，等 2 秒后再让 Navbar 拉取最新额度
        setTimeout(() => {
            window.dispatchEvent(new Event('quota-updated'));
        }, 2000);
        // 再补一次 5 秒后的刷新，确保慢网络下也能同步
        setTimeout(() => {
            window.dispatchEvent(new Event('quota-updated'));
        }, 5000);
    };

    return (
        <div className="flex flex-col gap-6 h-full min-h-[600px] animate-enter">
            {/* Header & Mode Switch */}
            <div className="glass-card p-4 sm:p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2">
                        <FingerprintIcon className="text-cyan-400 shrink-0" />
                        数字指纹嵌入 (Embedding)
                    </h1>
                    <p className="text-gray-400 text-xs sm:text-sm mt-1">支持单图精细调整与批量自动化处理</p>
                </div>
                <div className="flex flex-wrap bg-black/40 p-1 rounded-xl border border-white/5 w-full md:w-auto">
                    <button
                        onClick={() => setMode('single')}
                        className={`flex-1 md:flex-none px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all flex items-center justify-center gap-1.5 sm:gap-2 ${mode === 'single' ? 'bg-cyan-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                    >
                        <FileImage size={14} /> 图片
                    </button>
                    <button
                        onClick={() => setMode('batch')}
                        className={`flex-1 md:flex-none px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all flex items-center justify-center gap-1.5 sm:gap-2 ${mode === 'batch' ? 'bg-purple-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                    >
                        <Layers size={14} /> 批量
                    </button>
                    <button
                        onClick={() => setMode('text')}
                        className={`flex-1 md:flex-none px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all flex items-center justify-center gap-1.5 sm:gap-2 ${mode === 'text' ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                    >
                        <FileText size={14} /> 文本
                    </button>
                    <button
                        onClick={() => setMode('video')}
                        className={`flex-1 md:flex-none px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all flex items-center justify-center gap-1.5 sm:gap-2 ${mode === 'video' ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                    >
                        <Film size={14} /> 视频
                    </button>
                </div>
            </div>

            {mode === 'single' ? (
                // === Single Mode UI ===
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 flex-1">
                    {/* 技术说明 */}
                    <div className="col-span-full">
                        <div className="p-4 bg-cyan-500/5 border border-cyan-500/20 rounded-xl">
                            <div className="flex items-start gap-3">
                                <FingerprintIcon className="text-cyan-400 shrink-0 mt-0.5" size={16} />
                                <div>
                                    <div className="text-sm text-cyan-300 font-medium mb-1">DCT+QIM 频域数字指纹嵌入技术</div>
                                    <p className="text-xs text-gray-400 leading-relaxed">
                                        基于离散余弦变换(DCT)将图像转换到频域，利用量化索引调制(QIM)在DCT系数中嵌入256位SHA256数字指纹。支持强度调节，强度越高抗攻击能力越强，隐蔽性与鲁棒性可平衡配置。
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                    {/* Left Panel: Upload & Config */}
                    <div className="glass-card p-4 sm:p-6 md:p-8 flex flex-col gap-6 sm:gap-8 relative overflow-hidden">
                        <div className="absolute -top-10 -right-10 opacity-[0.03] pointer-events-none rotate-12">
                            <FingerprintIcon size={300} />
                        </div>

                        <div>
                            <h2 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-500 flex items-center gap-3 mb-2">
                                <Upload className="text-cyan-400" />
                                源文件上传
                            </h2>
                            <p className="text-gray-400 text-sm">支持 JPG, PNG, HEIC 格式，最大 10MB</p>
                        </div>

                        {/* Upload Area */}
                        <div
                            className={`flex-1 min-h-[250px] border-2 border-dashed rounded-2xl flex flex-col items-center justify-center cursor-pointer transition-all relative group
                                ${preview
                                    ? 'border-cyan-500/30 bg-cyan-900/10'
                                    : 'border-white/10 hover:border-cyan-400/50 hover:bg-white/5'
                                }
                            `}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={handleDrop}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            {preview ? (
                                <div className="relative w-full h-full p-4 group">
                                    <img src={preview} alt="Preview" className="w-full h-full object-contain rounded-lg shadow-lg" />
                                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-lg">
                                        <span className="text-white font-medium flex items-center gap-2">
                                            <Upload size={16} /> 更换图片
                                        </span>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center p-8 transition-transform group-hover:scale-105 duration-300">
                                    <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4 border border-white/10 group-hover:border-cyan-400/30 group-hover:shadow-neon-blue transition-all">
                                        <FileImage className="text-gray-400 group-hover:text-cyan-400 transition-colors" size={32} />
                                    </div>
                                    <p className="text-lg font-medium text-gray-300">点击或拖拽上传</p>
                                    <p className="text-xs text-gray-500 mt-2">保护您的数字资产版权</p>
                                </div>
                            )}
                            <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*" />
                        </div>

                        {/* Controls */}
                        <div className="space-y-6">
                            <div>
                                <div className="flex justify-between mb-2">
                                    <label className="flex items-center gap-2 text-sm text-gray-300 font-medium">
                                        <Sliders size={16} className="text-primary" />
                                        嵌入强度 (Strength)
                                    </label>
                                    <span className="text-xs font-mono text-primary bg-primary/10 px-2 py-0.5 rounded">{strength}</span>
                                </div>
                                <input
                                    type="range"
                                    min="0.05"
                                    max="0.3"
                                    step="0.01"
                                    value={strength}
                                    onChange={(e) => setStrength(parseFloat(e.target.value))}
                                    className="w-full h-2 bg-gray-700/50 rounded-lg appearance-none cursor-pointer accent-primary hover:accent-primary-light transition-all"
                                />
                                <div className="flex justify-between text-[10px] text-gray-500 font-mono mt-1 uppercase tracking-wider">
                                    <span>隐蔽性优先</span>
                                    <span>抗攻击优先</span>
                                </div>
                                <div className="mt-2 text-[11px] text-gray-500 leading-relaxed">
                                    强度越高越稳健（更抗压缩/裁剪等处理），但可能略影响观感；强度越低更隐蔽，但更容易被强处理破坏。建议日常使用 0.10~0.18。
                                </div>
                            </div>

                            <div>
                                <label className="flex items-center gap-2 text-sm text-gray-300 font-medium mb-2">
                                    <ShieldCheck size={16} className="text-green-400" />
                                    版权所有者 (Author)
                                </label>
                                <input
                                    type="text"
                                    value={author}
                                    onChange={(e) => setAuthor(e.target.value)}
                                    placeholder="如: PIONEER工作室"
                                    className="input-neon"
                                />
                            </div>

                            <button
                                onClick={handleSubmit}
                                disabled={!file || loading}
                                className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all
                                    ${!file || loading
                                        ? 'bg-gray-800 text-gray-600 border border-gray-700 cursor-not-allowed'
                                        : 'btn-primary bg-gradient-to-r from-cyan-500 to-blue-600 border-none shadow-lg shadow-cyan-500/20'
                                    }`}
                            >
                                {loading ? (
                                    <>
                                        <Loader2 className="animate-spin" />
                                        正在嵌入数字指纹...
                                    </>
                                ) : (
                                    <>
                                        <FingerprintIcon />
                                        立即嵌入指纹
                                    </>
                                )}
                            </button>
                        </div>
                    </div>

                    {/* Right Panel: Result */}
                    <div className="glass-card p-4 sm:p-6 md:p-8 flex flex-col relative">
                        <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
                            <ShieldCheck className="text-green-400" />
                            处理结果
                        </h2>

                        <div className="flex-1 flex flex-col gap-4">
                            {result ? (
                                <div className="flex flex-col gap-4 animate-enter">
                                    {/* Success Banner */}
                                    <div className="bg-gradient-to-r from-green-500/20 to-emerald-600/20 border border-green-500/30 p-4 rounded-2xl flex items-start gap-3">
                                        <div className="p-2 bg-green-500 rounded-full shadow-lg shadow-green-500/30">
                                            <ShieldCheck className="text-white" size={20} />
                                        </div>
                                        <div>
                                            <h3 className="text-base font-bold text-green-400">指纹嵌入成功</h3>
                                            <p className="text-xs text-gray-300 mt-1 opacity-80">{result.message}</p>
                                            {syncNotice && (
                                                <p className="text-xs text-green-200 mt-2 opacity-90">{syncNotice}</p>
                                            )}
                                        </div>
                                    </div>

                                    {/* Result Image Preview */}
                                    {result.download_url && (
                                        <div className="bg-black/30 p-3 rounded-xl border border-white/5">
                                            <span className="text-xs text-gray-500 uppercase tracking-wider block mb-2">水印图像预览</span>
                                            <div className="relative w-full h-48 rounded-lg overflow-hidden bg-gray-900/50">
                                                <img
                                                    src={buildAuthedUrl(result.download_url)}
                                                    alt="Watermarked result"
                                                    className="w-full h-full object-contain"
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* Metrics Grid */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="bg-black/30 p-3 rounded-xl border border-white/5">
                                            <span className="text-xs text-gray-500 uppercase tracking-wider block mb-1">PSNR (画质)</span>
                                            <span className="text-2xl font-mono text-cyan-400 font-bold">{result.psnr ? result.psnr.toFixed(2) : '--'} <span className="text-xs text-gray-600 font-normal">dB</span></span>
                                        </div>
                                        <div className="bg-black/30 p-3 rounded-xl border border-white/5">
                                            <span className="text-xs text-gray-500 uppercase tracking-wider block mb-1">处理耗时 (Time)</span>
                                            <span className="text-2xl font-mono text-purple-400 font-bold">
                                                {embedTotalTimeMs != null
                                                    ? (embedTotalTimeMs / 1000).toFixed(1)
                                                    : embedApiTimeMs != null
                                                        ? (embedApiTimeMs / 1000).toFixed(1)
                                                        : result?.processing_time_sec?.toFixed(1) || '--'
                                                } <span className="text-xs text-gray-600 font-normal">秒</span>
                                            </span>
                                        </div>
                                    </div>

                                    {/* Fingerprint ID */}
                                    <div className="bg-black/30 p-3 rounded-xl border border-white/5">
                                        <span className="text-xs text-gray-500 uppercase tracking-wider block mb-2">唯一指纹标识 (Fingerprint Hash)</span>
                                        <code className="block w-full bg-black/50 p-2 rounded text-xs text-gray-400 font-mono break-all border border-white/5">
                                            {result.fingerprint || 'Generating...'}
                                        </code>
                                    </div>

                                    {/* Action Buttons - 紧跟着内容，不再用 mt-auto */}
                                    <div className="space-y-2 pt-2">
                                        {result.download_url && (
                                            <a
                                                href={buildAuthedUrl(result.download_url)}
                                                download={result.filename}
                                                className="w-full h-11 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-400 hover:to-pink-500 text-white font-bold transition-all shadow-lg shadow-purple-500/20"
                                            >
                                                <Download size={18} />
                                                下载加密图像
                                            </a>
                                        )}
                                        <button
                                            onClick={() => window.location.href = '/evidence'}
                                            className="w-full h-11 flex items-center justify-center gap-2 rounded-xl border border-white/10 hover:bg-white/5 text-gray-300 hover:text-white transition-all text-sm font-medium"
                                        >
                                            查看我的存证 (Evidence)
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex-1 flex flex-col items-center justify-center text-center opacity-40">
                                    <div className="w-32 h-32 rounded-full border-4 border-dashed border-gray-600 flex items-center justify-center mb-6 animate-pulse-slow">
                                        <ShieldCheck size={64} className="text-gray-500" />
                                    </div>
                                    <h3 className="text-xl font-bold text-gray-500 mb-2">等待处理</h3>
                                    <p className="text-sm text-gray-600 max-w-xs">请在左侧上传图像并配置参数，处理结果将在此处显示。</p>
                                </div>
                            )}
                        </div>

                        {error && (
                            <div className="mt-6 bg-red-500/10 border border-red-500/20 text-red-300 p-4 rounded-xl flex items-center gap-3 animate-enter">
                                <div className="p-1.5 bg-red-500/20 rounded-full">!</div>
                                <span>{error}</span>
                            </div>
                        )}
                    </div>
                </div>
            ) : mode === 'batch' ? (
                // === Batch Mode UI ===
                <div className="glass-card p-4 sm:p-6 md:p-8 flex-1 flex flex-col gap-6">
                    {/* 技术说明 */}
                    <div className="p-4 bg-purple-500/5 border border-purple-500/20 rounded-xl">
                        <div className="flex items-start gap-3">
                            <Layers className="text-purple-400 shrink-0 mt-0.5" size={16} />
                            <div>
                                <div className="text-sm text-purple-300 font-medium mb-1">批量并发嵌入技术</div>
                                <p className="text-xs text-gray-400 leading-relaxed">
                                    采用5路并发队列同时处理多张图片，每张图片独立执行DCT频域指纹嵌入。统一配置嵌入强度和版权所有者，自动云端存证，支持批量下载。
                                </p>
                            </div>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 h-full">
                        {/* Batch Config */}
                        <div className="lg:col-span-1 space-y-6">
                            <h2 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-500 flex items-center gap-3">
                                <Layers className="text-purple-400" />
                                批量设置 (Batch Config)
                            </h2>

                            <div>
                                <label className="flex items-center gap-2 text-sm text-gray-300 font-medium mb-2">
                                    <Sliders size={16} className="text-primary" />
                                    统一嵌入强度
                                </label>
                                <input
                                    type="range"
                                    min="0.05"
                                    max="0.3"
                                    step="0.01"
                                    value={strength}
                                    onChange={(e) => setStrength(parseFloat(e.target.value))}
                                    className="w-full h-2 bg-gray-700/50 rounded-lg appearance-none cursor-pointer accent-purple-500 hover:accent-purple-400 transition-all"
                                />
                                <div className="text-right text-xs font-mono text-purple-400">{strength}</div>
                                <div className="mt-2 text-[11px] text-gray-500 leading-relaxed">
                                    强度越高越稳健（更抗压缩/裁剪等处理），但可能略影响观感；强度越低更隐蔽，但更容易被强处理破坏。建议日常使用 0.10~0.18。
                                </div>
                            </div>

                            <div>
                                <label className="flex items-center gap-2 text-sm text-gray-300 font-medium mb-2">
                                    <ShieldCheck size={16} className="text-green-400" />
                                    统一版权所有者
                                </label>
                                <input
                                    type="text"
                                    value={author}
                                    onChange={(e) => setAuthor(e.target.value)}
                                    placeholder="如: PIONEER工作室"
                                    className="input-neon border-purple-500/30 focus:border-purple-500"
                                />
                            </div>

                            <button
                                onClick={startBatchProcessing}
                                disabled={batchFiles.length === 0 || batchProcessing}
                                className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all
                                    ${batchFiles.length === 0 || batchProcessing
                                        ? 'bg-gray-800 text-gray-600 border border-gray-700 cursor-not-allowed'
                                        : 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-500/20 hover:scale-[1.02]'
                                    }`}
                            >
                                {batchProcessing ? (
                                    <>
                                        <Loader2 className="animate-spin" />
                                        批量处理中...
                                    </>
                                ) : (
                                    <>
                                        <Layers />
                                        开始批量处理 ({batchFiles.length})
                                    </>
                                )}
                            </button>

                            {batchProcessing && batchProgress && (
                                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                                    <div className="flex items-center justify-between text-xs text-gray-300 mb-2">
                                        <span>正在上传云端并嵌入加密指纹</span>
                                        <span className="font-mono">{batchProgress.done}/{batchProgress.total}</span>
                                    </div>
                                    <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden border border-white/10">
                                        <div
                                            className="h-full bg-gradient-to-r from-purple-500 to-pink-500"
                                            style={{ width: `${batchProgress.total ? Math.round((batchProgress.done / batchProgress.total) * 100) : 0}%` }}
                                        />
                                    </div>
                                    <div className="text-[11px] text-gray-500 mt-2 leading-relaxed">
                                        正在完成：上传文件、指纹加密嵌入、生成下载链接。耗时与图片大小、网络与服务器负载有关，请耐心等待。
                                    </div>
                                    {batchProgress.currentName && (
                                        <div className="text-[11px] text-gray-400 mt-2 truncate" title={batchProgress.currentName}>
                                            当前文件：{batchProgress.currentName}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* 批量完成后：跳转证据固化 */}
                            {!batchProcessing && batchFiles.length > 0 && batchFiles.some(f => f.status === 'done') && (
                                <button
                                    onClick={() => window.location.href = '/evidence'}
                                    className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all border border-amber-500/30 text-amber-300 hover:bg-amber-500/10 hover:scale-[1.01]"
                                >
                                    <ShieldCheck size={16} />
                                    查看证据固化 (Evidence) →
                                </button>
                            )}

                            {/* Upload Area */}
                            <div
                                className="border-2 border-dashed border-white/10 hover:border-purple-500/50 hover:bg-white/5 rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all"
                                onClick={() => batchInputRef.current?.click()}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={handleBatchDrop}
                            >
                                <Upload className="text-gray-400 mb-2" size={32} />
                                <p className="text-sm text-gray-300">点击或拖拽添加更多图片</p>
                                <input type="file" ref={batchInputRef} onChange={handleBatchFileChange} className="hidden" accept="image/*" multiple />
                            </div>
                        </div>

                        {/* File Queue */}
                        <div className="lg:col-span-2 bg-black/20 rounded-xl border border-white/5 overflow-hidden flex flex-col">
                            <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/5">
                                <span className="font-medium text-gray-300 flex items-center gap-2">
                                    <FileText size={16} /> 处理队列
                                </span>
                                {batchFiles.length > 0 && (
                                    <button
                                        onClick={() => setBatchFiles([])}
                                        disabled={batchProcessing}
                                        className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 disabled:opacity-50"
                                    >
                                        <Trash2 size={12} /> 清空队列
                                    </button>
                                )}
                            </div>

                            <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar max-h-[500px]">
                                {batchFiles.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-gray-600 min-h-[300px]">
                                        <Layers size={48} className="opacity-20 mb-4" />
                                        <p>暂无文件，请添加图片</p>
                                    </div>
                                ) : (
                                    batchFiles.map((item) => (
                                        <div key={item.id} className="bg-white/5 rounded-lg p-3 flex items-center justify-between group hover:bg-white/10 transition-colors border border-white/10">
                                            <div className="flex items-center gap-3 overflow-hidden">
                                                <div className="w-12 h-12 bg-black/40 rounded overflow-hidden flex-shrink-0 border border-white/10">
                                                    {((item.file?.type || '').startsWith('image/')) ? (
                                                        <img
                                                            src={URL.createObjectURL(item.file)}
                                                            className="w-full h-full object-cover"
                                                        />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center">
                                                            <FileText size={20} className="text-gray-600" />
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="text-sm text-gray-200 truncate max-w-[200px] font-medium">{item.file.name}</div>
                                                    <div className="text-[10px] text-gray-500 font-mono">{(item.file.size / 1024 / 1024).toFixed(2)} MB</div>
                                                    {item.status === 'uploading' && typeof item.uploadProgress === 'number' && (
                                                        <div className="mt-1">
                                                            <div className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden border border-white/10">
                                                                <div
                                                                    className="h-full bg-gradient-to-r from-cyan-500 to-blue-600"
                                                                    style={{ width: `${Math.max(0, Math.min(100, item.uploadProgress))}%` }}
                                                                />
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-4">
                                                {/* Status */}
                                                {item.status === 'pending' && <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded">等待中</span>}
                                                {item.status === 'uploading' && (
                                                    <span className="text-xs text-cyan-300 flex items-center gap-1">
                                                        <Loader2 size={12} className="animate-spin" />
                                                        上传中{typeof item.uploadProgress === 'number' ? ` ${item.uploadProgress}%` : ''}
                                                    </span>
                                                )}
                                                {item.status === 'processing' && <span className="text-xs text-blue-400 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> 处理中...</span>}
                                                {item.status === 'done' && <span className="text-xs text-green-400 flex items-center gap-1"><CheckCircle2 size={12} /> 完成</span>}
                                                {item.status === 'error' && (
                                                    <div className="flex flex-col items-end gap-0.5">
                                                        <span className="text-xs text-red-400 flex items-center gap-1"><XCircle size={12} /> 失败</span>
                                                        {item.error && <span className="text-[10px] text-red-400/70 max-w-[140px] truncate" title={item.error}>{item.error}</span>}
                                                        {item.quotaDeducted === false && <span className="text-[10px] text-green-400/80">未扣费</span>}
                                                    </div>
                                                )}

                                                {/* Detail Button - visible for done and error items */}
                                                {(item.status === 'done' || item.status === 'error') && (
                                                    <button
                                                        onClick={() => setBatchDetailItem(item)}
                                                        className="p-2 bg-white/5 text-gray-400 hover:text-cyan-400 hover:bg-cyan-500/10 rounded-lg transition-colors"
                                                        title="查看详情"
                                                    >
                                                        <Eye size={16} />
                                                    </button>
                                                )}

                                                {/* Actions */}
                                                {item.status === 'done' && item.result?.download_url && (
                                                    <a
                                                        href={buildAuthedUrl(item.result.download_url)}
                                                        download
                                                        className="p-2 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition-colors"
                                                        title="下载"
                                                    >
                                                        <Download size={16} />
                                                    </a>
                                                )}

                                                {item.status !== 'processing' && item.status !== 'uploading' && (
                                                    <button
                                                        onClick={() => removeBatchFile(item.id)}
                                                        className="p-2 text-gray-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                                                        title="移除"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            ) : mode === 'text' ? (
                // === Text Mode UI ===
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 flex-1">
                    {/* 技术说明 */}
                    <div className="col-span-full">
                        <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl">
                            <div className="flex items-start gap-3">
                                <FileText className="text-blue-400 shrink-0 mt-0.5" size={16} />
                                <div>
                                    <div className="text-sm text-blue-300 font-medium mb-1">Unicode零宽字符隐写技术</div>
                                    <p className="text-xs text-gray-400 leading-relaxed">
                                        利用\u200d作为边界标记，将版权元数据编码为\u200b(0)和\u200c(1)零宽字符序列嵌入文本。人眼完全不可见，但水印随文本传播而保留，支持检测洗稿和复制粘贴。
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="glass-card p-8 flex flex-col gap-6">
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <FileText className="text-blue-400" />
                            长文本盲水印覆盖 (Zero-width Chars)
                        </h2>
                        <textarea
                            value={textInput}
                            onChange={e => setTextInput(e.target.value)}
                            placeholder="在此粘贴爆款文案、小说章节数据库... (系统会使用零宽字符技术隐藏版权元数据)"
                            className="bg-black/30 border border-white/10 rounded-xl p-4 text-gray-300 w-full h-64 resize-none transition-all placeholder:text-gray-600 focus:border-blue-500/50 outline-none custom-scrollbar"
                        ></textarea>

                        <div>
                            <label className="flex items-center gap-2 text-sm text-gray-300 font-medium mb-2">
                                <ShieldCheck size={16} className="text-green-400" />
                                版权所有者声明 (Author)
                            </label>
                            <input
                                type="text"
                                value={author}
                                onChange={(e) => setAuthor(e.target.value)}
                                placeholder="如: 星火小说网 / PIONEER"
                                className="input-neon border-blue-500/30 focus:border-blue-500"
                            />
                        </div>

                        <button
                            onClick={handleTextSubmit}
                            disabled={!textInput.trim() || loading}
                            className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all
                                ${!textInput.trim() || loading
                                    ? 'bg-gray-800 text-gray-600 border border-gray-700 cursor-not-allowed'
                                    : 'btn-primary bg-gradient-to-r from-blue-500 to-indigo-600 border-none shadow-lg shadow-blue-500/20'
                                }`}
                        >
                            {loading ? <><Loader2 className="animate-spin" /> 正在进行字素级别编码...</> : <><FingerprintIcon /> 生成抗洗稿文本</>}
                        </button>
                    </div>

                    <div className="glass-card p-8 flex flex-col">
                        <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                            <ShieldCheck className="text-green-400" /> 加工结果
                        </h2>
                        {textResult ? (
                            <div className="flex-1 flex flex-col gap-6 animate-enter">
                                <div className="bg-blue-500/10 border border-blue-500/30 p-4 rounded-xl">
                                    <p className="text-blue-300 text-sm">{textResult.message}</p>
                                </div>
                                <div className="bg-black/40 border border-white/10 rounded-xl p-4 text-gray-300 w-full flex-1 overflow-y-auto min-h-[200px] break-all">
                                    {textResult.watermarked_text}
                                </div>
                                <button
                                    onClick={() => copyToClipboard(textResult.watermarked_text)}
                                    className="w-full py-3 rounded-xl font-bold text-white bg-white/10 hover:bg-white/20 transition-all flex items-center justify-center gap-2"
                                >
                                    <Copy size={16} /> 复制已保护的文本 (用于发布)
                                </button>
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-gray-600 opacity-40">
                                <FileText size={64} className="mb-4" />
                                <p>生成的隐秘水印文本将展示在此处</p>
                            </div>
                        )}
                        {error && <div className="mt-4 text-red-400 text-sm p-3 bg-red-400/10 rounded-lg">{error}</div>}
                    </div>
                </div>
            ) : (
                // === Video Mode UI ===
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 flex-1">
                    {/* 技术说明 */}
                    <div className="col-span-full">
                        <div className="p-4 bg-indigo-500/5 border border-indigo-500/20 rounded-xl">
                            <div className="flex items-start gap-3">
                                <Film className="text-indigo-400 shrink-0 mt-0.5" size={16} />
                                <div>
                                    <div className="text-sm text-indigo-300 font-medium mb-1">视频抽帧DCT盲水印嵌入技术</div>
                                    <p className="text-xs text-gray-400 leading-relaxed">
                                        每0.5秒抽取关键帧进行DCT频域分析，在频域系数中嵌入256位数字指纹。支持H.264编码，抗转码、压缩等攻击，指纹随视频传播而保留，支持跨平台追踪溯源。
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                    {/* Left: Video Config */}
                    <div className="glass-card p-8 flex flex-col gap-6">
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <Film className="text-indigo-400" />
                            Sora/AIGC 视频级抽帧注入
                        </h2>
                        <div
                            className={`flex-1 min-h-[200px] border-2 border-dashed ${videoFile ? 'border-indigo-500/50 bg-indigo-500/10' : 'border-white/10 hover:border-indigo-400/50'} rounded-2xl flex flex-col items-center justify-center cursor-pointer transition-all`}
                            onClick={() => videoInputRef.current?.click()}
                        >
                            {videoFile ? (
                                <div className="text-center">
                                    <Film className="text-indigo-400 w-16 h-16 mx-auto mb-2" />
                                    <p className="text-white font-medium">{videoFile.name}</p>
                                    <p className="text-gray-400 text-sm mt-1">{(videoFile.size / 1024 / 1024).toFixed(2)} MB</p>
                                </div>
                            ) : (
                                <div className="text-center text-gray-400 group-hover:text-indigo-400">
                                    <Upload className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                    <p>点击上方传入视频 (最大 50MB, MP4/AVI)</p>
                                    <p className="text-xs mt-1">默认仅处理前 10 秒关键帧（抽帧注入，便于快速完成与回放验证）</p>
                                </div>
                            )}
                            <input type="file" ref={videoInputRef} onChange={handleVideoChange} accept="video/*" className="hidden" />
                        </div>

                        <div>
                            <label className="flex items-center gap-2 text-sm text-gray-300 font-medium mb-2">
                                <ShieldCheck size={16} className="text-green-400" /> 版权所有者声明
                            </label>
                            <input
                                type="text"
                                value={author}
                                onChange={(e) => setAuthor(e.target.value)}
                                placeholder="如: PIONEER VIDEO"
                                className="input-neon border-indigo-500/30 focus:border-indigo-500"
                            />
                        </div>

                        <button
                            onClick={handleVideoSubmit}
                            disabled={!videoFile || loading}
                            className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all
                                ${!videoFile || loading
                                    ? 'bg-gray-800 text-gray-600 border border-gray-700 cursor-not-allowed'
                                    : 'btn-primary bg-gradient-to-r from-indigo-500 to-purple-600 border-none shadow-lg shadow-indigo-500/20'
                                }`}
                        >
                            {loading ? <><Loader2 className="animate-spin" /> 计算关键帧并注入指纹...</> : <><Film /> 启动视频保护引擎</>}
                        </button>
                    </div>
                    {/* Right: Video Result */}
                    <div className="glass-card p-8 flex flex-col">
                        <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                            <ShieldCheck className="text-green-400" /> H264 处理看板
                        </h2>
                        {videoResult ? (
                            <div className="flex-1 flex flex-col gap-6 animate-enter">
                                <div className="bg-gradient-to-r from-green-500/20 to-emerald-600/20 border border-green-500/30 p-4 rounded-xl flex items-start gap-3">
                                    <div className="p-2 bg-green-500 rounded-full shadow-lg shadow-green-500/30">
                                        <ShieldCheck className="text-white" size={20} />
                                    </div>
                                    <div>
                                        <h3 className="text-green-400 font-bold mb-1">版权保护部署成功</h3>
                                        <p className="text-sm text-gray-300">{videoResult.message}</p>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-black/30 p-4 rounded-xl border border-white/5">
                                        <span className="text-xs text-gray-500 uppercase block mb-1">扫描总帧数</span>
                                        <span className="text-2xl font-mono text-cyan-400 font-bold">{videoResult.video_stats?.total_frames_processed ?? '--'}</span>
                                    </div>
                                    <div className="bg-black/30 p-4 rounded-xl border border-white/5">
                                        <span className="text-xs text-gray-500 uppercase block mb-1">注入水印帧数</span>
                                        <span className="text-2xl font-mono text-purple-400 font-bold">{videoResult.video_stats?.watermarked_frames ?? '--'}</span>
                                    </div>
                                </div>
                                {/* 指纹标识 */}
                                {videoResult.fingerprint_embedded && (
                                    <div className="bg-black/30 p-3 rounded-xl border border-white/5">
                                        <span className="text-xs text-gray-500 uppercase tracking-wider block mb-2">嵌入指纹标识</span>
                                        <code className="block w-full bg-black/50 p-2 rounded text-xs text-gray-400 font-mono break-all border border-white/5">
                                            {videoResult.fingerprint_embedded}
                                        </code>
                                    </div>
                                )}
                                {/* 操作按钮 */}
                                <div className="space-y-2 pt-2">
                                    {videoResult.download_url && (
                                        <a
                                            href={buildAuthedUrl(videoResult.download_url)}
                                            download
                                            className="w-full h-11 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white font-bold transition-all shadow-lg shadow-indigo-500/20"
                                        >
                                            <Download size={18} />
                                            下载已保护视频
                                        </a>
                                    )}
                                    <button
                                        onClick={() => window.location.href = '/evidence'}
                                        className="w-full h-11 flex items-center justify-center gap-2 rounded-xl border border-white/10 hover:bg-white/5 text-gray-300 hover:text-white transition-all text-sm font-medium"
                                    >
                                        查看我的存证 (Evidence)
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-gray-600 opacity-40">
                                <Film size={64} className="mb-4" />
                                <p>等待视频流分析回调</p>
                            </div>
                        )}
                        {error && <div className="mt-4 text-red-400 text-sm p-3 bg-red-400/10 rounded-lg">{error}</div>}
                    </div>
                </div>
            )}

            {/* Video Embedding Progress Modal */}
            {videoModalOpen && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50 animate-enter">
                    <div className="glass-card w-full max-w-md border-indigo-500/30">
                        <div className="p-6 border-b border-white/10 flex items-center justify-between bg-indigo-500/10 rounded-t-2xl">
                            <div className="text-lg font-bold text-white flex items-center gap-2">
                                <Loader2 className="animate-spin" size={18} />
                                视频指纹嵌入中
                            </div>
                            <div className="text-xs text-gray-400">
                                {videoProcessStage === 0
                                    ? `上传进度 ${videoUploadProgress}%`
                                    : `步骤 ${videoProcessStage + 1} / ${videoStages.length}`}
                            </div>
                        </div>
                        <div className="p-6 space-y-5">
                            {/* Upload Progress */}
                            {videoProcessStage === 0 && (
                                <div className="space-y-2">
                                    <div className="flex justify-between items-center">
                                        <span className="text-sm text-gray-300 font-medium">上传视频文件</span>
                                        <span className="text-sm text-indigo-400 font-bold">{videoUploadProgress}%</span>
                                    </div>
                                    <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-300 ease-out"
                                            style={{ width: `${videoUploadProgress}%` }}
                                        />
                                    </div>
                                    <p className="text-xs text-gray-500">视频文件较大，上传速度取决于网络带宽...</p>
                                </div>
                            )}

                            {/* Stage Steps */}
                            <div className="space-y-1">
                                {videoStages.map((stage, idx) => {
                                    const isDone = idx < videoProcessStage;
                                    const isCurrent = idx === videoProcessStage;
                                    return (
                                        <div
                                            key={idx}
                                            className={`flex items-center gap-3 p-2.5 rounded-lg transition-all duration-300 ${
                                                isCurrent ? 'bg-indigo-500/10 border border-indigo-500/20' :
                                                isDone ? 'bg-green-500/5' : 'opacity-40'
                                            }`}
                                        >
                                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                                                isDone ? 'bg-green-500 text-white' :
                                                isCurrent ? 'bg-indigo-500 text-white animate-pulse' :
                                                'bg-gray-700 text-gray-500'
                                            }`}>
                                                {isDone ? '✓' : idx + 1}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className={`text-sm font-medium ${
                                                    isDone ? 'text-green-400' : isCurrent ? 'text-white' : 'text-gray-500'
                                                }`}>{stage.label}</div>
                                                {isCurrent && (
                                                    <div className="text-[11px] text-gray-400 mt-0.5">{stage.desc}</div>
                                                )}
                                            </div>
                                            {isCurrent && <Loader2 size={14} className="animate-spin text-indigo-400 shrink-0" />}
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="flex items-center gap-2 text-xs text-gray-500 bg-black/20 p-3 rounded-lg">
                                <Film size={14} className="text-indigo-400" />
                                <span>大文件处理可能需要较长时间，请勿关闭页面</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Batch Detail Modal */}
            {batchDetailItem && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-enter" onClick={() => setBatchDetailItem(null)}>
                    <div className="bg-gray-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto custom-scrollbar" onClick={(e) => e.stopPropagation()}>
                        {/* Modal Header */}
                        <div className="flex items-center justify-between p-5 border-b border-white/10">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                {batchDetailItem.status === 'done' ? (
                                    <><CheckCircle2 className="text-green-400" size={20} /> 嵌入详情</>
                                ) : (
                                    <><AlertTriangle className="text-red-400" size={20} /> 失败详情</>
                                )}
                            </h3>
                            <button onClick={() => setBatchDetailItem(null)} className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-5 space-y-4">
                            {/* File Info */}
                            <div className="flex items-center gap-4 bg-white/5 rounded-xl p-3 border border-white/5">
                                <div className="w-16 h-16 bg-black/40 rounded-lg overflow-hidden flex-shrink-0 border border-white/10">
                                    {((batchDetailItem.file?.type || '').startsWith('image/')) ? (
                                        <img src={URL.createObjectURL(batchDetailItem.file)} className="w-full h-full object-cover" alt="原图" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center"><FileText size={24} className="text-gray-600" /></div>
                                    )}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm text-gray-200 font-medium truncate">{batchDetailItem.file.name}</div>
                                    <div className="text-xs text-gray-500 font-mono mt-0.5">{(batchDetailItem.file.size / 1024 / 1024).toFixed(2)} MB · {batchDetailItem.file.type || '未知格式'}</div>
                                </div>
                            </div>

                            {batchDetailItem.status === 'done' && batchDetailItem.result && (
                                <>
                                    {/* Success Banner */}
                                    <div className="bg-green-500/10 border border-green-500/20 p-3 rounded-xl">
                                        <p className="text-sm text-green-300">{batchDetailItem.result.message || '指纹嵌入成功'}</p>
                                    </div>

                                    {/* Watermarked Image Preview */}
                                    {batchDetailItem.result.download_url && (
                                        <div className="bg-black/30 p-3 rounded-xl border border-white/5">
                                            <span className="text-xs text-gray-500 uppercase tracking-wider block mb-2">水印图像预览</span>
                                            <div className="relative w-full h-48 rounded-lg overflow-hidden bg-gray-900/50">
                                                <img
                                                    src={buildAuthedUrl(batchDetailItem.result.download_url)}
                                                    alt="Watermarked"
                                                    className="w-full h-full object-contain"
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* Metrics */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="bg-black/30 p-3 rounded-xl border border-white/5">
                                            <span className="text-xs text-gray-500 uppercase tracking-wider block mb-1">PSNR (画质)</span>
                                            <span className="text-xl font-mono text-cyan-400 font-bold">
                                                {batchDetailItem.result.psnr ? batchDetailItem.result.psnr.toFixed(2) : '--'} <span className="text-xs text-gray-600 font-normal">dB</span>
                                            </span>
                                        </div>
                                        <div className="bg-black/30 p-3 rounded-xl border border-white/5">
                                            <span className="text-xs text-gray-500 uppercase tracking-wider block mb-1">处理耗时</span>
                                            <span className="text-xl font-mono text-purple-400 font-bold">
                                                {batchDetailItem.result.processing_time_sec?.toFixed(1) || '--'} <span className="text-xs text-gray-600 font-normal">秒</span>
                                            </span>
                                        </div>
                                    </div>

                                    {/* Fingerprint Hash */}
                                    {batchDetailItem.result.fingerprint && (
                                        <div className="bg-black/30 p-3 rounded-xl border border-white/5">
                                            <span className="text-xs text-gray-500 uppercase tracking-wider block mb-2">唯一指纹标识 (Fingerprint Hash)</span>
                                            <code className="block w-full bg-black/50 p-2 rounded text-xs text-gray-400 font-mono break-all border border-white/5">
                                                {batchDetailItem.result.fingerprint}
                                            </code>
                                        </div>
                                    )}

                                    {/* Download Button */}
                                    {batchDetailItem.result.download_url && (
                                        <a
                                            href={buildAuthedUrl(batchDetailItem.result.download_url)}
                                            download={batchDetailItem.result.filename}
                                            className="w-full h-11 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-400 hover:to-pink-500 text-white font-bold transition-all shadow-lg shadow-purple-500/20"
                                        >
                                            <Download size={18} /> 下载加密图像
                                        </a>
                                    )}
                                </>
                            )}

                            {batchDetailItem.status === 'error' && (
                                <>
                                    {/* Error Banner */}
                                    <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl">
                                        <div className="flex items-start gap-3">
                                            <div className="p-1.5 bg-red-500/20 rounded-full mt-0.5">
                                                <XCircle size={16} className="text-red-400" />
                                            </div>
                                            <div className="flex-1">
                                                <h4 className="text-sm font-bold text-red-300 mb-1">嵌入失败</h4>
                                                <p className="text-sm text-red-200/80">{batchDetailItem.error || '未知错误'}</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Error Code & Details */}
                                    {batchDetailItem.errorCode && (
                                        <div className="bg-black/30 p-3 rounded-xl border border-white/5">
                                            <span className="text-xs text-gray-500 uppercase tracking-wider block mb-2">错误代码</span>
                                            <code className="text-sm text-red-400 font-mono">{batchDetailItem.errorCode}</code>
                                        </div>
                                    )}

                                    {/* Troubleshooting */}
                                    <div className="bg-amber-500/5 border border-amber-500/20 p-4 rounded-xl">
                                        <h4 className="text-xs text-amber-300 font-medium mb-2 flex items-center gap-1.5">
                                            <AlertTriangle size={12} /> 排查建议
                                        </h4>
                                        <ul className="text-xs text-gray-400 space-y-1.5 list-disc list-inside">
                                            {batchDetailItem.errorCode === 'WATERMARK_EXISTS' && (
                                                <li>该图片已存在数字指纹，无需重复嵌入。如需覆盖请联系管理员。</li>
                                            )}
                                            {batchDetailItem.errorCode === 'INVALID_IMAGE' && (
                                                <>
                                                    <li>图片格式可能不受支持，建议转换为 JPG 或 PNG 后重试</li>
                                                    <li>图片文件可能已损坏，请检查是否能正常打开</li>
                                                </>
                                            )}
                                            {batchDetailItem.errorCode === 'EMBED_FAILED' && (
                                                <>
                                                    <li>图片分辨率可能过低，建议使用 256×256 像素以上的图片</li>
                                                    <li>服务器处理异常，请稍后重试</li>
                                                </>
                                            )}
                                            {!batchDetailItem.errorCode && (
                                                <>
                                                    <li>请检查网络连接是否稳定</li>
                                                    <li>图片格式建议使用 JPG/PNG，大小不超过 10MB</li>
                                                    <li>如持续失败请稍后重试或联系技术支持</li>
                                                </>
                                            )}
                                        </ul>
                                    </div>

                                    {/* Quota Info */}
                                    <div className="bg-black/30 p-3 rounded-xl border border-white/5 flex items-center justify-between">
                                        <span className="text-xs text-gray-500">本次是否扣费</span>
                                        {batchDetailItem.quotaDeducted === false ? (
                                            <span className="text-xs text-green-400 font-medium">未扣费</span>
                                        ) : batchDetailItem.quotaDeducted === true ? (
                                            <span className="text-xs text-amber-400 font-medium">已扣费</span>
                                        ) : (
                                            <span className="text-xs text-gray-500">--</span>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Quota Upgrade Modal */}
            <QuotaUpgradeModal
                isOpen={showQuotaModal}
                onClose={() => setShowQuotaModal(false)}
                currentQuota={quotaInfo.total - quotaInfo.used}
                totalQuota={quotaInfo.total}
                isExhausted={isExhausted}
            />
        </div>
    );
};

export default Fingerprint;
