import { NextRequest, NextResponse } from "next/server";

// API_SECRET: エージェントからのリクエスト認証用
// ダッシュボードUI（同一オリジン）はCookieで認証
export function validateApiKey(req: NextRequest): boolean {
  const apiKey = req.headers.get("x-api-key") || req.headers.get("authorization")?.replace("Bearer ", "");
  const secret = process.env.API_SECRET;
  if (!secret) return true; // 未設定時はスキップ（開発用）
  return apiKey === secret;
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

// 簡易レート制限（インメモリ、Serverless環境では各インスタンスで独立）
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60_000; // 1分
const RATE_LIMIT_MAX = 120; // 1分あたり120リクエスト

export function checkRateLimit(req: NextRequest): boolean {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }

  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

export function rateLimitResponse() {
  return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
}

// 共通エラーラッパー
export function apiError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

// CORSヘッダー付きレスポンス
export function apiResponse(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Access-Control-Allow-Origin": process.env.CORS_ORIGIN || "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    },
  });
}

// CORS preflight
export function handleOptions() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": process.env.CORS_ORIGIN || "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    },
  });
}
