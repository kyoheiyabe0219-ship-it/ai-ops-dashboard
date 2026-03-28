-- V3: AI OS メモリレイヤー

-- 知識メモリ（成功戦略/タスクパターン/失敗/改善点）
CREATE TABLE IF NOT EXISTS knowledge_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('strategy', 'task_pattern', 'failure', 'improvement')),
  content text NOT NULL,
  score float DEFAULT 0,
  source_run_id uuid,
  tags text[] DEFAULT '{}',
  access_count int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- 意思決定メモリ（全判断の履歴と結果）
CREATE TABLE IF NOT EXISTS decision_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_type text NOT NULL CHECK (decision_type IN ('scale_up','scale_down','stop','create','assign','approve','reject','spawn_agent','kill_agent')),
  reason text NOT NULL,
  outcome text DEFAULT '',
  success_flag boolean,
  source_run_id uuid,
  created_at timestamptz DEFAULT now()
);

-- タスク拡張
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_type text DEFAULT 'general';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS retry_count int DEFAULT 0;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
