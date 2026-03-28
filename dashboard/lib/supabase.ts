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
