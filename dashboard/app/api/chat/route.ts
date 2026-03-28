import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { checkRateLimit, rateLimitResponse, apiResponse, apiError, handleOptions } from "@/lib/api-utils";
import { parseCommand, generateResponse } from "@/lib/command-parser";
import { runIteration, executeApprovedRun } from "@/lib/thinking-engine";

export async function OPTIONS() { return handleOptions(); }

export async function GET(req: NextRequest) {
  if (!checkRateLimit(req)) return rateLimitResponse();
  try {
    const supabase = getServiceSupabase();
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") || "50");
    const { data, error } = await supabase.from("chat_messages").select("*").order("created_at", { ascending: true }).limit(limit);
    if (error) return apiError(error.message);
    return apiResponse(data);
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}

type ActionLog = { api: string; method: string; count: number; status: "success" | "failed"; detail?: string; data_count?: number };

export async function POST(req: NextRequest) {
  if (!checkRateLimit(req)) return rateLimitResponse();
  const startTime = Date.now();

  try {
    const supabase = getServiceSupabase();
    const { message } = await req.json();
    if (!message || typeof message !== "string" || message.trim().length === 0) return apiError("message is required", 400);

    const userMessage = message.trim();
    const actions: ActionLog[] = [];
    const resultData: Record<string, unknown> = {};

    await supabase.from("chat_messages").insert({ role: "user", content: userMessage });

    const command = parseCommand(userMessage);
    const context: Record<string, unknown> = {};

    switch (command.type) {

      // ============================================================
      // create_run: CEOに計画を立案させる
      // ============================================================
      case "create_run": {
        const { data: newRun, error } = await supabase.from("agent_runs").insert({
          title: command.title,
          goal: command.goal,
          expected_value: command.expectedValue || 0,
          estimated_cost: 1,
          role: "ceo",
          status: "thinking",
          created_by: "chat",
        }).select().single();

        if (error || !newRun) {
          actions.push({ api: "agent_runs.insert", method: "POST", count: 1, status: "failed", detail: error?.message });
          break;
        }

        actions.push({ api: "agent_runs.insert", method: "POST", count: 1, status: "success", detail: `Run ${newRun.id.substring(0, 8)}` });

        // 初回イテレーション実行
        try {
          const iterResult = await runIteration(supabase, newRun.id);
          actions.push({ api: "thinking_engine.iterate", method: "POST", count: 1, status: "success", detail: `score=${iterResult.score}` });

          const { data: updated } = await supabase.from("agent_runs").select("*").eq("id", newRun.id).single();
          context.createdRun = {
            id: newRun.id,
            title: command.title,
            score: iterResult.score,
            status: updated?.status || "thinking",
          };
          resultData.run_id = newRun.id;
          resultData.score = iterResult.score;
          resultData.status = updated?.status;
        } catch (e) {
          actions.push({ api: "thinking_engine.iterate", method: "POST", count: 1, status: "failed", detail: e instanceof Error ? e.message : "error" });
          context.createdRun = { id: newRun.id, title: command.title, score: 0, status: "thinking" };
        }
        break;
      }

      // ============================================================
      // improve_run: 直近のRunを改善
      // ============================================================
      case "improve_run": {
        const { data: latestRun } = await supabase.from("agent_runs").select("id, status").in("status", ["thinking", "awaiting_approval"]).order("updated_at", { ascending: false }).limit(1);

        if (!latestRun || latestRun.length === 0) {
          actions.push({ api: "agent_runs.select", method: "GET", count: 1, status: "success", detail: "該当Runなし" });
          break;
        }

        const run = latestRun[0];

        // awaiting_approvalの場合、approvalを却下してthinkingに戻す
        if (run.status === "awaiting_approval") {
          const { data: approval } = await supabase.from("approval_requests").select("id").eq("run_id", run.id).eq("status", "pending").limit(1);
          if (approval?.[0]) {
            await supabase.from("approval_requests").update({ status: "rejected", rejection_reason: "チャットから改善指示" }).eq("id", approval[0].id);
          }
          await supabase.from("agent_runs").update({ status: "thinking" }).eq("id", run.id);
        }

        try {
          const iterResult = await runIteration(supabase, run.id);
          actions.push({ api: "thinking_engine.iterate", method: "POST", count: 1, status: "success", detail: `score=${iterResult.score}, #${iterResult.iteration}` });
          context.improvedRun = { id: run.id, score: iterResult.score, iteration: iterResult.iteration };
          resultData.run_id = run.id;
          resultData.score = iterResult.score;
        } catch (e) {
          actions.push({ api: "thinking_engine.iterate", method: "POST", count: 1, status: "failed", detail: e instanceof Error ? e.message : "error" });
        }
        break;
      }

      // ============================================================
      // execute_run: 承認済み or 承認待ちRunを実行
      // ============================================================
      case "execute_run": {
        // まず approved を探す
        let { data: runs } = await supabase.from("agent_runs").select("id").eq("status", "approved").order("updated_at", { ascending: false }).limit(1);

        // なければ awaiting_approval を承認して実行
        if (!runs || runs.length === 0) {
          const { data: awaitingRuns } = await supabase.from("agent_runs").select("id").eq("status", "awaiting_approval").order("updated_at", { ascending: false }).limit(1);
          if (awaitingRuns?.[0]) {
            await supabase.from("agent_runs").update({ status: "approved" }).eq("id", awaitingRuns[0].id);
            const { data: approval } = await supabase.from("approval_requests").select("id").eq("run_id", awaitingRuns[0].id).eq("status", "pending").limit(1);
            if (approval?.[0]) {
              await supabase.from("approval_requests").update({ status: "approved", responded_at: new Date().toISOString() }).eq("id", approval[0].id);
            }
            runs = awaitingRuns;
            actions.push({ api: "auto_approve", method: "PATCH", count: 1, status: "success", detail: "チャットから承認" });
          }
        }

        if (!runs || runs.length === 0) {
          actions.push({ api: "agent_runs.select", method: "GET", count: 1, status: "success", detail: "実行可能Runなし" });
          break;
        }

        try {
          const result = await executeApprovedRun(supabase, runs[0].id);
          actions.push({ api: "execute_run", method: "POST", count: 1, status: "success", detail: `${result.created}タスク生成` });
          context.executedRun = { id: runs[0].id, created: result.created };
          resultData.run_id = runs[0].id;
          resultData.tasks_created = result.created;
        } catch (e) {
          actions.push({ api: "execute_run", method: "POST", count: 1, status: "failed", detail: e instanceof Error ? e.message : "error" });
        }
        break;
      }

      // ============================================================
      // 既存intent（変更なし）
      // ============================================================
      case "create_tasks": {
        let created = 0;
        const taskIds: string[] = [];
        for (const task of command.tasks) {
          const { data: inserted, error } = await supabase.from("tasks").insert({ content: task.content, priority: task.priority, status: "pending", expected_value: task.expected_value, cost: task.cost }).select("id").single();
          if (!error && inserted) {
            created++; taskIds.push(inserted.id);
            const { data: idle } = await supabase.from("agents").select("id").eq("status", "idle").limit(1);
            if (idle?.[0]) {
              await supabase.from("tasks").update({ assigned_to: idle[0].id }).eq("id", inserted.id);
              actions.push({ api: "tasks.update(assign)", method: "PATCH", count: 1, status: "success", detail: `→ ${idle[0].id}` });
            }
          }
        }
        actions.unshift({ api: "tasks.insert", method: "POST", count: created, status: created > 0 ? "success" : "failed", detail: `${created}/${command.tasks.length}件` });
        context.createdTasks = created;
        resultData.task_ids = taskIds;
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
        resultData.unread = (data || []).filter((a: { is_read: boolean }) => !a.is_read).length;
        break;
      }

      case "roi_report": {
        const { data, error } = await supabase.from("tasks").select("content, status, roi, expected_value, actual_value, cost");
        actions.push({ api: "tasks.select", method: "GET", count: 1, status: error ? "failed" : "success", data_count: (data || []).length });
        context.tasks = data || [];
        const done = (data || []).filter((t: { status: string }) => t.status === "done");
        const avgRoi = done.length > 0 ? done.reduce((s: number, t: { roi: number }) => s + (t.roi || 0), 0) / done.length : 0;
        context.stats = { total_tasks: (data || []).length, avg_roi: Math.round(avgRoi * 100) / 100, net_profit: 0 };
        break;
      }

      case "agent_list": {
        const { data, error } = await supabase.from("agents").select("id, name, status, task, progress");
        actions.push({ api: "agents.select", method: "GET", count: 1, status: error ? "failed" : "success", data_count: (data || []).length });
        context.agents = data || [];
        break;
      }

      case "run_decision": {
        context.decisionResult = { total_actions: 0 };
        actions.push({ api: "decision_engine", method: "POST", count: 1, status: "success", detail: "0 actions" });
        break;
      }

      case "unknown": {
        actions.push({ api: "none", method: "-", count: 0, status: "success", detail: "ヘルプ表示" });
        break;
      }
    }

    const responseText = generateResponse(command, context);
    const durationMs = Date.now() - startTime;

    const { data: execLog } = await supabase.from("chat_executions").insert({
      message: userMessage, parsed_intent: command.type, actions, result: resultData, duration_ms: durationMs,
    }).select("id").single();

    await supabase.from("chat_messages").insert({
      role: "assistant", content: responseText,
      meta: { command_type: command.type, execution_id: execLog?.id },
    });

    return apiResponse({
      ok: true, response: responseText, command_type: command.type,
      execution: { id: execLog?.id, intent: command.type, actions, result: resultData, duration_ms: durationMs },
    });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}
