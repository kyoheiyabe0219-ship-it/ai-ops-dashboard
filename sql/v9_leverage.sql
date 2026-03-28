-- V9: レバレッジモード（1コンテンツ→複数チャネル）

CREATE TABLE IF NOT EXISTS content_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text DEFAULT '',
  source_task_id uuid,
  source_run_id uuid,
  content_type text DEFAULT 'article',
  reuse_count int DEFAULT 0,
  total_revenue int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id uuid NOT NULL REFERENCES content_assets(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('blog','sns_twitter','sns_instagram','video_short','video_long','affiliate','email','line','landing_page')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','failed')),
  revenue_generated int DEFAULT 0,
  external_url text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_deploy_content ON channel_deployments(content_id);
CREATE INDEX idx_deploy_channel ON channel_deployments(channel);

ALTER TABLE content_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p_ca" ON content_assets FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE channel_deployments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p_cd" ON channel_deployments FOR ALL USING (true) WITH CHECK (true);
ALTER PUBLICATION supabase_realtime ADD TABLE content_assets;
ALTER PUBLICATION supabase_realtime ADD TABLE channel_deployments;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
