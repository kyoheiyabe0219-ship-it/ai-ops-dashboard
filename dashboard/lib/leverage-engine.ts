/**
 * レバレッジエンジン V9 — 1コンテンツ→複数チャネル→複数収益
 *
 * content_assets: 元コンテンツ（記事/台本/アイデア）
 * channel_deployments: チャネル別展開（blog/sns/video/affiliate/email）
 *
 * フロー: コンテンツ生成 → 複数形式分解 → 複数チャネル投稿 → 収益化
 */

import { SupabaseClient } from "@supabase/supabase-js";

export type ContentAsset = {
  id: string;
  title: string;
  body: string;
  content_type: string;
  reuse_count: number;
  total_revenue: number;
  created_at: string;
};

export type ChannelDeployment = {
  id: string;
  content_id: string;
  channel: string;
  status: "pending" | "published" | "failed";
  revenue_generated: number;
  external_url: string | null;
  created_at: string;
};

// 全チャネル定義
const ALL_CHANNELS = [
  { id: "blog", label: "ブログ記事", format: "long_text", revenue_model: "ad+affiliate" },
  { id: "sns_twitter", label: "Twitter/X投稿", format: "short_text", revenue_model: "traffic" },
  { id: "sns_instagram", label: "Instagram", format: "image+caption", revenue_model: "traffic" },
  { id: "video_short", label: "ショート動画台本", format: "script_60s", revenue_model: "ad" },
  { id: "video_long", label: "YouTube台本", format: "script_10min", revenue_model: "ad+affiliate" },
  { id: "affiliate", label: "アフィリエイト導線", format: "cta_block", revenue_model: "affiliate" },
  { id: "email", label: "メルマガ", format: "newsletter", revenue_model: "nurture" },
  { id: "line", label: "LINE配信", format: "short_message", revenue_model: "nurture" },
  { id: "landing_page", label: "LP素材", format: "sales_copy", revenue_model: "conversion" },
] as const;

// ============================================================
// コンテンツ→チャネル展開計画を生成
// ============================================================

export type DeployPlan = {
  channel: string;
  label: string;
  format: string;
  revenue_model: string;
  task_content: string;
};

export function generateDeployPlan(title: string, strategy: "spread" | "revenue" | "growth"): DeployPlan[] {
  const plans: DeployPlan[] = [];

  if (strategy === "spread") {
    // 拡散重視: SNS + 動画
    plans.push(
      { channel: "blog", label: "ブログ記事", format: "long_text", revenue_model: "ad+affiliate", task_content: `[ブログ] ${title}` },
      { channel: "sns_twitter", label: "Twitter投稿", format: "short_text", revenue_model: "traffic", task_content: `[Twitter] ${title} の要約投稿` },
      { channel: "video_short", label: "ショート動画", format: "script_60s", revenue_model: "ad", task_content: `[ショート] ${title} の60秒動画台本` },
      { channel: "sns_instagram", label: "Instagram", format: "image+caption", revenue_model: "traffic", task_content: `[Insta] ${title} のカルーセル投稿` },
    );
  } else if (strategy === "revenue") {
    // 収益重視: アフィリエイト + LP
    plans.push(
      { channel: "blog", label: "SEO記事", format: "long_text", revenue_model: "ad+affiliate", task_content: `[SEO記事] ${title}` },
      { channel: "affiliate", label: "アフィリエイト", format: "cta_block", revenue_model: "affiliate", task_content: `[アフィリ] ${title} のCTAブロック生成` },
      { channel: "landing_page", label: "LP素材", format: "sales_copy", revenue_model: "conversion", task_content: `[LP] ${title} のセールスコピー` },
      { channel: "email", label: "メルマガ", format: "newsletter", revenue_model: "nurture", task_content: `[メルマガ] ${title} のステップメール` },
    );
  } else {
    // 成長フェーズ: 全チャネル展開
    for (const ch of ALL_CHANNELS) {
      plans.push({
        channel: ch.id, label: ch.label, format: ch.format, revenue_model: ch.revenue_model,
        task_content: `[${ch.label}] ${title}`,
      });
    }
  }

  return plans;
}

// ============================================================
// CEO: チャネル戦略選択
// ============================================================

export async function selectChannelStrategy(supabase: SupabaseClient): Promise<"spread" | "revenue" | "growth"> {
  const { data: streams } = await supabase.from("revenue_streams").select("status, roi, monthly_revenue");
  const active = (streams || []).filter(s => s.status === "active");
  const totalRevenue = active.reduce((s, r) => s + (r.monthly_revenue || 0), 0);

  if (active.length < 2) return "growth";       // アクティブ少ない → 全展開
  if (totalRevenue < 50000) return "spread";     // 収益低い → 拡散優先
  return "revenue";                              // 収益あり → 収益最大化
}

// ============================================================
// コンテンツ作成 + チャネル展開実行
// ============================================================

export async function createAndDeploy(
  supabase: SupabaseClient,
  title: string,
  body: string = "",
  sourceTaskId?: string,
  sourceRunId?: string
): Promise<{ contentId: string; deployments: number; tasks: number }> {
  // コンテンツアセット作成
  const { data: asset } = await supabase.from("content_assets").insert({
    title, body,
    source_task_id: sourceTaskId || null,
    source_run_id: sourceRunId || null,
  }).select("id").single();

  if (!asset) return { contentId: "", deployments: 0, tasks: 0 };

  // 戦略選択
  const strategy = await selectChannelStrategy(supabase);
  const plans = generateDeployPlan(title, strategy);

  let deployments = 0;
  let tasks = 0;

  for (const plan of plans) {
    // チャネル展開レコード
    await supabase.from("channel_deployments").insert({
      content_id: asset.id,
      channel: plan.channel,
      status: "pending",
    });
    deployments++;

    // タスク生成（Workerが実行）
    const { error } = await supabase.from("tasks").insert({
      content: plan.task_content,
      priority: plan.revenue_model.includes("affiliate") ? "high" : "medium",
      status: "pending",
      revenue_type: plan.channel,
    });
    if (!error) tasks++;
  }

  // reuse_count更新
  await supabase.from("content_assets").update({ reuse_count: deployments }).eq("id", asset.id);

  return { contentId: asset.id, deployments, tasks };
}

// ============================================================
// レバレッジサマリー
// ============================================================

export async function getLeverageSummary(supabase: SupabaseClient) {
  const { data: assets } = await supabase.from("content_assets").select("*").order("total_revenue", { ascending: false }).limit(20);
  const { data: deployments } = await supabase.from("channel_deployments").select("channel, status, revenue_generated");

  const allDeploy = deployments || [];
  const byChannel: Record<string, { count: number; published: number; revenue: number }> = {};
  for (const d of allDeploy) {
    if (!byChannel[d.channel]) byChannel[d.channel] = { count: 0, published: 0, revenue: 0 };
    byChannel[d.channel].count++;
    if (d.status === "published") byChannel[d.channel].published++;
    byChannel[d.channel].revenue += d.revenue_generated || 0;
  }

  const totalReuse = (assets || []).reduce((s, a) => s + (a.reuse_count || 0), 0);
  const totalContentRevenue = (assets || []).reduce((s, a) => s + (a.total_revenue || 0), 0);

  return {
    total_assets: (assets || []).length,
    total_deployments: allDeploy.length,
    total_reuse: totalReuse,
    total_content_revenue: totalContentRevenue,
    by_channel: byChannel,
    top_assets: (assets || []).slice(0, 5).map(a => ({ title: a.title, reuse: a.reuse_count, revenue: a.total_revenue })),
    channel_list: ALL_CHANNELS.map(c => ({ ...c, id: c.id })),
  };
}
