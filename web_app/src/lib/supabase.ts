import { createClient } from '@supabase/supabase-js';

// 此处配置后续真实Supabase环境变量
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://your-project-id.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'your-anon-key';

export const supabase = createClient(supabaseUrl, supabaseKey);

// 监听 Supabase auth 状态变化，自动同步 access_token 到 localStorage
// 解决 token 过期后自动刷新但 localStorage 未更新导致 raw fetch 401 的问题
supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.access_token) {
        localStorage.setItem('access_token', session.access_token);
    }
});

/**
 * 获取当前有效的 access_token（优先从 Supabase session 获取最新 token）
 * 用于 raw fetch 调用，避免使用 localStorage 中可能过期的旧 token
 */
export async function getValidToken(): Promise<string | null> {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
            localStorage.setItem('access_token', session.access_token);
            return session.access_token;
        }
    } catch {
        // fallback
    }
    return localStorage.getItem('access_token');
}
