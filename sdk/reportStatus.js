/**
 * エージェント共通SDK — reportStatus
 *
 * 使い方:
 *   const { reportStatus } = require("../sdk/reportStatus");
 *   await reportStatus({ agent_id: "A1", name: "市場リサーチAI", status: "running", task: "競合分析", progress: 45 });
 */

const DISPATCHER_URL =
  process.env.DISPATCHER_URL || "http://localhost:3001";

async function reportStatus({ agent_id, name, status, task, progress }) {
  const res = await fetch(`${DISPATCHER_URL}/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_id, name, status, task, progress }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`reportStatus failed: ${res.status} ${err}`);
  }

  return res.json();
}

module.exports = { reportStatus };
