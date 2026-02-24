import { Outlet } from 'react-router-dom';
import Navbar from './components/Navbar';
import UpgradeSuccessModal from './components/UpgradeSuccessModal';

import { auth } from './services/api';
import { useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useCallback } from 'react';
import { useApp } from './contexts/AppContext';

const PLAN_RANK: Record<string, number> = { free: 0, personal: 1, pro: 2, enterprise: 3 };
const normalizePlanKey = (p: string) => {
    const l = (p || '').toLowerCase().trim();
    if (l === 'professional') return 'pro';
    if (['free', 'personal', 'pro', 'enterprise'].includes(l)) return l;
    return 'free';
};

const Layout = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { state, showUpgradeSuccess, pushToast } = useApp();

    // 检测套餐变化，只在等级上升时显示升级成功提示
    const checkPlanChange = useCallback(async () => {
        const token = localStorage.getItem('access_token');
        if (!token) return;

        try {
            const user = await auth.me();
            const currentPlan = normalizePlanKey(user?.plan || 'free');
            const currentPeriod = user?.subscription_period || null;
            const prevPlan = localStorage.getItem('aigc_prev_plan');

            // 只在等级上升时弹窗（降级/过期不弹）
            if (prevPlan && prevPlan !== currentPlan) {
                const prevRank = PLAN_RANK[prevPlan] ?? 0;
                const currRank = PLAN_RANK[currentPlan] ?? 0;
                if (currRank > prevRank) {
                    showUpgradeSuccess(currentPlan, currentPeriod || undefined);
                }
            }

            localStorage.setItem('aigc_prev_plan', currentPlan);
        } catch (e) {
            // ignore
        }
    }, [showUpgradeSuccess]);

    useEffect(() => {
        // 首次加载时设置初始值
        checkPlanChange();

        // 监听额度更新事件，重新检查套餐（支付成功 / 管理员调整后触发）
        const handleQuotaUpdate = () => checkPlanChange();
        window.addEventListener('quota-updated', handleQuotaUpdate);

        return () => {
            window.removeEventListener('quota-updated', handleQuotaUpdate);
        };
    }, [checkPlanChange]);

    // 登录欢迎 Toast — 依赖 location.pathname，登录后导航时触发
    useEffect(() => {
        const flag = sessionStorage.getItem('just_logged_in');
        if (!flag) return;
        sessionStorage.removeItem('just_logged_in');

        (async () => {
            try {
                const user = await auth.me();
                const plan = normalizePlanKey(user?.plan || 'free');
                const name = user?.display_name || user?.username || '';
                const planNames: Record<string, string> = { free: '免费版', personal: '个人版', pro: '专业版', enterprise: '企业版' };

                if (plan === 'free') {
                    pushToast(`欢迎回来，${name}！`, 'success', 4000);
                } else {
                    pushToast(`欢迎回来，尊贵的 ${planNames[plan] || plan} 用户 ${name}！`, 'success', 4000);
                }
            } catch (e) {
                // ignore
            }
        })();
    }, [location.pathname, pushToast]);

    useEffect(() => {
        const checkAuth = async () => {
            const token = localStorage.getItem('access_token');
            const protectedRoutes = ['/monitor', '/fingerprint', '/evidence', '/admin'];
            const isProtected = protectedRoutes.some(path => location.pathname.startsWith(path));

            if (token) {
                try {
                    // Verify token validity
                    await auth.me();
                } catch (e) {
                    console.error("Auth check failed", e);
                    localStorage.removeItem('access_token');
                    if (isProtected) navigate('/login');
                }
            } else {
                if (isProtected) {
                    navigate('/login');
                }
            }
        };
        checkAuth();
    }, [location.pathname]);

    return (
        <div className="min-h-screen relative overflow-x-hidden bg-dark-900">
            {/* Background Decoration */}
            <div className="fixed inset-0 pointer-events-none z-0">
                {/* Mesh Gradients */}
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 rounded-full blur-[120px] animate-pulse-slow" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-secondary/20 rounded-full blur-[120px] animate-pulse-slow delay-1000" />
                <div className="absolute top-[40%] left-[60%] w-[20%] h-[20%] bg-accent/10 rounded-full blur-[100px] animate-float" />

                {/* Grid Overlay */}
                <div className="absolute inset-0 bg-[url('/grid.svg')] bg-[length:40px_40px] opacity-10" />
            </div>

            <Navbar />



            <main className="relative z-10 w-full max-w-full mx-auto px-3 sm:px-6 md:px-12 lg:px-20 py-28 sm:py-32 min-h-[calc(100vh-80px)]">
                <div className="animate-enter">
                    <Outlet />
                </div>
            </main>

            <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 w-[420px] max-w-[calc(100vw-24px)] sm:max-w-[calc(100vw-48px)] pointer-events-none">
                {(state.toasts || []).map((t) => (
                    <div
                        key={t.id}
                        className={`pointer-events-auto rounded-xl border px-4 py-3 shadow-2xl backdrop-blur-md transition-all
                            ${t.type === 'success'
                                ? 'bg-green-500/15 border-green-500/30 text-green-100'
                                : t.type === 'error'
                                    ? 'bg-red-500/15 border-red-500/30 text-red-100'
                                    : 'bg-white/10 border-white/15 text-gray-100'
                            }`}
                    >
                        <div className="text-sm leading-snug">{t.message}</div>
                    </div>
                ))}
            </div>

            <footer className="relative z-10 w-full border-t border-white/5 mt-auto py-8">
                <div className="max-w-7xl mx-auto px-4 text-center">
                    <p className="text-gray-500 text-sm">
                        AIGC 数字内容指纹嵌入与侵权全网监测平台 <span className="text-primary/60">V1.0</span>
                        <br />
                        &copy; 2026 技术支持：PIONEER工作室
                        <br />
                        <span className="inline-flex items-center gap-2 mt-2 px-3 py-1 bg-black/30 rounded-full border border-white/5 text-xs text-green-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                            引擎状态: 运行中 | 云端矩阵: 数据已多重加密备份
                        </span>
                    </p>
                </div>
            </footer>
            
            {/* 升级成功提示 */}
            <UpgradeSuccessModal />
        </div>
    );
};

export default Layout;
