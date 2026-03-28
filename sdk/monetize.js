/**
 * エージェント共通SDK — マネタイゼーション実行
 *
 * 使い方:
 *   const { executeMonetization } = require("./monetize");
 *
 *   // WordPress記事投稿
 *   await executeMonetization({
 *     task_id: "xxx",
 *     platform: "wordpress",
 *     title: "おすすめガジェット5選",
 *     content: "<p>記事本文...</p>",
 *     wp_status: "publish",
 *     revenue: 3000,
 *   });
 *
 *   // WordPress + アフィリエイトリンク付き
 *   await executeMonetization({
 *     task_id: "xxx",
 *     platform: "wordpress",
 *     title: "おすすめガジェット5選",
 *     content: "<p>記事本文...</p>",
 *     wp_status: "publish",
 *     revenue: 5000,
 *     affiliate: {
 *       title: "Apple AirPods Pro",
 *       amazonUrl: "B0D1XD1ZV3",
 *       description: "ノイキャン最強のイヤホン",
 *     },
 *   });
 */

const DISPATCHER_URL =
  process.env.DISPATCHER_URL || "http://localhost:3001";

async function executeMonetization(params) {
  const res = await fetch(`${DISPATCHER_URL}/execute-monetization`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`executeMonetization failed: ${res.status} ${err}`);
  }

  return res.json();
}

async function getMonetizationLogs(filters = {}) {
  const params = new URLSearchParams(filters);
  const res = await fetch(`${DISPATCHER_URL}/monetization-logs?${params}`);
  if (!res.ok) throw new Error(`getMonetizationLogs failed: ${res.status}`);
  return res.json();
}

async function getMonetizationStats() {
  const res = await fetch(`${DISPATCHER_URL}/monetization-stats`);
  if (!res.ok) throw new Error(`getMonetizationStats failed: ${res.status}`);
  return res.json();
}

module.exports = { executeMonetization, getMonetizationLogs, getMonetizationStats };
