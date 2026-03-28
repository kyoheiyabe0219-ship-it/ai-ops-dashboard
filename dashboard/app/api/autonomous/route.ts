import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { validateApiKey, unauthorizedResponse, checkRateLimit, rateLimitResponse, apiResponse, apiError, handleOptions } from "@/lib/api-utils";
import { runAutonomousCycle } from "@/lib/autonomous-engine";

export async function OPTIONS() { return handleOptions(); }

// GET /api/autonomous — 設定 + 直近ログ
export async function GET(req: NextRequest) {
  if (!checkRateLimit(req)) return rateLimitResponse();

  try {
    const supabase = getServiceSupabase();
    const [configRes, logsRes] = await Promise.all([
      supabase.from("autonomous_config").select("*").eq("id", "default").single(),
      supabase.from("autonomous_logs").select("*").order("created_at", { ascending: false }).limit(20),
    ]);

    return apiResponse({
      config: configRes.data,
      logs: logsRes.data || [],
    });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}

// POST /api/autonomous — 手動サイクル実行 or 設定更新
export async function POST(req: NextRequest) {
  if (!checkRateLimit(req)) return rateLimitResponse();
  if (!validateApiKey(req)) return unauthorizedResponse();

  try {
    const supabase = getServiceSupabase();
    const body = await req.json();

    // 設定更新
    if (body.action === "update_config") {
      const updates: Record<string, unknown> = {};
      if (body.enabled !== undefined) updates.enabled = body.enabled;
      if (body.max_parallel_runs) updates.max_parallel_runs = body.max_parallel_runs;
      if (body.max_total_tasks) updates.max_total_tasks = body.max_total_tasks;
      if (body.max_auto_gen_per_hour) updates.max_auto_gen_per_hour = body.max_auto_gen_per_hour;

      const { data, error } = await supabase
        .from("autonomous_config")
        .update(updates)
        .eq("id", "default")
        .select()
        .single();

      if (error) return apiError(error.message);
      return apiResponse({ ok: true, config: data });
    }

    // 手動サイクル実行
    const result = await runAutonomousCycle(supabase);
    return apiResponse({ ok: true, ...result });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}

// PATCH /api/autonomous — ON/OFFトグル
export async function PATCH(req: NextRequest) {
  if (!checkRateLimit(req)) return rateLimitResponse();

  try {
    const supabase = getServiceSupabase();
    const { enabled } = await req.json();

    const { data, error } = await supabase
      .from("autonomous_config")
      .update({ enabled: !!enabled, updated_at: new Date().toISOString() })
      .eq("id", "default")
      .select()
      .single();

    if (error) return apiError(error.message);
    return apiResponse({ ok: true, config: data });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}
