import { createClient } from "@supabase/supabase-js";

// サーバーサイド専用（service_role key）
// フロントエンドからは絶対にインポートしないこと
export function getServiceSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_KEY || ""
  );
}
