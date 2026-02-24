import React from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Fingerprint, Monitor, ShieldCheck, Activity, LogOut, Menu, X, Crown, Shield, User as UserIcon, Zap, Building2 } from 'lucide-react';
import { auth } from '../services/api';

const Navbar: React.FC = () => {
    const [isOpen, setIsOpen] = React.useState(false);
    const location = useLocation();
    const navigate = useNavigate();
    // 防止刷新时认证状态闪烁：从缓存中恢复上次的用户信息，让 UI 立即显示已登录状态
    const [user, setUser] = React.useState<any>(() => {
        try {
            const cached = localStorage.getItem('navbar_user_cache');
            if (cached && localStorage.getItem('access_token')) return JSON.parse(cached);
        } catch {}
        return null;
    });

    React.useEffect(() => {
        const checkAuth = async () => {
            const token = localStorage.getItem('access_token');
            if (token) {
                try {
                    const userData = await auth.me();
                    setUser(userData);
                    // 缓存用户信息，下次刷新时立即可用
                    localStorage.setItem('navbar_user_cache', JSON.stringify(userData));
                } catch (e) {
                    console.error("Auth check failed", e);
                    setUser(null);
                    localStorage.removeItem('navbar_user_cache');
                }
            } else {
                setUser(null);
                localStorage.removeItem('navbar_user_cache');
            }
        };
        checkAuth();

        // 监听额度更新事件，实现无刷新同步
        window.addEventListener('quota-updated', checkAuth);
        return () => window.removeEventListener('quota-updated', checkAuth);
    }, [location.pathname]);

    const handleLogout = async () => {
        // Clear all user-specific caches to prevent data leakage between accounts
        const token = localStorage.getItem('access_token') || '';
        const userId = token?.slice(-16) || 'anonymous';
        
        // Clear all possible cache keys (old and new formats)
        localStorage.removeItem(`latest_evidence_${userId}`);
        localStorage.removeItem('latest_evidence'); // old format
        localStorage.removeItem('access_token');
        localStorage.removeItem('navbar_user_cache');
        localStorage.removeItem('register_display_name');
        sessionStorage.removeItem('admin_api_secret');
        sessionStorage.removeItem(`app_state_${userId}`);
        sessionStorage.removeItem('app_state'); // old format
        
        // Clear all app_state_* entries to be safe
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
            const key = sessionStorage.key(i);
            if (key && key.startsWith('app_state_')) {
                sessionStorage.removeItem(key);
            }
        }
        
        // 标记已主动退出，阻止请求拦截器自动恢复 Supabase session
        sessionStorage.setItem('user_logged_out', '1');
        
        // 等待 Supabase signOut 完成，确保 session 被彻底清除
        await auth.logout();
        setUser(null);
        // Force reload to clear all React states and ensure clean slate
        window.location.href = '/login';
    };

    const navItems = [
        { name: '态势感知', path: '/', icon: <Activity size={24} />, activeColor: 'bg-blue-500/20 text-blue-400' },
        { name: '指纹嵌入', path: '/fingerprint', icon: <Fingerprint size={24} />, activeColor: 'bg-primary/20 text-primary-light' },
        { name: '侵权监测', path: '/monitor', icon: <Monitor size={24} />, activeColor: 'bg-secondary/20 text-secondary-light' },
        { name: '证据固化', path: '/evidence', icon: <ShieldCheck size={24} />, activeColor: 'bg-accent/20 text-accent' },
    ];

    return (
        <nav className="fixed top-0 left-0 right-0 h-28 z-50 px-4 md:px-10 flex items-center justify-center pointer-events-none">
            <div className="w-full max-w-[90rem] mx-auto glass-card h-18 px-8 flex items-center justify-between pointer-events-auto mt-5 rounded-full border-white/5">

                {/* Logo Section */}
                <div className="flex items-center gap-5 pl-3">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/30">
                        <Fingerprint className="text-white" size={28} />
                    </div>
                    <span className="text-2xl font-bold tracking-wide hidden md:block">
                        <span className="text-white">AIGC</span>
                        <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-500">Fingerprint</span>
                    </span>
                </div>

                {/* Desktop Navigation */}
                <div className="hidden md:flex items-center gap-3 bg-black/20 p-2 rounded-full border border-white/5 mx-6">
                    {navItems.map((item) => (
                        <NavLink
                            key={item.path}
                            to={item.path}
                            className={({ isActive }) =>
                                `px-6 py-2.5 rounded-full flex items-center gap-2.5 transition-all duration-300 font-medium text-lg
                                ${isActive
                                    ? `${item.activeColor} shadow-inner`
                                    : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                                }`
                            }
                        >
                            <span className={location.pathname === item.path ? '' : 'text-gray-500 group-hover:text-gray-300'}>
                                {item.icon}
                            </span>
                            <span>{item.name}</span>
                        </NavLink>
                    ))}
                </div>

                {/* Right Actions - Auth User Bar */}
                <div className="flex items-center gap-2 md:gap-4 pr-2">
                    {user ? (
                        (() => {
                            let config = {
                                bg: 'bg-gradient-to-tr from-teal-500/20 to-emerald-500/20',
                                border: 'border-teal-400/50',
                                shadow: 'shadow-[0_0_15px_rgba(20,184,166,0.3)]',
                                text: 'text-teal-400',
                                glow: 'border-teal-300/40 bg-teal-300/10',
                                label: '免费版',
                                badgeBg: 'bg-gradient-to-r from-teal-500/20 to-emerald-500/20',
                                badgeBorder: 'border-teal-500/30',
                                badgeText: 'text-teal-400',
                                Icon: Shield
                            };

                            const plan = (user.plan || '').toLowerCase();

                            if (user.role === 'admin') {
                                config = {
                                    bg: 'bg-gradient-to-tr from-red-500/20 to-rose-600/20',
                                    border: 'border-red-500/80',
                                    shadow: 'shadow-[0_0_15px_rgba(239,68,68,0.5)]',
                                    text: 'text-red-400',
                                    glow: 'border-red-400/50 bg-red-400/20',
                                    label: '监管中心',
                                    badgeBg: 'bg-gradient-to-r from-red-500/20 to-rose-600/20',
                                    badgeBorder: 'border-red-500/30',
                                    badgeText: 'text-red-400',
                                    Icon: Shield
                                };
                            } else if (plan === 'enterprise') {
                                config = {
                                    bg: 'bg-gradient-to-tr from-blue-500/20 to-cyan-500/20',
                                    border: 'border-blue-400/80',
                                    shadow: 'shadow-[0_0_15px_rgba(59,130,246,0.5)]',
                                    text: 'text-blue-400',
                                    glow: 'border-blue-300/50 bg-blue-300/20',
                                    label: '企业版',
                                    badgeBg: 'bg-gradient-to-r from-blue-500/20 to-cyan-500/20',
                                    badgeBorder: 'border-blue-400/30',
                                    badgeText: 'text-blue-400',
                                    Icon: Building2
                                };
                            } else if (plan === 'pro') {
                                config = {
                                    bg: 'bg-gradient-to-tr from-amber-500/20 to-orange-500/20',
                                    border: 'border-amber-400/80',
                                    shadow: 'shadow-[0_0_15px_rgba(251,191,36,0.5)]',
                                    text: 'text-amber-400',
                                    glow: 'border-amber-300/50 bg-amber-300/20',
                                    label: '专业版',
                                    badgeBg: 'bg-gradient-to-r from-amber-500/20 to-orange-500/20',
                                    badgeBorder: 'border-amber-500/30',
                                    badgeText: 'text-amber-400',
                                    Icon: Zap
                                };
                            } else if (plan === 'personal') {
                                config = {
                                    bg: 'bg-gradient-to-tr from-purple-500/20 to-fuchsia-500/20',
                                    border: 'border-purple-400/80',
                                    shadow: 'shadow-[0_0_15px_rgba(168,85,247,0.5)]',
                                    text: 'text-purple-400',
                                    glow: 'border-purple-300/50 bg-purple-300/20',
                                    label: '个人版',
                                    badgeBg: 'bg-gradient-to-r from-purple-500/20 to-fuchsia-500/20',
                                    badgeBorder: 'border-purple-500/30',
                                    badgeText: 'text-purple-400',
                                    Icon: UserIcon
                                };
                            }

                        return (
                                <div className="flex items-center gap-2 md:gap-3">
                                    {/* Mobile: compact plan badge */}
                                    <NavLink to={user.role === 'admin' ? '/admin' : '/pricing'} className={`md:hidden text-[10px] font-mono px-2 py-0.5 ${config.badgeBg} ${config.badgeText} border ${config.badgeBorder} rounded flex items-center gap-1 hover:brightness-110 transition-colors shadow-inner whitespace-nowrap`}>
                                        {config.label}
                                        {user.role !== 'admin' && user.plan !== 'free' ? <Crown size={10} className="mb-0.5" /> : <config.Icon size={10} className="mb-0.5" />}
                                    </NavLink>

                                    {/* Desktop: 动态角色高亮头像 */}
                                    <div className={`hidden md:flex relative items-center justify-center w-10 h-10 rounded-full ${config.bg} border-2 ${config.border} ${config.shadow} group hover:scale-110 transition-transform`}>
                                        {config.glow && <div className={`absolute inset-0 rounded-full border ${config.glow} animate-ping opacity-30`}></div>}
                                        {user.role !== 'admin' && user.plan !== 'free' && <Crown size={16} className={`absolute -top-3.5 ${config.text} drop-shadow-[0_0_5px_currentColor] animate-bounce`} />}
                                        {(user.plan === 'free' || user.role === 'admin') && <config.Icon size={16} className={`absolute -top-3.5 ${config.text} drop-shadow-[0_0_5px_currentColor] animate-bounce`} />}
                                        <span className={`${config.text} font-bold text-lg drop-shadow-md`}>
                                            {(user.display_name || user.username || 'U')?.charAt(0).toUpperCase()}
                                        </span>
                                    </div>

                                    <div className="hidden md:flex flex-col items-end mr-4 ml-1">
                                        <span className="text-xs text-gray-400">欢迎您，<span className="text-gray-200 font-semibold">{user.display_name || user.username}</span></span>
                                        <NavLink to={user.role === 'admin' ? '/admin' : '/pricing'} className={`text-[10px] font-mono mt-0.5 px-2 py-0.5 ${config.badgeBg} ${config.badgeText} border ${config.badgeBorder} rounded flex items-center gap-1 hover:brightness-110 transition-colors shadow-inner`}>
                                            {config.label}
                                            {user.role !== 'admin' && user.plan !== 'free' ? <Crown size={10} className="mb-0.5" /> : <config.Icon size={10} className="mb-0.5" />}
                                        </NavLink>

                                        {user.role !== 'admin' && (
                                            <div className="mt-1 flex flex-col items-end gap-1 text-right">
                                                {(() => {
                                                    const embedUsed = user.quota_embed_used ?? user.quota_used ?? 0;
                                                    const embedTotal = user.quota_embed_total ?? user.quota_total ?? 10;
                                                    const detectUsed = user.quota_detect_used;
                                                    const detectTotal = user.quota_detect_total;

                                                    const hasDetect = typeof detectUsed === 'number' || typeof detectTotal === 'number';
                                                    if (!hasDetect) {
                                                        return (
                                                            <div className="flex items-center gap-2">
                                                                <span className="px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-[10px] font-semibold">嵌入</span>
                                                                <span className="text-[12px] font-mono font-bold text-cyan-300">{embedUsed}</span>
                                                                <span className="text-[10px] font-mono text-gray-400">/{embedTotal}</span>
                                                            </div>
                                                        );
                                                    }
                                                    return (
                                                        <>
                                                            <div className="flex items-center gap-2">
                                                                <span className="px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-[10px] font-semibold">嵌入</span>
                                                                <span className="text-[12px] font-mono font-bold text-cyan-300">{embedUsed}</span>
                                                                <span className="text-[10px] font-mono text-gray-400">/{embedTotal}</span>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                <span className="px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[10px] font-semibold">检测</span>
                                                                <span className="text-[12px] font-mono font-bold text-rose-300">{detectUsed ?? 0}</span>
                                                                <span className="text-[10px] font-mono text-gray-400">/{detectTotal ?? 20}</span>
                                                            </div>
                                                        </>
                                                    );
                                                })()}
                                            </div>
                                        )}

                                        {/* 订阅到期倒计时 - 仅付费用户显示 */}
                                        {user.role !== 'admin' && user.plan !== 'free' && user.subscription_expires_at && (
                                            <NavLink
                                                to="/pricing"
                                                className={(() => {
                                                    const days = user.remaining_days ?? Math.max(0, Math.ceil((new Date(user.subscription_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
                                                    const status = String(user.subscription_status || '').toLowerCase();
                                                    if (status === 'expired' || days === 0) return 'text-[10px] text-red-400 mt-1 hover:text-red-300';
                                                    if (days <= 7) return 'text-[10px] text-amber-400 mt-1 hover:text-amber-300';
                                                    return 'text-[10px] text-emerald-400/80 mt-1 hover:text-emerald-300';
                                                })()}
                                                title="点击前往续费/升级"
                                            >
                                                {(() => {
                                                    const days = user.remaining_days ?? Math.max(0, Math.ceil((new Date(user.subscription_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
                                                    const status = String(user.subscription_status || '').toLowerCase();
                                                    if (status === 'expired' || days === 0) return '订阅已到期，点击续费';
                                                    if (days <= 7) return `即将到期（剩余 ${days} 天），点击续费`;
                                                    return `剩余 ${days} 天`;
                                                })()}
                                            </NavLink>
                                        )}
                                    </div>
                                    <button
                                        onClick={handleLogout}
                                        className="p-2 rounded-full text-gray-400 hover:text-white hover:bg-red-500/20 hover:shadow-neon-red transition-all duration-300"
                                        title="退出登录"
                                    >
                                        <LogOut size={18} />
                                    </button>
                                </div>
                            );
                        })()
                    ) : (
                        <div className="flex items-center gap-3">
                            <button onClick={() => navigate('/login')} className="text-sm font-medium text-gray-300 hover:text-white transition-colors">登录</button>
                            <button onClick={() => navigate('/register')} className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-full border border-white/10 transition-all">注册</button>
                        </div>
                    )}

                    {/* Mobile Menu Toggle */}
                    <button
                        className="md:hidden p-2 text-gray-300"
                        onClick={() => setIsOpen(!isOpen)}
                    >
                        {isOpen ? <X size={24} /> : <Menu size={24} />}
                    </button>
                </div>
            </div>

            {/* Mobile Navigation Dropdown */}
            {isOpen && (
                <div className="absolute top-24 left-4 right-4 glass-card p-4 flex flex-col gap-2 md:hidden pointer-events-auto animate-enter origin-top">
                    {/* Mobile user info section */}
                    {user && (
                        <div className="flex items-center gap-3 px-3 py-3 mb-1 rounded-xl bg-white/5 border border-white/10">
                            <div className={`relative flex items-center justify-center w-9 h-9 rounded-full ${(() => {
                                let cfg = { bg: 'bg-gradient-to-tr from-teal-500/20 to-emerald-500/20', border: 'border-teal-400/50', text: 'text-teal-400' };
                                const plan = (user.plan || '').toLowerCase();
                                if (user.role === 'admin') cfg = { bg: 'bg-gradient-to-tr from-red-500/20 to-rose-600/20', border: 'border-red-500/80', text: 'text-red-400' };
                                else if (plan === 'enterprise') cfg = { bg: 'bg-gradient-to-tr from-blue-500/20 to-cyan-500/20', border: 'border-blue-400/80', text: 'text-blue-400' };
                                else if (plan === 'pro') cfg = { bg: 'bg-gradient-to-tr from-amber-500/20 to-orange-500/20', border: 'border-amber-400/80', text: 'text-amber-400' };
                                else if (plan === 'personal') cfg = { bg: 'bg-gradient-to-tr from-purple-500/20 to-fuchsia-500/20', border: 'border-purple-400/80', text: 'text-purple-400' };
                                return `${cfg.bg} border-2 ${cfg.border}`;
                            })()}`}>
                                <span className="font-bold text-sm text-white">
                                    {(user.display_name || user.username || 'U')?.charAt(0).toUpperCase()}
                                </span>
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm text-white font-medium truncate">{user.display_name || user.username}</div>
                                <div className="text-[11px] text-gray-400 flex items-center gap-2 mt-0.5">
                                    {user.role !== 'admin' && (() => {
                                        const embedUsed = user.quota_embed_used ?? user.quota_used ?? 0;
                                        const embedTotal = user.quota_embed_total ?? user.quota_total ?? 10;
                                        return <span className="font-mono">额度 {embedUsed}/{embedTotal}</span>;
                                    })()}
                                </div>
                            </div>
                        </div>
                    )}
                    {navItems.map((item) => (
                        <NavLink
                            key={item.path}
                            to={item.path}
                            onClick={() => setIsOpen(false)}
                            className={({ isActive }) =>
                                `p-3 rounded-xl flex items-center gap-3 transition-all
                                ${isActive
                                    ? 'bg-white/10 text-white'
                                    : 'text-gray-400 hover:bg-white/5 hover:text-white'
                                }`
                            }
                        >
                            {item.icon}
                            <span className="font-medium">{item.name}</span>
                        </NavLink>
                    ))}
                    {/* Mobile: pricing & logout links */}
                    {user && (
                        <div className="flex items-center gap-2 mt-1 pt-2 border-t border-white/10">
                            <NavLink
                                to={user.role === 'admin' ? '/admin' : '/pricing'}
                                onClick={() => setIsOpen(false)}
                                className="flex-1 p-2.5 rounded-xl text-center text-sm text-gray-300 hover:bg-white/5 transition-all"
                            >
                                {user.role === 'admin' ? '管理面板' : '升级套餐'}
                            </NavLink>
                            <button
                                onClick={() => { setIsOpen(false); handleLogout(); }}
                                className="flex-1 p-2.5 rounded-xl text-center text-sm text-red-400 hover:bg-red-500/10 transition-all"
                            >
                                退出登录
                            </button>
                        </div>
                    )}
                </div>
            )}
        </nav>
    );
};

export default Navbar;
