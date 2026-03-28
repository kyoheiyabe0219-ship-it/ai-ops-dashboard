-- chat_executions テーブル（チャット処理フロー記録）

create table if not exists chat_executions (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  parsed_intent text not null,
  actions jsonb default '[]',
  result jsonb default '{}',
  duration_ms int default 0,
  created_at timestamptz default now()
);

create index idx_exec_created on chat_executions(created_at desc);

alter publication supabase_realtime add table chat_executions;

alter table chat_executions enable row level security;
create policy "anon_read_exec" on chat_executions for select using (true);
create policy "service_write_exec" on chat_executions for all using (true) with check (true);
