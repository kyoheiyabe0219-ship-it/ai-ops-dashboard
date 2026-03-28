-- alerts テーブル作成

create table if not exists alerts (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('error', 'warning', 'success', 'info')),
  title text not null,
  message text default '',
  related_agent text references agents(id) on delete set null,
  related_task uuid references tasks(id) on delete set null,
  is_read boolean default false,
  created_at timestamptz default now()
);

create index idx_alerts_unread on alerts(is_read, created_at desc);
create index idx_alerts_type on alerts(type);
create index idx_alerts_agent on alerts(related_agent);

alter publication supabase_realtime add table alerts;
