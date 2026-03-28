import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
    );
  }
  return _supabase;
}

export const supabase = typeof window !== "undefined"
  ? getSupabase()
  : (null as unknown as SupabaseClient);

export type Agent = {
  id: string;
  name: string;
  status: "idle" | "running" | "waiting" | "error" | "done";
  task: string;
  progress: number;
  updated_at: string;
};

export type Task = {
  id: string;
  content: string;
  assigned_to: string | null;
  status: "pending" | "running" | "done";
  priority: "high" | "medium" | "low";
  expected_value: number;
  actual_value: number;
  cost: number;
  roi: number;
  created_at: string;
  updated_at: string;
};

export type MonetizationLog = {
  id: string;
  task_id: string;
  platform: "wordpress" | "youtube" | "tiktok" | "blog" | "affiliate";
  revenue: number;
  status: "success" | "pending" | "failed";
  external_id: string | null;
  external_url: string | null;
  meta: Record<string, unknown>;
  created_at: string;
};

export type Alert = {
  id: string;
  type: "error" | "warning" | "success" | "info";
  title: string;
  message: string;
  related_agent: string | null;
  related_task: string | null;
  is_read: boolean;
  created_at: string;
};

export type DecisionLog = {
  id: string;
  type: "scale_up" | "scale_down" | "reassign" | "stop";
  reason: string;
  target: string;
  meta: Record<string, unknown>;
  created_at: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  meta: Record<string, unknown>;
  created_at: string;
};

export type AgentRun = {
  id: string;
  title: string;
  goal: string;
  status: "thinking" | "awaiting_approval" | "approved" | "executing" | "done" | "rejected" | "failed";
  current_iteration: number;
  max_iterations: number;
  best_score: number;
  final_plan: Record<string, unknown>;
  parent_run_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type ThinkingIteration = {
  id: string;
  run_id: string;
  iteration: number;
  proposal: string;
  proposal_model: string;
  evaluation: string | null;
  score: number | null;
  eval_model: string;
  improvements: string | null;
  duration_ms: number;
  created_at: string;
};

export type ApprovalRequest = {
  id: string;
  run_id: string;
  type: "plan_approval" | "sub_agent_creation" | "execution_approval";
  title: string;
  description: string;
  plan: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  rejection_reason: string | null;
  responded_at: string | null;
  created_at: string;
};
