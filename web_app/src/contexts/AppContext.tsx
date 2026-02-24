import React, { createContext, useContext, useState, useEffect } from 'react';

interface AppState {
    // Fingerprint (Page 2) - Results
    embeddingResult: any;
    batchFiles: any[];
    textResult: any;
    videoResult: any;

    // Fingerprint (Page 2) - Workflow config (persisted for page-switching)
    fingerprintMode: 'single' | 'batch' | 'text' | 'video';
    fingerprintStrength: number;
    fingerprintAuthor: string;
    fingerprintTextInput: string;

    // Monitor (Page 3)
    monitorResult: any;
    monitorBatchFiles: any[];
    monitorTextResult: any;
    monitorVideoResult: any;

    toasts: { id: string; message: string; type?: 'success' | 'info' | 'error' }[];
    
    // 升级成功提示
    upgradeSuccess: { show: boolean; plan?: string; period?: string };
}

interface AppContextType {
    state: AppState;
    setEmbeddingResult: (res: any) => void;
    setBatchFiles: (files: any[] | ((prev: any[]) => any[])) => void;
    setTextResult: (res: any) => void;
    setVideoResult: (res: any) => void;

    setMonitorResult: (res: any) => void;
    setMonitorBatchFiles: (files: any[] | ((prev: any[]) => any[])) => void;
    setMonitorTextResult: (res: any) => void;
    setMonitorVideoResult: (res: any) => void;

    setFingerprintMode: (mode: 'single' | 'batch' | 'text' | 'video') => void;
    setFingerprintStrength: (strength: number) => void;
    setFingerprintAuthor: (author: string) => void;
    setFingerprintTextInput: (text: string) => void;

    pushToast: (message: string, type?: 'success' | 'info' | 'error', timeoutMs?: number) => void;

    clearState: () => void;
    
    // 升级成功提示
    showUpgradeSuccess: (plan: string, period?: string) => void;
    hideUpgradeSuccess: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // 获取当前用户标识用于隔离缓存
    const getUserCacheKey = () => {
        const token = localStorage.getItem('access_token') || '';
        const userId = token?.slice(-16) || 'anonymous';
        return `app_state_${userId}`;
    };

    const [state, setState] = useState<AppState>(() => {
        const saved = sessionStorage.getItem(getUserCacheKey());
        if (saved) {
            const parsed = JSON.parse(saved);
            return {
                ...parsed,
                toasts: [],
                upgradeSuccess: { show: false },
            };
        }
        return {
            // Results (cleared on mount)
            embeddingResult: null,
            batchFiles: [],
            textResult: null,
            videoResult: null,
            // Workflow config (persisted)
            fingerprintMode: 'single' as 'single' | 'batch' | 'text' | 'video',
            fingerprintStrength: 0.1,
            fingerprintAuthor: '',
            fingerprintTextInput: '',
            // Monitor
            monitorResult: null,
            monitorBatchFiles: [],
            monitorTextResult: null,
            monitorVideoResult: null,
            toasts: [],
            upgradeSuccess: { show: false },
        };
    });

    useEffect(() => {
        const { toasts, ...rest } = state;
        sessionStorage.setItem(getUserCacheKey(), JSON.stringify({ ...rest, toasts: [] }));
    }, [state]);

    // Setters
    const setEmbeddingResult = (res: any) => setState(prev => ({ ...prev, embeddingResult: res }));
    const setBatchFiles = (files: any[] | ((prev: any[]) => any[])) => setState(prev => ({ ...prev, batchFiles: typeof files === 'function' ? files(prev.batchFiles) : files }));
    const setTextResult = (res: any) => setState(prev => ({ ...prev, textResult: res }));
    const setVideoResult = (res: any) => setState(prev => ({ ...prev, videoResult: res }));

    const setFingerprintMode = (mode: 'single' | 'batch' | 'text' | 'video') => setState(prev => ({ ...prev, fingerprintMode: mode }));
    const setFingerprintStrength = (strength: number) => setState(prev => ({ ...prev, fingerprintStrength: strength }));
    const setFingerprintAuthor = (author: string) => setState(prev => ({ ...prev, fingerprintAuthor: author }));
    const setFingerprintTextInput = (text: string) => setState(prev => ({ ...prev, fingerprintTextInput: text }));

    const setMonitorResult = (res: any) => setState(prev => ({ ...prev, monitorResult: res }));
    const setMonitorBatchFiles = (files: any[] | ((prev: any[]) => any[])) => setState(prev => ({ ...prev, monitorBatchFiles: typeof files === 'function' ? files(prev.monitorBatchFiles) : files }));
    const setMonitorTextResult = (res: any) => setState(prev => ({ ...prev, monitorTextResult: res }));
    const setMonitorVideoResult = (res: any) => setState(prev => ({ ...prev, monitorVideoResult: res }));

    const pushToast = (message: string, type: 'success' | 'info' | 'error' = 'info', timeoutMs: number = 3000) => {
        const id = Math.random().toString(36).slice(2);
        setState(prev => ({ ...prev, toasts: [...(prev.toasts || []), { id, message, type }] }));
        window.setTimeout(() => {
            setState(prev => ({ ...prev, toasts: (prev.toasts || []).filter(t => t.id !== id) }));
        }, timeoutMs);
    };

    // 升级成功提示
    const showUpgradeSuccess = React.useCallback((plan: string, period?: string) => {
        setState(prev => ({ ...prev, upgradeSuccess: { show: true, plan, period } }));
    }, []);

    const hideUpgradeSuccess = React.useCallback(() => {
        setState(prev => ({ ...prev, upgradeSuccess: { show: false } }));
    }, []);

    const clearState = () => {
        const newState = {
            // Results
            embeddingResult: null,
            batchFiles: [],
            textResult: null,
            videoResult: null,
            // Workflow config (keep these for convenience)
            fingerprintMode: 'single' as 'single' | 'batch' | 'text' | 'video',
            fingerprintStrength: 0.1,
            fingerprintAuthor: '',
            fingerprintTextInput: '',
            // Monitor
            monitorResult: null,
            monitorBatchFiles: [],
            monitorTextResult: null,
            monitorVideoResult: null,
            toasts: [],
            upgradeSuccess: { show: false },
        };
        setState(newState);
        // 同时清理当前用户的 sessionStorage
        const token = localStorage.getItem('access_token') || '';
        const userId = token?.slice(-16) || 'anonymous';
        sessionStorage.removeItem(`app_state_${userId}`);
    };

    return (
        <AppContext.Provider value={{
            state,
            setEmbeddingResult, setBatchFiles, setTextResult, setVideoResult,
            setFingerprintMode, setFingerprintStrength, setFingerprintAuthor, setFingerprintTextInput,
            setMonitorResult, setMonitorBatchFiles, setMonitorTextResult, setMonitorVideoResult,
            pushToast,
            clearState,
            showUpgradeSuccess,
            hideUpgradeSuccess,
        }}>
            {children}
        </AppContext.Provider>
    );
};

export const useApp = () => {
    const context = useContext(AppContext);
    if (!context) {
        throw new Error('useApp must be used within an AppProvider');
    }
    return context;
};
