-- V7: 目的関数AI

CREATE TABLE IF NOT EXISTS goal_function (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  short_term_weight float NOT NULL DEFAULT 0.3,
  long_term_weight float NOT NULL DEFAULT 0.3,
  learning_weight float NOT NULL DEFAULT 0.2,
  stability_weight float NOT NULL DEFAULT 0.1,
  risk_weight float NOT NULL DEFAULT 0.1,
  version int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','archived')),
  change_reason text,
  created_at timestamptz DEFAULT now()
);

INSERT INTO goal_function (version, status, change_reason)
VALUES (1, 'active', 'Initial goal function')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS goal_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  previous_weights jsonb NOT NULL,
  new_weights jsonb NOT NULL,
  reason text NOT NULL,
  performance_before jsonb DEFAULT '{}',
  performance_after jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE goal_function ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p_gf" ON goal_function FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE goal_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p_gl" ON goal_logs FOR ALL USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE goal_function;
ALTER PUBLICATION supabase_realtime ADD TABLE goal_logs;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
