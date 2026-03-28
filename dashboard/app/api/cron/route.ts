import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase-server";
import { runAutonomousCycle } from "@/lib/autonomous-engine";

// Vercel Cron endpoint — GET /api/cron — 5分ごとに自動実行
export async function GET(req: NextRequest) {
  // Vercel Cron認証（CRON_SECRET）
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getServiceSupabase();
    const result = await runAutonomousCycle(supabase);

    const totalActions = result.runs_created + result.tasks_generated + result.auto_approved + result.agents_spawned;

    return NextResponse.json({
      ok: true,
      mode: result.mode,
      total_actions: totalActions,
      runs_created: result.runs_created,
      tasks_generated: result.tasks_generated,
      auto_approved: result.auto_approved,
      duration_ms: result.duration_ms,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Unknown error",
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
