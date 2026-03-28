import { NextRequest, NextResponse } from "next/server";

// GET: ログインフォーム表示
export async function GET(req: NextRequest) {
  const redirect = new URL(req.url).searchParams.get("redirect") || "/";
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Ops - Login</title>
<style>body{background:#030712;color:#fff;font-family:system-ui;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}
.box{background:#111827;padding:2rem;border-radius:1rem;border:1px solid #1f2937;width:300px}
h1{font-size:1.2rem;margin:0 0 1rem}input{width:100%;padding:.75rem;background:#1f2937;border:1px solid #374151;border-radius:.5rem;color:#fff;margin-bottom:1rem;box-sizing:border-box}
button{width:100%;padding:.75rem;background:#7c3aed;border:none;border-radius:.5rem;color:#fff;font-weight:600;cursor:pointer}button:hover{background:#6d28d9}</style></head>
<body><div class="box"><h1>🤖 AI Ops</h1><form method="POST" action="/api/auth">
<input type="hidden" name="redirect" value="${redirect}">
<input type="password" name="password" placeholder="パスワード" autofocus>
<button type="submit">ログイン</button></form></div></body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html" } });
}

// POST: パスワード検証
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const password = formData.get("password") as string;
  const redirect = (formData.get("redirect") as string) || "/";
  const expected = process.env.DASHBOARD_PASSWORD;

  if (!expected || password === expected) {
    const res = NextResponse.redirect(new URL(redirect, req.url));
    res.cookies.set("dashboard_auth", password || "", { httpOnly: true, secure: true, sameSite: "lax", maxAge: 86400 * 7 });
    return res;
  }

  // 失敗
  return NextResponse.redirect(new URL(`/api/auth?redirect=${redirect}&error=1`, req.url));
}
