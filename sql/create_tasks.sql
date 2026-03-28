-- Supabase: tasks テーブル作成
-- agents テーブル作成後に実行

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  assigned_to text references agents(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'running', 'done')),
  priority text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- updated_at 自動更新トリガー（関数は既存を再利用）
create trigger tasks_updated_at
  before update on tasks
  for each row
  execute function update_updated_at();

-- リアルタイム購読を有効化
alter publication supabase_realtime add table tasks;

-- 優先度・ステータスで高速検索用インデックス
create index idx_tasks_status on tasks(status);
create index idx_tasks_assigned on tasks(assigned_to);
create index idx_tasks_priority_created on tasks(priority, created_at);
