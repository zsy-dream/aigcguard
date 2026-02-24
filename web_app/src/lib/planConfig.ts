export type PlanKey = 'free' | 'personal' | 'pro' | 'enterprise';

export const getPlanKey = (plan: any): PlanKey => {
    const raw = (plan ?? '').toString().trim();
    const lower = raw.toLowerCase();
    const map: Record<string, PlanKey> = {
        'free': 'free',
        'personal': 'personal',
        'pro': 'pro',
        'professional': 'pro',
        'enterprise': 'enterprise',
        '个人版': 'personal',
        '个人': 'personal',
        '专业版': 'pro',
        '专业': 'pro',
        '企业版': 'enterprise',
        '企业': 'enterprise',
        '基础版': 'free',
        '基础': 'free',
        '免费版': 'free',
        '免费': 'free',
    };

    const direct = map[raw] || map[lower];
    if (direct) return direct;

    if (lower.includes('enterprise') || raw.includes('企业')) return 'enterprise';
    if (lower.includes('pro') || lower.includes('professional') || raw.includes('专业')) return 'pro';
    if (lower.includes('personal') || raw.includes('个人')) return 'personal';
    return 'free';
};

export const PLAN_CONFIG: Record<PlanKey, {
    localDetectionHistoryLimit: number;
    cloudDetectionSyncLimit: number;
    features: {
        report_markdown: boolean;
        export_pdf: boolean;
        report_ai: boolean;
        dmca: boolean;
    };
}> = {
    free: {
        localDetectionHistoryLimit: 50,
        cloudDetectionSyncLimit: 50,
        features: { report_markdown: true, export_pdf: false, report_ai: false, dmca: false },
    },
    personal: {
        localDetectionHistoryLimit: 100,
        cloudDetectionSyncLimit: 100,
        features: { report_markdown: true, export_pdf: true, report_ai: true, dmca: false },
    },
    pro: {
        localDetectionHistoryLimit: 200,
        cloudDetectionSyncLimit: 200,
        features: { report_markdown: true, export_pdf: true, report_ai: true, dmca: true },
    },
    enterprise: {
        localDetectionHistoryLimit: 500,
        cloudDetectionSyncLimit: 500,
        features: { report_markdown: true, export_pdf: true, report_ai: true, dmca: true },
    },
};

export const hasFeatureAccessByPlan = (plan: any, feature: keyof (typeof PLAN_CONFIG)['free']['features']) => {
    const key = getPlanKey(plan);
    return !!PLAN_CONFIG[key]?.features?.[feature];
};
