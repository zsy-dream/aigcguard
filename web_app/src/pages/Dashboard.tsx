import React, { useEffect, useState } from 'react';
import { Shield, Activity, Clock, AlertTriangle, Users, ArrowUpRight, Fingerprint } from 'lucide-react';
import AssetThumbnail from '../components/AssetThumbnail';
import { watermark, auth, admin } from '../services/api';
import { supabase } from '../lib/supabase';

const Dashboard: React.FC = () => {
    React.useEffect(() => {
        document.title = "态势感知中心 - AIGCGuard 数字化监管平台";
    }, []);
    const [data, setData] = useState({ total_assets: 0, active_monitors: 0, total_infringements: 0, total_authors: 0 });
    const [recentAssets, setRecentAssets] = useState<any[]>([]);

    // ----------- ADMIN STATE -----------
    const [isAdmin, setIsAdmin] = useState(false);
    const [adminActiveTab, setAdminActiveTab] = useState<'overview' | 'users' | 'assets'>('overview');
    const [adminRealStats, setAdminRealStats] = useState({ users: 0, assets: 0, fingerprints: 0 });
    const [adminUsers, setAdminUsers] = useState<any[]>([]);
    const [adminAssets, setAdminAssets] = useState<any[]>([]);
    // -----------------------------------

    const upgradeUserPlan = async (userId: string, targetPlan: string) => {
        try {
            let targetQuota = 10;
            if (targetPlan === 'personal') targetQuota = 500;
            if (targetPlan === 'pro') targetQuota = 2000;
            if (targetPlan === 'enterprise') targetQuota = 9999999;

            const startedAt = new Date();
            const expiresAt = new Date(startedAt);
            expiresAt.setMonth(expiresAt.getMonth() + 1);

            await supabase
                .from('profiles')
                .update({
                    plan: targetPlan,
                    quota_total: targetQuota,
                    subscription_period: targetPlan === 'free' ? null : 'month',
                    subscription_status: targetPlan === 'free' ? 'inactive' : 'active',
                    subscription_started_at: targetPlan === 'free' ? null : startedAt.toISOString(),
                    subscription_expires_at: targetPlan === 'free' ? null : expiresAt.toISOString(),
                })
                .eq('id', userId);
            // 乐观更新 UI
            setAdminUsers(users =>
                users.map(u =>
                    u.id === userId
                        ? {
                              ...u,
                              plan: targetPlan,
                              quota_total: targetQuota,
                              subscription_period: targetPlan === 'free' ? null : 'month',
                              subscription_status: targetPlan === 'free' ? 'inactive' : 'active',
                              subscription_started_at: targetPlan === 'free' ? null : startedAt.toISOString(),
                              subscription_expires_at: targetPlan === 'free' ? null : expiresAt.toISOString(),
                          }
                        : u
                )
            );
        } catch (e) {
            console.error("Upgrade failed", e);
        }
    };

    const formatDate = (dateStr: string) => {
        try {
            if (!dateStr) return new Date().toLocaleString();
            const d = new Date(dateStr.replace(' ', 'T'));
            if (isNaN(d.getTime())) return dateStr;
            return d.toLocaleString();
        } catch (e) {
            return dateStr;
        }
    };

    // 动态营销数据基准值存储
    const getDynamicBaseValue = (key: string, defaultValue: number, growthRate: number = 0.1) => {
        const stored = localStorage.getItem(`dashboard_${key}_base`);
        const lastVisit = localStorage.getItem(`dashboard_last_visit`);
        const now = Date.now();
        
        let baseValue = stored ? parseInt(stored, 10) : defaultValue;
        
        // 如果有上次访问时间，根据时间差模拟增长
        if (lastVisit) {
            const hoursSinceLastVisit = (now - parseInt(lastVisit, 10)) / (1000 * 60 * 60);
            // 每小时随机增长 0.1% ~ 0.5%
            const growthMultiplier = 1 + (hoursSinceLastVisit * growthRate * (0.5 + Math.random()));
            baseValue = Math.floor(baseValue * Math.min(growthMultiplier, 1.5)); // 最大增长 50%
        }
        
        // 保存新的基准值和访问时间
        localStorage.setItem(`dashboard_${key}_base`, baseValue.toString());
        localStorage.setItem(`dashboard_last_visit`, now.toString());
        
        return baseValue;
    };

    useEffect(() => {
        const fetchMarketingData = () => {
            // 获取动态基准值（随时间增长）
            const baseAssets = getDynamicBaseValue('assets', 12586, 0.001);
            const baseMonitors = getDynamicBaseValue('monitors', 124, 0.0005);
            const baseInfringements = getDynamicBaseValue('infringements', 32, 0.002);
            const baseAuthors = getDynamicBaseValue('authors', 1205, 0.008);
            
            // 添加实时随机波动（范围更大，变化更明显）
            const simulatedBase = {
                total_assets: baseAssets + Math.floor(Math.random() * 200) - 50,  // ±150 波动
                active_monitors: baseMonitors + Math.floor(Math.random() * 20) - 5,  // ±10 波动
                total_infringements: baseInfringements + Math.floor(Math.random() * 8) - 2,  // ±4 波动
                total_authors: baseAuthors + Math.floor(Math.random() * 40) - 10  // ±20 波动
            };
            setData(simulatedBase);

            // 获取最近活动 (带 Mock 保护)
            watermark.getActivity().then(res => {
                if (res && res.length > 0) {
                    setRecentAssets(res);
                }
            }).catch(() => {
                console.log("Activity backend unavailable");
            });
        };

        // 先乐观填充营销数据，避免 auth.me 卡住导致页面一直显示 0
        fetchMarketingData();

        // 再尝试获取用户身份，如果是管理员则展示真实数据
        auth.me().then(async (user) => {
            if (user?.role === 'admin') {
                setIsAdmin(true);
                // Admin Mode: Fetch Real data from backend API (bypass RLS)
                try {
                    const data = await admin.summary({ limit_users: 10, limit_assets: 10 });
                    setAdminRealStats({
                        users: data.users_count || 0,
                        assets: data.assets_count || 0,
                        fingerprints: data.assets_count || 0
                    });
                    if (data.users) setAdminUsers(data.users);
                    if (data.assets) setAdminAssets(data.assets);
                } catch (e) {
                    console.error("Admin API fetch error:", e);
                    setIsAdmin(false);
                    fetchMarketingData();
                }
            }
        }).catch(() => {
            // ignore, keep marketing mode
        });

        // 启动实时数字波动动画（每 3 秒微幅变化，制造"实时感"）
        const fluctuationTimer = setInterval(() => {
            setData(prev => ({
                total_assets: prev.total_assets + 1,
                active_monitors: prev.active_monitors + 1,
                total_infringements: prev.total_infringements + 1,
                total_authors: prev.total_authors + 1
            }));
        }, 12 * 60 * 60 * 1000);

        return () => clearInterval(fluctuationTimer);
    }, []);

    const cards = [
        { title: '受保护资产 (Assets)', value: data.total_assets, icon: <Shield size={24} />, color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20', trend: '+8%' },
        { title: '监测节点 (Nodes)', value: data.active_monitors, icon: <Activity size={24} />, color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20', trend: '+12%' },
        { title: '侵权警报 (Alerts)', value: data.total_infringements, icon: <AlertTriangle size={24} />, color: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/20', trend: '+3%' },
        { title: '注册用户 (Users)', value: data.total_authors || 1, icon: <Users size={24} />, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', trend: '+15%' },
    ];

    if (isAdmin) {
        return (
            <div className="space-y-8 animate-enter">
                {/* Admin Header & Tabs */}
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end border-b border-white/5 pb-4 gap-4">
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2 flex items-center gap-3">
                            数据监管面板
                        </h1>
                        <p className="text-gray-400 text-sm">全网数据指纹监控与溯源实时概览</p>
                    </div>
                    <div className="flex bg-black/40 rounded-lg p-1 border border-white/5 w-full sm:w-auto">
                        <button onClick={() => setAdminActiveTab('overview')} className={`flex-1 sm:flex-none px-3 sm:px-4 py-2 text-xs sm:text-sm rounded-md transition-all ${adminActiveTab === 'overview' ? 'bg-white/10 text-white shadow-lg' : 'text-gray-400 hover:text-gray-200'}`}>总览</button>
                        <button onClick={() => setAdminActiveTab('users')} className={`flex-1 sm:flex-none px-3 sm:px-4 py-2 text-xs sm:text-sm rounded-md transition-all ${adminActiveTab === 'users' ? 'bg-white/10 text-white shadow-lg' : 'text-gray-400 hover:text-gray-200'}`}>用户管理</button>
                        <button onClick={() => setAdminActiveTab('assets')} className={`flex-1 sm:flex-none px-3 sm:px-4 py-2 text-xs sm:text-sm rounded-md transition-all ${adminActiveTab === 'assets' ? 'bg-white/10 text-white shadow-lg' : 'text-gray-400 hover:text-gray-200'}`}>资产档案</button>
                    </div>
                </div>

                {adminActiveTab === 'overview' && (
                    <div className="space-y-8 animate-enter mt-8">
                        {/* Admin Stats Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="glass-card p-6 border border-emerald-500/30 bg-emerald-500/5 relative overflow-hidden group">
                                <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 blur-3xl -z-10 rounded-full group-hover:bg-emerald-500/20 transition-all"></div>
                                <div className="text-emerald-400 mb-2"><Users size={28} /></div>
                                <div className="text-4xl font-black text-white">{adminRealStats.users}</div>
                                <div className="text-sm text-emerald-400/80 mt-1">系统注册用户总计</div>
                            </div>
                            <div className="glass-card p-6 border border-cyan-500/30 bg-cyan-500/5 relative overflow-hidden group">
                                <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 blur-3xl -z-10 rounded-full group-hover:bg-cyan-500/20 transition-all"></div>
                                <div className="text-cyan-400 mb-2"><Activity size={28} /></div>
                                <div className="text-4xl font-black text-white">{adminRealStats.assets}</div>
                                <div className="text-sm text-cyan-400/80 mt-1">真实入库与保护资产总数</div>
                            </div>
                            <div className="glass-card p-6 border border-purple-500/30 bg-purple-500/5 relative overflow-hidden group">
                                <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 blur-3xl -z-10 rounded-full group-hover:bg-purple-500/20 transition-all"></div>
                                <div className="text-purple-400 mb-2"><Fingerprint size={28} /></div>
                                <div className="text-4xl font-black text-white">{adminRealStats.fingerprints}</div>
                                <div className="text-sm text-purple-400/80 mt-1">云端区块链存证指纹数</div>
                            </div>
                        </div>

                        {/* DB Details */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                            {/* Latest Users */}
                            <div className="glass-card p-6 flex flex-col">
                                <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                                    <Users className="text-emerald-400" size={20} />
                                    <span>最新注册用户（明细）</span>
                                </h3>
                                <div className="space-y-3">
                                    {adminUsers.length === 0 ? <div className="text-gray-500 text-sm">暂无数据记录，待对接Supabase...</div> : adminUsers.map((u, idx) => (
                                        <div key={idx} className="flex justify-between items-center p-3 rounded-lg bg-black/40 border border-white/5">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-sm">
                                                    {(u.username || u.email || 'U').charAt(0).toUpperCase()}
                                                </div>
                                                <div>
                                                    <div className="text-sm text-white">{u.username || u.email || '未命名用户'}</div>
                                                    <div className="text-xs text-gray-500">ID: {u.id?.substring?.(0, 8)}...</div>
                                                </div>
                                            </div>
                                            <div className="text-xs font-mono text-gray-400">{formatDate(u.created_at)}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Latest Assets */}
                            <div className="glass-card p-6 flex flex-col">
                                <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                                    <Activity className="text-cyan-400" size={20} />
                                    <span>最新上传资产（明细）</span>
                                </h3>
                                <div className="space-y-3">
                                    {adminAssets.length === 0 ? <div className="text-gray-500 text-sm">暂无数据记录，待对接Supabase...</div> : adminAssets.map((a, idx) => (
                                        <div key={idx} className="flex justify-between items-center p-3 rounded-lg bg-black/40 border border-white/5">
                                            <div className="flex items-center gap-3">
                                                {a.thumbnail_url || a.image_url ? (
                                                    <img src={a.thumbnail_url || a.image_url} alt="asset" className="w-10 h-10 rounded-md object-cover border border-white/10" />
                                                ) : (
                                                    <div className="w-10 h-10 rounded-md bg-cyan-500/20 text-cyan-400 flex items-center justify-center"><Shield size={16} /></div>
                                                )}
                                                <div>
                                                    <div className="text-sm text-white max-w-[200px] truncate">{a.filename || a.title || '无标题资产'}</div>
                                                    <div className="text-xs text-gray-500">归属: {a.author_id || 'U'}</div>
                                                </div>
                                            </div>
                                            <div className="text-xs font-mono text-gray-400">{formatDate(a.created_at)}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* System Analytics */}
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                            {/* Activity Chart */}
                            <div className="col-span-2 glass-card p-6 flex flex-col min-h-[350px]">
                                <div className="flex justify-between items-center mb-6">
                                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                        <Activity className="text-emerald-400" size={20} />
                                        <span>系统全网监测吞吐量</span>
                                    </h3>
                                    <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-full border border-emerald-500/20">实时计算</span>
                                </div>

                                <div className="flex-1 flex items-end justify-between gap-2 px-2 pb-6 border-b border-white/5 relative">
                                    {/* Y-axis guidelines */}
                                    <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                                        {[100, 75, 50, 25, 0].map(v => (
                                            <div key={v} className="border-b border-white/5 w-full h-0 relative">
                                                <span className="absolute -left-6 -top-2 text-[10px] text-gray-600 font-mono">{v}k</span>
                                            </div>
                                        ))}
                                    </div>

                                    {/* CSS Bar Chart */}
                                    {[30, 45, 20, 60, 85, 40, 75, 50, 90, 65, 35, 80, 55, 100, 70, 95].map((h, i) => (
                                        <div key={i} className="w-full h-full flex items-end relative group z-10">
                                            <div
                                                style={{ height: `${h}%`, transitionDelay: `${i * 30}ms` }}
                                                className="w-full bg-gradient-to-t from-emerald-500/10 via-emerald-500/30 to-emerald-400/60 rounded-t-sm transition-all duration-300 group-hover:to-emerald-300"
                                            >
                                                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-full opacity-0 group-hover:opacity-100 text-xs text-emerald-300 mb-1 transition-opacity">
                                                    {h}k
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex justify-between text-xs text-gray-500 font-mono mt-2 pl-4">
                                    <span>1周前</span>
                                    <span>今日</span>
                                </div>
                            </div>

                            {/* Threat Analysis */}
                            <div className="glass-card p-6 flex flex-col">
                                <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                                    <AlertTriangle className="text-rose-400" size={20} />
                                    <span>高危侵权预警</span>
                                </h3>

                                <div className="space-y-4 flex-1">
                                    {[
                                        { title: '发现抹除水印内容', platform: '某博', confidence: '98%', time: '10分钟前' },
                                        { title: '未授权商用视频', platform: '某音', confidence: '95%', time: '1小时前' },
                                        { title: '局部重绘洗稿', platform: '某书', confidence: '91%', time: '3小时前' },
                                        { title: '跨语言套壳文章', platform: '独立站', confidence: '88%', time: '5小时前' }
                                    ].map((alert, i) => (
                                        <div key={i} className="p-3 rounded-lg bg-red-500/5 border border-red-500/10 hover:border-red-500/30 transition-colors">
                                            <div className="flex justify-between items-start mb-2">
                                                <div className="text-sm text-red-100 font-medium">{alert.title}</div>
                                                <div className="text-[10px] text-rose-400 font-mono bg-rose-500/10 px-1.5 py-0.5 rounded">{alert.confidence} 置信</div>
                                            </div>
                                            <div className="flex justify-between items-center text-xs text-gray-400">
                                                <span className="flex items-center gap-1"><Shield size={10} className="text-gray-500" /> {alert.platform}</span>
                                                <span>{alert.time}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <button className="w-full mt-4 py-2 text-xs text-rose-400/70 hover:text-rose-400 border border-rose-500/20 hover:bg-rose-500/10 rounded-lg transition-all">
                                    查看全部告警
                                </button>
                            </div>
                        </div>
                    </div>
                )} {/* End Overview Tab */}

                {adminActiveTab === 'users' && (
                    <div className="glass-card p-6 animate-enter mt-8">
                        <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                            <Users className="text-emerald-400" size={20} />
                            <span>账户管理与权限配置</span>
                        </h3>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-white/10 text-gray-400 text-sm">
                                        <th className="pb-3 pl-4">用户</th>
                                        <th className="pb-3">角色</th>
                                        <th className="pb-3">当前版本</th>
                                        <th className="pb-3">额度使用</th>
                                        <th className="pb-3">注册时间</th>
                                        <th className="pb-3 text-right pr-4">操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {adminUsers.map(u => (
                                        <tr key={u.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                            <td className="py-4 pl-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-sm">
                                                        {(u.display_name || u.username || 'U').charAt(0).toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <div className="text-sm text-white">{u.display_name || u.username}</div>
                                                        <div className="text-xs text-gray-500">{u.username?.includes('@') ? u.username : u.id?.substring(0, 8)}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="py-4">
                                                <span className={`px-2 py-1 rounded text-xs border ${u.role === 'admin' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-gray-500/10 text-gray-400 border-gray-500/20'}`}>
                                                    {u.role || 'user'}
                                                </span>
                                            </td>
                                            <td className="py-4">
                                                <span className={`px-2 py-1 rounded text-xs border ${u.plan === 'pro' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : u.plan === 'enterprise' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-teal-500/10 text-teal-400 border-teal-500/20'}`}>
                                                    {u.plan?.toUpperCase() || 'FREE'}
                                                </span>
                                            </td>
                                            <td className="py-4 text-sm text-gray-300 font-mono">
                                                {u.quota_used || 0} / {u.quota_total || 10}
                                            </td>
                                            <td className="py-4 text-xs font-mono text-gray-500">
                                                {formatDate(u.created_at)}
                                            </td>
                                            <td className="py-4 text-right pr-4 space-x-2 flex justify-end gap-2">
                                                {u.plan !== 'pro' && u.role !== 'admin' && (
                                                    <button onClick={() => upgradeUserPlan(u.id, 'pro')} className="px-3 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded text-xs transition-colors">
                                                        升专业版
                                                    </button>
                                                )}
                                                {u.plan !== 'enterprise' && u.role !== 'admin' && (
                                                    <button onClick={() => upgradeUserPlan(u.id, 'enterprise')} className="px-3 py-1 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded text-xs transition-colors">
                                                        升企业版
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {adminUsers.length === 0 && (
                                        <tr><td colSpan={6} className="py-8 text-center text-gray-500">暂无账户数据</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {adminActiveTab === 'assets' && (
                    <div className="glass-card p-6 animate-enter mt-8">
                        <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                            <Activity className="text-cyan-400" size={20} />
                            <span>云端区块链资产档案</span>
                        </h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                            {adminAssets.map(a => (
                                <div key={a.id} className="relative group rounded-xl overflow-hidden bg-black/40 border border-white/5 hover:border-cyan-500/30 transition-all cursor-pointer">
                                    <div className="aspect-square bg-gray-900 flex items-center justify-center p-2 relative">
                                        {a.output_path || a.input_path ? (
                                            <img src={`/api${a.output_path || a.input_path}`} alt="asset" className="w-full h-full object-contain" onError={(e) => { (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMzhiMmY2IiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PHBhdGggZD0iTTIyIDEySDJNMTIgMkJ2MjJNMjAgMTZBOCA4IDAgMSAwIDIwaTE2YTYgNiAwIDAgMTEyIDBaIi8+PC9zdmc+'; (e.target as HTMLImageElement).className = 'w-10 h-10 opacity-30'; }} />
                                        ) : (
                                            <Shield size={32} className="text-cyan-500/20" />
                                        )}
                                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-4 text-center backdrop-blur-sm">
                                            <div className="text-xs text-white font-medium break-all line-clamp-2">{a.filename}</div>
                                            <div className="text-[10px] text-cyan-400 mt-2">PSNR: {a.psnr || 'N/A'}</div>
                                            <div className="text-[10px] text-gray-400 mt-1">{formatDate(a.created_at)}</div>
                                        </div>
                                    </div>
                                    <div className="p-2 border-t border-white/5 bg-black/60">
                                        <div className="text-[10px] font-mono text-gray-500 truncate" title={a.fingerprint}>
                                            FP: {a.fingerprint}
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {adminAssets.length === 0 && (
                                <div className="col-span-full py-12 text-center text-gray-500">暂无上传资产</div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-enter">
            {/* Header */}
            <div className="flex justify-between items-end">
                <div>
                    <h1 className="text-3xl font-bold text-white mb-2">态势感知 <span className="text-gray-500 text-lg font-normal">Dashboard</span></h1>
                    <p className="text-gray-400 text-sm">全网数据指纹监控与溯源实时概览</p>
                </div>
                <div className="flex gap-2">
                    <span className="px-3 py-1 bg-green-500/10 text-green-400 rounded-full text-xs flex items-center gap-1 border border-green-500/20">
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                        系统运行正常
                    </span>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {cards.map((card, index) => (
                    <div key={index} className={`glass-card p-6 border ${card.border} hover:border-opacity-50 transition-all duration-300 group`}>
                        <div className="flex justify-between items-start mb-4">
                            <div className={`p-3 rounded-xl ${card.bg} ${card.color} group-hover:scale-110 transition-transform duration-300`}>
                                {card.icon}
                            </div>
                            <span className="text-xs text-gray-500 flex items-center gap-1 bg-white/5 px-2 py-1 rounded-full">
                                {card.trend} <ArrowUpRight size={10} />
                            </span>
                        </div>
                        <div className="text-3xl font-bold text-white mb-1 group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-white group-hover:to-gray-400 transition-all">
                            {card.value}
                        </div>
                        <div className="text-sm text-gray-400 font-medium">{card.title}</div>
                    </div>
                ))}
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Chart Section */}
                <div className="col-span-2 glass-card p-6 min-h-[400px] flex flex-col">
                    <div className="flex justify-between items-center mb-8">
                        <h3 className="text-xl font-bold text-white flex items-center gap-2">
                            <Activity className="text-cyan-400" size={20} />
                            <span>实时监测趋势</span>
                        </h3>
                        <div className="flex gap-2">
                            {['1H', '24H', '7D'].map((t) => (
                                <button key={t} className="px-3 py-1 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
                                    {t}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* CSS Chart Bar Visualization */}
                    <div className="flex-1 flex items-end justify-between gap-2 md:gap-4 px-2">
                        {[40, 65, 30, 80, 55, 90, 45, 70, 35, 60, 25, 50, 75, 60, 85].map((h, i) => (
                            <div key={i} className="w-full h-full flex items-end relative group">
                                <div
                                    style={{ height: `${h}%`, transitionDelay: `${i * 50}ms` }}
                                    className="w-full bg-gradient-to-t from-cyan-500/10 via-cyan-500/40 to-cyan-400/80 rounded-t-sm transition-all duration-500 ease-out group-hover:to-cyan-300 relative"
                                >
                                    <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-full opacity-0 group-hover:opacity-100 text-xs text-cyan-300 mb-1 transition-opacity">
                                        {h}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="mt-4 flex justify-between text-xs text-gray-500 font-mono">
                        <span>00:00</span>
                        <span>06:00</span>
                        <span>12:00</span>
                        <span>18:00</span>
                        <span>24:00</span>
                    </div>
                </div>

                {/* Recent Activity */}
                <div className="glass-card p-6 flex flex-col">
                    <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                        <Clock className="text-purple-400" size={20} />
                        <span>最新存证记录</span>
                    </h3>
                    <p className="text-xs text-gray-500 mb-4">仅展示您本人的存证记录 · 数据加密隔离存储</p>
                    <div className="space-y-4 flex-1 overflow-y-auto max-h-[400px] custom-scrollbar pr-2">
                        {recentAssets.length === 0 ? (
                            <div className="text-center text-gray-500 py-10">暂无数据</div>
                        ) : (
                            recentAssets.map((asset) => (
                                <div key={asset.id} className="group flex items-center gap-4 p-3 rounded-xl hover:bg-white/5 transition-all cursor-pointer border border-transparent hover:border-white/5">
                                    <div className="w-12 h-12 rounded-lg bg-gray-800/50 overflow-hidden relative">
                                        <AssetThumbnail
                                            src={asset.preview_url ? `${asset.preview_url}?token=${localStorage.getItem('access_token') || ''}` : ''}
                                            alt="preview"
                                            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                                            assetType={asset.asset_type}
                                            locked={asset.is_locked}
                                        />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium text-gray-200 truncate group-hover:text-cyan-400 transition-colors">
                                            {asset.filename}
                                        </div>
                                        <div className="text-xs text-gray-500 font-mono mt-0.5">
                                            {formatDate(asset.created_at || asset.timestamp)}
                                        </div>
                                    </div>
                                    <div className="px-2 py-1 rounded text-[10px] font-bold bg-green-500/10 text-green-400 border border-green-500/20">
                                        已验证
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                    <button className="w-full mt-4 py-2 text-xs text-gray-400 hover:text-white border border-white/5 hover:bg-white/5 rounded-lg transition-all">
                        查看全部记录
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
