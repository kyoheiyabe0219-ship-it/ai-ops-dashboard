/**
 * ブログ投稿エージェント
 *
 * タスクを受け取り → WordPress記事として投稿 → 収益ログ記録
 * タスクの content をそのまま記事タイトルとして使用。
 * 実運用では Claude API で記事本文を生成する想定。
 */
const { reportStatus } = require("./reportStatus");
const { fetchNextTask, updateTaskStatus } = require("./taskClient");
const { executeMonetization } = require("./monetize");

const AGENT_ID = "BLOG1";
const AGENT_NAME = "ブログ投稿AI";
const POLL_INTERVAL = 5000;

async function processTask(task) {
  console.log(`[${AGENT_ID}] タスク開始: ${task.content}`);

  await updateTaskStatus(task.id, "running");
  await reportStatus({
    agent_id: AGENT_ID,
    name: AGENT_NAME,
    status: "running",
    task: task.content,
    progress: 0,
  });

  // Step 1: 記事本文を準備（30%）
  await reportStatus({
    agent_id: AGENT_ID,
    name: AGENT_NAME,
    status: "running",
    task: `${task.content} — 記事作成中`,
    progress: 30,
  });

  // 実運用では Claude API で生成。ここではタスク内容から記事を構成
  const articleTitle = task.content;
  const articleContent = `
    <h2>${task.content}</h2>
    <p>この記事はAIエージェントによって自動生成されました。</p>
    <p>タスクID: ${task.id}</p>
    <p>期待価値: ¥${task.expected_value || 0}</p>
    <p>作成日時: ${new Date().toISOString()}</p>
  `.trim();

  // Step 2: WordPressに投稿（70%）
  await reportStatus({
    agent_id: AGENT_ID,
    name: AGENT_NAME,
    status: "running",
    task: `${task.content} — WordPress投稿中`,
    progress: 70,
  });

  const result = await executeMonetization({
    task_id: task.id,
    platform: "wordpress",
    title: articleTitle,
    content: articleContent,
    wp_status: "draft",
    revenue: task.expected_value || 0,
  });

  console.log(`[${AGENT_ID}] 投稿完了:`, result.result?.external_url || "URL取得失敗");

  // Step 3: 完了（100%）
  await updateTaskStatus(task.id, "done");
  await reportStatus({
    agent_id: AGENT_ID,
    name: AGENT_NAME,
    status: "done",
    task: `${task.content} — 投稿完了`,
    progress: 100,
  });

  console.log(`[${AGENT_ID}] タスク完了: ${task.content}`);
}

async function pollLoop() {
  await reportStatus({
    agent_id: AGENT_ID,
    name: AGENT_NAME,
    status: "idle",
    task: "",
    progress: 0,
  });
  console.log(`[${AGENT_ID}] 起動。ブログタスク待機中...`);

  while (true) {
    try {
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
