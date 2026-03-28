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

// ============================================================
// Core Types (V2 - 組織構造対応)
// ============================================================

export type Agent = {
  id: string;
  name: string;
  status: "idle" | "running" | "waiting" | "error" | "done";
  role: "ceo" | "manager" | "worker";
  parent_id: string | null;
  task: string;
  progress: number;
  max_children: number;
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
  run_id: string | null;
  parent_task_id: string | null;
  created_at: string;
  updated_at: string;
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
  assigned_agent: string | null;
  created_by: string;
  expected_value: number;
  estimated_cost: number;
  estimated_roi: number;
  role: "ceo" | "normal" | "quick";
  dynamic_target_score: number;
  success_rate: number;
  effective_score: number;
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
  dynamic_target_score: number;
  reached_target: boolean;
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

export type Alert = {
  id: string;
  type: "error" | "warning" | "success" | "info";
  title: string;
  message: string;
  related_agent: string | null;
  is_read: boolean;
  created_at: string;
};

export type KnowledgeMemory = {
  id: string;
  type: "strategy" | "task_pattern" | "failure" | "improvement";
  content: string;
  score: number;
  weight: number;
  usage_count: number;
  is_active: boolean;
  last_used_at: string | null;
  tags: string[];
  created_at: string;
};

export type DecisionMemory = {
  id: string;
  decision_type: string;
  reason: string;
  outcome: string;
  success_flag: boolean | null;
  confidence: number;
  impact_score: number;
  reuse_count: number;
  source_run_id: string | null;
  created_at: string;
};

export type RevenueStream = {
  id: string;
  type: "blog" | "affiliate" | "sns" | "video" | "tool";
  name: string;
  status: "active" | "testing" | "stopped";
  monthly_revenue: number;
  total_revenue: number;
  growth_rate: number;
  roi: number;
  task_count: number;
  created_at: string;
};

export type GoalFunction = {
  id: string;
  short_term_weight: number;
  long_term_weight: number;
  learning_weight: number;
  stability_weight: number;
  risk_weight: number;
  version: number;
  status: string;
  change_reason: string;
  created_at: string;
};

export type CeoAlgorithm = {
  id: string;
  version: number;
  scoring_weights: { ai: number; memory: number; decision: number };
  explore_rules: { base_rate: number; stagnation_rate: number; failure_rate: number; high_perf_rate: number };
  decision_rules: { auto_approve_confidence: number; failure_block_weight: number; priority_weight: number };
  performance: { avg_roi?: number; success_rate?: number };
  status: string;
  change_reason: string;
  created_at: string;
};

export type MetaLog = {
  id: string;
  run_id: string | null;
  original_decision: string;
  outcome: string;
  error_reason: string | null;
  improvement_suggestion: string | null;
  applied: boolean;
  created_at: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  meta: Record<string, unknown>;
  created_at: string;
};
