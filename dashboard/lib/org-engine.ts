/**
 * 組織構造エンジン
 *
 * CEO(1) → Manager(max 4) → Worker(max 4 per manager)
 * - idleエージェントがいたら新規生成禁止
 * - 5人目はユーザー承認必須
 */

import { SupabaseClient } from "@supabase/supabase-js";

export type OrgTree = {
  id: string;
  name: string;
  role: "ceo" | "manager" | "worker";
  status: string;
  task: string;
  progress: number;
  children: OrgTree[];
};

const MAX_CHILDREN = 4;

/**
 * 組織ツリーを構築
 */
export async function buildOrgTree(supabase: SupabaseClient): Promise<OrgTree[]> {
  const { data: agents } = await supabase.from("agents").select("*").order("role", { ascending: true });
  if (!agents) return [];

  const byId = new Map(agents.map(a => [a.id, { ...a, children: [] as OrgTree[] }]));
  const roots: OrgTree[] = [];

  for (const agent of agents) {
    const node = byId.get(agent.id)!;
    if (agent.parent_id && byId.has(agent.parent_id)) {
      byId.get(agent.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

/**
 * エージェント生成可否チェック
 */
export async function canSpawnAgent(
  supabase: SupabaseClient,
  parentId: string,
  requestedRole: "manager" | "worker"
): Promise<{ allowed: boolean; reason: string; needs_approval: boolean }> {

  // idleエージェントがいたら生成禁止
  const { data: idleAgents } = await supabase
    .from("agents")
    .select("id")
    .eq("status", "idle")
    .eq("role", requestedRole);

  if (idleAgents && idleAgents.length > 0) {
    return { allowed: false, reason: `idle ${requestedRole}が${idleAgents.length}人存在。新規生成不要`, needs_approval: false };
  }

  // 親の子供数チェック
  const { data: children } = await supabase
    .from("agents")
    .select("id")
    .eq("parent_id", parentId);

  const childCount = (children || []).length;

  if (childCount >= MAX_CHILDREN) {
    // 5人目 = ユーザー承認必須
    return { allowed: true, reason: `${childCount + 1}人目の部下。ユーザー承認が必要`, needs_approval: true };
  }

  return { allowed: true, reason: "OK", needs_approval: false };
}

/**
 * エージェント生成
 */
export async function spawnAgent(
  supabase: SupabaseClient,
  parentId: string,
  role: "manager" | "worker",
  name: string
): Promise<{ id: string } | null> {
  const id = `${role.toUpperCase()}_${Date.now().toString(36)}`;

  const { data, error } = await supabase
    .from("agents")
    .insert({
      id,
      name,
      role,
      parent_id: parentId,
      status: "idle",
      task: "",
      progress: 0,
      max_children: role === "manager" ? MAX_CHILDREN : 0,
    })
    .select("id")
    .single();

  if (error) return null;
  return data;
}

/**
 * タスクを組織に割り振り
 * CEO → Manager → Worker の順で委譲
 */
export async function assignTaskToOrg(
  supabase: SupabaseClient,
  taskId: string
): Promise<string | null> {
  // まずidle workerに割り当て
  const { data: idleWorkers } = await supabase
    .from("agents")
    .select("id")
    .eq("role", "worker")
    .eq("status", "idle")
    .limit(1);

  if (idleWorkers && idleWorkers.length > 0) {
    await supabase.from("tasks").update({ assigned_to: idleWorkers[0].id }).eq("id", taskId);
    return idleWorkers[0].id;
  }

  // idle workerがいなければ idle managerに
  const { data: idleManagers } = await supabase
    .from("agents")
    .select("id")
    .eq("role", "manager")
    .eq("status", "idle")
    .limit(1);

  if (idleManagers && idleManagers.length > 0) {
    await supabase.from("tasks").update({ assigned_to: idleManagers[0].id }).eq("id", taskId);
    return idleManagers[0].id;
  }

  return null; // 全員busy
}
