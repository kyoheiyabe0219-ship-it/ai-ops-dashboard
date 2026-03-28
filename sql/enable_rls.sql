-- RLS有効化 + ポリシー設定
-- anon key: 読み取りのみ許可
-- service_role key: 全操作許可（RLSバイパス）

-- agents
alter table agents enable row level security;
create policy "anon_read_agents" on agents for select using (true);
create policy "service_write_agents" on agents for all using (true) with check (true);

-- tasks
alter table tasks enable row level security;
create policy "anon_read_tasks" on tasks for select using (true);
create policy "service_write_tasks" on tasks for all using (true) with check (true);

-- monetization_logs
alter table monetization_logs enable row level security;
create policy "anon_read_monetization" on monetization_logs for select using (true);
create policy "service_write_monetization" on monetization_logs for all using (true) with check (true);

-- alerts
alter table alerts enable row level security;
create policy "anon_read_alerts" on alerts for select using (true);
create policy "anon_update_alerts" on alerts for update using (true) with check (true);
create policy "service_write_alerts" on alerts for all using (true) with check (true);

-- decision_logs
alter table decision_logs enable row level security;
create policy "anon_read_decisions" on decision_logs for select using (true);
create policy "service_write_decisions" on decision_logs for all using (true) with check (true);
