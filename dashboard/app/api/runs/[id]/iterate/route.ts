import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { validateApiKey, unauthorizedResponse, checkRateLimit, rateLimitResponse, apiResponse, apiError, handleOptions } from "@/lib/api-utils";
import { runIteration } from "@/lib/thinking-engine";

export async function OPTIONS() { return handleOptions(); }

// POST /api/runs/[id]/iterate — 1イテレーション実行
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkRateLimit(req)) return rateLimitResponse();
  if (!validateApiKey(req)) return unauthorizedResponse();

  try {
    const { id } = await params;
    const supabase = getServiceSupabase();
    const result = await runIteration(supabase, id);

    // 最新状態を返す
    const { data: run } = await supabase.from("agent_runs").select("*").eq("id", id).single();

    return apiResponse({ ok: true, ...result, run });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}
