-- 检测记录表：存储用户的检测行为（永久保存，完整版数据）
-- 创建时间: 2026-02-22

CREATE TABLE IF NOT EXISTS detection_records (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- 输入信息
    input_filename TEXT,
    input_hash TEXT,  -- 可选：输入文件的哈希值
    
    -- 检测结果
    has_watermark BOOLEAN DEFAULT FALSE,
    confidence FLOAT,
    
    -- 匹配到的最佳资产
    matched_asset_id BIGINT,  -- 关联 watermarked_assets.id
    matched_asset JSONB,  -- 冗余存储：{id, filename, author, fingerprint_hash, similarity}
    
    -- 候选列表（完整版）
    candidates JSONB DEFAULT '[]'::jsonb,  -- [{id, filename, author, similarity}, ...]
    
    -- 提取的指纹前缀（方案1：只存128位，避免数据膨胀）
    fingerprint_prefix TEXT,  -- 存提取到的指纹前128位
    
    -- AI报告（可选）
    ai_report TEXT,  -- 生成的AI分析结论文本
    
    -- 元数据（扩展字段，用于未来增加字段而不改表结构）
    metadata JSONB DEFAULT '{}'::jsonb  -- 扩展字段：如 request_type, processing_time_ms 等
);

-- 索引：按用户+时间查询（最常用）
CREATE INDEX IF NOT EXISTS idx_detection_records_user_created 
ON detection_records(user_id, created_at DESC);

-- 索引：按时间倒序（管理员全局查询）
CREATE INDEX IF NOT EXISTS idx_detection_records_created 
ON detection_records(created_at DESC);

-- 索引：按是否命中水印筛选
CREATE INDEX IF NOT EXISTS idx_detection_records_has_watermark 
ON detection_records(has_watermark) WHERE has_watermark = TRUE;

-- 索引：按匹配资产ID（反向查询哪些检测命中了某个资产）
CREATE INDEX IF NOT EXISTS idx_detection_records_matched_asset 
ON detection_records(matched_asset_id) WHERE matched_asset_id IS NOT NULL;

-- 注释
COMMENT ON TABLE detection_records IS '用户检测记录表：存储每次水印检测的详细结果，永久保留';
COMMENT ON COLUMN detection_records.fingerprint_prefix IS '提取的指纹前128位，用于调试和验证';
COMMENT ON COLUMN detection_records.candidates IS '所有候选匹配资产的JSON列表，包含相似度';
COMMENT ON COLUMN detection_records.ai_report IS 'AI生成的检测报告文本';

-- 启用 RLS（行级安全）
ALTER TABLE detection_records ENABLE ROW LEVEL SECURITY;

-- 策略：用户只能看到自己的记录
CREATE POLICY detection_records_user_select ON detection_records
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

-- 策略：只有服务角色可以插入（后端API插入）
CREATE POLICY detection_records_service_insert ON detection_records
    FOR INSERT TO service_role
    WITH CHECK (true);

-- 策略：管理员可以查看所有记录（通过 service_role 或自定义判断）
-- 注意：实际管理员查询走后端API，不直接走Supabase客户端
