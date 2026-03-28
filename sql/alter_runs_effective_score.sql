-- 現実最適化モデル: success_rate + time_cost + effective_score

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS success_rate float DEFAULT 0.5;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS time_cost int DEFAULT 1;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS effective_score float DEFAULT 0;

ALTER TABLE thinking_iterations ADD COLUMN IF NOT EXISTS success_rate float DEFAULT 0.5;
ALTER TABLE thinking_iterations ADD COLUMN IF NOT EXISTS cost_weight float DEFAULT 1;
ALTER TABLE thinking_iterations ADD COLUMN IF NOT EXISTS effective_score float DEFAULT 0;
