-- V4.5: 判断進化

ALTER TABLE decision_memory ADD COLUMN IF NOT EXISTS confidence float DEFAULT 0.5;
ALTER TABLE decision_memory ADD COLUMN IF NOT EXISTS impact_score float DEFAULT 0;
ALTER TABLE decision_memory ADD COLUMN IF NOT EXISTS reuse_count int DEFAULT 0;
ALTER TABLE decision_memory ADD COLUMN IF NOT EXISTS context_hash text;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
