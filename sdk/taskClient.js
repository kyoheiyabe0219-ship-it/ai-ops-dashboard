/**
 * エージェント共通SDK — タスク取得・更新（収益最適化対応）
 */

const DISPATCHER_URL =
  process.env.DISPATCHER_URL || "https://dashboard-zeta-flame-74.vercel.app/api";
const API_SECRET = process.env.API_SECRET || "";

async function fetchMyTasks(agentId, status) {
  const params = new URLSearchParams({ assigned_to: agentId });
  if (status) params.set("status", status);

  const headers = {};
  if (API_SECRET) headers["x-api-key"] = API_SECRET;
  const res = await fetch(`${DISPATCHER_URL}/tasks?${params}`, { headers });
  if (!res.ok) throw new Error(`fetchMyTasks failed: ${res.status}`);
  return res.json();
}

async function fetchNextTask(agentId) {
  const headers = {};
  if (API_SECRET) headers["x-api-key"] = API_SECRET;
  const res = await fetch(`${DISPATCHER_URL}/tasks/next/${agentId}`, { headers });
  if (!res.ok) throw new Error(`fetchNextTask failed: ${res.status}`);
  const body = await res.json();
  return body.task;
}

async function updateTaskStatus(taskId, status) {
  const headers = { "Content-Type": "application/json" };
  if (API_SECRET) headers["x-api-key"] = API_SECRET;
  const res = await fetch(`${DISPATCHER_URL}/task/${taskId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`updateTaskStatus failed: ${res.status}`);
  return res.json();
}

async function reportTaskResult(taskId, { actual_value, cost }) {
  const headers = { "Content-Type": "application/json" };
  if (API_SECRET) headers["x-api-key"] = API_SECRET;
  const res = await fetch(`${DISPATCHER_URL}/task/${taskId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ status: "done", actual_value, cost }),
  });
  if (!res.ok) throw new Error(`reportTaskResult failed: ${res.status}`);
  return res.json();
}

module.exports = { fetchMyTasks, fetchNextTask, updateTaskStatus, reportTaskResult };
