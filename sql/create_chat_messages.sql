-- chat_messages テーブル

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  meta jsonb default '{}',
  created_at timestamptz default now()
);

create index idx_chat_created on chat_messages(created_at desc);

alter publication supabase_realtime add table chat_messages;

-- RLS
alter table chat_messages enable row level security;
create policy "anon_read_chat" on chat_messages for select using (true);
create policy "service_write_chat" on chat_messages for all using (true) with check (true);
