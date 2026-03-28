-- V8: 収益化AI OS

CREATE TABLE IF NOT EXISTS revenue_streams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('blog','affiliate','sns','video','tool')),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'testing' CHECK (status IN ('active','testing','stopped')),
  monthly_revenue int DEFAULT 0,
  total_revenue int DEFAULT 0,
  growth_rate float DEFAULT 0,
  roi float DEFAULT 0,
  task_count int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS revenue_type text;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS revenue_generated int DEFAULT 0;

ALTER TABLE revenue_streams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p_rs" ON revenue_streams FOR ALL USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE revenue_streams;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
