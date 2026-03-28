-- monetization_logs テーブル作成
-- tasks テーブル作成後に実行

create table if not exists monetization_logs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks(id) on delete cascade,
  platform text not null check (platform in ('wordpress', 'youtube', 'tiktok', 'blog', 'affiliate')),
  revenue int default 0,
  status text not null default 'pending' check (status in ('success', 'pending', 'failed')),
  external_id text,
  external_url text,
  meta jsonb default '{}',
  created_at timestamptz default now()
);

create index idx_monetization_task on monetization_logs(task_id);
create index idx_monetization_platform on monetization_logs(platform);
create index idx_monetization_status on monetization_logs(status);

alter publication supabase_realtime add table monetization_logs;
