-- V2: 組織構造対応

-- agents にロール + 階層追加
ALTER TABLE agents ADD COLUMN IF NOT EXISTS role text DEFAULT 'worker' CHECK (role IN ('ceo', 'manager', 'worker'));
ALTER TABLE agents ADD COLUMN IF NOT EXISTS parent_id text REFERENCES agents(id);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS max_children int DEFAULT 4;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS created_by text DEFAULT 'system';

-- tasks に parent_task_id（タスク分解用）
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id uuid;

-- agent_runs に hierarchy_level
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS assigned_agent text;
