-- Supabase: agents テーブル作成
-- Supabase Dashboard > SQL Editor で実行

create table if not exists agents (
  id text primary key,
  name text not null,
  status text not null default 'idle' check (status in ('idle', 'running', 'waiting', 'error', 'done')),
  task text default '',
  progress int default 0 check (progress >= 0 and progress <= 100),
  updated_at timestamptz default now()
);

-- updated_at 自動更新トリガー
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger agents_updated_at
  before update on agents
  for each row
  execute function update_updated_at();

-- リアルタイム購読を有効化
alter publication supabase_realtime add table agents;

-- RLS（必要に応じて有効化）
-- alter table agents enable row level security;
-- create policy "Allow all" on agents for all using (true);
