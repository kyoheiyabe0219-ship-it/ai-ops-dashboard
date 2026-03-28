"use client";

import { useState, FormEvent } from "react";
import { Task, Agent } from "@/lib/supabase";

const DISPATCHER = "/api";

function timeAgo(d: string) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}秒前`;
  if (s < 3600) return `${Math.floor(s / 60)}分前`;
  return `${Math.floor(s / 3600)}時間前`;
}

export default function TasksTab({
  tasks, agents, onRefresh,
}: {
  tasks: Task[];
  agents: Agent[];
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState<"all" | "pending" | "running" | "done">("all");
  const [sortBy, setSortBy] = useState<"created" | "roi">("created");
  const [content, setContent] = useState("");
  const [priority, setPriority] = useState<"high" | "medium" | "low">("medium");
  const [sending, setSending] = useState(false);

  async function createTask(e: FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setSending(true);
    try {
      await fetch(`${DISPATCHER}/task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim(), priority }),
      });
      setContent("");
      onRefresh();
    } finally { setSending(false); }
  }

  const agentMap: Record<string, string> = {};
  agents.forEach(a => { agentMap[a.id] = a.name; });

  let filtered = tab === "all" ? tasks : tasks.filter(t => t.status === tab);
  if (sortBy === "roi") filtered = [...filtered].sort((a, b) => (b.roi || 0) - (a.roi || 0));

  return (
    <div className="space-y-3">
      {/* 作成フォーム */}
      <form onSubmit={createTask} className="flex gap-2">
        <input type="text" value={content} onChange={e => setContent(e.target.value)} placeholder="タスクを入力..."
          className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-500" />
        <select value={priority} onChange={e => setPriority(e.target.value as typeof priority)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-xs text-white">
          <option value="high">高</option><option value="medium">中</option><option value="low">低</option>
        </select>
        <button type="submit" disabled={sending || !content.trim()}
          className="bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition shrink-0">
          {sending ? "..." : "追加"}
        </button>
      </form>

      {/* フィルタ */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {(["all", "pending", "running", "done"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-2.5 py-1 rounded-lg text-xs transition ${tab === t ? "bg-gray-700 text-white" : "text-gray-500"}`}>
              {t === "all" ? `全(${tasks.length})` : t === "pending" ? `待(${tasks.filter(x => x.status === "pending").length})` : t === "running" ? `実行(${tasks.filter(x => x.status === "running").length})` : `完(${tasks.filter(x => x.status === "done").length})`}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <button onClick={() => setSortBy("created")} className={`px-2 py-1 rounded text-[10px] ${sortBy === "created" ? "bg-gray-700 text-white" : "text-gray-600"}`}>新着</button>
          <button onClick={() => setSortBy("roi")} className={`px-2 py-1 rounded text-[10px] ${sortBy === "roi" ? "bg-purple-900 text-purple-300" : "text-gray-600"}`}>ROI</button>
        </div>
      </div>

      {/* 一覧 */}
      <div className="space-y-2">
        {filtered.length === 0 && <p className="text-gray-600 text-center py-6 text-sm">タスクなし</p>}
        {filtered.map(task => (
          <div key={task.id} className="bg-gray-900 rounded-xl p-3 border border-gray-800">
            <div className="flex items-center gap-2 mb-1">
              <span>{task.status === "done" ? "✅" : task.status === "running" ? "⚡" : "⏳"}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${task.priority === "high" ? "bg-red-900 text-red-300" : task.priority === "low" ? "bg-gray-700 text-gray-400" : "bg-yellow-900 text-yellow-300"}`}>
                {task.priority.toUpperCase()}
              </span>
              <span className="flex-1 text-sm truncate">{task.content}</span>
              {task.roi > 0 && <span className="text-[10px] text-purple-400 font-mono">ROI {task.roi.toFixed(1)}x</span>}
            </div>
            <div className="flex items-center gap-2 text-[10px] text-gray-600">
              <span>{task.assigned_to ? `→ ${agentMap[task.assigned_to] || task.assigned_to}` : "未割当"}</span>
              <span className="flex-1" />
              <span>{timeAgo(task.created_at)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
