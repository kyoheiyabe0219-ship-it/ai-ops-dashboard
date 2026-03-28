-- decision_logs テーブル作成

create table if not exists decision_logs (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('scale_up', 'scale_down', 'reassign', 'stop')),
  reason text not null,
  target text not null,
  meta jsonb default '{}',
  created_at timestamptz default now()
);

create index idx_decision_type on decision_logs(type);
create index idx_decision_created on decision_logs(created_at desc);

alter publication supabase_realtime add table decision_logs;
