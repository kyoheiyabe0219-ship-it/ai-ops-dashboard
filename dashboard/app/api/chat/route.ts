import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { checkRateLimit, rateLimitResponse, apiResponse, apiError, handleOptions } from "@/lib/api-utils";
import { parseCommand, generateResponse } from "@/lib/command-parser";

export async function OPTIONS() { return handleOptions(); }

// GET /api/chat — メッセージ履歴取得
export async function GET(req: NextRequest) {
  if (!checkRateLimit(req)) return rateLimitResponse();

  try {
    const supabase = getServiceSupabase();
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") || "50");

    const { data, error } = await supabase
      .from("chat_messages")
      .select("*")
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) return apiError(error.message);
    return apiResponse(data);
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}

// アクションログ型
type ActionLog = {
  api: string;
  method: string;
  count: number;
  status: "success" | "failed";
  detail?: string;
  data_count?: number;
};

// POST /api/chat — メッセージ送信 + コマンド実行 + フロー記録
export async function POST(req: NextRequest) {
  if (!checkRateLimit(req)) return rateLimitResponse();

  const startTime = Date.now();

  try {
    const supabase = getServiceSupabase();
    const { message } = await req.json();

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return apiError("message is required", 400);
    }

    const userMessage = message.trim();
    const actions: ActionLog[] = [];
    const resultData: Record<string, unknown> = {};

    // ① ユーザーメッセージを保存
    await supabase.from("chat_messages").insert({ role: "user", content: userMessage });

    // ② コマンド解析
    const command = parseCommand(userMessage);

    // ③ コマンド実行（アクションを記録）
    const context: Record<string, unknown> = {};

    switch (command.type) {
      case "create_tasks": {
        let created = 0;
        const taskIds: string[] = [];

        for (const task of command.tasks) {
          const { data: inserted, error } = await supabase
            .from("tasks")
            .insert({ content: task.content, priority: task.priority, status: "pending", expected_value: task.expected_value, cost: task.cost })
            .select("id")
            .single();

          if (!error && inserted) {
            created++;
            taskIds.push(inserted.id);

            // 自動割り振り
            const { data: idle } = await supabase.from("agents").select("id").eq("status", "idle").limit(1);
            if (idle && idle.length > 0) {
              await supabase.from("tasks").update({ assigned_to: idle[0].id }).eq("id", inserted.id);
              actions.push({ api: "tasks.update (auto-assign)", method: "PATCH", count: 1, status: "success", detail: `→ ${idle[0].id}` });
            }
          } else {
            actions.push({ api: "tasks.insert", method: "POST", count: 1, status: "failed", detail: error?.message });
          }
        }

        actions.unshift({ api: "tasks.insert", method: "POST", count: created, status: created > 0 ? "success" : "failed", detail: `${created}/${command.tasks.length}件成功` });
        context.createdTasks = created;
        resultData.task_ids = taskIds;
        resultData.created = created;
        break;
      }

      case "status": {
        const [agentsRes, tasksRes] = await Promise.all([
          supabase.from("agents").select("id, name, status, task, progress"),
          supabase.from("tasks").select("content, status, roi, expected_value, actual_value, cost"),
        ]);
        actions.push({ api: "agents.select", method: "GET", count: 1, status: agentsRes.error ? "failed" : "success", data_count: (agentsRes.data || []).length });
        actions.push({ api: "tasks.select", method: "GET", count: 1, status: tasksRes.error ? "failed" : "success", data_count: (tasksRes.data || []).length });

        context.agents = agentsRes.data || [];
        context.tasks = tasksRes.data || [];
        const done = (tasksRes.data || []).filter((t: { status: string }) => t.status === "done");
        const avgRoi = done.length > 0 ? done.reduce((s: number, t: { roi: number }) => s + (t.roi || 0), 0) / done.length : 0;
        const totalActual = done.reduce((s: number, t: { actual_value: number }) => s + (t.actual_value || 0), 0);
        const totalCost = done.reduce((s: number, t: { cost: number }) => s + (t.cost || 0), 0);
        context.stats = { total_tasks: (tasksRes.data || []).length, avg_roi: Math.round(avgRoi * 100) / 100, net_profit: totalActual - totalCost };
        resultData.agents_count = (agentsRes.data || []).length;
        resultData.tasks_count = (tasksRes.data || []).length;
        break;
      }

      case "errors": {
        const { data, error } = await supabase.from("alerts").select("type, title, is_read").order("created_at", { ascending: false }).limit(20);
        actions.push({ api: "alerts.select", method: "GET", count: 1, status: error ? "failed" : "success", data_count: (data || []).length });
        context.alerts = data || [];
        resultData.alerts_count = (data || []).length;
        resultData.unread = (data || []).filter((a: { is_read: boolean }) => !a.is_read).length;
        break;
      }

      case "roi_report": {
        const { data, error } = await supabase.from("tasks").select("content, status, roi, expected_value, actual_value, cost");
        actions.push({ api: "tasks.select", method: "GET", count: 1, status: error ? "failed" : "success", data_count: (data || []).length });
        context.tasks = data || [];
        const done = (data || []).filter((t: { status: string }) => t.status === "done");
        const avgRoi = done.length > 0 ? done.reduce((s: number, t: { roi: number }) => s + (t.roi || 0), 0) / done.length : 0;
        const totalActual = done.reduce((s: number, t: { actual_value: number }) => s + (t.actual_value || 0), 0);
        const totalCost = done.reduce((s: number, t: { cost: number }) => s + (t.cost || 0), 0);
        context.stats = { total_tasks: (data || []).length, avg_roi: Math.round(avgRoi * 100) / 100, net_profit: totalActual - totalCost };
        resultData.done_tasks = done.length;
        resultData.avg_roi = Math.round(avgRoi * 100) / 100;
        break;
      }

      case "agent_list": {
        const { data, error } = await supabase.from("agents").select("id, name, status, task, progress");
        actions.push({ api: "agents.select", method: "GET", count: 1, status: error ? "failed" : "success", data_count: (data || []).length });
        context.agents = data || [];
        resultData.agents_count = (data || []).length;
        break;
      }

      case "run_decision": {
        context.decisionResult = { total_actions: 0 };
        actions.push({ api: "decision_engine.run", method: "POST", count: 1, status: "success", detail: "0 actions" });
        break;
      }

      case "unknown": {
        actions.push({ api: "none", method: "-", count: 0, status: "success", detail: "ヘルプ表示" });
        break;
      }
    }

    // ④ レスポンス生成
    const responseText = generateResponse(command, context);
    const durationMs = Date.now() - startTime;

    // ⑤ 実行ログを保存
    const { data: execLog } = await supabase.from("chat_executions").insert({
      message: userMessage,
      parsed_intent: command.type,
      actions,
      result: resultData,
      duration_ms: durationMs,
    }).select("id").single();

    // ⑥ アシスタントメッセージを保存（execution_idをmetaに含める）
    await supabase.from("chat_messages").insert({
      role: "assistant",
      content: responseText,
      meta: { command_type: command.type, execution_id: execLog?.id },
    });

    return apiResponse({
      ok: true,
      response: responseText,
      command_type: command.type,
      execution: {
        id: execLog?.id,
        intent: command.type,
        actions,
        result: resultData,
        duration_ms: durationMs,
      },
    });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}
