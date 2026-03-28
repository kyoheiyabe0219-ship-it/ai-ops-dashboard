-- Phase 1: 思考ループ + 承認システム

-- AgentRun（ジョブ単位）
create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  goal text not null,
  status text not null default 'thinking'
    check (status in ('thinking', 'awaiting_approval', 'approved', 'executing', 'done', 'rejected', 'failed')),
  current_iteration int default 0,
  max_iterations int default 10,
  best_score int default 0,
  final_plan jsonb default '{}',
  parent_run_id uuid references agent_runs(id),
  created_by text default 'user',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create trigger agent_runs_updated_at
  before update on agent_runs
  for each row execute function update_updated_at();

create index idx_runs_status on agent_runs(status);
alter publication supabase_realtime add table agent_runs;
alter table agent_runs enable row level security;
create policy "anon_read_runs" on agent_runs for select using (true);
create policy "service_write_runs" on agent_runs for all using (true) with check (true);

-- 思考イテレーション
create table if not exists thinking_iterations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references agent_runs(id) on delete cascade,
  iteration int not null,
  proposal text not null,
  proposal_model text default 'claude',
  evaluation text,
  score int,
  eval_model text default 'gpt-4',
  improvements text,
  duration_ms int default 0,
  created_at timestamptz default now()
);

create index idx_iterations_run on thinking_iterations(run_id, iteration);
alter publication supabase_realtime add table thinking_iterations;
alter table thinking_iterations enable row level security;
create policy "anon_read_iterations" on thinking_iterations for select using (true);
create policy "service_write_iterations" on thinking_iterations for all using (true) with check (true);

-- 承認リクエスト
create table if not exists approval_requests (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references agent_runs(id) on delete cascade,
  type text not null default 'plan_approval'
    check (type in ('plan_approval', 'sub_agent_creation', 'execution_approval')),
  title text not null,
  description text default '',
  plan jsonb default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  rejection_reason text,
  responded_at timestamptz,
  created_at timestamptz default now()
);

create index idx_approvals_status on approval_requests(status);
create index idx_approvals_run on approval_requests(run_id);
alter publication supabase_realtime add table approval_requests;
alter table approval_requests enable row level security;
create policy "anon_read_approvals" on approval_requests for select using (true);
create policy "anon_update_approvals" on approval_requests for update using (true) with check (true);
create policy "service_write_approvals" on approval_requests for all using (true) with check (true);

-- tasks に run_id 追加（既存を壊さない）
alter table tasks add column if not exists run_id uuid references agent_runs(id);
