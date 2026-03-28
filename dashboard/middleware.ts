import { NextRequest, NextResponse } from "next/server";

/**
 * 簡易認証ミドルウェア
 *
 * DASHBOARD_PASSWORD が設定されている場合:
 * - Cookie "auth" が一致しなければ /api/auth にリダイレクト
 * - /api/* はAPIキー認証で保護（既存）
 * - /api/cron は CRON_SECRET で保護（既存）
 *
 * DASHBOARD_PASSWORD が未設定: 認証なし（開発用）
 */

export function middleware(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next(); // 未設定時はスキップ

  const { pathname } = req.nextUrl;

  // API, _next, public assets はスキップ
  if (pathname.startsWith("/api/") || pathname.startsWith("/_next/") || pathname.startsWith("/icons/") || pathname === "/sw.js" || pathname === "/manifest.json" || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  // 認証チェック
  const authCookie = req.cookies.get("dashboard_auth")?.value;
  if (authCookie === password) {
    return NextResponse.next();
  }

  // 認証ページへリダイレクト
  const loginUrl = new URL("/api/auth", req.url);
  loginUrl.searchParams.set("redirect", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!api|_next|icons|sw\\.js|manifest\\.json|favicon\\.ico).*)"],
};
