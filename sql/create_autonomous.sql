-- 自律モード設定テーブル
create table if not exists autonomous_config (
  id text primary key default 'default',
  enabled boolean default false,
  max_parallel_runs int default 10,
  max_total_tasks int default 50,
  max_auto_gen_per_hour int default 20,
  auto_approve_min_effective float default 5,
  auto_approve_min_roi float default 5,
  auto_approve_min_success_rate float default 0.6,
  agent_spawn_threshold float default 10,
  agent_kill_threshold float default 0.3,
  loop_interval_sec int default 60,
  updated_at timestamptz default now()
);

-- デフォルト設定挿入
insert into autonomous_config (id) values ('default') on conflict do nothing;

-- 自律ループログ
create table if not exists autonomous_logs (
  id uuid primary key default gen_random_uuid(),
  cycle int default 0,
  actions_taken jsonb default '[]',
  runs_created int default 0,
  tasks_generated int default 0,
  agents_spawned int default 0,
  agents_killed int default 0,
  auto_approved int default 0,
  duration_ms int default 0,
  created_at timestamptz default now()
);

create index idx_auto_logs_created on autonomous_logs(created_at desc);
alter publication supabase_realtime add table autonomous_config;
alter publication supabase_realtime add table autonomous_logs;

alter table autonomous_config enable row level security;
create policy "allow_all_auto_config" on autonomous_config for all using (true) with check (true);
alter table autonomous_logs enable row level security;
create policy "allow_all_auto_logs" on autonomous_logs for all using (true) with check (true);
