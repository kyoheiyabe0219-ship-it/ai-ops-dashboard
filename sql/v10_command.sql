-- 指示構造化テーブル
CREATE TABLE IF NOT EXISTS commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_input text NOT NULL,
  strategy text,
  constraints jsonb DEFAULT '[]',
  goal text,
  goal_value int,
  success_flag boolean,
  run_id uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p_cmd" ON commands FOR ALL USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE commands;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
