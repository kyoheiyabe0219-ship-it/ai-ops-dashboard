/**
 * エージェント共通SDK — タスク取得・更新（収益最適化対応）
 */

const DISPATCHER_URL =
  process.env.DISPATCHER_URL || "http://localhost:3001";

async function fetchMyTasks(agentId, status) {
  const params = new URLSearchParams({ assigned_to: agentId });
  if (status) params.set("status", status);

  const res = await fetch(`${DISPATCHER_URL}/tasks?${params}`);
  if (!res.ok) throw new Error(`fetchMyTasks failed: ${res.status}`);
  return res.json();
}

async function fetchNextTask(agentId) {
  const res = await fetch(`${DISPATCHER_URL}/tasks/next/${agentId}`);
  if (!res.ok) throw new Error(`fetchNextTask failed: ${res.status}`);
  const body = await res.json();
  return body.task;
}

async function updateTaskStatus(taskId, status) {
  const res = await fetch(`${DISPATCHER_URL}/task/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`updateTaskStatus failed: ${res.status}`);
  return res.json();
}

async function reportTaskResult(taskId, { actual_value, cost }) {
  const res = await fetch(`${DISPATCHER_URL}/task/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "done", actual_value, cost }),
  });
  if (!res.ok) throw new Error(`reportTaskResult failed: ${res.status}`);
  return res.json();
}

module.exports = { fetchMyTasks, fetchNextTask, updateTaskStatus, reportTaskResult };
