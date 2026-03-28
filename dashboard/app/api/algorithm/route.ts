import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { checkRateLimit, rateLimitResponse, apiResponse, apiError, handleOptions } from "@/lib/api-utils";
import { getActiveAlgorithm, proposeAlgorithmUpdate, applyAlgorithmUpdate, rollbackAlgorithm } from "@/lib/meta-engine";

export async function OPTIONS() { return handleOptions(); }

// GET /api/algorithm — 現在のアルゴリズム + メタログ + 改善提案
export async function GET(req: NextRequest) {
  if (!checkRateLimit(req)) return rateLimitResponse();
  try {
    const supabase = getServiceSupabase();
    const [algo, metaRes, historyRes] = await Promise.all([
      getActiveAlgorithm(supabase),
      supabase.from("meta_logs").select("*").order("created_at", { ascending: false }).limit(10),
      supabase.from("ceo_algorithm").select("*").order("version", { ascending: false }).limit(5),
    ]);
    const proposal = await proposeAlgorithmUpdate(supabase);
    return apiResponse({
      current: algo,
      meta_logs: metaRes.data || [],
      history: historyRes.data || [],
      proposal,
    });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}

// POST /api/algorithm — 改善適用 or ロールバック
export async function POST(req: NextRequest) {
  if (!checkRateLimit(req)) return rateLimitResponse();
  try {
    const supabase = getServiceSupabase();
    const { action, proposed } = await req.json();

    if (action === "apply" && proposed) {
      const result = await applyAlgorithmUpdate(supabase, proposed);
      return apiResponse({ ok: true, algorithm: result });
    }

    if (action === "rollback") {
      const result = await rollbackAlgorithm(supabase);
      return apiResponse({ ok: true, algorithm: result });
    }

    return apiError("action must be 'apply' or 'rollback'", 400);
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}
