
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../services/api';
import { Shield, UserPlus, User, Lock } from 'lucide-react';

const Register: React.FC = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [fullName, setFullName] = useState(() => {
        try {
            return localStorage.getItem('register_display_name') || '';
        } catch (e) {
            return '';
        }
    });
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [needsEmailConfirmation, setNeedsEmailConfirmation] = useState(false);
    const [resending, setResending] = useState(false);
    const [resendMessage, setResendMessage] = useState('');
    const [registeredWithSession, setRegisteredWithSession] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    // Note: Use /api/register or /api/users/register based on backend
    // backend endpoints/users.py: @router.post("/register") -> mounted at /api/users ?
    // Check main.py. app.include_router(users.router, prefix=settings.API_V1_STR, tags=["users"])
    // API_V1_STR is /api. Users router has /register. So /api/register.
    // Wait, users.py assumes /register relative to router. 
    // If router prefix is /api, then it is /api/register.

    const navigate = useNavigate();

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess('');
        setNeedsEmailConfirmation(false);
        setResendMessage('');
        setRegisteredWithSession(false);
        setIsLoading(true);
        try {
            const res = await auth.register({
                username,
                password,
                display_name: fullName || undefined
            });

            try {
                if (fullName) {
                    localStorage.setItem('register_display_name', fullName);
                }
            } catch (e) {
                // ignore
            }

            if (res.session) {
                setRegisteredWithSession(true);
                setSuccess('注册成功！正在进入平台...');
            } else {
                setNeedsEmailConfirmation(true);
                setSuccess('注册成功！请前往邮箱完成验证后再登录（如未收到，请检查垃圾箱/广告邮件）。');
            }
        } catch (err: any) {
            setError(err.message || '注册失败，请检查填写内容或稍后再试');
        } finally {
            setIsLoading(false);
        }
    };

    const handleResendConfirmation = async () => {
        if (!username) {
            setResendMessage('请先填写注册邮箱');
            return;
        }
        setResending(true);
        setResendMessage('');
        try {
            const { supabase } = await import('../lib/supabase');
            const { error } = await supabase.auth.resend({
                type: 'signup',
                email: username,
                options: {
                    emailRedirectTo: `${window.location.origin}/auth/callback`,
                },
            } as any);
            if (error) throw error;
            setResendMessage('已重新发送验证邮件，请前往邮箱完成认证（如未收到请查看垃圾箱/广告邮件）。');
        } catch (e: any) {
            setResendMessage(e?.message || '重发失败，请稍后再试');
        } finally {
            setResending(false);
        }
    };

    return (
        <div className="w-full flex items-center justify-center pt-20 pb-12 text-white min-h-[75vh]">
            <div className="w-full max-w-lg p-10 glass-card rounded-2xl border border-white/10 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-500 to-pink-500"></div>

                <div className="text-center mb-10">
                    <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-purple-500/10 mb-5 animate-pulse-slow">
                        <UserPlus className="w-10 h-10 text-purple-400" />
                    </div>
                    <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-400">
                        创建账户
                    </h2>
                    <p className="text-gray-400 text-base mt-3">加入 AIGC 内容保护网络</p>
                </div>

                {error && (
                    <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg text-center animate-enter">
                        {error}
                    </div>
                )}
                {success && (
                    <div className="mb-4 p-3 bg-green-500/10 border border-green-500/20 text-green-400 text-sm rounded-lg text-center animate-enter">
                        {success}
                    </div>
                )}

                {needsEmailConfirmation && (
                    <div className="mb-4 p-3 bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-sm rounded-lg text-center animate-enter">
                        邮箱验证通过后，你就可以使用刚才的邮箱和密码登录。
                        <div className="mt-3 flex justify-center gap-2 flex-wrap">
                            <button
                                type="button"
                                onClick={() => navigate('/login')}
                                className="px-4 py-2 rounded-lg bg-black/40 border border-white/10 text-cyan-200 hover:bg-black/30 text-sm"
                            >
                                去登录
                            </button>
                            <button
                                type="button"
                                onClick={handleResendConfirmation}
                                disabled={resending}
                                className="px-4 py-2 rounded-lg bg-black/40 border border-white/10 text-cyan-200 hover:bg-black/30 disabled:opacity-50 text-sm"
                            >
                                {resending ? '正在重发...' : '重发验证邮件'}
                            </button>
                        </div>
                        {resendMessage && (
                            <div className="mt-3 text-xs text-gray-200/80">
                                {resendMessage}
                            </div>
                        )}
                    </div>
                )}

                {registeredWithSession && (
                    <div className="mb-4 p-3 bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-sm rounded-lg text-center animate-enter">
                        <div className="mt-1 flex justify-center gap-2 flex-wrap">
                            <button
                                type="button"
                                onClick={() => navigate('/dashboard')}
                                className="px-4 py-2 rounded-lg bg-black/40 border border-white/10 text-cyan-200 hover:bg-black/30 text-sm"
                            >
                                进入平台
                            </button>
                        </div>
                    </div>
                )}

                <form onSubmit={handleRegister} className="space-y-5">
                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-2">注册邮箱</label>
                        <div className="relative">
                            <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-5 h-5" />
                            <input
                                type="email"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="w-full bg-black/20 border border-white/10 rounded-xl py-3 pl-10 px-4 text-white focus:outline-none focus:border-purple-500/50 transition-colors"

                                required
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-2">密码</label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-5 h-5" />
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-black/20 border border-white/10 rounded-xl py-3 pl-10 px-4 text-white focus:outline-none focus:border-purple-500/50 transition-colors"
                                required
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-2">显示名称 (可选)</label>
                        <div className="relative">
                            <Shield className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-5 h-5" />
                            <input
                                type="text"
                                value={fullName}
                                onChange={(e) => {
                                    const v = e.target.value;
                                    setFullName(v);
                                    try {
                                        localStorage.setItem('register_display_name', v);
                                    } catch (err) {
                                        // ignore
                                    }
                                }}
                                className="w-full bg-black/20 border border-white/10 rounded-xl py-3 pl-10 px-4 text-white focus:outline-none focus:border-purple-500/50 transition-colors"
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold py-4 px-6 rounded-xl transition-all shadow-lg shadow-purple-500/20 mt-4 disabled:opacity-50 flex justify-center items-center gap-2 text-lg"
                    >
                        {isLoading ? (
                            <>
                                <span className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></span>
                                正在创建账户...
                            </>
                        ) : (
                            '注册并进入平台'
                        )}
                    </button>
                </form>

                <div className="mt-6 text-center text-sm text-gray-500">
                    已有账户? <a href="/login" className="text-purple-400 hover:underline">去登录</a>
                </div>
            </div>
        </div>
    );
};

export default Register;
