-- AgentRun に ROI連動スコアリング用カラム追加

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS expected_value int DEFAULT 0;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS estimated_cost int DEFAULT 1;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS estimated_roi float GENERATED ALWAYS AS (
  expected_value::float / GREATEST(estimated_cost, 1)
) STORED;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS role text DEFAULT 'normal'
  CHECK (role IN ('ceo', 'normal', 'quick'));
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS dynamic_target_score int DEFAULT 0;

-- thinking_iterations に動的スコア情報追加
ALTER TABLE thinking_iterations ADD COLUMN IF NOT EXISTS estimated_roi float DEFAULT 0;
ALTER TABLE thinking_iterations ADD COLUMN IF NOT EXISTS dynamic_target_score int DEFAULT 80;
ALTER TABLE thinking_iterations ADD COLUMN IF NOT EXISTS reached_target boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_runs_roi ON agent_runs(estimated_roi DESC);
