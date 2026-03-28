import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { validateApiKey, unauthorizedResponse, checkRateLimit, rateLimitResponse, apiResponse, apiError, handleOptions } from "@/lib/api-utils";
import { executeApprovedRun } from "@/lib/thinking-engine";

export async function OPTIONS() { return handleOptions(); }

// POST /api/runs/[id]/execute — 承認済み計画を実行（Task生成）
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!checkRateLimit(req)) return rateLimitResponse();
  if (!validateApiKey(req)) return unauthorizedResponse();

  try {
    const { id } = await params;
    const supabase = getServiceSupabase();
    const result = await executeApprovedRun(supabase, id);
    return apiResponse({ ok: true, ...result });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}
