/**
 * タスク駆動型エージェント（収益最適化版）
 *
 * 動作:
 * 1. 5秒ごとに ROI最適順の次タスクを取得
 * 2. タスク実行 → progress報告 → actual_value/cost を記録して完了
 */
const { reportStatus } = require("./reportStatus");
const { fetchNextTask, updateTaskStatus, reportTaskResult } = require("./taskClient");

const AGENT_ID = "W1";
const AGENT_NAME = "汎用ワーカーAI";
const POLL_INTERVAL = 5000;

async function processTask(task) {
  console.log(`[${AGENT_ID}] タスク開始: ${task.content} (期待価値: ¥${task.expected_value || 0}, コスト: ¥${task.cost || 0})`);

  await updateTaskStatus(task.id, "running");
  await reportStatus({
    agent_id: AGENT_ID,
    name: AGENT_NAME,
    status: "running",
    task: task.content,
    progress: 0,
  });

  // 処理シミュレーション（5段階 × 2秒）
  const startTime = Date.now();
  for (let p = 20; p <= 100; p += 20) {
    await new Promise((r) => setTimeout(r, 2000));
    await reportStatus({
      agent_id: AGENT_ID,
      name: AGENT_NAME,
      status: p === 100 ? "done" : "running",
      task: task.content,
      progress: p,
    });
    console.log(`[${AGENT_ID}] Progress: ${p}%`);
  }

  // 実績を記録（実際のシステムではここで成果を計測）
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const actualValue = task.expected_value || 0; // 実システムでは実測値
  const actualCost = task.cost || elapsed;       // 未設定なら経過秒数

  await reportTaskResult(task.id, {
    actual_value: actualValue,
    cost: actualCost,
  });

  console.log(`[${AGENT_ID}] タスク完了: ${task.content} (実績: ¥${actualValue}, コスト: ¥${actualCost})`);
}

async function pollLoop() {
  await reportStatus({
    agent_id: AGENT_ID,
    name: AGENT_NAME,
    status: "idle",
    task: "",
    progress: 0,
  });
  console.log(`[${AGENT_ID}] 起動。ROI最適タスクを待機中...`);

  while (true) {
    try {
      // ROI最適順で次のタスクを取得
      const task = await fetchNextTask(AGENT_ID);

      if (task) {
        await processTask(task);

        await reportStatus({
          agent_id: AGENT_ID,
          name: AGENT_NAME,
          status: "idle",
          task: "",
          progress: 0,
        });
      }
    } catch (err) {
      console.error(`[${AGENT_ID}] Error:`, err.message);
      await reportStatus({
        agent_id: AGENT_ID,
        name: AGENT_NAME,
        status: "error",
        task: err.message,
        progress: 0,
      });
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
}

pollLoop();
