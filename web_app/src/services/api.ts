import axios from 'axios';
import { supabase } from '../lib/supabase';
import type { User, WatermarkResult, DetectionResult, Asset } from '../types';

// 从环境变量读取 API URL，支持开发和生产环境切换
const API_URL = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
    baseURL: API_URL,
});

// 全局响应拦截器：处理402额度不足错误，自动弹窗引导充值
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 402) {
            const message = error.response?.data?.detail || '您的使用额度已用完或订阅已过期';
            // 使用自定义事件通知前端显示充值弹窗
            window.dispatchEvent(new CustomEvent('show-recharge-modal', { 
                detail: { message, type: 'quota_exceeded' } 
            }));
            // 同时显示alert确保用户看到
            if (confirm(`${message}\n\n是否立即跳转到充值页面？`)) {
                window.location.href = '/pricing';
            }
        }
        return Promise.reject(error);
    }
);

api.interceptors.request.use(async (config) => {
    let token = localStorage.getItem('access_token');
    if (!token) {
        // 如果用户主动退出，不从 Supabase session 自动恢复 token
        const loggedOut = sessionStorage.getItem('user_logged_out');
        if (!loggedOut) {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                token = session?.access_token || null;
                if (token) {
                    localStorage.setItem('access_token', token);
                }
            } catch (e) {
                // ignore
            }
        }
    }
    if (token) {
        if (!config.headers) {
            config.headers = {} as any;
        }
        (config.headers as any).Authorization = `Bearer ${token}`;
    }

    const url = config.url || '';
    if (url.startsWith('/admin/')) {
        const adminSecret = sessionStorage.getItem('admin_api_secret');
        if (adminSecret) {
            if (!config.headers) {
                config.headers = {} as any;
            }
            (config.headers as any)['X-Admin-Secret'] = adminSecret;
        }
    }
    return config;
});

export const auth = {
    login: async (formData: FormData) => {
        const usernameInput = formData.get('username') as string;
        const password = formData.get('password') as string;

        // Handle dedicated admin account mapping for Supabase migration
        const email = usernameInput === 'admin' ? 'admin@aigc.com' : usernameInput;

        try {
            const { data, error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) throw error;
            if (data.session) {
                localStorage.setItem('access_token', data.session.access_token);
            }
            return data.session;
        } catch (err: any) {
            // Auto-try registration if it's the admin account and login fails (likely because it was cleared)
            if (email === 'admin@aigc.com') {
                try {
                    const regData = await auth.register({ username: email, password, display_name: '系统管理员' });
                    return regData.session;
                } catch (regErr) {
                    throw err; // throw original error if registration also fails
                }
            }
            throw err;
        }
    },
    register: async (payload: any) => {
        const { username, password, display_name } = payload;
        const { data, error } = await supabase.auth.signUp({
            email: username,
            password,
            options: {
                emailRedirectTo: `${window.location.origin}/auth/callback`,
                data: {
                    display_name: display_name || username.split('@')[0]
                }
            }
        });
        if (error) throw error;

        // Auto-login if session is provided (email verification disabled)
        if (data.session) {
            localStorage.setItem('access_token', data.session.access_token);
        }

        return data;
    },
    me: async () => {
        // Prefer backend /users/me for authoritative subscription status + remaining_days.
        // Backend dependency will auto-expire & downgrade if needed.
        try {
            const res = await api.get<User>('/users/me');
            return res.data;
        } catch (e) {
            // fallback to Supabase directly (useful when backend is down during dev)
        }

        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user?.id) {
                const { data, error } = await supabase
                    .from('profiles')
                    .select('id, username, role, display_name, plan, quota_used, quota_total, quota_embed_used, quota_embed_total, quota_detect_used, quota_detect_total, subscription_status, subscription_period, subscription_started_at, subscription_expires_at')
                    .eq('id', session.user.id)
                    .single();
                if (error) throw error;
                return data as User;
            }
        } catch (e) {
            // ignore
        }

        throw new Error('Not authenticated');
    },
    logout: async () => {
        await supabase.auth.signOut();
        localStorage.removeItem('access_token');
    }
};

export const admin = {
    overview: async () => {
        const res = await api.get('/admin/overview');
        return res.data;
    },
    summary: async (params?: { limit_users?: number; limit_assets?: number }) => {
        const res = await api.get('/admin/summary', { params });
        return res.data;
    },
    listAssets: async (params?: { limit?: number; offset?: number }) => {
        const res = await api.get('/admin/assets', { params });
        return res.data;
    },
    updateUserPlan: async (userId: string, plan: string, subscriptionPeriod?: string) => {
        const formData = new FormData();
        formData.append('user_id', userId);
        formData.append('plan', plan);
        if (subscriptionPeriod) {
            formData.append('subscription_period', subscriptionPeriod);
        }
        const res = await api.post('/admin/update-user-plan', formData);
        return res.data;
    },
    getUserDetail: async (userId: string) => {
        const res = await api.get(`/admin/users/${userId}`);
        return res.data;
    },
    getUserAssets: async (userId: string, params?: { limit?: number; offset?: number; asset_type?: string }) => {
        const res = await api.get(`/admin/users/${userId}/assets`, { params });
        return res.data;
    },
    getUserDetections: async (userId: string, params?: { limit?: number; offset?: number; has_watermark?: boolean }) => {
        const res = await api.get(`/admin/users/${userId}/detection-records`, { params });
        return res.data;
    },
    getUserTimeline: async (userId: string, params?: { limit?: number; offset?: number }) => {
        const res = await api.get(`/admin/users/${userId}/timeline`, { params });
        return res.data;
    },
};

export const watermark = {
    embed: async (formData: FormData, config?: any) => {
        const res = await api.post<WatermarkResult>('/embed', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            ...(config || {})
        });
        return res.data;
    },
    detect: async (formData: FormData) => {
        const res = await api.post<DetectionResult>('/detect', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
        return res.data;
    },
    getAssets: async () => {
        const res = await api.get<Asset[]>('/assets');
        return res.data;
    },
    getActivity: async () => {
        const res = await api.get<any[]>('/activity');
        return res.data;
    },
    list: async (limit: number = 10) => {
        const res = await api.get<Asset[]>('/assets', { params: { limit } });
        return res.data;
    },
    anchorAsset: async (asset_id: number) => {
        const res = await api.post(`/anchor/${asset_id}`);
        return res.data;
    },
    embedText: async (data: { text: string; author_name: string }) => {
        const res = await api.post('/embed/text', data);
        return res.data;
    },
    embedVideo: async (formData: FormData, config?: any) => {
        const res = await api.post('/embed/video', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            ...(config || {})
        });
        return res.data;
    },
    detectText: async (data: { text: string }) => {
        const res = await api.post('/detect/text', data);
        return res.data;
    },
    detectVideo: async (formData: FormData) => {
        const res = await api.post('/detect/video', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
        return res.data;
    },
    // 异步任务API
    submitAsyncTask: async (payload: { task_type: string; file: File }) => {
        const formData = new FormData();
        formData.append('file', payload.file);
        formData.append('task_type', payload.task_type);
        const res = await api.post('/detect/async', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
        return res.data;
    },
    getTaskStatus: async (taskId: string) => {
        const res = await api.get(`/tasks/${taskId}/status`);
        return res.data;
    },
    getMyTasks: async (limit: number = 20) => {
        const res = await api.get('/tasks/my', { params: { limit } });
        return res.data;
    },
    cancelTask: async (taskId: string) => {
        const res = await api.post(`/tasks/${taskId}/cancel`);
        return res.data;
    },
    getMyDetectionRecords: async (limit: number = 50) => {
        const res = await api.get('/detection/my-records', { params: { limit } });
        return res.data;
    }
};

export const stats = {
    get: async () => {
        const res = await api.get<{
            total_assets: number;
            active_monitors: number;
            total_infringements: number;
            total_authors: number;
        }>('/stats');
        return res.data;
    }
};

export default api;
