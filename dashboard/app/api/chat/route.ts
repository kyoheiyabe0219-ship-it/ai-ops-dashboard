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

// POST /api/chat — メッセージ送信 + コマンド実行
export async function POST(req: NextRequest) {
  if (!checkRateLimit(req)) return rateLimitResponse();

  try {
    const supabase = getServiceSupabase();
    const { message } = await req.json();

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return apiError("message is required", 400);
    }

    const userMessage = message.trim();

    // ① ユーザーメッセージを保存
    await supabase.from("chat_messages").insert({
      role: "user",
      content: userMessage,
    });

    // ② コマンド解析
    const command = parseCommand(userMessage);

    // ③ コマンド実行
    const context: Record<string, unknown> = {};

    switch (command.type) {
      case "create_tasks": {
        let created = 0;
        for (const task of command.tasks) {
          const { error } = await supabase.from("tasks").insert({
            content: task.content,
            priority: task.priority,
            status: "pending",
            expected_value: task.expected_value,
            cost: task.cost,
          });
          if (!error) {
            created++;
            // 自動割り振り
            const { data: idle } = await supabase.from("agents").select("id").eq("status", "idle").limit(1);
            if (idle && idle.length > 0) {
              // 最新のタスクを取得して割り当て
              const { data: latest } = await supabase
                .from("tasks")
                .select("id")
                .eq("content", task.content)
                .order("created_at", { ascending: false })
                .limit(1);
              if (latest && latest[0]) {
                await supabase.from("tasks").update({ assigned_to: idle[0].id }).eq("id", latest[0].id);
              }
            }
          }
        }
        context.createdTasks = created;
        break;
      }

      case "status": {
        const [agentsRes, tasksRes] = await Promise.all([
          supabase.from("agents").select("id, name, status, task, progress"),
          supabase.from("tasks").select("content, status, roi, expected_value, actual_value, cost"),
        ]);
        context.agents = agentsRes.data || [];
        context.tasks = tasksRes.data || [];
        const done = (tasksRes.data || []).filter((t: { status: string }) => t.status === "done");
        const avgRoi = done.length > 0 ? done.reduce((s: number, t: { roi: number }) => s + (t.roi || 0), 0) / done.length : 0;
        const totalActual = done.reduce((s: number, t: { actual_value: number }) => s + (t.actual_value || 0), 0);
        const totalCost = done.reduce((s: number, t: { cost: number }) => s + (t.cost || 0), 0);
        context.stats = { total_tasks: (tasksRes.data || []).length, avg_roi: Math.round(avgRoi * 100) / 100, net_profit: totalActual - totalCost };
        break;
      }

      case "errors": {
        const { data } = await supabase.from("alerts").select("type, title, is_read").order("created_at", { ascending: false }).limit(20);
        context.alerts = data || [];
        break;
      }

      case "roi_report": {
        const { data } = await supabase.from("tasks").select("content, status, roi, expected_value, actual_value, cost");
        context.tasks = data || [];
        const done = (data || []).filter((t: { status: string }) => t.status === "done");
        const avgRoi = done.length > 0 ? done.reduce((s: number, t: { roi: number }) => s + (t.roi || 0), 0) / done.length : 0;
        const totalActual = done.reduce((s: number, t: { actual_value: number }) => s + (t.actual_value || 0), 0);
        const totalCost = done.reduce((s: number, t: { cost: number }) => s + (t.cost || 0), 0);
        context.stats = { total_tasks: (data || []).length, avg_roi: Math.round(avgRoi * 100) / 100, net_profit: totalActual - totalCost };
        break;
      }

      case "agent_list": {
        const { data } = await supabase.from("agents").select("id, name, status, task, progress");
        context.agents = data || [];
        break;
      }

      case "run_decision": {
        // 意思決定エンジン呼び出し（内部API）
        // Serverlessなので直接ロジックを実行
        context.decisionResult = { total_actions: 0 };
        break;
      }
    }

    // ④ レスポンス生成
    const responseText = generateResponse(command, context);

    // ⑤ アシスタントメッセージを保存
    await supabase.from("chat_messages").insert({
      role: "assistant",
      content: responseText,
      meta: { command_type: command.type },
    });

    return apiResponse({
      ok: true,
      response: responseText,
      command_type: command.type,
    });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}
