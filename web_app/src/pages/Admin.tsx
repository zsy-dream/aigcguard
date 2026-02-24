import React from 'react';
import {
    Users, Activity, Fingerprint, Shield, Loader2, Check, X,
    Search, ChevronLeft, ChevronRight, RefreshCw, Clock,
    AlertTriangle, Link, FileText, Calendar, BarChart2, Layers
} from 'lucide-react';
import { admin, watermark, auth } from '../services/api';

// ─────────────────────────────────────────────────────────
// ImageWithSkeleton
// ─────────────────────────────────────────────────────────
const ImageWithSkeleton: React.FC<{
    src?: string | null;
    alt?: string;
    className?: string;
}> = ({ src, alt = '', className = '' }) => {
    const [loaded, setLoaded] = React.useState(false);
    const [err, setErr] = React.useState(false);

    if (!src) {
        return (
            <div className={`flex items-center justify-center bg-black/40 ${className}`}>
                <Layers size={18} className="text-gray-600" />
            </div>
        );
    }
    return (
        <div className={`relative overflow-hidden bg-black/40 ${className}`}>
            {!loaded && !err && (
                <div className="absolute inset-0 animate-pulse bg-white/5" />
            )}
            {err ? (
                <div className="absolute inset-0 flex items-center justify-center">
                    <AlertTriangle size={18} className="text-gray-600" />
                </div>
            ) : (
                <img
                    src={src}
                    alt={alt}
                    decoding="async"
                    loading="lazy"
                    className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
                    onLoad={() => setLoaded(true)}
                    onError={() => setErr(true)}
                />
            )}
        </div>
    );
};

const USER_PAGE_SIZE = 20;
const DRAWER_LIMIT = 12;

const Admin: React.FC = () => {
    // ── core ─────────────────────────────────────────────────────────────────
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);
    const [overview, setOverview] = React.useState<any>(null);
    const [summary, setSummary] = React.useState<{ users_count: number; assets_count: number } | null>(null);
    const [lastUpdated, setLastUpdated] = React.useState<Date | null>(null);
    const [summaryLoading, setSummaryLoading] = React.useState(false);
    const [activeTab, setActiveTab] = React.useState<'overview' | 'users' | 'assets'>('overview');

    // ── upgrade ──────────────────────────────────────────────────────────────
    const [upgradingUser, setUpgradingUser] = React.useState<string | null>(null);
    const [userEdits, setUserEdits] = React.useState<Record<string, { plan: string; subscription_period: string }>>({})
    const [confirmModal, setConfirmModal] = React.useState<{
        open: boolean;
        user: any | null;
        newPlan: string;
        newPeriod: string;
    }>({ open: false, user: null, newPlan: '', newPeriod: '' });

    // ── assets tab ───────────────────────────────────────────────────────────
    const [assetsLoading, setAssetsLoading] = React.useState(false);
    const [assetsError, setAssetsError] = React.useState<string | null>(null);
    const [assetsData, setAssetsData] = React.useState<{ total: number; items: any[]; offset: number; limit: number }>(
        { total: 0, items: [], offset: 0, limit: 20 }
    );

    // ── user list search & pagination ────────────────────────────────────────
    const [userSearch, setUserSearch] = React.useState('');
    const [userPage, setUserPage] = React.useState(1);

    // ── drawer ───────────────────────────────────────────────────────────────
    const [drawerUser, setDrawerUser] = React.useState<any>(null);
    const [drawerDetail, setDrawerDetail] = React.useState<any>(null);
    const [drawerDetailLoading, setDrawerDetailLoading] = React.useState(false);
    const [drawerTab, setDrawerTab] = React.useState<'assets' | 'detections' | 'timeline'>('assets');
    const [drawerAssets, setDrawerAssets] = React.useState<{ total: number; items: any[]; offset: number }>({ total: 0, items: [], offset: 0 });
    const [drawerAssetsLoading, setDrawerAssetsLoading] = React.useState(false);
    const [drawerDetections, setDrawerDetections] = React.useState<{ total: number; items: any[]; offset: number }>({ total: 0, items: [], offset: 0 });
    const [drawerDetectionsLoading, setDrawerDetectionsLoading] = React.useState(false);
    const [drawerTimeline, setDrawerTimeline] = React.useState<{ total: number; items: any[]; offset: number }>({ total: 0, items: [], offset: 0 });
    const [drawerTimelineLoading, setDrawerTimelineLoading] = React.useState(false);
    const [anchoringAsset, setAnchoringAsset] = React.useState<number | null>(null);
    const [anchorError, setAnchorError] = React.useState<string | null>(null);

    const planOptions = [
        { value: 'free', label: '免费版', color: 'text-teal-300', bg: 'bg-teal-500/20', border: 'border-teal-500/30' },
        { value: 'personal', label: '个人版', color: 'text-purple-300', bg: 'bg-purple-500/20', border: 'border-purple-500/30' },
        { value: 'pro', label: '专业版', color: 'text-amber-300', bg: 'bg-amber-500/20', border: 'border-amber-500/30' },
        { value: 'enterprise', label: '企业版', color: 'text-blue-300', bg: 'bg-blue-500/20', border: 'border-blue-500/30' },
    ];

    const periodOptions = [
        { value: 'month', label: '月付', color: 'text-blue-300', bg: 'bg-blue-500/20', border: 'border-blue-500/30' },
        { value: 'year', label: '年付', color: 'text-emerald-300', bg: 'bg-emerald-500/20', border: 'border-emerald-500/30' },
    ];

    const getPlanStyle = (plan: string) => planOptions.find(p => p.value === plan) || planOptions[0];
    const getPeriodStyle = (period: string) => periodOptions.find(p => p.value === period) || periodOptions[0];

    const loadOverview = React.useCallback(async () => {
        const data = await admin.overview();
        setOverview(data);
        setLastUpdated(new Date());
    }, []);

    const loadSummary = React.useCallback(async () => {
        try {
            const data = await admin.summary({ limit_users: 0, limit_assets: 0 });
            setSummary({ users_count: data.users_count, assets_count: data.assets_count });
        } catch { /* fallback to overview counts */ }
    }, []);

    const handleRefresh = React.useCallback(async () => {
        setSummaryLoading(true);
        try { await Promise.all([loadOverview(), loadSummary()]); }
        finally { setSummaryLoading(false); }
    }, [loadOverview, loadSummary]);

    const handleUpdateUserPlan = React.useCallback(async (userId: string, plan: string, subscriptionPeriod?: string) => {
        setUpgradingUser(userId);
        setError(null);
        try {
            await admin.updateUserPlan(userId, plan, subscriptionPeriod);
            await loadOverview();
            window.dispatchEvent(new Event('quota-updated'));
            // 如果该用户的抽屉正在打开，刷新详情
            if (drawerUser?.id === userId) {
                const res = await admin.getUserDetail(userId).catch(() => null);
                if (res?.user) {
                    setDrawerDetail(res.user);
                    setDrawerUser((prev: any) => prev ? { ...prev, plan } : prev);
                }
            }
        } catch (e: any) {
            setError(e?.message || '更新用户权限失败');
        } finally {
            setUpgradingUser(null);
        }
    }, [loadOverview, drawerUser]);

    const buildImgSrc = (url: string | undefined | null) => {
        const u = String(url || '');
        if (!u) return '';
        if (u.startsWith('/api/image/')) {
            const token = localStorage.getItem('access_token') || '';
            if (token && !u.includes('token=')) {
                const join = u.includes('?') ? '&' : '?';
                return `${u}${join}token=${encodeURIComponent(token)}`;
            }
        }
        return u;
    };

    // ── drawer helpers ────────────────────────────────────────────────────────
    const openDrawer = React.useCallback(async (user: any) => {
        setDrawerUser(user);
        setDrawerDetail(null);
        setDrawerTab('assets');
        setDrawerAssets({ total: 0, items: [], offset: 0 });
        setDrawerDetections({ total: 0, items: [], offset: 0 });
        setDrawerTimeline({ total: 0, items: [], offset: 0 });
        setAnchorError(null);
        setDrawerDetailLoading(true);
        setDrawerAssetsLoading(true);
        try {
            const [detailRes, assetsRes] = await Promise.all([
                admin.getUserDetail(user.id).catch(() => null),
                admin.getUserAssets(user.id, { limit: DRAWER_LIMIT, offset: 0 }).catch(() => null),
            ]);
            if (detailRes?.user) setDrawerDetail(detailRes.user);
            if (assetsRes) {
                setDrawerAssets({
                    total: assetsRes.total ?? 0,
                    items: assetsRes.assets ?? [],
                    offset: (assetsRes.assets ?? []).length,
                });
            }
        } finally {
            setDrawerDetailLoading(false);
            setDrawerAssetsLoading(false);
        }
    }, []);

    const closeDrawer = React.useCallback(() => {
        setDrawerUser(null);
        setDrawerDetail(null);
    }, []);

    const loadDrawerTabData = async (
        tab: 'assets' | 'detections' | 'timeline',
        userId: string,
        reset: boolean,
        currentOffset: number
    ) => {
        const offset = reset ? 0 : currentOffset;
        if (tab === 'assets') {
            setDrawerAssetsLoading(true);
            try {
                const res = await admin.getUserAssets(userId, { limit: DRAWER_LIMIT, offset });
                setDrawerAssets(prev => ({
                    total: res.total ?? prev.total,
                    items: reset ? (res.assets ?? []) : [...prev.items, ...(res.assets ?? [])],
                    offset: offset + (res.assets ?? []).length,
                }));
            } finally { setDrawerAssetsLoading(false); }
        } else if (tab === 'detections') {
            setDrawerDetectionsLoading(true);
            try {
                const res = await admin.getUserDetections(userId, { limit: DRAWER_LIMIT, offset });
                setDrawerDetections(prev => ({
                    total: res.total ?? prev.total,
                    items: reset ? (res.records ?? []) : [...prev.items, ...(res.records ?? [])],
                    offset: offset + (res.records ?? []).length,
                }));
            } finally { setDrawerDetectionsLoading(false); }
        } else {
            setDrawerTimelineLoading(true);
            try {
                const res = await admin.getUserTimeline(userId, { limit: 30, offset });
                setDrawerTimeline(prev => ({
                    total: res.total ?? prev.total,
                    items: reset ? (res.timeline ?? []) : [...prev.items, ...(res.timeline ?? [])],
                    offset: offset + (res.timeline ?? []).length,
                }));
            } finally { setDrawerTimelineLoading(false); }
        }
    };

    const handleAnchorAsset = async (assetId: number) => {
        setAnchoringAsset(assetId);
        setAnchorError(null);
        try {
            await watermark.anchorAsset(assetId);
            const update = (a: any) => a.id === assetId ? { ...a, tx_hash: 'pending' } : a;
            setDrawerAssets(prev => ({ ...prev, items: prev.items.map(update) }));
            setAssetsData(prev => ({ ...prev, items: prev.items.map(update) }));
        } catch (e: any) {
            setAnchorError(e?.message || '上链失败，请重试');
        } finally {
            setAnchoringAsset(null);
        }
    };

    // ── drawer tab auto-load ──────────────────────────────────────────────────
    React.useEffect(() => {
        if (!drawerUser) return;
        if (drawerTab === 'detections' && drawerDetections.items.length === 0 && !drawerDetectionsLoading) {
            loadDrawerTabData('detections', drawerUser.id, true, 0);
        } else if (drawerTab === 'timeline' && drawerTimeline.items.length === 0 && !drawerTimelineLoading) {
            loadDrawerTabData('timeline', drawerUser.id, true, 0);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [drawerTab, drawerUser?.id]);

    // ── computed ──────────────────────────────────────────────────────────────
    const allUsers: any[] = overview?.users || [];
    const filteredUsers = React.useMemo(() => {
        if (!userSearch.trim()) return allUsers;
        const q = userSearch.toLowerCase();
        return allUsers.filter(u =>
            (u.username || '').toLowerCase().includes(q) ||
            (u.display_name || '').toLowerCase().includes(q)
        );
    }, [allUsers, userSearch]);
    const totalUserPages = Math.max(1, Math.ceil(filteredUsers.length / USER_PAGE_SIZE));
    const paginatedUsers = filteredUsers.slice((userPage - 1) * USER_PAGE_SIZE, userPage * USER_PAGE_SIZE);
    React.useEffect(() => { setUserPage(1); }, [userSearch]);

    // ── effects ───────────────────────────────────────────────────────────────
    React.useEffect(() => {
        document.title = "管理员仪表盘 - AIGCGuard";
    }, []);

    React.useEffect(() => {
        const load = async () => {
            setLoading(true);
            setError(null);
            try {
                const me = await auth.me();
                if (me.role !== 'admin') {
                    setError('无权限访问管理员面板');
                    setOverview(null);
                    return;
                }
                await Promise.all([loadOverview(), loadSummary()]);
            } catch (e: any) {
                setError(e?.message || '加载失败');
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [loadOverview, loadSummary]);
    const loadAllAssets = async (opts?: { reset?: boolean }) => {
        const reset = !!opts?.reset;
        setAssetsLoading(true);
        setAssetsError(null);
        try {
            const limit = assetsData.limit;
            const offset = reset ? 0 : assetsData.offset;
            const res = await admin.listAssets({ limit, offset });
            const items = Array.isArray(res?.assets) ? res.assets : [];
            const total = Number(res?.total ?? 0);
            setAssetsData((prev) => {
                const nextItems = reset ? items : [...prev.items, ...items];
                return { ...prev, total, items: nextItems, offset: offset + items.length, limit };
            });
        } catch (e: any) {
            setAssetsError(e?.message || '加载资产失败');
        } finally {
            setAssetsLoading(false);
        }
    };

    React.useEffect(() => {
        if (activeTab === 'assets') {
            loadAllAssets({ reset: true });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab]);

    if (loading) {
        return (
            <div className="glass-card p-10 flex items-center justify-center gap-3 text-gray-300">
                <Loader2 className="animate-spin" size={18} />
                正在加载管理员数据...
            </div>
        );
    }

    if (error) {
        return (
            <div className="glass-card p-10 text-center text-red-300 border border-red-500/20">
                {error}
            </div>
        );
    }

    const realUsersCount = summary?.users_count ?? overview?.users_count ?? 0;
    const realAssetsCount = summary?.assets_count ?? overview?.assets_count ?? 0;

    return (
        <div className="space-y-6 animate-enter">
            {/* ── Header + Tabs ── */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-end border-b border-white/5 pb-4 gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-white mb-1 flex items-center gap-2">
                        <Shield className="text-red-400" size={24} />
                        管理员控制台
                    </h1>
                    <div className="flex items-center gap-3">
                        <p className="text-gray-400 text-sm">真实数据统计 · 用户权限管理 · 云端同步</p>
                        {lastUpdated && (
                            <span className="flex items-center gap-1 text-xs text-gray-600">
                                <Clock size={11} />
                                {lastUpdated.toLocaleTimeString('zh-CN')}
                            </span>
                        )}
                        <button
                            onClick={handleRefresh}
                            disabled={summaryLoading}
                            className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-white/5 border border-white/10 text-gray-400 hover:bg-white/10 transition-all disabled:opacity-50"
                        >
                            <RefreshCw size={11} className={summaryLoading ? 'animate-spin' : ''} />
                            刷新
                        </button>
                    </div>
                </div>
                <div className="flex bg-black/40 rounded-lg p-1 border border-white/5">
                    {(['overview', 'users', 'assets'] as const).map((tab, i) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-4 py-2 text-sm rounded-md transition-all ${activeTab === tab ? 'bg-white/10 text-white shadow-lg' : 'text-gray-400 hover:text-gray-200'}`}
                        >
                            {['数据总览', '用户管理', '资产档案'][i]}
                        </button>
                    ))}
                </div>
            </div>

            {/* ── 数据总览 ── */}
            {activeTab === 'overview' && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="glass-card p-5 border border-emerald-500/30 bg-emerald-500/5">
                            <div className="text-emerald-400 mb-2"><Users size={22} /></div>
                            <div className="text-3xl font-black text-white">{realUsersCount}</div>
                            <div className="text-xs text-emerald-400/80 mt-1">系统注册用户</div>
                        </div>
                        <div className="glass-card p-5 border border-cyan-500/30 bg-cyan-500/5">
                            <div className="text-cyan-400 mb-2"><Activity size={22} /></div>
                            <div className="text-3xl font-black text-white">{realAssetsCount}</div>
                            <div className="text-xs text-cyan-400/80 mt-1">上传资产总数</div>
                        </div>
                        <div className="glass-card p-5 border border-purple-500/30 bg-purple-500/5">
                            <div className="text-purple-400 mb-2"><Fingerprint size={22} /></div>
                            <div className="text-3xl font-black text-white">{realAssetsCount}</div>
                            <div className="text-xs text-purple-400/80 mt-1">区块链指纹存证</div>
                        </div>
                    </div>

                    {/* Recent Activity */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Latest Users */}
                        <div className="glass-card p-5">
                            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                <Users className="text-emerald-400" size={18} />
                                最新注册用户
                            </h3>
                            <div className="space-y-2 max-h-[300px] overflow-y-auto">
                                {(overview?.users || []).length === 0 ? (
                                    <div className="text-gray-500 text-sm py-4">暂无用户数据</div>
                                ) : (
                                    (overview.users || []).slice(0, 10).map((u: any) => (
                                        <div key={u.id} className="flex justify-between items-center p-3 rounded-lg bg-black/40 border border-white/5">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-sm">
                                                    {(u.display_name || u.username || 'U').charAt(0).toUpperCase()}
                                                </div>
                                                <div>
                                                    <div className="text-sm text-white">{u.display_name || u.username}</div>
                                                    <div className="text-xs text-gray-500">{u.username}</div>
                                                </div>
                                            </div>
                                            <span className={`px-2 py-1 rounded text-xs border ${getPlanStyle(u.plan || 'free').bg} ${getPlanStyle(u.plan || 'free').color} ${getPlanStyle(u.plan || 'free').border}`}>
                                                {getPlanStyle(u.plan || 'free').label}
                                            </span>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                        {/* Latest Assets */}
                        <div className="glass-card p-5">
                            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                <Activity className="text-cyan-400" size={18} />
                                最新上传资产
                            </h3>
                            <div className="space-y-2 max-h-[300px] overflow-y-auto">
                                {(overview?.assets || []).length === 0 ? (
                                    <div className="text-gray-500 text-sm py-4">暂无资产数据</div>
                                ) : (
                                    (overview.assets || []).slice(0, 10).map((a: any) => (
                                        <div key={a.id} className="flex items-center gap-3 p-3 rounded-lg bg-black/40 border border-white/5">
                                            <ImageWithSkeleton
                                                src={buildImgSrc(a.preview_url)}
                                                alt={a.filename}
                                                className="w-10 h-10 rounded-lg border border-white/10 flex-shrink-0"
                                            />
                                            <div className="min-w-0 flex-1">
                                                <div className="text-sm text-white truncate">{a.filename}</div>
                                                <div className="text-xs text-gray-500 font-mono truncate">FP: {a.fingerprint?.substring(0, 20)}...</div>
                                                <div className="text-xs text-gray-500 mt-0.5">
                                                    上传者: {a.uploader_display_name || a.uploader_username || (a.user_id ? `${String(a.user_id).slice(0, 8)}...` : '-')}
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── 用户管理 ── */}
            {activeTab === 'users' && (
                <div className="glass-card p-5">
                    {/* header */}
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
                        <div>
                            <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                <Users className="text-emerald-400" size={18} />
                                用户权限管理
                            </h3>
                            <div className="text-xs text-gray-500 mt-0.5">
                                显示最新 {filteredUsers.length} 位{userSearch ? ` (搜索: "${userSearch}")` : ''}
                                {realUsersCount > (overview?.users || []).length && (
                                    <span className="ml-1 text-gray-600">/ 共 {realUsersCount} 位</span>
                                )}
                            </div>
                        </div>
                        <div className="relative">
                            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                            <input
                                type="text"
                                placeholder="搜索邮箱 / 昵称..."
                                value={userSearch}
                                onChange={e => setUserSearch(e.target.value)}
                                className="pl-8 pr-3 py-1.5 text-xs bg-black/40 border border-white/10 rounded-lg text-gray-300 placeholder:text-gray-600 focus:outline-none focus:border-white/20 w-52"
                            />
                        </div>
                    </div>

                    {/* table */}
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm min-w-[1050px]">
                            <thead className="border-b border-white/10 text-gray-400">
                                <tr>
                                    <th className="pb-3 pl-2">用户</th>
                                    <th className="pb-3">角色</th>
                                    <th className="pb-3">当前套餐</th>
                                    <th className="pb-3">订阅周期</th>
                                    <th className="pb-3">到期时间</th>
                                    <th className="pb-3">额度使用</th>
                                    <th className="pb-3 text-right pr-2">权限操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paginatedUsers.length === 0 ? (
                                    <tr><td colSpan={7} className="py-8 text-center text-gray-500">{userSearch ? '未找到匹配用户' : '暂无用户数据'}</td></tr>
                                ) : paginatedUsers.map((u: any) => (
                                    <tr
                                        key={u.id}
                                        className="border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer"
                                        onClick={(e) => {
                                            if ((e.target as HTMLElement).closest('select,button')) return;
                                            openDrawer(u);
                                        }}
                                    >
                                        <td className="py-3 pl-2">
                                            <div className="flex items-center gap-2">
                                                <div className="w-7 h-7 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs">
                                                    {(u.display_name || u.username || 'U').charAt(0).toUpperCase()}
                                                </div>
                                                <div>
                                                    <div className="text-sm text-white">{u.display_name || u.username}</div>
                                                    <div className="text-xs text-gray-500">{u.username?.includes('@') ? u.username : u.id?.substring(0, 8)}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="py-3">
                                            <span className={`px-2 py-1 rounded text-xs border ${u.role === 'admin' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-gray-500/10 text-gray-400 border-gray-500/20'}`}>
                                                {u.role || 'user'}
                                            </span>
                                        </td>
                                        <td className="py-3">
                                            <span className={`px-2 py-1 rounded text-xs border ${getPlanStyle(u.plan || 'free').bg} ${getPlanStyle(u.plan || 'free').color} ${getPlanStyle(u.plan || 'free').border}`}>
                                                {getPlanStyle(u.plan || 'free').label}
                                            </span>
                                        </td>
                                        <td className="py-3">
                                            {u.subscription_period ? (
                                                <span className={`px-2 py-1 rounded text-xs border ${u.subscription_period === 'year' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-blue-500/10 text-blue-400 border-blue-500/20'}`}>
                                                    {u.subscription_period === 'month' ? '月付' : '年付'}
                                                </span>
                                            ) : <span className="text-xs text-gray-500">-</span>}
                                        </td>
                                        <td className="py-3 text-xs text-gray-300">
                                            {u.subscription_expires_at ? (
                                                <span className={u.subscription_status === 'expired' ? 'text-red-400' : 'text-emerald-400'}>
                                                    {new Date(u.subscription_expires_at).toLocaleDateString('zh-CN')}
                                                    {u.subscription_status === 'expired' && ' (已过期)'}
                                                </span>
                                            ) : <span className="text-gray-500">-</span>}
                                        </td>
                                        <td className="py-3 text-xs text-gray-300 font-mono">
                                            <div className="flex flex-col gap-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] text-gray-500 w-12">嵌入额度</span>
                                                    <span>{Number(u.quota_embed_used ?? 0)}/{Number(u.quota_embed_total ?? 0)}</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] text-gray-500 w-12">检测额度</span>
                                                    <span>{Number(u.quota_detect_used ?? 0)}/{Number(u.quota_detect_total ?? 0)}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="py-3 text-right pr-2">
                                            {u.role !== 'admin' && (
                                                <div className="flex justify-end items-center gap-2">
                                                    <select
                                                        value={String(userEdits[u.id]?.plan ?? u.plan ?? 'free')}
                                                        disabled={upgradingUser === u.id}
                                                        onClick={e => e.stopPropagation()}
                                                        onChange={e => {
                                                            const np = e.target.value;
                                                            const cp = userEdits[u.id]?.subscription_period ?? u.subscription_period ?? 'month';
                                                            setUserEdits(prev => ({ ...prev, [u.id]: { plan: np, subscription_period: np === 'free' ? '' : cp } }));
                                                        }}
                                                        className={`px-2 py-1 border rounded text-xs disabled:opacity-50 w-[92px] ${getPlanStyle(userEdits[u.id]?.plan ?? u.plan ?? 'free').bg} ${getPlanStyle(userEdits[u.id]?.plan ?? u.plan ?? 'free').border} ${getPlanStyle(userEdits[u.id]?.plan ?? u.plan ?? 'free').color}`}
                                                    >
                                                        {planOptions.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                                                    </select>
                                                    <select
                                                        value={String(userEdits[u.id]?.subscription_period ?? u.subscription_period ?? 'month')}
                                                        disabled={upgradingUser === u.id || String(userEdits[u.id]?.plan ?? u.plan ?? 'free') === 'free'}
                                                        onClick={e => e.stopPropagation()}
                                                        onChange={e => {
                                                            const np2 = e.target.value;
                                                            const cp2 = userEdits[u.id]?.plan ?? u.plan ?? 'free';
                                                            setUserEdits(prev => ({ ...prev, [u.id]: { plan: cp2, subscription_period: np2 } }));
                                                        }}
                                                        className={`px-2 py-1 border rounded text-xs disabled:opacity-50 w-[72px] ${getPeriodStyle(userEdits[u.id]?.subscription_period ?? u.subscription_period ?? 'month').bg} ${getPeriodStyle(userEdits[u.id]?.subscription_period ?? u.subscription_period ?? 'month').border} ${getPeriodStyle(userEdits[u.id]?.subscription_period ?? u.subscription_period ?? 'month').color}`}
                                                    >
                                                        {periodOptions.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                                                    </select>
                                                    <button
                                                        onClick={e => {
                                                            e.stopPropagation();
                                                            const np3 = userEdits[u.id]?.plan ?? u.plan ?? 'free';
                                                            const np4 = userEdits[u.id]?.subscription_period ?? u.subscription_period ?? 'month';
                                                            setConfirmModal({ open: true, user: u, newPlan: np3, newPeriod: np4 });
                                                        }}
                                                        disabled={upgradingUser === u.id}
                                                        className="px-3 py-1 rounded text-xs bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30 disabled:opacity-50 transition-colors"
                                                    >确认</button>
                                                    {upgradingUser === u.id && <Loader2 size={14} className="animate-spin text-cyan-400" />}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* pagination */}
                    {totalUserPages > 1 && (
                        <div className="mt-4 flex items-center justify-between text-xs text-gray-400">
                            <span>第 {userPage} / {totalUserPages} 页</span>
                            <div className="flex items-center gap-1">
                                <button onClick={() => setUserPage(p => Math.max(1, p - 1))} disabled={userPage === 1}
                                    className="p-1.5 rounded bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-40 transition-all">
                                    <ChevronLeft size={14} />
                                </button>
                                {Array.from({ length: totalUserPages }, (_, i) => i + 1)
                                    .filter(p => p === 1 || p === totalUserPages || Math.abs(p - userPage) <= 1)
                                    .reduce<(number | string)[]>((acc, p, i, arr) => {
                                        if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push('…');
                                        acc.push(p); return acc;
                                    }, []).map((p, i) =>
                                        p === '…' ? <span key={`e${i}`} className="px-1">…</span> : (
                                            <button key={p} onClick={() => setUserPage(p as number)}
                                                className={`w-7 h-7 rounded text-xs transition-all ${userPage === p ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-500/40' : 'bg-white/5 border border-white/10 hover:bg-white/10'}`}>
                                                {p}
                                            </button>
                                        )
                                    )}
                                <button onClick={() => setUserPage(p => Math.min(totalUserPages, p + 1))} disabled={userPage === totalUserPages}
                                    className="p-1.5 rounded bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-40 transition-all">
                                    <ChevronRight size={14} />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── 资产档案 ── */}
            {activeTab === 'assets' && (
                <div className="glass-card p-5">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <div className="text-lg font-bold text-white">资产档案（全部）</div>
                            <div className="text-xs text-gray-400 mt-1">共 {assetsData.total} 条</div>
                        </div>
                        <button onClick={() => loadAllAssets({ reset: true })} disabled={assetsLoading}
                            className="px-3 py-2 text-xs rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 transition-all disabled:opacity-50">刷新</button>
                    </div>
                    {assetsError && (
                        <div className="p-4 text-sm text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl mb-4">{assetsError}</div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {assetsData.items.map((a: any) => (
                            <div key={a.id} className="bg-black/30 border border-white/10 rounded-xl overflow-hidden">
                                <ImageWithSkeleton
                                    src={buildImgSrc(a.preview_url)}
                                    alt={a.filename}
                                    className="h-40 border-b border-white/10"
                                />
                                <div className="p-3">
                                    <div className="flex items-start justify-between gap-2 mb-1">
                                        <div className="text-sm text-white truncate flex-1">{a.filename}</div>
                                        {a.tx_hash ? (
                                            <span className="flex-shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                                                <Link size={9} />已上链
                                            </span>
                                        ) : (
                                            <button
                                                onClick={() => handleAnchorAsset(a.id)}
                                                disabled={anchoringAsset === a.id}
                                                className="flex-shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-gray-500/15 text-gray-400 border border-gray-500/25 hover:bg-cyan-500/20 hover:text-cyan-300 hover:border-cyan-500/30 transition-colors disabled:opacity-50"
                                            >
                                                {anchoringAsset === a.id ? <Loader2 size={9} className="animate-spin" /> : <Link size={9} />}
                                                上链
                                            </button>
                                        )}
                                    </div>
                                    <div className="text-[11px] text-gray-500">
                                        上传者：{a.uploader_display_name || a.uploader_username || (a.user_id ? `${String(a.user_id).slice(0, 8)}...` : '-')}
                                    </div>
                                    <div className="text-[10px] text-gray-500 font-mono mt-1 truncate">FP: {String(a.fingerprint || '').slice(0, 24)}...</div>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="mt-5 flex justify-center">
                        {assetsData.items.length < assetsData.total && (
                            <button onClick={() => loadAllAssets({ reset: false })} disabled={assetsLoading}
                                className="px-4 py-2.5 text-sm rounded-xl bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 transition-all disabled:opacity-50">
                                {assetsLoading ? '加载中...' : '加载更多'}
                            </button>
                        )}
                        {assetsData.items.length >= assetsData.total && assetsData.total > 0 && (
                            <div className="text-xs text-gray-500">已加载全部</div>
                        )}
                    </div>
                </div>
            )}

            {/* ── 用户详情弹窗 ── */}
            {drawerUser && (
                <div className="fixed inset-0 z-50 flex flex-col items-center pt-[2vh] pb-[2vh] px-4 bg-black/70 backdrop-blur-sm overflow-y-auto"
                    onClick={e => { if (e.target === e.currentTarget) closeDrawer(); }}>
                    <aside className="w-[88vw] max-w-[1280px] flex-shrink-0 h-[90vh] bg-[#0d1117] border border-white/10 rounded-2xl flex flex-col overflow-hidden shadow-2xl">
                        {/* drawer header */}
                        <div className="flex items-center justify-between p-5 border-b border-white/10 flex-shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-base">
                                    {(drawerUser.display_name || drawerUser.username || 'U').charAt(0).toUpperCase()}
                                </div>
                                <div>
                                    <div className="text-white font-semibold">{drawerUser.display_name || drawerUser.username}</div>
                                    <div className="text-xs text-gray-400">{drawerUser.username}</div>
                                </div>
                            </div>
                            <button onClick={closeDrawer} className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"><X size={18} /></button>
                        </div>

                        <div className="flex-1 overflow-y-auto">
                            {/* info section */}
                            <div className="p-5 border-b border-white/10 space-y-4">
                                {/* badges */}
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className={`px-2 py-1 rounded text-xs border ${getPlanStyle(drawerUser.plan || 'free').bg} ${getPlanStyle(drawerUser.plan || 'free').color} ${getPlanStyle(drawerUser.plan || 'free').border}`}>
                                        {getPlanStyle(drawerUser.plan || 'free').label}
                                    </span>
                                    <span className={`px-2 py-1 rounded text-xs border ${drawerUser.role === 'admin' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-gray-500/10 text-gray-400 border-gray-500/20'}`}>
                                        {drawerUser.role || 'user'}
                                    </span>
                                    {drawerUser.subscription_period && (
                                        <span className={`px-2 py-1 rounded text-xs border ${getPeriodStyle(drawerUser.subscription_period).bg} ${getPeriodStyle(drawerUser.subscription_period).color} ${getPeriodStyle(drawerUser.subscription_period).border}`}>
                                            {drawerUser.subscription_period === 'month' ? '月付' : '年付'}
                                        </span>
                                    )}
                                    {drawerUser.subscription_expires_at && (
                                        <span className={`flex items-center gap-1 px-2 py-1 rounded text-xs border ${drawerUser.subscription_status === 'expired' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}>
                                            <Calendar size={10} />
                                            {drawerUser.subscription_status === 'expired' ? '已过期' : '到期'} {new Date(drawerUser.subscription_expires_at).toLocaleDateString('zh-CN')}
                                        </span>
                                    )}
                                </div>
                                {/* quota bars */}
                                <div className="grid grid-cols-2 gap-3">
                                    {[
                                        { label: '嵌入额度', used: drawerUser.quota_embed_used ?? 0, total: drawerUser.quota_embed_total ?? 0, color: 'bg-purple-500' },
                                        { label: '检测额度', used: drawerUser.quota_detect_used ?? 0, total: drawerUser.quota_detect_total ?? 0, color: 'bg-cyan-500' },
                                    ].map(q => (
                                        <div key={q.label} className="p-3 rounded-lg bg-black/40 border border-white/10">
                                            <div className="flex justify-between text-[11px] text-gray-400 mb-1.5">
                                                <span>{q.label}</span>
                                                <span className="font-mono">{q.used}/{q.total}</span>
                                            </div>
                                            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                                                <div className={`h-full ${q.color} rounded-full`}
                                                    style={{ width: `${q.total > 0 ? Math.min(100, (q.used / q.total) * 100) : 0}%` }} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                {/* stats */}
                                {drawerDetailLoading ? (
                                    <div className="flex items-center gap-2 text-gray-500 text-xs"><Loader2 size={12} className="animate-spin" />加载统计数据...</div>
                                ) : drawerDetail?.stats ? (
                                    <div className="grid grid-cols-3 gap-2">
                                        {[
                                            { label: '上传资产', value: drawerDetail.stats.assets_count, color: 'text-cyan-400' },
                                            { label: '检测次数', value: drawerDetail.stats.detections_count, color: 'text-purple-400' },
                                            { label: '侵权举报', value: drawerDetail.stats.reports_count, color: 'text-amber-400' },
                                        ].map(s => (
                                            <div key={s.label} className="p-3 rounded-lg bg-black/40 border border-white/10 text-center">
                                                <div className={`text-xl font-black ${s.color}`}>{s.value}</div>
                                                <div className="text-[10px] text-gray-500 mt-0.5">{s.label}</div>
                                            </div>
                                        ))}
                                    </div>
                                ) : null}
                                {/* plan upgrade */}
                                {drawerUser.role !== 'admin' && (
                                    <div className="p-3 rounded-lg bg-black/40 border border-white/10">
                                        <div className="text-xs text-gray-400 mb-2 font-medium">套餐管理</div>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <select
                                                value={String(userEdits[drawerUser.id]?.plan ?? drawerUser.plan ?? 'free')}
                                                disabled={upgradingUser === drawerUser.id}
                                                onChange={e => {
                                                    const np = e.target.value;
                                                    const cp = userEdits[drawerUser.id]?.subscription_period ?? drawerUser.subscription_period ?? 'month';
                                                    setUserEdits(prev => ({ ...prev, [drawerUser.id]: { plan: np, subscription_period: np === 'free' ? '' : cp } }));
                                                }}
                                                className={`px-2 py-1.5 border rounded text-xs disabled:opacity-50 ${getPlanStyle(userEdits[drawerUser.id]?.plan ?? drawerUser.plan ?? 'free').bg} ${getPlanStyle(userEdits[drawerUser.id]?.plan ?? drawerUser.plan ?? 'free').border} ${getPlanStyle(userEdits[drawerUser.id]?.plan ?? drawerUser.plan ?? 'free').color}`}
                                            >
                                                {planOptions.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                                            </select>
                                            <select
                                                value={String(userEdits[drawerUser.id]?.subscription_period ?? drawerUser.subscription_period ?? 'month')}
                                                disabled={upgradingUser === drawerUser.id || String(userEdits[drawerUser.id]?.plan ?? drawerUser.plan ?? 'free') === 'free'}
                                                onChange={e => {
                                                    const np = e.target.value;
                                                    const cp = userEdits[drawerUser.id]?.plan ?? drawerUser.plan ?? 'free';
                                                    setUserEdits(prev => ({ ...prev, [drawerUser.id]: { plan: cp, subscription_period: np } }));
                                                }}
                                                className={`px-2 py-1.5 border rounded text-xs disabled:opacity-50 ${getPeriodStyle(userEdits[drawerUser.id]?.subscription_period ?? drawerUser.subscription_period ?? 'month').bg} ${getPeriodStyle(userEdits[drawerUser.id]?.subscription_period ?? drawerUser.subscription_period ?? 'month').border} ${getPeriodStyle(userEdits[drawerUser.id]?.subscription_period ?? drawerUser.subscription_period ?? 'month').color}`}
                                            >
                                                {periodOptions.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                                            </select>
                                            <button
                                                onClick={() => {
                                                    const np = userEdits[drawerUser.id]?.plan ?? drawerUser.plan ?? 'free';
                                                    const nq = userEdits[drawerUser.id]?.subscription_period ?? drawerUser.subscription_period ?? 'month';
                                                    setConfirmModal({ open: true, user: drawerUser, newPlan: np, newPeriod: nq });
                                                }}
                                                disabled={upgradingUser === drawerUser.id}
                                                className="px-3 py-1.5 rounded text-xs bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30 disabled:opacity-50 transition-colors flex items-center gap-1"
                                            >
                                                {upgradingUser === drawerUser.id ? <><Loader2 size={12} className="animate-spin" />处理中</> : '确认更改'}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* sub-tabs */}
                            <div className="flex border-b border-white/10 flex-shrink-0">
                                {(['assets', 'detections', 'timeline'] as const).map((tab, i) => {
                                    const icons = [<Layers key="a" size={13} />, <FileText key="d" size={13} />, <BarChart2 key="t" size={13} />];
                                    const labels = ['上传资产', '检测记录', '活动时间线'];
                                    return (
                                        <button key={tab} onClick={() => setDrawerTab(tab)}
                                            className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-colors ${drawerTab === tab ? 'border-cyan-400 text-cyan-300' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
                                            {icons[i]}{labels[i]}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* sub-tab content */}
                            <div className="p-4 space-y-3">
                                {/* assets */}
                                {drawerTab === 'assets' && (
                                    <>
                                        {anchorError && <div className="p-2 text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg">{anchorError}</div>}
                                        {drawerAssets.total > 0 && <div className="text-xs text-gray-500">共 {drawerAssets.total} 个资产</div>}
                                        <div className="grid grid-cols-2 gap-3">
                                            {drawerAssets.items.map((a: any) => (
                                                <div key={a.id} className="bg-black/30 border border-white/10 rounded-xl overflow-hidden">
                                                    <ImageWithSkeleton
                                                        src={buildImgSrc(a.output_path?.startsWith('http') ? a.output_path : (a.filename ? `/api/image/${encodeURIComponent(a.filename)}` : ''))}
                                                        alt={a.filename}
                                                        className="h-32 border-b border-white/10"
                                                    />
                                                    <div className="p-2.5">
                                                        <div className="flex items-start justify-between gap-1 mb-1">
                                                            <div className="text-xs text-white truncate flex-1">{a.filename}</div>
                                                            {a.tx_hash ? (
                                                                <span className="flex-shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/25"><Link size={8} />链上</span>
                                                            ) : (
                                                                <button onClick={() => handleAnchorAsset(a.id)} disabled={anchoringAsset === a.id}
                                                                    className="flex-shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-gray-500/15 text-gray-400 border border-gray-500/25 hover:bg-cyan-500/20 hover:text-cyan-300 hover:border-cyan-500/30 transition-colors disabled:opacity-50">
                                                                    {anchoringAsset === a.id ? <Loader2 size={8} className="animate-spin" /> : <Link size={8} />}上链
                                                                </button>
                                                            )}
                                                        </div>
                                                        <div className="text-[10px] text-gray-500">{a.created_at ? new Date(a.created_at).toLocaleDateString('zh-CN') : '-'}</div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        {drawerAssetsLoading && <div className="flex items-center justify-center gap-2 py-4 text-gray-500 text-xs"><Loader2 size={14} className="animate-spin" />加载中...</div>}
                                        {!drawerAssetsLoading && drawerAssets.items.length === 0 && <div className="text-center text-gray-500 text-sm py-6">该用户暂无上传资产</div>}
                                        {drawerAssets.items.length < drawerAssets.total && (
                                            <button onClick={() => loadDrawerTabData('assets', drawerUser.id, false, drawerAssets.offset)} disabled={drawerAssetsLoading}
                                                className="w-full py-2 text-xs text-gray-400 hover:text-gray-200 bg-white/5 border border-white/10 rounded-lg transition-colors disabled:opacity-50">
                                                加载更多 ({drawerAssets.items.length}/{drawerAssets.total})
                                            </button>
                                        )}
                                    </>
                                )}
                                {/* detections */}
                                {drawerTab === 'detections' && (
                                    <>
                                        {drawerDetections.total > 0 && <div className="text-xs text-gray-500">共 {drawerDetections.total} 条记录</div>}
                                        {drawerDetections.items.map((d: any) => (
                                            <div key={d.id} className="flex items-center gap-3 p-3 rounded-lg bg-black/40 border border-white/10">
                                                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${d.has_watermark ? 'bg-emerald-400' : 'bg-gray-500'}`} />
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-xs text-white truncate">{d.input_filename || '未知文件'}</div>
                                                    <div className="text-[10px] text-gray-500 mt-0.5">{d.created_at ? new Date(d.created_at).toLocaleString('zh-CN') : '-'}</div>
                                                </div>
                                                <div className="flex-shrink-0 text-right">
                                                    <div className={`text-xs font-medium ${d.has_watermark ? 'text-emerald-400' : 'text-gray-500'}`}>{d.has_watermark ? '命中' : '未命中'}</div>
                                                    {(() => {
                                                        const sim = d.matched_asset?.similarity;
                                                        const conf = d.confidence;
                                                        if (sim != null && Number(sim) > 0)
                                                            return <div className="text-[10px] text-gray-500">{Number(sim).toFixed(0)}% 相似</div>;
                                                        if (conf != null && conf > 0)
                                                            return <div className="text-[10px] text-gray-500">{(conf * 100).toFixed(0)}%</div>;
                                                        return null;
                                                    })()}
                                                </div>
                                            </div>
                                        ))}
                                        {drawerDetectionsLoading && <div className="flex items-center justify-center gap-2 py-4 text-gray-500 text-xs"><Loader2 size={14} className="animate-spin" />加载中...</div>}
                                        {!drawerDetectionsLoading && drawerDetections.items.length === 0 && <div className="text-center text-gray-500 text-sm py-6">该用户暂无检测记录</div>}
                                        {drawerDetections.items.length < drawerDetections.total && (
                                            <button onClick={() => loadDrawerTabData('detections', drawerUser.id, false, drawerDetections.offset)} disabled={drawerDetectionsLoading}
                                                className="w-full py-2 text-xs text-gray-400 hover:text-gray-200 bg-white/5 border border-white/10 rounded-lg transition-colors disabled:opacity-50">
                                                加载更多 ({drawerDetections.items.length}/{drawerDetections.total})
                                            </button>
                                        )}
                                    </>
                                )}
                                {/* timeline */}
                                {drawerTab === 'timeline' && (
                                    <>
                                        {drawerTimeline.total > 0 && <div className="text-xs text-gray-500">共 {drawerTimeline.total} 条记录</div>}
                                        <div className="space-y-2">
                                            {drawerTimeline.items.map((item: any, idx: number) => (
                                                <div key={`${item.type}-${item.id}-${idx}`} className="flex gap-3">
                                                    <div className="flex flex-col items-center">
                                                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${
                                                            item.type === 'asset' ? 'bg-cyan-500/20' : item.type === 'detection' ? 'bg-purple-500/20' : 'bg-amber-500/20'
                                                        }`}>{item.icon || (item.type === 'asset' ? '📁' : item.type === 'detection' ? '🔍' : '⚠️')}</div>
                                                        {idx < drawerTimeline.items.length - 1 && <div className="w-px flex-1 bg-white/10 mt-1" />}
                                                    </div>
                                                    <div className="pb-3 flex-1 min-w-0">
                                                        <div className="text-xs text-white truncate">{item.title}</div>
                                                        <div className="text-[10px] text-gray-500 mt-0.5">{item.timestamp ? new Date(item.timestamp).toLocaleString('zh-CN') : '-'}</div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        {drawerTimelineLoading && <div className="flex items-center justify-center gap-2 py-4 text-gray-500 text-xs"><Loader2 size={14} className="animate-spin" />加载中...</div>}
                                        {!drawerTimelineLoading && drawerTimeline.items.length === 0 && <div className="text-center text-gray-500 text-sm py-6">该用户暂无活动记录</div>}
                                        {drawerTimeline.items.length < drawerTimeline.total && (
                                            <button onClick={() => loadDrawerTabData('timeline', drawerUser.id, false, drawerTimeline.offset)} disabled={drawerTimelineLoading}
                                                className="w-full py-2 text-xs text-gray-400 hover:text-gray-200 bg-white/5 border border-white/10 rounded-lg transition-colors disabled:opacity-50">加载更多</button>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    </aside>
                </div>
            )}

            {/* ── 确认弹窗 ── */}
            {confirmModal.open && confirmModal.user && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="glass-card max-w-md w-full p-6 border border-cyan-500/30 shadow-2xl shadow-cyan-500/10">
                        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <Shield className="text-cyan-400" size={20} />
                            确认更改用户权限
                        </h3>
                        <div className="space-y-4 mb-6">
                            <div className="p-3 rounded-lg bg-black/40 border border-white/10">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
                                        {(confirmModal.user.display_name || confirmModal.user.username || 'U').charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <div className="text-sm text-white font-medium">{confirmModal.user.display_name || confirmModal.user.username}</div>
                                        <div className="text-xs text-gray-500">{confirmModal.user.username}</div>
                                    </div>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="p-3 rounded-lg bg-black/40 border border-white/10">
                                    <div className="text-xs text-gray-500 mb-1">当前套餐</div>
                                    <span className={`px-2 py-1 rounded text-xs border ${getPlanStyle(confirmModal.user.plan || 'free').bg} ${getPlanStyle(confirmModal.user.plan || 'free').color} ${getPlanStyle(confirmModal.user.plan || 'free').border}`}>{getPlanStyle(confirmModal.user.plan || 'free').label}</span>
                                    <div className="text-xs text-gray-500 mt-2">当前周期</div>
                                    <span className={`px-2 py-1 rounded text-xs border mt-1 inline-block ${getPeriodStyle(confirmModal.user.subscription_period || 'month').bg} ${getPeriodStyle(confirmModal.user.subscription_period || 'month').color} ${getPeriodStyle(confirmModal.user.subscription_period || 'month').border}`}>{getPeriodStyle(confirmModal.user.subscription_period || 'month').label}</span>
                                </div>
                                <div className="p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/30">
                                    <div className="text-xs text-cyan-400 mb-1">新套餐</div>
                                    <span className={`px-2 py-1 rounded text-xs border ${getPlanStyle(confirmModal.newPlan).bg} ${getPlanStyle(confirmModal.newPlan).color} ${getPlanStyle(confirmModal.newPlan).border}`}>{getPlanStyle(confirmModal.newPlan).label}</span>
                                    <div className="text-xs text-cyan-400 mt-2">新周期</div>
                                    <span className={`px-2 py-1 rounded text-xs border mt-1 inline-block ${getPeriodStyle(confirmModal.newPeriod).bg} ${getPeriodStyle(confirmModal.newPeriod).color} ${getPeriodStyle(confirmModal.newPeriod).border}`}>{getPeriodStyle(confirmModal.newPeriod).label}</span>
                                </div>
                            </div>
                            <div className="p-3 rounded-lg bg-black/40 border border-white/10">
                                <div className="text-xs text-gray-500 mb-2">订阅到期时间</div>
                                <div className="flex items-center justify-between">
                                    <div><div className="text-xs text-gray-500">原到期日</div><div className="text-sm text-gray-400">{confirmModal.user.subscription_expires_at ? new Date(confirmModal.user.subscription_expires_at).toLocaleDateString('zh-CN') : '未订阅'}</div></div>
                                    <div className="text-gray-600">→</div>
                                    <div><div className="text-xs text-cyan-400">新到期日</div><div className="text-sm text-cyan-300 font-medium">{(() => {
                                        const now = new Date();
                                        const base = confirmModal.user.subscription_expires_at && new Date(confirmModal.user.subscription_expires_at) > now ? new Date(confirmModal.user.subscription_expires_at) : now;
                                        const exp = new Date(base);
                                        confirmModal.newPeriod === 'month' ? exp.setMonth(exp.getMonth() + 1) : exp.setFullYear(exp.getFullYear() + 1);
                                        return exp.toLocaleDateString('zh-CN');
                                    })()}</div></div>
                                </div>
                            </div>
                            {confirmModal.newPlan === (confirmModal.user.plan || 'free') && confirmModal.newPeriod === (confirmModal.user.subscription_period || 'month') && (
                                <div className="p-2 rounded bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">注意：套餐和周期未变更，将执行续费操作。</div>
                            )}
                            {confirmModal.newPlan !== (confirmModal.user.plan || 'free') && (
                                <div className="p-2 rounded bg-purple-500/10 border border-purple-500/20 text-xs text-purple-400">注意：套餐发生变更，将从当前时间起重新计算订阅周期。</div>
                            )}
                        </div>

                        {/* 按钮 */}
                        <div className="flex gap-3">
                            <button
                                onClick={() => setConfirmModal({ open: false, user: null, newPlan: '', newPeriod: '' })}
                                disabled={upgradingUser === confirmModal.user.id}
                                className="flex-1 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 transition-colors disabled:opacity-50"
                            >
                                取消
                            </button>
                            <button
                                onClick={async () => {
                                    await handleUpdateUserPlan(confirmModal.user!.id, confirmModal.newPlan, confirmModal.newPeriod);
                                    setConfirmModal({ open: false, user: null, newPlan: '', newPeriod: '' });
                                }}
                                disabled={upgradingUser === confirmModal.user.id}
                                className="flex-1 px-4 py-2 rounded-lg bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {upgradingUser === confirmModal.user.id ? (
                                    <>
                                        <Loader2 size={14} className="animate-spin" />
                                        处理中...
                                    </>
                                ) : (
                                    <>
                                        <Check size={14} />
                                        确认更改
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Admin;
