import React from 'react';
import { createPortal } from 'react-dom';
import { Check, Shield, Zap, Building2, Crown, User, Loader2, X, HelpCircle, ChevronDown } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const Pricing: React.FC = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [loadingPlan, setLoadingPlan] = React.useState<string | null>(null);
    const [showContactModal, setShowContactModal] = React.useState(false);
    const [showSubscriptionModal, setShowSubscriptionModal] = React.useState(false);
    const [currentPlan, setCurrentPlan] = React.useState<string | null>(null);
    const [planLoaded, setPlanLoaded] = React.useState(false);
    const [billingPeriod, setBillingPeriod] = React.useState<'month' | 'year'>('month');
    const [showPeriodModal, setShowPeriodModal] = React.useState(false);
    const [pendingPlan, setPendingPlan] = React.useState<string | null>(null);
    const [subscriptionStatus, setSubscriptionStatus] = React.useState<string | null>(null);
    const [subscriptionPeriod, setSubscriptionPeriod] = React.useState<string | null>(null);
    const [subscriptionExpiresAt, setSubscriptionExpiresAt] = React.useState<string | null>(null);
    const [subscriptionRemainingDays, setSubscriptionRemainingDays] = React.useState<number | null>(null);
    const [renewLoading, setRenewLoading] = React.useState<'month' | 'year' | null>(null);

    const portalTarget = typeof document !== 'undefined' ? document.body : null;

    const normalizePlan = (plan: string | null | undefined) => {
        const p = String(plan || '').toLowerCase().trim();
        if (p === 'free') return 'free';
        if (p === 'personal') return 'personal';
        if (p === 'pro' || p === 'professional') return 'pro';
        if (p === 'enterprise') return 'enterprise';
        return 'free';
    };

    // 套餐显示名称映射（仅影响前端显示，不改变数据库值）
    const getPlanDisplayName = (plan: string | null | undefined) => {
        const normalized = normalizePlan(plan);
        const displayNames: Record<string, string> = {
            'free': '免费版',
            'personal': '个人版',
            'pro': '专业版',
            'enterprise': '企业版'
        };
        return displayNames[normalized] || normalized;
    };

    // 状态显示名称映射（仅影响前端显示）
    const getStatusDisplayName = (status: string | null | undefined) => {
        if (!status) return '未激活';
        const displayNames: Record<string, string> = {
            'active': '运行中',
            'inactive': '未激活',
            'cancelled': '已取消',
            'expired': '已过期',
            'pending': '处理中'
        };
        return displayNames[status.toLowerCase()] || status;
    };

    // 获取用户当前套餐
    const computeRemainingDays = (expiresAt: string | null) => {
        if (!expiresAt) return null;
        const ms = new Date(expiresAt).getTime() - Date.now();
        const days = Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
        return days;
    };

    React.useEffect(() => {
        const fetchCurrentPlan = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session) {
                    setCurrentPlan('free');
                    return;
                }
                const { data } = await supabase
                    .from('profiles')
                    .select('plan, subscription_period, subscription_expires_at, subscription_status')
                    .eq('id', session.user.id)
                    .single();
                setCurrentPlan(normalizePlan(data?.plan));
                setSubscriptionPeriod(data?.subscription_period ?? null);
                setSubscriptionExpiresAt(data?.subscription_expires_at ?? null);
                setSubscriptionStatus(data?.subscription_status ?? null);
                setSubscriptionRemainingDays(computeRemainingDays(data?.subscription_expires_at ?? null));
            } finally {
                setPlanLoaded(true);
            }
        };
        fetchCurrentPlan();
    }, []);

    const refreshFromSupabase = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const { data } = await supabase
            .from('profiles')
            .select('plan, subscription_period, subscription_expires_at, subscription_status')
            .eq('id', session.user.id)
            .single();
        setCurrentPlan(normalizePlan(data?.plan));
        setSubscriptionPeriod(data?.subscription_period ?? null);
        setSubscriptionExpiresAt(data?.subscription_expires_at ?? null);
        setSubscriptionStatus(data?.subscription_status ?? null);
        setSubscriptionRemainingDays(computeRemainingDays(data?.subscription_expires_at ?? null));
    };

    const handleRenew = async (period: 'month' | 'year') => {
        try {
            setRenewLoading(period);
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                navigate('/login');
                return;
            }

            const plan = normalizePlan(currentPlan);
            if (plan === 'free') {
                alert('免费版无需续费，请先升级套餐');
                return;
            }

            const formData = new FormData();
            formData.append('plan', plan);
            formData.append('period', period);
            formData.append('username', session.user.email || 'test_user');

            const res = await fetch('/api/pay/alipay-create', {
                method: 'POST',
                body: formData
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || '支付下单失败，请检查支付宝沙箱配置');
            }
            const data = await res.json();
            if (!data.payment_url) {
                throw new Error('支付链接生成失败');
            }
            window.location.href = data.payment_url;
        } catch (e: any) {
            alert(e.message || '续费失败');
        } finally {
            setRenewLoading(null);
        }
    };

    const getPlanButtonText = (plan: string) => {
        if (!planLoaded) return '加载中...';
        const cp = normalizePlan(currentPlan);
        const target = normalizePlan(plan);
        if (cp === target) return '当前计划';
        if (target === 'free') return '免费版';
        if (target === 'personal') return '升级个人版';
        if (target === 'pro') return '立即购买护航包';
        if (target === 'enterprise') return '联系企业顾问';
        return '立即开通';
    };

    const isPlanDisabled = (plan: string) => {
        if (!planLoaded) return true;
        return normalizePlan(currentPlan) === normalizePlan(plan);
    };

    React.useEffect(() => {
        const pay = searchParams.get('pay');
        if (!pay) return;

        const run = async () => {
            if (pay === 'success') {
                await refreshFromSupabase();
                window.dispatchEvent(new Event('quota-updated'));
                // 升级弹窗由 Layout.tsx 的 checkPlanChange 通过 quota-updated 事件自动触发
            } else if (pay === 'fail') {
                alert('支付未完成或验签失败，请重试');
            }
            navigate('/pricing', { replace: true });
        };
        run();
    }, [searchParams]);

    const handlePurchaseWithPeriod = async (plan: string, period: 'month' | 'year') => {
        try {
            setLoadingPlan(plan);

            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                navigate('/login');
                return;
            }

            const formData = new FormData();
            formData.append('plan', plan);
            formData.append('period', period);
            formData.append('username', session.user.email || 'test_user');

            const res = await fetch('/api/pay/alipay-create', {
                method: 'POST',
                body: formData
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || '支付下单失败，请检查支付宝沙箱配置');
            }

            const data = await res.json();
            if (data.payment_url) {
                window.location.href = data.payment_url;
                return;
            }

            throw new Error('支付链接生成失败');

        } catch (err: any) {
            console.error("Payment initiation failed:", err);
            alert(err.message || '支付失败，建议检查后端环境');
        } finally {
            setLoadingPlan(null);
            setPendingPlan(null);
        }
    };

    return (
        <div className="max-w-6xl mx-auto space-y-8 sm:space-y-12 animate-enter pb-20 pt-16 sm:pt-24">
            {/* Header */}
            <div className="text-center space-y-4">
                <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white mb-2">选择适合您的<span className="bg-clip-text text-transparent bg-gradient-to-r from-amber-400 to-orange-500">保护方案</span></h1>
                <p className="text-gray-400 text-sm sm:text-lg max-w-2xl mx-auto">
                    从个人创作者到大型传媒企业，AIGC Guard 为您提供工业级的数字内容版权保护与全网侵权监测服务。
                </p>

                <div className="mt-6 w-full max-w-3xl mx-auto">
                    <div className="flex flex-col md:flex-row items-center justify-center gap-3">
                        <button
                            onClick={() => setShowSubscriptionModal(true)}
                            disabled={!planLoaded}
                            className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-gray-200 hover:bg-white/10 transition-all text-sm font-bold disabled:opacity-60"
                        >
                            订阅管理
                        </button>
                    </div>
                </div>
            </div>

            {/* Pricing Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mt-12">
                {/* 1. Free Plan */}
                <div className="glass-card p-6 flex flex-col relative border border-white/5 hover:border-gray-500/30 transition-all">
                    <div className="mb-8">
                        <div className="w-12 h-12 rounded-xl bg-teal-500/10 flex items-center justify-center mb-6 border border-teal-500/20">
                            <Shield className="text-teal-400" size={24} />
                        </div>
                        <h3 className="text-xl font-bold text-white mb-2">免费版</h3>
                        <p className="text-gray-400 text-xs h-10 leading-relaxed">
                            轻量体验：水印嵌入 + 全网检测 + 基础存证。
                        </p>
                        <div className="mt-6 flex items-baseline gap-1">
                            <span className="text-4xl font-bold text-white">¥0</span>
                            <span className="text-gray-500">/ 永久</span>
                        </div>
                    </div>

                    <div className="space-y-5 flex-1 mb-8">
                        {/* 基础功能 */}
                        <div>
                            <div className="text-xs text-teal-400/60 mb-2 uppercase tracking-wider">基础功能</div>
                            <div className="space-y-2">
                                {[
                                    '每月50次数字水印嵌入（图片/文本/视频）',
                                    '每月20次全网侵权检测扫描',
                                    '支持图片、文本、视频全类型内容保护',
                                    '区块链存证确权（基础通道）',
                                    '批量一键上链存证（单次最多10个）',
                                    '检测记录本地保留50条 + 云端同步50条'
                                ].map((feature, i) => (
                                    <div key={i} className="flex items-center gap-3 text-sm text-gray-300">
                                        <Check size={16} className="text-teal-400 shrink-0" />
                                        <span>{feature}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        
                        {/* 包含报告 */}
                        <div>
                            <div className="text-xs text-teal-400/60 mb-2 uppercase tracking-wider">报告能力</div>
                            <div className="space-y-2">
                                <div className="flex items-center gap-3 text-sm text-gray-300">
                                    <Check size={16} className="text-teal-400 shrink-0" />
                                    <span>溯源鉴定报告（仅在线查看）</span>
                                </div>
                            </div>
                        </div>
                        {/* 升级解锁 */}
                        <div>
                            <div className="text-xs text-gray-500 mb-2 uppercase tracking-wider">升级后可解锁</div>
                            <div className="space-y-2">
                                {[
                                    '报告多格式导出',
                                    'DeepSeek AI 智能分析报告',
                                    'DMCA 侵权下架通知函（专业版）'
                                ].map((feature, i) => (
                                    <div key={i} className="flex items-center gap-3 text-sm text-gray-500">
                                        <span className="w-4 h-4 flex items-center justify-center text-gray-600">×</span>
                                        <span>{feature}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <button 
                        disabled={isPlanDisabled('free')}
                        className={`w-full py-3 rounded-xl font-bold transition-all mt-auto border ${isPlanDisabled('free') ? 'bg-white/10 text-white border-white/10 cursor-default' : 'bg-white/5 text-white hover:bg-white/10 border-white/5'}`}
                    >
                        {getPlanButtonText('free')}
                    </button>
                </div>

                {/* 2. Personal Plan */}
                <div className="glass-card p-6 flex flex-col relative border border-white/5 hover:border-purple-500/30 transition-all">
                    <div className="mb-8">
                        <div className="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center mb-6 border border-purple-500/20">
                            <User className="text-purple-400" size={24} />
                        </div>
                        <h3 className="text-xl font-bold text-white mb-2">个人版</h3>
                        <p className="text-gray-400 text-xs h-10 leading-relaxed">
                            个人创作者确权、溯源与报告的基础全套。
                        </p>
                        <div className="mt-6 flex flex-col">
                            <div className="flex items-baseline gap-1">
                                <span className="text-4xl font-bold text-white">¥19</span>
                                <span className="text-gray-500">/ 月</span>
                            </div>
                            <div className="mt-1 flex items-center gap-2">
                                <span className="text-xs text-gray-500">或</span>
                                <span className="text-sm text-emerald-400 font-medium">¥199/年（省13%）</span>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-5 flex-1 mb-8">
                        {/* 核心额度 */}
                        <div>
                            <div className="text-xs text-gray-500 mb-2 uppercase tracking-wider">核心额度</div>
                            <div className="space-y-2">
                                {[
                                    '每月500次数字水印嵌入（图片/文本/视频）',
                                    '每月200次全网侵权检测扫描',
                                    '支持图片、文本、视频全类型内容保护',
                                    '批量处理（单次最多50个文件）',
                                    '批量一键上链存证（单次最多30个）',
                                    '检测记录本地保留100条 + 云端同步100条'
                                ].map((feature, i) => (
                                    <div key={i} className="flex items-center gap-3 text-sm text-gray-300">
                                        <Check size={16} className="text-purple-400 shrink-0" />
                                        <span>{feature}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        
                        {/* 报告 & 导出 */}
                        <div>
                            <div className="text-xs text-purple-400/70 mb-2 uppercase tracking-wider">报告 & 导出</div>
                            <div className="space-y-2">
                                {[
                                    '溯源鉴定报告（查看 & 导出）',
                                    '检测报告多格式导出',
                                    'DeepSeek AI 智能分析报告',
                                    '区块链存证确权凭证'
                                ].map((feature, i) => (
                                    <div key={i} className="flex items-center gap-3 text-sm text-gray-300">
                                        <Check size={16} className="text-purple-400 shrink-0" />
                                        <span>{feature}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        {/* 升级解锁 */}
                        <div>
                            <div className="text-xs text-gray-500 mb-2 uppercase tracking-wider">升级后可解锁</div>
                            <div className="space-y-2">
                                <div className="flex items-center gap-3 text-sm text-gray-500">
                                    <span className="w-4 h-4 flex items-center justify-center text-gray-600">×</span>
                                    <span>DMCA 侵权下架通知函（专业版）</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={() => {
                            if (isPlanDisabled('personal')) return;
                            setPendingPlan('personal');
                            setShowPeriodModal(true);
                        }}
                        disabled={loadingPlan === 'personal' || isPlanDisabled('personal')}
                        className={`w-full py-3 rounded-xl font-bold transition-all mt-auto border border-purple-500/30 flex items-center justify-center gap-2 ${isPlanDisabled('personal') ? 'bg-white/10 text-white cursor-default' : 'bg-purple-600/20 text-purple-300 hover:bg-purple-600/30'}`}
                    >
                        {loadingPlan === 'personal' && <Loader2 size={18} className="animate-spin" />}
                        {getPlanButtonText('personal')}
                    </button>
                </div>

                {/* 3. Pro Plan */}
                <div className="glass-card !overflow-visible p-6 flex flex-col relative border-2 border-amber-500/50 transform lg:-translate-y-4 shadow-2xl shadow-amber-500/20 z-10 group hover:z-30 transition-all duration-300">
                    <div className="absolute inset-0 overflow-hidden rounded-[2rem] pointer-events-none">
                        <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/2 w-64 h-64 bg-amber-500/10 blur-[80px] rounded-full group-hover:bg-amber-500/20 transition-all duration-700" />
                    </div>

                    <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gradient-to-r from-amber-500 to-orange-600 text-white text-[11px] tracking-widest font-black px-4 py-1.5 rounded-full shadow-[0_0_25px_rgba(245,158,11,0.6)] border border-white/30 flex items-center gap-2 whitespace-nowrap z-50">
                        <span className="w-2 h-2 rounded-full bg-white animate-pulse shadow-[0_0_8px_white]" />
                        核心推荐 · 工作室首选
                    </div>

                    <div className="mb-8 relative mt-2">
                        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 p-[1px] mb-6 shadow-lg shadow-amber-500/20">
                            <div className="w-full h-full rounded-2xl bg-gray-900 flex items-center justify-center">
                                <Zap className="text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]" size={28} />
                            </div>
                        </div>
                        <h3 className="text-xl font-bold text-white mb-2">专业版</h3>
                        <p className="text-gray-400 text-xs h-10 leading-relaxed">
                            团队协作与深度维权：更高额度 + API + 法务能力。
                        </p>
                        <div className="mt-6 flex flex-col">
                            <div className="flex items-baseline gap-1.5">
                                <span className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500">¥99</span>
                                <span className="text-gray-500 font-medium font-mono text-sm">/ 月</span>
                            </div>
                            <div className="mt-1 flex items-center gap-2">
                                <span className="text-xs text-gray-500">或</span>
                                <span className="text-sm text-amber-400 font-medium">¥999/年（省16%）</span>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4 flex-1 mb-8 relative">
                        {/* 核心额度 */}
                        <div>
                            <div className="text-xs text-amber-500/60 mb-2 uppercase tracking-wider font-medium">核心额度</div>
                            <div className="space-y-2">
                                {[
                                    '每月2000次数字水印嵌入（图片/文本/视频）',
                                    '每月1000次全网侵权检测扫描',
                                    '支持图片、文本、视频全类型内容保护',
                                    '批量处理（单次最多200个文件）'
                                ].map((feature, i) => (
                                    <div key={i} className="flex items-center gap-3 text-sm text-gray-200">
                                        <span className="p-0.5 rounded-full bg-amber-500/20 text-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.2)] shrink-0">
                                            <Check size={12} strokeWidth={3} />
                                        </span>
                                        <span className="font-medium">{feature}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        
                        {/* 协作与API */}
                        <div>
                            <div className="text-xs text-amber-500/60 mb-2 uppercase tracking-wider font-medium">协作与API</div>
                            <div className="space-y-2">
                                {[
                                    '团队共享（5人协作空间）',
                                    'API接口调用（每月1000次）'
                                ].map((feature, i) => (
                                    <div key={i} className="flex items-center gap-3 text-sm text-gray-200">
                                        <span className="p-0.5 rounded-full bg-amber-500/20 text-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.2)] shrink-0">
                                            <Check size={12} strokeWidth={3} />
                                        </span>
                                        <span className="font-medium">{feature}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        
                        {/* 报告 & 法务 */}
                        <div>
                            <div className="text-xs text-amber-500/60 mb-2 uppercase tracking-wider font-medium">报告 & 法务</div>
                            <div className="space-y-2">
                                {[
                                    '全部报告多格式导出',
                                    'DeepSeek AI 智能分析报告',
                                    'DMCA 侵权下架通知函',
                                    '区块链存证确权凭证',
                                    '检测记录云端同步（最多200条）+ 本地保留200条',
                                    '优先技术支持响应通道'
                                ].map((feature, i) => (
                                    <div key={i} className="flex items-center gap-3 text-sm text-gray-200">
                                        <span className="p-0.5 rounded-full bg-amber-500/20 text-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.2)] shrink-0">
                                            <Check size={12} strokeWidth={3} />
                                        </span>
                                        <span className="font-medium">{feature}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={() => {
                            if (isPlanDisabled('pro')) return;
                            setPendingPlan('pro');
                            setShowPeriodModal(true);
                        }}
                        disabled={loadingPlan === 'pro' || isPlanDisabled('pro')}
                        className={`w-full py-3.5 rounded-xl font-black text-sm tracking-wide transition-all mt-auto transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2 ${isPlanDisabled('pro') ? 'bg-white/10 text-white shadow-none cursor-default' : 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-[0_4px_15px_rgba(245,158,11,0.3)] hover:shadow-[0_8px_25px_rgba(245,158,11,0.5)]'}`}
                    >
                        {loadingPlan === 'pro' && <Loader2 size={18} className="animate-spin" />}
                        {getPlanButtonText('pro')}
                    </button>
                </div>

                {/* 4. Enterprise Plan */}
                <div className="glass-card p-6 flex flex-col relative border border-white/5 hover:border-blue-500/30 transition-all">
                    <div className="mb-8">
                        <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center mb-6 border border-blue-500/30">
                            <Building2 className="text-blue-400" size={24} />
                        </div>
                        <h3 className="text-xl font-bold text-white mb-2">企业版</h3>
                        <p className="text-gray-400 text-xs h-10 leading-relaxed">
                            私有化部署与定制：专属通道、SLA 与白标输出。
                        </p>
                        <div className="mt-6 flex flex-col">
                            <div className="flex items-baseline gap-1">
                                <span className="text-4xl font-bold text-white">¥299</span>
                                <span className="text-gray-500">/ 月起</span>
                            </div>
                            <span className="text-xs text-blue-400/70 mt-1">年付特惠: ¥2999/年起</span>
                        </div>
                    </div>

                    <div className="space-y-4 flex-1 mb-8">
                        {/* 核心额度 */}
                        <div>
                            <div className="text-xs text-blue-400/70 mb-2 uppercase tracking-wider">核心额度</div>
                            <div className="space-y-2">
                                {[
                                    '无限次数数字水印嵌入（图片/文本/视频）',
                                    '无限次数全网侵权检测扫描',
                                    '支持图片、文本、视频全类型内容保护'
                                ].map((feature, i) => (
                                    <div key={i} className="flex items-center gap-3 text-sm text-gray-300">
                                        <span className="p-0.5 rounded-full bg-blue-500/20 text-blue-400 shrink-0">
                                            <Crown size={12} strokeWidth={3} />
                                        </span>
                                        <span>{feature}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        
                        {/* 报告 & 法务 */}
                        <div>
                            <div className="text-xs text-blue-400/70 mb-2 uppercase tracking-wider">报告 & 法务（包含专业版全部）</div>
                            <div className="space-y-2">
                                {[
                                    '全部报告多格式导出 + AI 分析 + DMCA 通知函',
                                    '检测记录云端同步（最多500条）+ 本地保留500条',
                                ].map((feature, i) => (
                                    <div key={i} className="flex items-center gap-3 text-sm text-gray-300">
                                        <span className="p-0.5 rounded-full bg-blue-500/20 text-blue-400 shrink-0">
                                            <Crown size={12} strokeWidth={3} />
                                        </span>
                                        <span>{feature}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        {/* 高级服务 */}
                        <div>
                            <div className="text-xs text-blue-400/70 mb-2 uppercase tracking-wider">高级服务</div>
                            <div className="space-y-2">
                                {[
                                    '私有化部署方案（可选）',
                                    '专属功能定制开发服务',
                                    '1对1专属企业客服',
                                    '99.9%服务可用性保障（SLA）'
                                ].map((feature, i) => (
                                    <div key={i} className="flex items-center gap-3 text-sm text-gray-300">
                                        <span className="p-0.5 rounded-full bg-blue-500/20 text-blue-400 shrink-0">
                                            <Crown size={12} strokeWidth={3} />
                                        </span>
                                        <span>{feature}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        
                        {/* 企业定制 */}
                        <div>
                            <div className="text-xs text-blue-400/70 mb-2 uppercase tracking-wider">企业定制</div>
                            <div className="space-y-2">
                                {[
                                    '法务文书与证据报告定制',
                                    '区块链存证专属通道与策略配置',
                                    '全栈平台白标品牌输出'
                                ].map((feature, i) => (
                                    <div key={i} className="flex items-center gap-3 text-sm text-gray-300">
                                        <span className="p-0.5 rounded-full bg-blue-500/20 text-blue-400 shrink-0">
                                            <Crown size={12} strokeWidth={3} />
                                        </span>
                                        <span>{feature}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={() => setShowContactModal(true)}
                        className="w-full py-3 rounded-xl bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 font-bold transition-all mt-auto border border-blue-500/30">
                        联系企业顾问
                    </button>
                </div>
            </div>

            <div className="mt-10 glass-card p-4 sm:p-6 border border-white/10">
                <div className="flex items-center justify-between gap-4 mb-4">
                    <div>
                        <div className="text-base sm:text-lg font-bold text-white">功能权限对照</div>
                    </div>
                    <button
                        onClick={() => setShowSubscriptionModal(true)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-200 hover:bg-white/10 transition-all"
                    >
                        订阅管理
                    </button>
                </div>

                {/* 移动端横滑提示 */}
                <div className="sm:hidden text-[10px] text-gray-500 mb-2 text-center">← 左右滑动查看完整对照 →</div>
                <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
                    <table className="w-full text-left min-w-[600px]">
                        <thead className="text-sm text-gray-400 tracking-wide">
                            <tr className="border-b border-white/10">
                                <th className="py-3 pr-4 font-semibold w-[28%]">功能</th>
                                <th className="py-3 pr-4 font-semibold text-teal-300 w-[18%] text-center">免费版</th>
                                <th className="py-3 pr-4 font-semibold text-purple-300 w-[18%] text-center">个人版</th>
                                <th className="py-3 pr-4 font-semibold text-amber-300 w-[18%] text-center">专业版</th>
                                <th className="py-3 pr-0 font-semibold text-blue-300 w-[18%] text-center">企业版</th>
                            </tr>
                        </thead>
                        <tbody className="text-sm">
                            <tr className="border-b border-white/5">
                                <td className="py-3 pr-4 text-gray-300">检测记录（本地保留 / 云端同步）</td>
                                <td className="py-3 pr-4 text-teal-300 text-center">本地 50 / 云端 50</td>
                                <td className="py-3 pr-4 text-purple-300 text-center">本地 100 / 云端 100</td>
                                <td className="py-3 pr-4 text-amber-300 text-center">本地 200 / 云端 200</td>
                                <td className="py-3 pr-0 text-blue-300 text-center">本地 500 / 云端 500</td>
                            </tr>
                            <tr className="border-b border-white/5">
                                <td className="py-3 pr-4 text-gray-300">溯源鉴定报告（在线查看）</td>
                                <td className="py-3 pr-4 text-teal-300 text-center"><Check size={14} className="inline" /> 在线查看</td>
                                <td className="py-3 pr-4 text-purple-300 text-center"><Check size={14} className="inline" /> 查看 & 导出</td>
                                <td className="py-3 pr-4 text-amber-300 text-center"><Check size={14} className="inline" /> 查看 & 导出</td>
                                <td className="py-3 pr-0 text-blue-300 text-center"><Check size={14} className="inline" /> 查看 & 导出</td>
                            </tr>
                            <tr className="border-b border-white/5">
                                <td className="py-3 pr-4 text-gray-300">导出检测报告（多格式）</td>
                                <td className="py-3 pr-4 text-gray-500 text-center"><X size={14} className="inline" /> 需升级</td>
                                <td className="py-3 pr-4 text-purple-300 text-center"><Check size={14} className="inline" /> 多格式导出</td>
                                <td className="py-3 pr-4 text-amber-300 text-center"><Check size={14} className="inline" /> 多格式导出</td>
                                <td className="py-3 pr-0 text-blue-300 text-center"><Check size={14} className="inline" /> 多格式导出</td>
                            </tr>
                            <tr className="border-b border-white/5">
                                <td className="py-3 pr-4 text-gray-300">DeepSeek AI 智能分析报告</td>
                                <td className="py-3 pr-4 text-gray-500 text-center"><X size={14} className="inline" /> 需升级</td>
                                <td className="py-3 pr-4 text-purple-300 text-center"><Check size={14} className="inline" /> 多格式导出</td>
                                <td className="py-3 pr-4 text-amber-300 text-center"><Check size={14} className="inline" /> 多格式导出</td>
                                <td className="py-3 pr-0 text-blue-300 text-center"><Check size={14} className="inline" /> 多格式导出</td>
                            </tr>
                            <tr>
                                <td className="py-3 pr-4 text-gray-300">DMCA 侵权下架通知函</td>
                                <td className="py-3 pr-4 text-gray-500 text-center"><X size={14} className="inline" /> 需升级</td>
                                <td className="py-3 pr-4 text-gray-500 text-center"><X size={14} className="inline" /> 需升级</td>
                                <td className="py-3 pr-4 text-amber-300 text-center"><Check size={14} className="inline" /> 多格式导出</td>
                                <td className="py-3 pr-0 text-blue-300 text-center"><Check size={14} className="inline" /> 多格式导出</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            {/* FAQ Section - Accordion Style */}
            <div className="mt-20 relative">
                {/* Decorative background glow */}
                <div className="absolute inset-0 -top-20 pointer-events-none">
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-gradient-to-b from-cyan-500/5 via-purple-500/5 to-transparent rounded-full blur-3xl" />
                </div>

                <div className="text-center mb-12 relative">
                    <div className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-gradient-to-r from-cyan-500/10 to-purple-500/10 border border-cyan-400/20 mb-5 shadow-lg shadow-cyan-500/5">
                        <HelpCircle size={16} className="text-cyan-400" />
                        <span className="text-sm font-medium text-cyan-300 tracking-wide">常见问题</span>
                    </div>
                    <h3 className="text-3xl md:text-4xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-white via-gray-100 to-gray-300 tracking-tight">
                        有疑问？我们来解答
                    </h3>
                    <p className="text-gray-400 mt-3 text-base tracking-wide">关于功能、计费与技术的常见问题汇总</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-5xl mx-auto relative">
                    {[
                        {
                            q: '与传统水印、哈希有什么本质区别？',
                            a: '传统可见水印容易被裁剪、涂抹或截图移除；普通文件哈希在图片被压缩后会完全改变，无法匹配原作品。AIGCGuard 采用基于 DCT 频域的鲁棒数字指纹技术，将不可见的版权信息嵌入图像深层特征中，在压缩、缩放、截图、裁剪等常见传播场景下仍可稳定提取与匹配。'
                        },
                        {
                            q: '图片被压缩、裁剪、截图后还能检测吗？',
                            a: '可以。平台采用 LDM 隐式空间对抗训练技术，数字指纹与图像内容深度融合。即使经过微信/QQ 等社交软件二次压缩、局部裁剪、手机截图等操作，指纹仍可被稳定提取，检测置信度保持在较高水平。'
                        },
                        {
                            q: '嵌入指纹时的作者信息有什么作用？',
                            a: '嵌入指纹时填写的作者名称会作为版权归属信息写入数字指纹。在后续检测中,系统会自动显示该作者信息,作为确权证据的一部分。如果嵌入时未填写作者名称,检测报告中将显示\"未知\"。建议在嵌入时务必填写准确的作者信息,以确保检测报告的完整性和法律证据效力。'
                        },
                        {
                            q: '置信度是什么？如何判断是否侵权？',
                            a: '系统在输出“命中”前会进行多重一致性校验，并给出置信度等级（高 / 中 / 低）。高置信度（≥80%）表示证据链充分，建议直接维权；中置信度（60–80%）建议结合上链凭证人工复核；低置信度（<60%）通常为安全范围。专业版/企业版可启用更严格的阈值策略，降低误判风险。'
                        },
                        {
                            q: '检测报告包含哪些内容？如何导出？',
                            a: '检测报告包含数字指纹匹配结果、五维证据评分、原始资产信息、确权时间戳、链上 TxID 等完整证据链。免费版可在线查看溯源鉴定报告；个人版及以上支持多格式导出（PDF、Markdown、TXT 等）及 DeepSeek AI 智能分析报告；DMCA 侵权下架通知函为专业版及以上专属功能。'
                        },
                        {
                            q: '检测记录会保存多久？我可以在哪里查看？',
                            a: '所有检测记录均保存在「监测中心」的「检测记录」标签页中,包含检测时间、文件名、匹配结果、置信度、五维评分等完整信息。每个套餐有本地保留上限（免费版 50 条、个人版 100 条、专业版 200 条、企业版 500 条），超出后最早的记录会被自动替换,同时支持云端同步备份。您可以随时点击任意记录查看详细检测报告,并支持导出为 PDF、HTML 等格式。检测记录按时间倒序排列,支持快速定位历史检测结果。'
                        },
                        {
                            q: '什么是区块链存证？所有套餐都支持吗？',
                            a: '区块链存证是将作品的数字指纹（Hash）同步广播至公有链节点，生成不可篡改且含时间戳的交易 TxID，可作为法律维权的电子证据。所有版本（包括免费版）均支持区块链存证确权，各套餐的区别仅在于单次批量上链的数量上限。'
                        },
                        {
                            q: 'DMCA 下架通知函如何生成？需要什么材料？',
                            a: '专业版/企业版支持一键生成 DMCA 下架通知函。系统会自动填充检测到的匹配证据（原始资产信息、相似度、确权时间、区块链 TxID），用户只需补充侵权链接和简要证据要点，由 DeepSeek AI 自动生成符合《著作权法》规范的正式法律文书。'
                        },
                        {
                            q: 'DMCA 下架通知函的法律效力如何？适用哪些场景？',
                            a: 'DMCA（Digital Millennium Copyright Act）是美国数字版权保护法案,国内外主流平台（如 Google、YouTube、GitHub、微博、抖音等）均接受 DMCA 下架通知。平台生成的通知函包含完整的证据链:原始资产信息、检测匹配结果、区块链存证 TxID 及时间戳,符合《著作权法》与《信息网络传播权保护条例》要求。用户收到通知函后,可直接向侵权平台提交下架申请,也可作为诉讼证据使用。专业版/企业版支持批量生成 DMCA 通知函。'
                        },
                        {
                            q: '不同套餐的权限具体有哪些区别？',
                            a: '免费版:支持在线查看溯源鉴定报告、基础指纹嵌入与检测、区块链存证（单次 10 个）。个人版:新增多格式报告导出（PDF/HTML/Markdown）、DeepSeek AI 分析报告、单次 30 个批量上链。专业版:新增 DMCA 法务文书生成、API 接入、无限批量上链、5 人团队空间。企业版:全部功能解锁,支持私有化部署、专属客服与更高配额。所有用户均可查看检测记录,导出与高级功能按套餐等级开放。'
                        },
                        {
                            q: '免费版批量上链为什么限制 10 个？',
                            a: '免费版定位为轻量体验，单次批量上链限制 10 个文件，适合个人体验和小规模使用。如需大批量存证，建议升级至个人版（单次 30 个）或专业版/企业版（无限制），可联系客服了解更多。'
                        },
                        {
                            q: '专业版额度和团队空间如何计算？',
                            a: '专业版包含每月 2000 次嵌入 + 1000 次检测额度，以及 5 人协作空间。额度按自然月重置，未用完不累积。超额后可购买扩容包或联系客服升级。团队空间支持成员角色权限管理与资产共享。'
                        },
                        {
                            q: '隐私与数据安全如何保障？',
                            a: '平台采用账户隔离与行级权限控制（RLS），用户只能访问自己的确权资产与检测记录。存证数据仅保存指纹与必要元数据，不会上传或存储原图内容；企业版支持私有化部署与专属存储策略，满足更严格的合规要求。'
                        },
                        {
                            q: 'API 接入流程需要多久？有文档吗？',
                            a: '专业版及企业版用户开通后即可获得专属 AppKey 和完整开发者文档,通常半天即可完成接入。支持 RESTful API 调用,可将指纹嵌入、检测与存证功能集成到自有网站、APP 或内部审核系统中。'
                        }
                    ].map((item, idx) => {
                        const isLeft = idx % 2 === 0;
                        const numTextHover = isLeft ? 'group-hover:text-cyan-400' : 'group-hover:text-purple-400';
                        const numBgHover = isLeft ? 'group-hover:bg-cyan-500/15' : 'group-hover:bg-purple-500/15';
                        const borderHover = isLeft ? 'hover:border-cyan-500/25' : 'hover:border-purple-500/25';

                        return (
                            <details
                                key={idx}
                                className={`group rounded-2xl overflow-hidden bg-slate-900/50 backdrop-blur-xl border border-white/[0.08] shadow-lg transition-all duration-300 ${borderHover} hover:shadow-xl hover:bg-slate-800/50`}
                            >
                                <summary className="flex items-center justify-between p-5 cursor-pointer list-none transition-colors relative">
                                    <div className="flex items-center gap-4">
                                        <span className={`w-9 h-9 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-xs font-bold text-gray-500 ${numTextHover} ${numBgHover} transition-all duration-300 shrink-0`}>
                                            {String(idx + 1).padStart(2, '0')}
                                        </span>
                                        <span className="font-semibold text-[15px] text-gray-200 group-hover:text-white transition-colors duration-300 leading-snug">
                                            {item.q}
                                        </span>
                                    </div>
                                    <ChevronDown size={16} className="text-gray-600 group-open:rotate-180 group-hover:text-gray-400 transition-all duration-300 shrink-0 ml-3" />
                                </summary>
                                <div className="px-5 pb-5 pt-0">
                                    <div className="ml-[52px] text-gray-400 text-sm leading-[1.8] border-t border-white/[0.06] pt-4">
                                        {item.a}
                                    </div>
                                </div>
                            </details>
                        );
                    })}
                </div>
            </div>

            {portalTarget && showSubscriptionModal && createPortal(
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
                        onClick={() => setShowSubscriptionModal(false)}
                    />
                    <div className="relative w-full max-w-2xl rounded-2xl overflow-hidden shadow-2xl border border-white/10 bg-gradient-to-b from-slate-900/85 via-slate-950/80 to-black/80">
                        <div className="p-4 border-b border-white/10 flex items-center justify-between">
                            <div className="text-white font-bold">订阅管理</div>
                            <button
                                onClick={() => setShowSubscriptionModal(false)}
                                className="p-2 rounded-lg hover:bg-white/10 text-gray-300"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="p-5 max-h-[80vh] overflow-auto">
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 text-left">
                                <div className="flex items-center justify-between gap-4">
                                    <div>
                                        <div className="text-sm text-gray-400">我的订阅</div>
                                        <div className="text-lg font-bold text-white mt-1">
                                            {getPlanDisplayName(currentPlan)}
                                        </div>
                                    </div>
                                    <button
                                        onClick={refreshFromSupabase}
                                        className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-200 hover:bg-white/10 transition-all"
                                    >
                                        刷新
                                    </button>
                                </div>

                                <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                                        <div className="text-[11px] text-gray-500">状态</div>
                                        <div className="text-sm text-white mt-1">{getStatusDisplayName(subscriptionStatus)}</div>
                                    </div>
                                    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                                        <div className="text-[11px] text-gray-500">周期</div>
                                        <div className="text-sm text-white mt-1">
                                            {subscriptionPeriod ? (subscriptionPeriod === 'year' ? '年付' : '月付') : '-'}
                                        </div>
                                    </div>
                                    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                                        <div className="text-[11px] text-gray-500">到期时间</div>
                                        <div className="text-sm text-white mt-1">
                                            {subscriptionExpiresAt ? new Date(subscriptionExpiresAt).toLocaleString() : '-'}
                                        </div>
                                    </div>
                                    <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                                        <div className="text-[11px] text-gray-500">剩余天数</div>
                                        <div className="text-sm text-white mt-1">
                                            {subscriptionRemainingDays === null ? '-' : `${subscriptionRemainingDays} 天`}
                                        </div>
                                    </div>
                                </div>

                                {normalizePlan(currentPlan) !== 'free' && (
                                    <div className="mt-4 flex flex-wrap gap-3 items-center">
                                        <button
                                            onClick={() => handleRenew('month')}
                                            disabled={renewLoading !== null}
                                            className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white text-sm font-bold disabled:opacity-50"
                                        >
                                            {renewLoading === 'month' ? '下单中...' : '续费 1 个月'}
                                        </button>
                                        <button
                                            onClick={() => handleRenew('year')}
                                            disabled={renewLoading !== null}
                                            className="px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white text-sm font-bold disabled:opacity-50"
                                        >
                                            {renewLoading === 'year' ? '下单中...' : '续费 1 年'}
                                        </button>
                                        <div className="text-xs text-gray-500">
                                            支付完成后由后端验签发货，数据以 Supabase profiles 为准
                                        </div>
                                    </div>
                                )}

                                {normalizePlan(currentPlan) === 'free' && (
                                    <div className="mt-4 text-xs text-gray-500">
                                        免费版暂无续费入口，请在下方选择套餐进行开通。
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>,
                portalTarget
            )}

            {/* Period Selection Modal */}
            {portalTarget && showPeriodModal && pendingPlan && createPortal(
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowPeriodModal(false)}></div>
                    <div className="glass-card relative border border-white/10 w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl z-10 p-6 bg-black/80">
                        <button
                            onClick={() => setShowPeriodModal(false)}
                            className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors"
                        >
                            <X size={20} />
                        </button>

                        <h3 className="text-xl font-bold text-white mb-2 text-center">选择计费周期</h3>
                        <p className="text-sm text-gray-400 text-center mb-6">
                            {pendingPlan === 'personal' ? '个人版' : pendingPlan === 'pro' ? '专业版' : '套餐'}
                        </p>

                        <div className="space-y-3 mb-6">
                            <button
                                onClick={() => {
                                    handlePurchaseWithPeriod(pendingPlan, 'month');
                                    setShowPeriodModal(false);
                                }}
                                className="w-full py-3 rounded-xl bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-all flex items-center justify-between px-4"
                            >
                                <span className="font-medium">月付</span>
                                <span className="text-lg font-bold">
                                    ¥{pendingPlan === 'personal' ? '19' : pendingPlan === 'pro' ? '99' : '0'}/月
                                </span>
                            </button>
                            <button
                                onClick={() => {
                                    handlePurchaseWithPeriod(pendingPlan, 'year');
                                    setShowPeriodModal(false);
                                }}
                                className="w-full py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-all flex items-center justify-between px-4"
                            >
                                <div className="flex items-center gap-2">
                                    <span className="font-medium">年付</span>
                                    <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded">{pendingPlan === 'personal' ? '省13%' : '省16%'}</span>
                                </div>
                                <span className="text-lg font-bold">
                                    ¥{pendingPlan === 'personal' ? '199' : pendingPlan === 'pro' ? '999' : '0'}/年
                                </span>
                            </button>
                        </div>

                        <button
                            onClick={() => setShowPeriodModal(false)}
                            className="w-full py-2 rounded-xl text-gray-400 hover:text-white transition-all text-sm"
                        >
                            取消
                        </button>
                    </div>
                </div>,
                portalTarget
            )}

            {/* Contact Modal */}
            {portalTarget && showContactModal && createPortal(
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowContactModal(false)}></div>
                    <div className="glass-card relative border border-white/10 w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl animate-enter z-10 flex flex-col items-center p-8 bg-black/80">
                        <button
                            onClick={() => setShowContactModal(false)}
                            className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors"
                        >
                            <X size={20} />
                        </button>

                        <div className="w-full relative rounded-xl overflow-hidden bg-white/5 border border-white/5 mb-6">
                            {/* 如果用户还没有放图片，这个 div 提供一个视觉占位 */}
                            <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-500 italic pointer-events-none -z-10">
                                请在 public 目录放置 /qrcode.png
                            </div>
                            <img
                                src="/qrcode.png"
                                alt="企业顾问二维码"
                                className="w-full h-auto object-cover"
                                onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                    (e.target as HTMLImageElement).parentElement!.classList.add('h-64', 'flex', 'items-center', 'justify-center');
                                }}
                            />
                        </div>

                        <h3 className="text-xl font-bold text-white mb-2 text-center">专属企业服务顾问</h3>
                        <p className="text-sm text-gray-400 text-center mb-6">扫码添加企业微信，获取定制化报价与技术方案</p>

                        <button
                            onClick={() => setShowContactModal(false)}
                            className="w-full py-3 rounded-xl bg-white/10 text-white hover:bg-white/20 font-bold transition-all border border-white/5"
                        >
                            我已添加
                        </button>
                    </div>
                </div>,
                portalTarget
            )}
        </div>
    );
};

export default Pricing;
