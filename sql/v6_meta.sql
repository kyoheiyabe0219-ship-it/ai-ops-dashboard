-- V6: 自己改変AI

-- メタ思考ログ（判断の自己評価）
CREATE TABLE IF NOT EXISTS meta_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid,
  original_decision text NOT NULL,
  outcome text NOT NULL DEFAULT 'pending',
  error_reason text,
  improvement_suggestion text,
  applied boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- CEOアルゴリズム（バージョン管理）
CREATE TABLE IF NOT EXISTS ceo_algorithm (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version int NOT NULL DEFAULT 1,
  scoring_weights jsonb NOT NULL DEFAULT '{"ai":0.5,"memory":0.3,"decision":0.2}',
  explore_rules jsonb NOT NULL DEFAULT '{"base_rate":0.2,"stagnation_rate":0.35,"failure_rate":0.4,"high_perf_rate":0.1}',
  decision_rules jsonb NOT NULL DEFAULT '{"auto_approve_confidence":0.8,"failure_block_weight":0.7,"priority_weight":1.5}',
  performance jsonb DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','rollback','archived')),
  change_reason text,
  created_at timestamptz DEFAULT now()
);

-- 初期アルゴリズム（v1）
INSERT INTO ceo_algorithm (version, status, change_reason)
VALUES (1, 'active', 'Initial algorithm')
ON CONFLICT DO NOTHING;

ALTER TABLE meta_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p_meta" ON meta_logs FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE ceo_algorithm ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p_algo" ON ceo_algorithm FOR ALL USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE meta_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE ceo_algorithm;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
