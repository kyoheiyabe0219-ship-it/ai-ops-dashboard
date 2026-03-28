-- 収益最適化カラム追加（既存tasksテーブルに対して実行）

alter table tasks add column if not exists expected_value int default 0;
alter table tasks add column if not exists actual_value int default 0;
alter table tasks add column if not exists cost int default 0;
alter table tasks add column if not exists roi float generated always as (
  case when cost > 0 then expected_value::float / cost else expected_value end
) stored;

-- ROI順ソート用インデックス
create index if not exists idx_tasks_roi on tasks(roi desc);
