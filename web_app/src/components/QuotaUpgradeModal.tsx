import React from 'react';
import { X, Crown, ArrowRight, AlertTriangle, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface QuotaUpgradeModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentQuota: number;
    totalQuota: number;
    isExhausted: boolean;
}

export const QuotaUpgradeModal: React.FC<QuotaUpgradeModalProps> = ({
    isOpen,
    onClose,
    currentQuota,
    totalQuota,
    isExhausted
}) => {
    const navigate = useNavigate();
    const usagePercent = totalQuota > 0 ? ((totalQuota - currentQuota) / totalQuota * 100) : 0;

    if (!isOpen) return null;

    const handleUpgrade = () => {
        onClose();
        navigate('/pricing');
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-enter">
            <div className="glass-card w-full max-w-md border border-amber-500/30 overflow-hidden">
                {/* Header */}
                <div className="p-6 border-b border-white/10 bg-gradient-to-r from-amber-500/10 to-orange-500/10">
                    <div className="flex justify-between items-start">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-amber-500/20 rounded-lg">
                                {isExhausted ? (
                                    <AlertTriangle className="text-amber-400" size={24} />
                                ) : (
                                    <Zap className="text-amber-400" size={24} />
                                )}
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white">
                                    {isExhausted ? '额度已用完' : '额度即将耗尽'}
                                </h3>
                                <p className="text-sm text-gray-400">
                                    {isExhausted 
                                        ? '您的免费额度已经用完，升级套餐继续使用' 
                                        : `剩余额度: ${currentQuota} / ${totalQuota}`
                                    }
                                </p>
                            </div>
                        </div>
                        <button 
                            onClick={onClose}
                            className="p-2 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 space-y-4">
                    {/* Progress Bar */}
                    <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-400">已使用额度</span>
                            <span className="text-amber-400 font-bold">{usagePercent.toFixed(0)}%</span>
                        </div>
                        <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                            <div 
                                className={`h-full rounded-full transition-all ${
                                    isExhausted ? 'bg-red-500' : 'bg-amber-500'
                                }`}
                                style={{ width: `${Math.min(usagePercent, 100)}%` }}
                            />
                        </div>
                    </div>

                    {/* Plan Options */}
                    <div className="grid grid-cols-3 gap-3">
                        <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20 text-center">
                            <div className="text-lg font-bold text-purple-400">个人版</div>
                            <div className="text-xs text-gray-400">500 次/月</div>
                            <div className="text-sm text-white mt-1">¥19</div>
                        </div>
                        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-center relative">
                            <div className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-amber-500 text-white text-[10px] rounded-full">
                                推荐
                            </div>
                            <div className="text-lg font-bold text-amber-400">专业版</div>
                            <div className="text-xs text-gray-400">2000 次/月</div>
                            <div className="text-sm text-white mt-1">¥99</div>
                        </div>
                        <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-center">
                            <div className="text-lg font-bold text-blue-400">企业版</div>
                            <div className="text-xs text-gray-400">无限次</div>
                            <div className="text-sm text-white mt-1">¥299</div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-white/10 flex gap-3">
                    <button 
                        onClick={onClose}
                        className="flex-1 py-3 rounded-xl border border-white/10 hover:bg-white/5 text-gray-300 transition-all"
                    >
                        稍后再说
                    </button>
                    <button 
                        onClick={handleUpgrade}
                        className="flex-1 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-amber-500/20"
                    >
                        <Crown size={18} />
                        立即升级
                        <ArrowRight size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default QuotaUpgradeModal;
