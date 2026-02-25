import React from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const AuthCallback: React.FC = () => {
    const navigate = useNavigate();
    const [message, setMessage] = React.useState('正在完成邮箱验证...');

    React.useEffect(() => {
        let cancelled = false;

        const run = async () => {
            try {
                const url = new URL(window.location.href);
                const code = url.searchParams.get('code');

                if (code) {
                    const { error } = await supabase.auth.exchangeCodeForSession(code);
                    if (error) throw error;
                } else {
                    const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
                    const hashParams = new URLSearchParams(hash);
                    const access_token = hashParams.get('access_token');
                    const refresh_token = hashParams.get('refresh_token');

                    if (access_token && refresh_token) {
                        const { error } = await supabase.auth.setSession({ access_token, refresh_token });
                        if (error) throw error;
                    }
                }

                if (cancelled) return;
                setMessage('验证成功，正在跳转...');
                navigate('/login', { replace: true });
            } catch (e: any) {
                if (cancelled) return;
                setMessage(e?.message || '验证失败，请返回登录页重试');
                setTimeout(() => {
                    if (!cancelled) navigate('/login', { replace: true });
                }, 1500);
            }
        };

        run();

        return () => {
            cancelled = true;
        };
    }, [navigate]);

    return (
        <div className="w-full flex items-center justify-center pt-20 pb-12 text-white min-h-[75vh]">
            <div className="w-full max-w-lg p-10 glass-card rounded-2xl border border-white/10 relative overflow-hidden text-center">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-cyan-500 to-purple-500"></div>
                <div className="text-lg text-gray-200">{message}</div>
            </div>
        </div>
    );
};

export default AuthCallback;
