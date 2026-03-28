"use client";

import { useEffect, useState, FormEvent, useCallback } from "react";
import { getSupabase, Agent, Task, MonetizationLog, Alert, DecisionLog, ChatMessage } from "@/lib/supabase";

// ============================================================
// 定数
// ============================================================

const AGENT_STATUS: Record<Agent["status"], { icon: string; color: string; bg: string; border: string }> = {
  idle:    { icon: "⚪", color: "text-gray-500",   bg: "bg-gray-100",   border: "border-gray-700" },
  running: { icon: "🟢", color: "text-green-600",  bg: "bg-green-50",   border: "border-green-800" },
  waiting: { icon: "🟡", color: "text-yellow-600", bg: "bg-yellow-50",  border: "border-yellow-800" },
  error:   { icon: "🔴", color: "text-red-600",    bg: "bg-red-50",     border: "border-red-800" },
  done:    { icon: "🔵", color: "text-blue-600",   bg: "bg-blue-50",    border: "border-blue-800" },
};

const TASK_STATUS: Record<Task["status"], { icon: string; color: string }> = {
  pending: { icon: "⏳", color: "text-yellow-400" },
  running: { icon: "⚡", color: "text-green-400" },
  done:    { icon: "✅", color: "text-blue-400" },
};

const PRIORITY_BADGE: Record<Task["priority"], { label: string; color: string }> = {
  high:   { label: "HIGH", color: "bg-red-900 text-red-300" },
  medium: { label: "MED",  color: "bg-yellow-900 text-yellow-300" },
  low:    { label: "LOW",  color: "bg-gray-700 text-gray-400" },
};

const PLATFORM_CONFIG: Record<string, { icon: string; color: string }> = {
  wordpress: { icon: "📝", color: "text-blue-400" },
  youtube:   { icon: "🎬", color: "text-red-400" },
  tiktok:    { icon: "🎵", color: "text-pink-400" },
  blog:      { icon: "📰", color: "text-green-400" },
  affiliate: { icon: "🔗", color: "text-yellow-400" },
};

const ALERT_CONFIG: Record<Alert["type"], { icon: string; color: string; border: string; bg: string }> = {
  error:   { icon: "🔴", color: "text-red-400",    border: "border-red-800",    bg: "bg-red-950" },
  warning: { icon: "🟡", color: "text-yellow-400", border: "border-yellow-800", bg: "bg-yellow-950" },
  success: { icon: "🟢", color: "text-green-400",  border: "border-green-800",  bg: "bg-green-950" },
  info:    { icon: "🔵", color: "text-blue-400",   border: "border-blue-800",   bg: "bg-blue-950" },
};

const DECISION_CONFIG: Record<DecisionLog["type"], { icon: string; color: string; border: string; bg: string; label: string }> = {
  scale_up:   { icon: "📈", color: "text-green-400",  border: "border-green-800",  bg: "bg-green-950",  label: "スケールアップ" },
  scale_down: { icon: "📉", color: "text-yellow-400", border: "border-yellow-800", bg: "bg-yellow-950", label: "スケールダウン" },
  reassign:   { icon: "🔄", color: "text-blue-400",   border: "border-blue-800",   bg: "bg-blue-950",   label: "再割り振り" },
  stop:       { icon: "🛑", color: "text-red-400",    border: "border-red-800",    bg: "bg-red-950",    label: "停止" },
};

const DISPATCHER_URL = process.env.NEXT_PUBLIC_DISPATCHER_URL || "/api";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  return `${Math.floor(hr / 24)}日前`;
}

function formatYen(n: number): string {
  if (n >= 10000) return `¥${(n / 10000).toFixed(1)}万`;
  return `¥${n.toLocaleString()}`;
}

// ============================================================
// アラートバー（上部固定）
// ============================================================

function AlertBar({ alerts, onRead, onReadAll, onOpen }: {
  alerts: Alert[];
  onRead: (id: string) => void;
  onReadAll: () => void;
  onOpen: () => void;
}) {
  const unread = alerts.filter((a) => !a.is_read);
  const hasError = unread.some((a) => a.type === "error");
  const latest = unread.slice(0, 3);

  if (unread.length === 0) return null;

  return (
    <div className={`rounded-xl border p-3 mb-4 ${hasError ? "bg-red-950/50 border-red-900" : "bg-yellow-950/30 border-yellow-900/50"}`}>
      <div className="flex items-center justify-between mb-2">
        <button onClick={onOpen} className="flex items-center gap-2">
          <span className={`text-sm font-bold ${hasError ? "text-red-400" : "text-yellow-400"}`}>
            {hasError ? "🚨" : "⚠️"} {unread.length}件の未読アラート
          </span>
        </button>
        <button onClick={onReadAll} className="text-[10px] text-gray-500 hover:text-gray-300 px-2 py-0.5 rounded bg-gray-800">
          全既読
        </button>
      </div>
      <div className="space-y-1.5">
        {latest.map((a) => {
          const cfg = ALERT_CONFIG[a.type];
          return (
            <button key={a.id} onClick={() => onRead(a.id)}
              className={`w-full flex items-center gap-2 text-left rounded-lg px-2.5 py-1.5 border ${cfg.border} ${cfg.bg} transition hover:opacity-80`}>
              <span className="text-sm">{cfg.icon}</span>
              <div className="flex-1 min-w-0">
                <span className={`text-xs font-medium ${cfg.color}`}>{a.title}</span>
                {a.message && <p className="text-[10px] text-gray-500 truncate">{a.message}</p>}
              </div>
              <span className="text-[10px] text-gray-600 shrink-0">{timeAgo(a.created_at)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// ヘルスサマリー
// ============================================================

function HealthSummary({ agents, tasks }: { agents: Agent[]; tasks: Task[] }) {
  const total = agents.length || 1;
  const running = agents.filter((a) => a.status === "running").length;
  const errored = agents.filter((a) => a.status === "error").length;
  const stale = agents.filter((a) => {
    return a.status === "running" && Date.now() - new Date(a.updated_at).getTime() > 30000;
  }).length;
  const uptime = Math.round((running / total) * 100);
  const doneTasks = tasks.filter((t) => t.status === "done");
  const avgRoi = doneTasks.length > 0
    ? doneTasks.reduce((s, t) => s + (t.roi || 0), 0) / doneTasks.length : 0;
  const activeTasks = tasks.filter((t) => t.status === "running").length;

  const isHealthy = errored === 0 && stale === 0;

  const items = [
    { label: "稼働率", value: `${uptime}%`, color: uptime >= 50 ? "text-green-400" : "text-red-400" },
    { label: "エラー", value: `${errored}`, color: errored > 0 ? "text-red-400" : "text-green-400" },
    { label: "無応答", value: `${stale}`, color: stale > 0 ? "text-yellow-400" : "text-gray-500" },
    { label: "実行中", value: `${activeTasks}`, color: "text-blue-400" },
    { label: "平均ROI", value: `${avgRoi.toFixed(1)}x`, color: "text-purple-400" },
  ];

  return (
    <div className={`rounded-xl border p-3 ${isHealthy ? "border-green-900/50 bg-green-950/20" : "border-red-900/50 bg-red-950/20"}`}>
      <div className="flex items-center gap-2 mb-2">
        <span>{isHealthy ? "✅" : "⚠️"}</span>
        <span className={`text-xs font-bold ${isHealthy ? "text-green-400" : "text-red-400"}`}>
          {isHealthy ? "システム正常" : "要確認"}
        </span>
      </div>
      <div className="flex gap-3 overflow-x-auto">
        {items.map((item) => (
          <div key={item.label} className="shrink-0">
            <p className="text-[10px] text-gray-600">{item.label}</p>
            <p className={`text-sm font-bold ${item.color}`}>{item.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// 収益サマリー
// ============================================================

function RevenueStats({ tasks, logs }: { tasks: Task[]; logs: MonetizationLog[] }) {
  const doneTasks = tasks.filter((t) => t.status === "done");
  const totalExpected = tasks.reduce((s, t) => s + (t.expected_value || 0), 0);
  const totalActual = doneTasks.reduce((s, t) => s + (t.actual_value || 0), 0);
  const totalCost = doneTasks.reduce((s, t) => s + (t.cost || 0), 0);
  const avgRoi = doneTasks.length > 0
    ? doneTasks.reduce((s, t) => s + (t.roi || 0), 0) / doneTasks.length : 0;
  const netProfit = totalActual - totalCost;
  const successLogs = logs.filter((l) => l.status === "success");
  const realRevenue = successLogs.reduce((s, l) => s + (l.revenue || 0), 0);

  const stats = [
    { label: "期待収益", value: formatYen(totalExpected), color: "text-yellow-400" },
    { label: "実績収益", value: formatYen(totalActual), color: "text-green-400" },
    { label: "リアル収益", value: formatYen(realRevenue), color: "text-emerald-300" },
    { label: "コスト", value: formatYen(totalCost), color: "text-red-400" },
    { label: "純利益", value: formatYen(netProfit), color: netProfit >= 0 ? "text-emerald-400" : "text-red-400" },
    { label: "平均ROI", value: `${avgRoi.toFixed(1)}x`, color: "text-purple-400" },
  ];

  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      {stats.map((s) => (
        <div key={s.label} className="bg-gray-900 rounded-xl p-3 sm:p-4 border border-gray-800">
          <p className="text-[10px] sm:text-xs text-gray-500 mb-0.5">{s.label}</p>
          <p className={`text-base sm:text-xl font-bold ${s.color}`}>{s.value}</p>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// プラットフォーム & ログ
// ============================================================

function PlatformBreakdown({ logs }: { logs: MonetizationLog[] }) {
  const successLogs = logs.filter((l) => l.status === "success");
  const byPlatform: Record<string, { count: number; revenue: number }> = {};
  successLogs.forEach((l) => {
    if (!byPlatform[l.platform]) byPlatform[l.platform] = { count: 0, revenue: 0 };
    byPlatform[l.platform].count++;
    byPlatform[l.platform].revenue += l.revenue || 0;
  });
  const platforms = Object.entries(byPlatform).sort((a, b) => b[1].revenue - a[1].revenue);

  if (platforms.length === 0) return <p className="text-gray-600 text-sm text-center py-4">実績なし</p>;

  return (
    <div className="space-y-2">
      {platforms.map(([platform, data]) => {
        const cfg = PLATFORM_CONFIG[platform] || { icon: "💰", color: "text-gray-400" };
        return (
          <div key={platform} className="flex items-center gap-2 bg-gray-900 rounded-lg px-3 py-2.5 border border-gray-800">
            <span>{cfg.icon}</span>
            <span className={`text-sm font-medium ${cfg.color}`}>{platform}</span>
            <span className="flex-1" />
            <span className="text-xs text-gray-500">{data.count}件</span>
            <span className="text-sm font-bold text-emerald-400">{formatYen(data.revenue)}</span>
          </div>
        );
      })}
    </div>
  );
}

function MonetizationFeed({ logs }: { logs: MonetizationLog[] }) {
  const recent = logs.slice(0, 5);
  if (recent.length === 0) return <p className="text-gray-600 text-sm text-center py-4">ログなし</p>;

  return (
    <div className="space-y-2">
      {recent.map((log) => {
        const cfg = PLATFORM_CONFIG[log.platform] || { icon: "💰", color: "text-gray-400" };
        const sc = log.status === "success" ? "text-green-400" : log.status === "failed" ? "text-red-400" : "text-yellow-400";
        return (
          <div key={log.id} className="flex items-center gap-2 bg-gray-900/50 rounded-lg px-3 py-2 border border-gray-800/50">
            <span>{cfg.icon}</span>
            <span className={`text-xs ${sc}`}>{log.status === "success" ? "成功" : log.status === "failed" ? "失敗" : "処理中"}</span>
            <span className="flex-1" />
            {log.external_url && <a href={log.external_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 underline">開く</a>}
            <span className="text-sm font-mono text-emerald-400">+{formatYen(log.revenue || 0)}</span>
            <span className="text-[10px] text-gray-600">{timeAgo(log.created_at)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// タスクフォーム
// ============================================================

function TaskForm({ onCreated }: { onCreated: () => void }) {
  const [content, setContent] = useState("");
  const [priority, setPriority] = useState<Task["priority"]>("medium");
  const [expectedValue, setExpectedValue] = useState("");
  const [cost, setCost] = useState("");
  const [showExtra, setShowExtra] = useState(false);
  const [sending, setSending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setSending(true);
    try {
      await fetch(`${DISPATCHER_URL}/task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim(), priority, expected_value: parseInt(expectedValue) || 0, cost: parseInt(cost) || 0 }),
      });
      setContent(""); setExpectedValue(""); setCost(""); setShowExtra(false); onCreated();
    } finally { setSending(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 mb-4">
      <div className="flex gap-2">
        <input type="text" value={content} onChange={(e) => setContent(e.target.value)} placeholder="タスクを入力..."
          className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-500" />
        <button type="submit" disabled={sending || !content.trim()}
          className="bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition shrink-0">
          {sending ? "..." : "投入"}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex bg-gray-800 rounded-lg overflow-hidden border border-gray-700">
          {(["high", "medium", "low"] as const).map((p) => (
            <button key={p} type="button" onClick={() => setPriority(p)}
              className={`px-3 py-1.5 text-xs transition ${priority === p ? (p === "high" ? "bg-red-900 text-red-300" : p === "medium" ? "bg-yellow-900 text-yellow-300" : "bg-gray-600 text-gray-300") : "text-gray-500"}`}>
              {p === "high" ? "高" : p === "medium" ? "中" : "低"}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setShowExtra(!showExtra)} className="text-xs text-gray-500 hover:text-gray-300 transition">
          {showExtra ? "▲ 閉じる" : "▼ 価値・コスト"}
        </button>
      </div>
      {showExtra && (
        <div className="flex gap-2">
          <input type="number" value={expectedValue} onChange={(e) => setExpectedValue(e.target.value)} placeholder="期待価値（円）"
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-500" />
          <input type="number" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="コスト（円）"
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-500" />
        </div>
      )}
    </form>
  );
}

// ============================================================
// 下部ナビ
// ============================================================

type Section = "dashboard" | "tasks" | "agents" | "revenue" | "alerts" | "analytics" | "decisions" | "chat";

function BottomNav({ active, onChange, unreadAlerts }: {
  active: Section; onChange: (s: Section) => void; unreadAlerts: number;
}) {
  const items: { key: Section; icon: string; label: string; badge?: number }[] = [
    { key: "dashboard", icon: "📊", label: "概要" },
    { key: "chat", icon: "💬", label: "Chat" },
    { key: "agents", icon: "🤖", label: "Agent" },
    { key: "tasks", icon: "📌", label: "タスク" },
    { key: "alerts", icon: "🔔", label: "通知", badge: unreadAlerts },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-gray-900/95 backdrop-blur border-t border-gray-800 z-50 pb-[env(safe-area-inset-bottom)] sm:hidden">
      <div className="flex">
        {items.map((item) => (
          <button key={item.key} onClick={() => onChange(item.key)}
            className={`flex-1 flex flex-col items-center py-2 relative transition ${active === item.key ? "text-white" : "text-gray-500"}`}>
            <span className="text-lg">{item.icon}</span>
            <span className="text-[10px] mt-0.5">{item.label}</span>
            {item.badge !== undefined && item.badge > 0 && (
              <span className="absolute top-0.5 right-1/4 bg-red-600 text-[9px] text-white rounded-full w-4 h-4 flex items-center justify-center font-bold">
                {item.badge > 9 ? "9+" : item.badge}
              </span>
            )}
          </button>
        ))}
      </div>
    </nav>
  );
}

// ============================================================
// チャットセクション（独立コンポーネント）
// ============================================================

function ChatSection({ messages, setMessages, dispatcherUrl, onTaskCreated }: {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  dispatcherUrl: string;
  onTaskCreated: () => void;
}) {
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const chatEndRef = { current: null as HTMLDivElement | null };

  async function sendChat(e: FormEvent) {
    e.preventDefault();
    if (!chatInput.trim() || chatSending) return;

    const msg = chatInput.trim();
    setChatInput("");
    setChatSending(true);

    const tempUser: ChatMessage = { id: `temp-${Date.now()}`, role: "user", content: msg, meta: {}, created_at: new Date().toISOString() };
    setMessages((prev) => [...prev, tempUser]);

    try {
      const res = await fetch(`${dispatcherUrl}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();

      if (data.ok) {
        const tempAssistant: ChatMessage = { id: `temp-${Date.now()}-a`, role: "assistant", content: data.response, meta: { command_type: data.command_type }, created_at: new Date().toISOString() };
        setMessages((prev) => [...prev, tempAssistant]);
        if (data.command_type === "create_tasks") onTaskCreated();
      }
    } catch {
      const errMsg: ChatMessage = { id: `temp-${Date.now()}-e`, role: "assistant", content: "送信失敗。ネットワークを確認してください。", meta: {}, created_at: new Date().toISOString() };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setChatSending(false);
    }
  }

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  });

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)] sm:h-[calc(100vh-8rem)]">
      <div className="flex-1 overflow-y-auto space-y-3 mb-3">
        {messages.length === 0 && (
          <div className="text-center py-12 space-y-3">
            <p className="text-4xl">💬</p>
            <p className="text-gray-500 text-sm">AI組織に指示を出しましょう</p>
            <div className="space-y-1.5 text-[11px] text-gray-600">
              <p>📌 「ブログ記事を3本作って」</p>
              <p>📊 「今の状況は？」</p>
              <p>⚠️ 「問題ある？」</p>
              <p>💰 「ROIは？」</p>
              <p>🤖 「エージェント見せて」</p>
              <p>🧠 「最適化して」</p>
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
              msg.role === "user"
                ? "bg-blue-600 text-white rounded-br-md"
                : "bg-gray-800 text-gray-200 rounded-bl-md border border-gray-700"
            }`}>
              <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">{msg.content}</pre>
              <p className={`text-[10px] mt-1 ${msg.role === "user" ? "text-blue-300" : "text-gray-600"}`}>
                {new Date(msg.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
          </div>
        ))}
        {chatSending && (
          <div className="flex justify-start">
            <div className="bg-gray-800 border border-gray-700 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
        <div ref={(el) => { chatEndRef.current = el; }} />
      </div>

      <form onSubmit={sendChat} className="flex gap-2 shrink-0">
        <input
          type="text"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          placeholder="指示を入力..."
          disabled={chatSending}
          className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-600 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={chatSending || !chatInput.trim()}
          className="bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white px-5 py-3 rounded-xl text-sm font-medium transition shrink-0"
        >
          {chatSending ? "..." : "送信"}
        </button>
      </form>
    </div>
  );
}

// ============================================================
// メイン
// ============================================================

export default function Dashboard() {
  const supabase = getSupabase();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs] = useState<MonetizationLog[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [decisions, setDecisions] = useState<DecisionLog[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [section, setSection] = useState<Section>("dashboard");
  const [taskTab, setTaskTab] = useState<"all" | "pending" | "running" | "done">("all");
  const [sortBy, setSortBy] = useState<"created" | "roi">("created");
  const [alertFilter, setAlertFilter] = useState<"unread" | "all">("unread");

  const loadTasks = useCallback(() => {
    supabase.from("tasks").select("*").order("created_at", { ascending: false }).then(({ data }) => { if (data) setTasks(data as Task[]); });
  }, []);

  const loadLogs = useCallback(() => {
    supabase.from("monetization_logs").select("*").order("created_at", { ascending: false }).then(({ data }) => { if (data) setLogs(data as MonetizationLog[]); });
  }, []);

  const loadAlerts = useCallback(() => {
    supabase.from("alerts").select("*").order("created_at", { ascending: false }).limit(100).then(({ data }) => { if (data) setAlerts(data as Alert[]); });
  }, []);

  const loadDecisions = useCallback(() => {
    supabase.from("decision_logs").select("*").order("created_at", { ascending: false }).limit(50).then(({ data }) => { if (data) setDecisions(data as DecisionLog[]); });
  }, []);

  const loadChat = useCallback(() => {
    supabase.from("chat_messages").select("*").order("created_at", { ascending: true }).limit(100).then(({ data }) => { if (data) setChatMessages(data as ChatMessage[]); });
  }, []);

  async function markRead(id: string) {
    await fetch(`${DISPATCHER_URL}/alerts/${id}/read`, { method: "PATCH" });
    setAlerts((prev) => prev.map((a) => a.id === id ? { ...a, is_read: true } : a));
  }

  async function markAllRead() {
    await fetch(`${DISPATCHER_URL}/alerts/read-all`, { method: "POST" });
    setAlerts((prev) => prev.map((a) => ({ ...a, is_read: true })));
  }

  useEffect(() => {
    supabase.from("agents").select("*").order("updated_at", { ascending: false }).then(({ data }) => { if (data) setAgents(data as Agent[]); });
    loadTasks(); loadLogs(); loadAlerts(); loadDecisions(); loadChat();

    const agentCh = supabase.channel("agents-rt").on("postgres_changes", { event: "*", schema: "public", table: "agents" }, (p) => {
      setAgents((prev) => {
        const u = p.new as Agent;
        const exists = prev.find((a) => a.id === u.id);
        if (exists) return prev.map((a) => a.id === u.id ? u : a).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
        return [u, ...prev];
      });
    }).subscribe();

    const taskCh = supabase.channel("tasks-rt").on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, (p) => {
      if (p.eventType === "DELETE") { setTasks((prev) => prev.filter((t) => t.id !== (p.old as Task).id)); return; }
      setTasks((prev) => {
        const u = p.new as Task;
        const exists = prev.find((t) => t.id === u.id);
        if (exists) return prev.map((t) => t.id === u.id ? u : t).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        return [u, ...prev];
      });
    }).subscribe();

    const logCh = supabase.channel("logs-rt").on("postgres_changes", { event: "*", schema: "public", table: "monetization_logs" }, (p) => {
      if (p.eventType === "INSERT") setLogs((prev) => [p.new as MonetizationLog, ...prev]);
    }).subscribe();

    const alertCh = supabase.channel("alerts-rt").on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, (p) => {
      if (p.eventType === "INSERT") setAlerts((prev) => [p.new as Alert, ...prev]);
      if (p.eventType === "UPDATE") setAlerts((prev) => prev.map((a) => a.id === (p.new as Alert).id ? p.new as Alert : a));
    }).subscribe();

    const decisionCh = supabase.channel("decisions-rt").on("postgres_changes", { event: "INSERT", schema: "public", table: "decision_logs" }, (p) => {
      setDecisions((prev) => [p.new as DecisionLog, ...prev]);
    }).subscribe();

    const chatCh = supabase.channel("chat-rt").on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (p) => {
      setChatMessages((prev) => [...prev, p.new as ChatMessage]);
    }).subscribe();

    return () => { supabase.removeChannel(agentCh); supabase.removeChannel(taskCh); supabase.removeChannel(logCh); supabase.removeChannel(alertCh); supabase.removeChannel(decisionCh); supabase.removeChannel(chatCh); };
  }, [loadTasks, loadLogs, loadAlerts, loadDecisions, loadChat]);

  // 集計
  const runningAgents = agents.filter((a) => a.status === "running").length;
  const erroredAgents = agents.filter((a) => a.status === "error").length;
  const pendingTasks = tasks.filter((t) => t.status === "pending").length;
  const successLogs = logs.filter((l) => l.status === "success");
  const unreadAlerts = alerts.filter((a) => !a.is_read);

  let filteredTasks = taskTab === "all" ? tasks : tasks.filter((t) => t.status === taskTab);
  if (sortBy === "roi") filteredTasks = [...filteredTasks].sort((a, b) => (b.roi || 0) - (a.roi || 0));

  const agentMap: Record<string, string> = {};
  agents.forEach((a) => (agentMap[a.id] = a.name));

  const agentTasks: Record<string, Task[]> = {};
  tasks.filter((t) => t.assigned_to && t.status !== "done").forEach((t) => {
    if (!agentTasks[t.assigned_to!]) agentTasks[t.assigned_to!] = [];
    agentTasks[t.assigned_to!].push(t);
  });

  const taskLogs: Record<string, MonetizationLog[]> = {};
  logs.forEach((l) => { if (!taskLogs[l.task_id]) taskLogs[l.task_id] = []; taskLogs[l.task_id].push(l); });

  // エージェント別アラート（直近3件）
  const agentAlerts: Record<string, Alert[]> = {};
  alerts.forEach((a) => {
    if (a.related_agent) {
      if (!agentAlerts[a.related_agent]) agentAlerts[a.related_agent] = [];
      if (agentAlerts[a.related_agent].length < 3) agentAlerts[a.related_agent].push(a);
    }
  });

  // ============================================================
  // デスクトップサイドバー
  // ============================================================
  const navItems: { key: Section; icon: string; label: string }[] = [
    { key: "dashboard", icon: "📊", label: "概要" },
    { key: "chat", icon: "💬", label: "Chat" },
    { key: "agents", icon: "🤖", label: "エージェント" },
    { key: "tasks", icon: "📌", label: "タスク" },
    { key: "decisions", icon: "🧠", label: "AI判断" },
    { key: "alerts", icon: "🔔", label: "アラート" },
    { key: "analytics", icon: "📈", label: "分析" },
    { key: "revenue", icon: "💰", label: "収益" },
  ];

  const desktopNav = (
    <aside className="hidden sm:flex flex-col w-16 lg:w-48 bg-gray-900 border-r border-gray-800 shrink-0">
      <div className="p-3 lg:p-4 border-b border-gray-800">
        <h1 className="hidden lg:block text-sm font-bold">AI Ops</h1>
        <span className="lg:hidden text-xl block text-center">🤖</span>
      </div>
      {navItems.map((item) => (
        <button key={item.key} onClick={() => setSection(item.key)}
          className={`flex items-center gap-2 px-3 lg:px-4 py-3 text-sm transition relative ${section === item.key ? "bg-gray-800 text-white" : "text-gray-500 hover:text-gray-300 hover:bg-gray-800/50"}`}>
          <span>{item.icon}</span>
          <span className="hidden lg:inline">{item.label}</span>
          {item.key === "alerts" && unreadAlerts.length > 0 && (
            <span className="absolute top-2 left-8 lg:left-auto lg:right-3 bg-red-600 text-[9px] text-white rounded-full w-4 h-4 flex items-center justify-center">
              {unreadAlerts.length > 9 ? "9+" : unreadAlerts.length}
            </span>
          )}
        </button>
      ))}
    </aside>
  );

  // ============================================================
  // セクション: 概要
  // ============================================================
  const dashboardSection = (
    <div className="space-y-4">
      <AlertBar alerts={alerts} onRead={markRead} onReadAll={markAllRead} onOpen={() => setSection("alerts")} />
      <HealthSummary agents={agents} tasks={tasks} />
      <RevenueStats tasks={tasks} logs={logs} />

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-400">エージェント</h3>
          <button onClick={() => setSection("agents")} className="text-xs text-blue-500">すべて →</button>
        </div>
        <div className="space-y-2">
          {agents.slice(0, 3).map((agent) => {
            const cfg = AGENT_STATUS[agent.status];
            const stale = agent.status === "running" && Date.now() - new Date(agent.updated_at).getTime() > 30000;
            return (
              <div key={agent.id} className={`bg-gray-900 rounded-xl p-3 border ${stale ? "border-yellow-700 bg-yellow-950/20" : cfg.border}`}>
                <div className="flex items-center gap-2">
                  <span>{stale ? "⚠️" : cfg.icon}</span>
                  <span className="text-sm font-medium flex-1 truncate">{agent.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>{agent.status.toUpperCase()}</span>
                  <span className="text-[10px] text-gray-600">{timeAgo(agent.updated_at)}</span>
                </div>
                {agent.task && <p className="text-xs text-gray-500 mt-1 truncate">{agent.task}</p>}
                {(agent.status === "running" || agent.status === "done") && (
                  <div className="w-full bg-gray-800 rounded-full h-1.5 mt-2">
                    <div className={`h-1.5 rounded-full transition-all duration-500 ${agent.status === "done" ? "bg-blue-500" : "bg-green-500"}`} style={{ width: `${agent.progress}%` }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 直近AI判断 */}
      {decisions.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-400">🧠 AI判断</h3>
            <button onClick={() => setSection("decisions")} className="text-xs text-blue-500">すべて →</button>
          </div>
          <div className="space-y-1.5">
            {decisions.slice(0, 3).map((d) => {
              const cfg = DECISION_CONFIG[d.type];
              return (
                <div key={d.id} className={`flex items-center gap-2 rounded-lg px-3 py-2 border ${cfg.border} ${cfg.bg}`}>
                  <span>{cfg.icon}</span>
                  <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
                  <span className="flex-1 text-[11px] text-gray-400 truncate">{d.reason}</span>
                  <span className="text-[10px] text-gray-600 shrink-0">{timeAgo(d.created_at)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-400">直近タスク</h3>
          <button onClick={() => setSection("tasks")} className="text-xs text-blue-500">すべて →</button>
        </div>
        <div className="space-y-1.5">
          {tasks.slice(0, 5).map((task) => {
            const st = TASK_STATUS[task.status]; const pr = PRIORITY_BADGE[task.priority];
            return (
              <div key={task.id} className="flex items-center gap-2 bg-gray-900 rounded-lg px-3 py-2 border border-gray-800">
                <span className="text-sm">{st.icon}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${pr.color}`}>{pr.label}</span>
                <span className="flex-1 text-xs truncate">{task.content}</span>
                {task.roi > 0 && <span className="text-[10px] text-purple-400 font-mono">{task.roi.toFixed(1)}x</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  // ============================================================
  // セクション: エージェント（強化版）
  // ============================================================
  const agentsSection = (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold sm:hidden">🤖 エージェント</h2>
      {agents.length === 0 && <p className="text-gray-500 text-center py-12">エージェントが登録されていません</p>}
      {agents.map((agent) => {
        const cfg = AGENT_STATUS[agent.status];
        const assigned = agentTasks[agent.id] || [];
        const recentAlerts = agentAlerts[agent.id] || [];
        const stale = agent.status === "running" && Date.now() - new Date(agent.updated_at).getTime() > 30000;
        const runningTaskCount = tasks.filter((t) => t.assigned_to === agent.id && t.status === "running").length;

        return (
          <div key={agent.id} className={`bg-gray-900 rounded-xl p-4 border transition ${stale ? "border-yellow-700 bg-yellow-950/10" : cfg.border}`}>
            {/* ヘッダー */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">{stale ? "⚠️" : cfg.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm sm:text-base truncate">{agent.name}</span>
                  <span className="text-gray-600 text-xs">{agent.id}</span>
                </div>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color} font-medium`}>{agent.status.toUpperCase()}</span>
            </div>

            {/* メタ情報 */}
            <div className="flex gap-3 text-[11px] text-gray-500 mb-2">
              <span>最終HB: {timeAgo(agent.updated_at)}</span>
              <span>実行中: {runningTaskCount}件</span>
              {stale && <span className="text-yellow-400 font-medium">無応答</span>}
            </div>

            {agent.task && <p className="text-gray-400 text-xs mb-2 truncate">{agent.task}</p>}

            {/* 割当タスク */}
            {assigned.length > 0 && (
              <div className="mb-2 space-y-1">
                {assigned.map((t) => (
                  <div key={t.id} className="flex items-center gap-1.5 text-[11px] text-gray-500">
                    <span>{TASK_STATUS[t.status].icon}</span>
                    <span className={`px-1 py-0.5 rounded text-[10px] ${PRIORITY_BADGE[t.priority].color}`}>{PRIORITY_BADGE[t.priority].label}</span>
                    <span className="text-gray-400 truncate flex-1">{t.content}</span>
                    {t.roi > 0 && <span className="text-purple-500 font-mono">{t.roi.toFixed(1)}x</span>}
                  </div>
                ))}
              </div>
            )}

            {/* エラー履歴 */}
            {recentAlerts.length > 0 && (
              <div className="mb-2 space-y-1">
                {recentAlerts.map((a) => {
                  const ac = ALERT_CONFIG[a.type];
                  return (
                    <div key={a.id} className={`flex items-center gap-1.5 text-[10px] rounded px-2 py-1 ${ac.bg} border ${ac.border}`}>
                      <span>{ac.icon}</span>
                      <span className={ac.color}>{a.title}</span>
                      <span className="flex-1" />
                      <span className="text-gray-600">{timeAgo(a.created_at)}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* プログレス */}
            {(agent.status === "running" || agent.status === "done") && (
              <>
                <div className="w-full bg-gray-800 rounded-full h-1.5">
                  <div className={`h-1.5 rounded-full transition-all duration-500 ${agent.status === "done" ? "bg-blue-500" : "bg-green-500"}`} style={{ width: `${agent.progress}%` }} />
                </div>
                <p className="text-right text-[10px] text-gray-600 mt-0.5">{agent.progress}%</p>
              </>
            )}
          </div>
        );
      })}
    </div>
  );

  // ============================================================
  // セクション: タスク
  // ============================================================
  const tasksSection = (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold sm:hidden">📌 タスク</h2>
      <TaskForm onCreated={loadTasks} />

      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <div className="flex gap-1 shrink-0">
          {(["all", "pending", "running", "done"] as const).map((t) => (
            <button key={t} onClick={() => setTaskTab(t)}
              className={`px-2.5 py-1 rounded-lg text-xs whitespace-nowrap transition ${taskTab === t ? "bg-gray-700 text-white" : "bg-gray-900 text-gray-500"}`}>
              {t === "all" ? "全て" : t === "pending" ? "待機" : t === "running" ? "実行中" : "完了"}
            </button>
          ))}
        </div>
        <div className="flex gap-1 ml-auto shrink-0">
          <button onClick={() => setSortBy("created")} className={`px-2 py-1 rounded text-[10px] ${sortBy === "created" ? "bg-gray-700 text-white" : "text-gray-600"}`}>新着</button>
          <button onClick={() => setSortBy("roi")} className={`px-2 py-1 rounded text-[10px] ${sortBy === "roi" ? "bg-purple-900 text-purple-300" : "text-gray-600"}`}>ROI</button>
        </div>
      </div>

      <div className="space-y-2">
        {filteredTasks.length === 0 && <p className="text-gray-600 text-center py-6 text-sm">タスクなし</p>}
        {filteredTasks.map((task) => {
          const st = TASK_STATUS[task.status]; const pr = PRIORITY_BADGE[task.priority];
          const hasValue = (task.expected_value || 0) > 0 || (task.actual_value || 0) > 0;
          const tLogs = taskLogs[task.id] || [];
          const successCount = tLogs.filter((l) => l.status === "success").length;
          return (
            <div key={task.id} className="bg-gray-900 rounded-xl p-3 border border-gray-800">
              <div className="flex items-start gap-2">
                <span className="mt-0.5">{st.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${pr.color}`}>{pr.label}</span>
                    {task.roi > 0 && <span className="text-[10px] px-1 py-0.5 rounded bg-purple-900/50 text-purple-300 font-mono">ROI {task.roi.toFixed(1)}x</span>}
                    {successCount > 0 && <span className="text-[10px] px-1 py-0.5 rounded bg-emerald-900/50 text-emerald-300">💰{successCount}</span>}
                  </div>
                  <p className="text-sm">{task.content}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2 text-[11px] text-gray-500">
                {hasValue && (
                  <>
                    <span className="text-yellow-500">{formatYen(task.expected_value || 0)}</span>
                    {task.status === "done" && <><span>→</span><span className="text-green-400">{formatYen(task.actual_value || 0)}</span></>}
                  </>
                )}
                <span className="flex-1" />
                <span>{task.assigned_to ? `→ ${agentMap[task.assigned_to] || task.assigned_to}` : "未割当"}</span>
                <span className="text-gray-700">{timeAgo(task.created_at)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  // ============================================================
  // セクション: アラート
  // ============================================================
  const filteredAlerts = alertFilter === "unread" ? alerts.filter((a) => !a.is_read) : alerts;

  const alertsSection = (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold sm:hidden">🔔 アラート</h2>
        <div className="flex gap-1 ml-auto">
          <button onClick={() => setAlertFilter("unread")} className={`px-2.5 py-1 rounded-lg text-xs ${alertFilter === "unread" ? "bg-gray-700 text-white" : "bg-gray-900 text-gray-500"}`}>
            未読 ({unreadAlerts.length})
          </button>
          <button onClick={() => setAlertFilter("all")} className={`px-2.5 py-1 rounded-lg text-xs ${alertFilter === "all" ? "bg-gray-700 text-white" : "bg-gray-900 text-gray-500"}`}>
            全て ({alerts.length})
          </button>
          {unreadAlerts.length > 0 && (
            <button onClick={markAllRead} className="px-2.5 py-1 rounded-lg text-xs bg-gray-800 text-gray-400 hover:text-white">全既読</button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {filteredAlerts.length === 0 && <p className="text-gray-600 text-center py-8 text-sm">{alertFilter === "unread" ? "未読アラートなし" : "アラートなし"}</p>}
        {filteredAlerts.map((a) => {
          const cfg = ALERT_CONFIG[a.type];
          return (
            <button key={a.id} onClick={() => !a.is_read && markRead(a.id)}
              className={`w-full text-left rounded-xl p-3 border transition ${a.is_read ? "bg-gray-900 border-gray-800 opacity-60" : `${cfg.bg} ${cfg.border}`}`}>
              <div className="flex items-center gap-2">
                <span>{cfg.icon}</span>
                <span className={`text-sm font-medium ${a.is_read ? "text-gray-400" : cfg.color}`}>{a.title}</span>
                <span className="flex-1" />
                {!a.is_read && <span className="w-2 h-2 bg-blue-500 rounded-full" />}
                <span className="text-[10px] text-gray-600">{timeAgo(a.created_at)}</span>
              </div>
              {a.message && <p className="text-xs text-gray-500 mt-1">{a.message}</p>}
              {(a.related_agent || a.related_task) && (
                <div className="flex gap-2 mt-1.5 text-[10px] text-gray-600">
                  {a.related_agent && <span>🤖 {agentMap[a.related_agent] || a.related_agent}</span>}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  // ============================================================
  // セクション: 分析
  // ============================================================
  const doneTasks = tasks.filter((t) => t.status === "done");
  const roiRanking = [...doneTasks].filter((t) => t.roi > 0).sort((a, b) => (b.roi || 0) - (a.roi || 0)).slice(0, 10);
  const recentErrors = alerts.filter((a) => a.type === "error").slice(0, 10);

  const analyticsSection = (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold sm:hidden">📈 パフォーマンス分析</h2>

      {/* ヘルス */}
      <HealthSummary agents={agents} tasks={tasks} />

      {/* ROIランキング */}
      <div>
        <h3 className="text-sm font-semibold text-gray-400 mb-2">🏆 ROIランキング</h3>
        <div className="space-y-1.5">
          {roiRanking.length === 0 && <p className="text-gray-600 text-sm text-center py-4">完了タスクなし</p>}
          {roiRanking.map((task, i) => (
            <div key={task.id} className="flex items-center gap-2 bg-gray-900 rounded-lg px-3 py-2 border border-gray-800">
              <span className={`text-xs font-bold ${i < 3 ? "text-yellow-400" : "text-gray-500"}`}>#{i + 1}</span>
              <span className="flex-1 text-xs truncate">{task.content}</span>
              <span className="text-xs text-purple-400 font-mono font-bold">{task.roi.toFixed(1)}x</span>
              <span className="text-[10px] text-green-400">{formatYen(task.actual_value || 0)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 収益 */}
      <div>
        <h3 className="text-sm font-semibold text-gray-400 mb-2">📊 プラットフォーム別</h3>
        <PlatformBreakdown logs={logs} />
      </div>

      {/* エラー履歴 */}
      <div>
        <h3 className="text-sm font-semibold text-gray-400 mb-2">🔴 直近エラー</h3>
        <div className="space-y-1.5">
          {recentErrors.length === 0 && <p className="text-gray-600 text-sm text-center py-4">エラーなし 🎉</p>}
          {recentErrors.map((a) => (
            <div key={a.id} className="flex items-center gap-2 bg-red-950/30 rounded-lg px-3 py-2 border border-red-900/50">
              <span>🔴</span>
              <div className="flex-1 min-w-0">
                <span className="text-xs text-red-400">{a.title}</span>
                {a.message && <p className="text-[10px] text-gray-600 truncate">{a.message}</p>}
              </div>
              <span className="text-[10px] text-gray-600 shrink-0">{timeAgo(a.created_at)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 収益ログ */}
      <div>
        <h3 className="text-sm font-semibold text-gray-400 mb-2">📡 収益ログ</h3>
        <MonetizationFeed logs={logs} />
      </div>
    </div>
  );

  // ============================================================
  // セクション: 収益
  // ============================================================
  const revenueSection = (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold sm:hidden">💰 収益</h2>
      <RevenueStats tasks={tasks} logs={logs} />
      <div>
        <h3 className="text-sm font-semibold text-gray-400 mb-2">📊 プラットフォーム別</h3>
        <PlatformBreakdown logs={logs} />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-gray-400 mb-2">📡 収益ログ</h3>
        <MonetizationFeed logs={logs} />
      </div>
    </div>
  );

  // ============================================================
  // セクション: AI判断
  // ============================================================

  // 判断タイプ別の集計
  const decisionByType: Record<string, number> = {};
  decisions.forEach((d) => { decisionByType[d.type] = (decisionByType[d.type] || 0) + 1; });

  const decisionsSection = (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold sm:hidden">🧠 AI判断</h2>
        <button
          onClick={async () => {
            await fetch(`${DISPATCHER_URL}/auto-decision/run`, { method: "POST" });
            loadDecisions();
          }}
          className="text-xs bg-purple-900 text-purple-300 px-3 py-1.5 rounded-lg hover:bg-purple-800 transition ml-auto"
        >
          今すぐ実行
        </button>
      </div>

      {/* サマリー */}
      <div className="grid grid-cols-4 gap-2">
        {(["scale_up", "scale_down", "reassign", "stop"] as const).map((type) => {
          const cfg = DECISION_CONFIG[type];
          return (
            <div key={type} className={`rounded-xl p-3 border ${cfg.border} ${cfg.bg}`}>
              <p className="text-lg text-center">{cfg.icon}</p>
              <p className={`text-center text-lg font-bold ${cfg.color}`}>{decisionByType[type] || 0}</p>
              <p className="text-[10px] text-gray-500 text-center">{cfg.label}</p>
            </div>
          );
        })}
      </div>

      {/* 自動判断ルール説明 */}
      <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
        <p className="text-xs font-semibold text-gray-400 mb-2">ルール（30秒ごと自動評価）</p>
        <div className="space-y-1 text-[11px] text-gray-500">
          <p>📈 <span className="text-green-400">スケールアップ</span> — ROI{">"}5が3回連続 → 同種+2生成</p>
          <p>📉 <span className="text-yellow-400">スケールダウン</span> — ROI{"<"}1が3回連続 → low優先度化</p>
          <p>🔄 <span className="text-blue-400">再割り振り</span> — 処理時間が平均2倍超 → 別エージェントへ</p>
          <p>🛑 <span className="text-red-400">停止</span> — エラー3回連続 → 強制idle + タスク再割当</p>
        </div>
      </div>

      {/* ログ */}
      <div>
        <h3 className="text-sm font-semibold text-gray-400 mb-2">判断ログ</h3>
        <div className="space-y-2">
          {decisions.length === 0 && <p className="text-gray-600 text-center py-6 text-sm">判断ログなし（30秒ごとに自動評価中）</p>}
          {decisions.map((d) => {
            const cfg = DECISION_CONFIG[d.type];
            return (
              <div key={d.id} className={`rounded-xl p-3 border ${cfg.border} ${cfg.bg}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span>{cfg.icon}</span>
                  <span className={`text-xs font-bold ${cfg.color}`}>{cfg.label}</span>
                  <span className="flex-1" />
                  <span className="text-[10px] text-gray-600">{timeAgo(d.created_at)}</span>
                </div>
                <p className="text-xs text-gray-300">{d.reason}</p>
                <p className="text-[10px] text-gray-600 mt-1">対象: {d.target}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  // ============================================================
  // レンダリング
  // ============================================================
  const sections: Record<Section, React.ReactNode> = {
    dashboard: dashboardSection, agents: agentsSection, tasks: tasksSection,
    chat: <ChatSection messages={chatMessages} setMessages={setChatMessages} dispatcherUrl={DISPATCHER_URL} onTaskCreated={loadTasks} />,
    decisions: decisionsSection, alerts: alertsSection, analytics: analyticsSection, revenue: revenueSection,
  };
  const sectionLabels: Record<Section, string> = {
    dashboard: "概要", agents: "エージェント", tasks: "タスク",
    chat: "Chat", decisions: "AI判断", alerts: "アラート", analytics: "分析", revenue: "収益",
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white flex">
      {desktopNav}
      <main className="flex-1 min-w-0">
        <header className="hidden sm:flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h1 className="text-xl font-bold">{sectionLabels[section]}</h1>
          <div className="flex gap-3 text-xs text-gray-400">
            <span className="text-green-400">{runningAgents} 稼働</span>
            {erroredAgents > 0 && <span className="text-red-400">{erroredAgents} エラー</span>}
            <span>📌 {pendingTasks} 待機</span>
            {unreadAlerts.length > 0 && <span className="text-red-400">🔔 {unreadAlerts.length}</span>}
            <span className="text-emerald-400">💰 {successLogs.length}件</span>
          </div>
        </header>

        <header className="sm:hidden pt-[env(safe-area-inset-top)] px-4 pt-4 pb-2">
          <h1 className="text-xl font-bold">AI Ops</h1>
        </header>

        <div className="px-4 sm:px-6 py-4 pb-24 sm:pb-6">
          {sections[section]}
        </div>
      </main>

      <BottomNav active={section} onChange={setSection} unreadAlerts={unreadAlerts.length} />
    </div>
  );
}
