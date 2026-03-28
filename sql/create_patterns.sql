-- 成功/失敗パターン管理

create table if not exists success_patterns (
  id uuid primary key default gen_random_uuid(),
  task_type text not null,
  pattern jsonb not null default '{}',
  sample_content text default '',
  success_count int default 0,
  total_count int default 0,
  success_rate float default 0,
  avg_roi float default 0,
  total_revenue int default 0,
  last_generated_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists failure_patterns (
  id uuid primary key default gen_random_uuid(),
  task_type text not null,
  pattern jsonb not null default '{}',
  failure_count int default 0,
  total_count int default 0,
  failure_rate float default 0,
  avg_roi float default 0,
  blocked boolean default false,
  created_at timestamptz default now()
);

-- autonomous_config にモード追加
alter table autonomous_config add column if not exists mode text default 'safe'
  check (mode in ('safe', 'aggressive'));
alter table autonomous_config add column if not exists auto_mode_switch boolean default true;
alter table autonomous_config add column if not exists roi_switch_up_threshold float default 5;
alter table autonomous_config add column if not exists roi_switch_down_threshold float default 2;
alter table autonomous_config add column if not exists max_per_pattern_per_hour int default 3;

-- tasks にpattern_id追加
alter table tasks add column if not exists pattern_id uuid references success_patterns(id);

create index if not exists idx_patterns_roi on success_patterns(avg_roi desc);
create index if not exists idx_patterns_type on success_patterns(task_type);
create index if not exists idx_failure_blocked on failure_patterns(blocked);

alter publication supabase_realtime add table success_patterns;
alter publication supabase_realtime add table failure_patterns;

alter table success_patterns enable row level security;
create policy "allow_all_success_patterns" on success_patterns for all using (true) with check (true);
alter table failure_patterns enable row level security;
create policy "allow_all_failure_patterns" on failure_patterns for all using (true) with check (true);
