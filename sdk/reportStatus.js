/**
 * エージェント共通SDK — reportStatus
 *
 * 使い方:
 *   const { reportStatus } = require("../sdk/reportStatus");
 *   await reportStatus({ agent_id: "A1", name: "市場リサーチAI", status: "running", task: "競合分析", progress: 45 });
 */

const DISPATCHER_URL =
  process.env.DISPATCHER_URL || "https://dashboard-zeta-flame-74.vercel.app/api";
const API_SECRET = process.env.API_SECRET || "";

async function reportStatus({ agent_id, name, status, task, progress }) {
  const headers = { "Content-Type": "application/json" };
  if (API_SECRET) headers["x-api-key"] = API_SECRET;

  const res = await fetch(`${DISPATCHER_URL}/update`, {
    method: "POST",
    headers,
    body: JSON.stringify({ agent_id, name, status, task, progress }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`reportStatus failed: ${res.status} ${err}`);
  }

  return res.json();
}

module.exports = { reportStatus };
