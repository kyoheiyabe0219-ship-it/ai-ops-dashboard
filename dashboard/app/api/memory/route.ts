import { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { checkRateLimit, rateLimitResponse, apiResponse, apiError, handleOptions } from "@/lib/api-utils";

export async function OPTIONS() { return handleOptions(); }

// GET /api/memory — メモリ読み取り
export async function GET(req: NextRequest) {
  if (!checkRateLimit(req)) return rateLimitResponse();

  try {
    const supabase = getServiceSupabase();
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") || "20");
    const type = url.searchParams.get("type");

    let kQuery = supabase.from("knowledge_memory").select("*").order("created_at", { ascending: false }).limit(limit);
    if (type && type !== "all") kQuery = kQuery.eq("type", type);

    const [kRes, dRes] = await Promise.all([
      kQuery,
      supabase.from("decision_memory").select("*").order("created_at", { ascending: false }).limit(limit),
    ]);

    return apiResponse({
      knowledge: kRes.data || [],
      decisions: dRes.data || [],
    });
  } catch (err) {
    return apiError(err instanceof Error ? err.message : "Unknown error");
  }
}
