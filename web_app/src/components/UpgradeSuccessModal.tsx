import React, { useEffect } from 'react';
import { Check, Crown, Zap, Shield, Building2, X } from 'lucide-react';
import { useApp } from '../contexts/AppContext';

const planConfig: Record<string, { name: string; color: string; icon: React.ElementType; gradient: string }> = {
    free: { name: '免费版', color: 'text-teal-400', icon: Shield, gradient: 'from-teal-500/20 to-emerald-500/20' },
    personal: { name: '个人版', color: 'text-purple-400', icon: Zap, gradient: 'from-purple-500/20 to-pink-500/20' },
    pro: { name: '专业版', color: 'text-amber-400', icon: Crown, gradient: 'from-amber-500/20 to-orange-500/20' },
    enterprise: { name: '企业版', color: 'text-blue-400', icon: Building2, gradient: 'from-blue-500/20 to-cyan-500/20' },
};

export const UpgradeSuccessModal: React.FC = () => {
    const { state, hideUpgradeSuccess } = useApp();
    const { upgradeSuccess } = state;

    useEffect(() => {
        if (upgradeSuccess.show) {
            const timer = setTimeout(() => {
                hideUpgradeSuccess();
            }, 5000);
            return () => clearTimeout(timer);
        }
    }, [upgradeSuccess.show, hideUpgradeSuccess]);

    if (!upgradeSuccess.show || !upgradeSuccess.plan) return null;

    const config = planConfig[upgradeSuccess.plan] || planConfig.free;
    const Icon = config.icon;

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-enter">
            <div className="relative w-full max-w-md glass-card border border-white/20 overflow-hidden">
                {/* 背景动画 */}
                <div className={`absolute inset-0 bg-gradient-to-br ${config.gradient} opacity-30`} />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.1),transparent_70%)]" />
                
                {/* 关闭按钮 */}
                <button
                    onClick={hideUpgradeSuccess}
                    className="absolute top-4 right-4 p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-all z-10"
                >
                    <X size={20} />
                </button>

                <div className="relative p-8 text-center">
                    {/* 成功图标 */}
                    <div className="mb-6 flex justify-center">
                        <div className={`w-20 h-20 rounded-full bg-gradient-to-br ${config.gradient} flex items-center justify-center border-2 border-white/20 shadow-2xl`}>
                            <div className="relative">
                                <Icon size={40} className={config.color} />
                                <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center border-2 border-slate-900">
                                    <Check size={14} className="text-white" strokeWidth={3} />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 标题 */}
                    <h2 className="text-2xl font-bold text-white mb-2">
                        升级成功！
                    </h2>
                    
                    {/* 套餐信息 */}
                    <div className="mb-6">
                        <p className="text-gray-400 text-sm mb-3">您已成功升级至</p>
                        <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 ${config.color} font-bold text-lg`}>
                            <Icon size={20} />
                            {config.name}
                            {upgradeSuccess.period && (
                                <span className="text-sm font-normal text-gray-400">
                                    ({upgradeSuccess.period === 'month' ? '月付' : '年付'})
                                </span>
                            )}
                        </div>
                    </div>

                    {/* 权益展示 */}
                    <div className="space-y-2 mb-6 text-left">
                        <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/5">
                            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                                <Check size={16} className="text-emerald-400" />
                            </div>
                            <div>
                                <p className="text-white text-sm font-medium">额度已提升</p>
                                <p className="text-gray-400 text-xs">嵌入/检测额度已按新套餐更新</p>
                            </div>
                        </div>
                        
                        <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/5">
                            <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
                                <Check size={16} className="text-blue-400" />
                            </div>
                            <div>
                                <p className="text-white text-sm font-medium">高级功能已解锁</p>
                                <p className="text-gray-400 text-xs">享受更多专业版权保护功能</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3 p-3 bg-white/5 rounded-lg border border-white/5">
                            <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center">
                                <Check size={16} className="text-purple-400" />
                            </div>
                            <div>
                                <p className="text-white text-sm font-medium">历史记录保留</p>
                                <p className="text-gray-400 text-xs">原有使用记录和资产完整保留</p>
                            </div>
                        </div>
                    </div>

                    {/* 按钮 */}
                    <button
                        onClick={hideUpgradeSuccess}
                        className={`w-full py-3 px-6 rounded-xl font-bold text-white bg-gradient-to-r ${config.gradient} border border-white/20 hover:border-white/40 transition-all hover:scale-[1.02] active:scale-[0.98]`}
                    >
                        开始使用新权益
                    </button>

                    <p className="mt-4 text-xs text-gray-500">
                        如有任何问题，请联系客服支持
                    </p>
                </div>
            </div>
        </div>
    );
};

export default UpgradeSuccessModal;
