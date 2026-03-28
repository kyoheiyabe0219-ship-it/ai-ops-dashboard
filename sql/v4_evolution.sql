-- V4: 記憶進化システム

ALTER TABLE knowledge_memory ADD COLUMN IF NOT EXISTS weight float DEFAULT 1.0;
ALTER TABLE knowledge_memory ADD COLUMN IF NOT EXISTS usage_count int DEFAULT 0;
ALTER TABLE knowledge_memory ADD COLUMN IF NOT EXISTS last_used_at timestamptz;
ALTER TABLE knowledge_memory ADD COLUMN IF NOT EXISTS decay_rate float DEFAULT 0.95;
ALTER TABLE knowledge_memory ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

-- tasks 強化
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS failure_reason text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS success_flag boolean;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
