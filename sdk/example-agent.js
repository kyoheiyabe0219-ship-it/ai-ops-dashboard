/**
 * エージェント実装例
 * 起動 → 処理中 → 完了 の流れを再現
 */
const { reportStatus } = require("./reportStatus");

const AGENT_ID = "A1";
const AGENT_NAME = "市場リサーチAI";

async function main() {
  // 1. 起動時
  await reportStatus({
    agent_id: AGENT_ID,
    name: AGENT_NAME,
    status: "running",
    task: "競合分析",
    progress: 0,
  });

  // 2. 処理中（5秒ごとにprogress更新）
  for (let p = 20; p <= 80; p += 20) {
    await new Promise((r) => setTimeout(r, 5000));
    await reportStatus({
      agent_id: AGENT_ID,
      name: AGENT_NAME,
      status: "running",
      task: "競合分析",
      progress: p,
    });
    console.log(`Progress: ${p}%`);
  }

  // 3. 完了
  await reportStatus({
    agent_id: AGENT_ID,
    name: AGENT_NAME,
    status: "done",
    task: "競合分析",
    progress: 100,
  });

  console.log("Done!");
}

main().catch(async (err) => {
  // 4. エラー時
  console.error(err);
  await reportStatus({
    agent_id: AGENT_ID,
    name: AGENT_NAME,
    status: "error",
    task: err.message,
    progress: 0,
  });
});
