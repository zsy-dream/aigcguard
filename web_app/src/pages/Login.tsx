
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../services/api';
import { Shield, Lock, User } from 'lucide-react';

const Login: React.FC = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [needsEmailConfirmation, setNeedsEmailConfirmation] = useState(false);
    const [resending, setResending] = useState(false);
    const [resendMessage, setResendMessage] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const navigate = useNavigate();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError('');
        setNeedsEmailConfirmation(false);
        setResendMessage('');
        try {
            const formData = new FormData();
            formData.append('username', username);
            formData.append('password', password);
            await auth.login(formData);
            // 清除退出标记，允许后续请求正常携带 token
            sessionStorage.removeItem('user_logged_out');
            // 设置登录标记，用于 Layout 显示欢迎 Toast
            sessionStorage.setItem('just_logged_in', '1');
            const user = await auth.me();
            if (user.role === 'admin' || user.role === '行政') {
                navigate('/admin');
            } else {
                navigate('/evidence');
            }
        } catch (err: any) {
            console.error('Login error:', err);
            const msg = err?.message || 'Login failed';
            setError(msg);
            if (typeof msg === 'string' && msg.toLowerCase().includes('email not confirmed')) {
                setNeedsEmailConfirmation(true);
            }
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
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-500 to-purple-500"></div>

                <div className="text-center mb-10">
                    <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-cyan-500/10 mb-5 animate-pulse-slow">
                        <Shield className="w-10 h-10 text-cyan-400" />
                    </div>
                    <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-purple-400">
                        AIGC Guard 登录
                    </h2>
                    <p className="text-gray-400 text-base mt-3">数字内容指纹嵌入与监测平台</p>
                </div>

                {error && (
                    <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg text-center">
                        {error}
                    </div>
                )}

                {needsEmailConfirmation && (
                    <div className="mb-4 p-3 bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-sm rounded-lg text-center">
                        你的邮箱尚未完成验证，请先前往邮箱点击验证链接，然后再登录。
                        <div className="mt-3 flex justify-center">
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

                <form onSubmit={handleLogin} className="space-y-5">
                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-2">登录邮箱</label>
                        <div className="relative">
                            <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-5 h-5" />
                            <input
                                type="email"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="w-full bg-black/20 border border-white/10 rounded-xl py-3 pl-10 px-4 text-white focus:outline-none focus:border-cyan-500/50 transition-colors text-base"
                                placeholder="请输入邮箱"
                                required
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-2">登录密码</label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-5 h-5" />
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-black/20 border border-white/10 rounded-xl py-3 pl-10 px-4 text-white focus:outline-none focus:border-cyan-500/50 transition-colors text-base"
                                placeholder="请输入密码"
                                required
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
                                登录中...
                            </>
                        ) : (
                            '立即登录'
                        )}
                    </button>
                </form>



                <div className="mt-6 text-center text-sm text-gray-500">
                    还未注册? <a href="/register" className="text-cyan-400 hover:underline">创建账户</a>
                </div>
            </div>
        </div>
    );
};

export default Login;
