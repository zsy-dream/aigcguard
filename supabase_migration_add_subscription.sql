-- 为已存在的profiles表添加订阅周期字段（增量更新，不会丢失现有数据）
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS subscription_period TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'inactive',
ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- 确认字段已添加
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'profiles' 
ORDER BY ordinal_position;
