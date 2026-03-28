/**
 * チャットコマンドパーサー v2
 *
 * 戦略系・抽象指示対応
 * 優先順位: create_run > improve_run > execute_run > status > errors > roi > agent_list > run_decision > create_tasks > fallback(create_run)
 */

export type ParsedCommand =
  | { type: "create_run"; title: string; goal: string; expectedValue: number }
  | { type: "improve_run" }
  | { type: "execute_run" }
  | { type: "deploy_content"; title: string }
  | { type: "create_tasks"; tasks: { content: string; priority: string; expected_value: number; cost: number }[] }
  | { type: "status" }
  | { type: "errors" }
  | { type: "roi_report" }
  | { type: "agent_list" }
  | { type: "run_decision" }
  | { type: "unknown"; original: string };

// ============================================================
// 抽出ヘルパー
// ============================================================

function extractCount(text: string): number {
  const match = text.match(/(\d+)\s*[件本個つ]/);
  if (match) return Math.min(parseInt(match[1]), 10);
  return 1;
}

function extractPriority(text: string): string {
  if (/急ぎ|至急|最優先|high/i.test(text)) return "high";
  if (/低|後で|余裕|low/i.test(text)) return "low";
  return "medium";
}

function extractValue(text: string): number {
  const match = text.match(/(\d+)\s*万\s*円?/);
  if (match) return parseInt(match[1]) * 10000;
  const match2 = text.match(/(\d+)\s*円/);
  if (match2) return parseInt(match2[1]);
  // PV系から価値推定
  const pvMatch = text.match(/(\d+)\s*万?\s*(PV|pv|ページビュー)/);
  if (pvMatch) {
    const pv = pvMatch[0].includes("万") ? parseInt(pvMatch[1]) * 10000 : parseInt(pvMatch[1]);
    return pv * 5; // 1PV = 5円で推定
  }
  return 0;
}

function extractTaskContent(text: string): string {
  let content = text
    .replace(/(\d+)\s*[件本個つ]\s*(作って|やって|頼む|お願い|して|生成|作成|追加)/g, "")
    .replace(/(作って|やって|頼む|お願い|して|生成|作成|追加|実行)/g, "")
    .replace(/[をにのが]/g, " ")
    .replace(/急ぎで|至急|高優先|低優先/g, "")
    .replace(/\d+万?円/g, "")
    .trim();
  if (!content || content.length < 2) content = text.replace(/(やって|して|頼む|お願い)/g, "").trim();
  return content;
}

// ============================================================
// メインパーサー
// ============================================================

export function parseCommand(input: string): ParsedCommand {
  const text = input.trim();

  // ① create_run（戦略・計画系） — 最優先
  if (/戦略|プラン|計画|考えて|設計|方針|どうやる|立案|構想|企画|ロードマップ|roadmap|strategy|plan/i.test(text)) {
    return {
      type: "create_run",
      title: text.length > 30 ? text.substring(0, 30) + "..." : text,
      goal: text,
      expectedValue: extractValue(text),
    };
  }

  // ② improve_run（改善系）
  if (/改善|ブラッシュアップ|良くして|もっと良|直して|修正して|やり直|リファイン|improve|refine/i.test(text)) {
    return { type: "improve_run" };
  }

  // ③ execute_run（実行系）
  if (/実行して|進めて|GO|やれ|承認|通して|開始して|始めて|launch|execute|approve/i.test(text)) {
    return { type: "execute_run" };
  }

  // ③b deploy_content（コンテンツ展開）
  if (/展開|マルチ|チャネル|複数|配信|deploy|distribute|レバレッジ/i.test(text)) {
    const title = text.replace(/(展開|して|を|に|で|マルチ|チャネル|複数|配信)/g, "").trim() || text;
    return { type: "deploy_content", title };
  }

  // ④ status
  if (/今[のは]?[状どう]|状況|どうなってる|ステータス|status/i.test(text)) {
    return { type: "status" };
  }

  // ⑤ errors
  if (/問題|エラー|error|異常|アラート|alert|ヤバい|障害/i.test(text)) {
    return { type: "errors" };
  }

  // ⑥ roi_report（確認系のみ。「上げて」「増やす」はcreate_run）
  if (/ROI|revenue|profit/i.test(text) || (/(収益|売上|利益)/.test(text) && /(見せ|教え|確認|レポート|どう|いくら)/.test(text))) {
    return { type: "roi_report" };
  }

  // ⑦ agent_list
  if (/エージェント|agent|誰が|メンバー|チーム/i.test(text)) {
    return { type: "agent_list" };
  }

  // ⑧ run_decision
  if (/判断|決定|最適化|decision|optimize/i.test(text)) {
    return { type: "run_decision" };
  }

  // ⑨ create_tasks（具体的タスク生成）
  if (/やって|して|作って|頼む|お願い|生成|作成|追加|タスク/i.test(text)) {
    const count = extractCount(text);
    const priority = extractPriority(text);
    const value = extractValue(text);
    const content = extractTaskContent(text);

    const tasks = Array.from({ length: count }, (_, i) => ({
      content: count > 1 ? `${content} #${i + 1}` : content,
      priority,
      expected_value: value,
      cost: 0,
    }));

    return { type: "create_tasks", tasks };
  }

  // ⑩ フォールバック: 2文字以上ならcreate_runとして扱う
  if (text.length >= 2) {
    return {
      type: "create_run",
      title: text.length > 30 ? text.substring(0, 30) + "..." : text,
      goal: text,
      expectedValue: extractValue(text),
    };
  }

  return { type: "unknown", original: text };
}

// ============================================================
// レスポンス生成
// ============================================================

export function generateResponse(command: ParsedCommand, context: {
  agents?: { id: string; name: string; status: string; task: string; progress: number }[];
  tasks?: { content: string; status: string; roi: number }[];
  alerts?: { type: string; title: string; is_read: boolean }[];
  stats?: { total_tasks: number; avg_roi: number; net_profit: number };
  createdTasks?: number;
  decisionResult?: { total_actions: number };
  createdRun?: { id: string; title: string; score: number; status: string };
  improvedRun?: { id: string; score: number; iteration: number };
  executedRun?: { id: string; created: number };
  deployedContent?: { contentId: string; deployments: number; tasks: number };
}): string {

  switch (command.type) {
    case "create_run": {
      const r = context.createdRun;
      if (r) {
        return `🧠 CEOが計画を立案中...\n\nRun: ${r.title}\nスコア: ${r.score}点\nステータス: ${r.status === "awaiting_approval" ? "承認待ち" : "思考中"}\n\n${r.status === "awaiting_approval" ? "→ 🔄 Runs タブで計画を確認・承認してください" : "→ 思考ループ継続中"}`;
      }
      return "🧠 計画を立案しています...";
    }

    case "improve_run": {
      const r = context.improvedRun;
      if (r) {
        return `🔄 計画を改善しました\n\nイテレーション: #${r.iteration}\n新スコア: ${r.score}点\n\n→ 🔄 Runs タブで確認してください`;
      }
      return "🔄 改善対象のRunがありません";
    }

    case "execute_run": {
      const r = context.executedRun;
      if (r) {
        return `⚡ 計画を実行に移しました\n\n生成タスク: ${r.created}件\n→ Workerが自動的に処理を開始します`;
      }
      return "⚡ 実行可能な承認済みRunがありません";
    }

    case "deploy_content": {
      const d = context.deployedContent;
      if (d) return `🔀 コンテンツを${d.deployments}チャネルに展開しました\n\n生成タスク: ${d.tasks}件\n→ 各チャネルのWorkerが処理を開始します`;
      return "🔀 展開処理を実行中...";
    }

    case "create_tasks":
      return `✅ ${context.createdTasks || command.tasks.length}件のタスクを作成しました。\n${command.tasks.map((t) => `  📌 ${t.content}（${t.priority}）`).join("\n")}\n\n自動割り振り済みです。`;

    case "status": {
      const a = context.agents || [];
      const running = a.filter((x) => x.status === "running");
      const errored = a.filter((x) => x.status === "error");
      const t = context.tasks || [];
      const pending = t.filter((x) => x.status === "pending");

      let msg = `📊 現在の状況\n\n`;
      msg += `🤖 エージェント: ${a.length}人（${running.length}稼働 / ${errored.length}エラー）\n`;
      running.forEach((r) => { msg += `  🟢 ${r.name} → ${r.task} (${r.progress}%)\n`; });
      errored.forEach((r) => { msg += `  🔴 ${r.name} → ${r.task}\n`; });
      msg += `\n📌 タスク: ${t.length}件（${pending.length}件待機）`;
      if (context.stats) {
        msg += `\n💰 平均ROI: ${context.stats.avg_roi}x / 純利益: ¥${context.stats.net_profit.toLocaleString()}`;
      }
      return msg;
    }

    case "errors": {
      const unread = (context.alerts || []).filter((a) => !a.is_read);
      if (unread.length === 0) return "✅ 未読アラートはありません。";
      let msg = `⚠️ ${unread.length}件の未読アラート\n\n`;
      unread.slice(0, 5).forEach((a) => {
        const icon = a.type === "error" ? "🔴" : a.type === "warning" ? "🟡" : "🔵";
        msg += `${icon} ${a.title}\n`;
      });
      return msg;
    }

    case "roi_report": {
      const t = context.tasks || [];
      const done = t.filter((x) => x.status === "done" && x.roi > 0).sort((a, b) => b.roi - a.roi);
      let msg = `💰 ROIレポート\n\n`;
      if (context.stats) {
        msg += `平均ROI: ${context.stats.avg_roi}x\n純利益: ¥${context.stats.net_profit.toLocaleString()}\n\n`;
      }
      msg += `🏆 Top ROIタスク:\n`;
      done.slice(0, 5).forEach((d, i) => { msg += `  ${i + 1}. ${d.content} — ${d.roi.toFixed(1)}x\n`; });
      if (done.length === 0) msg += "  完了タスクなし";
      return msg;
    }

    case "agent_list": {
      const a = context.agents || [];
      let msg = `🤖 エージェント一覧（${a.length}人）\n\n`;
      a.forEach((agent) => {
        const icon = agent.status === "running" ? "🟢" : agent.status === "error" ? "🔴" : "⚪";
        msg += `${icon} ${agent.name} [${agent.id}] — ${agent.status}`;
        if (agent.task) msg += ` → ${agent.task}`;
        msg += "\n";
      });
      return msg;
    }

    case "run_decision":
      if (context.decisionResult) {
        return `🧠 意思決定エンジンを実行しました。\n結果: ${context.decisionResult.total_actions}件のアクション`;
      }
      return "🧠 実行中...";

    case "unknown":
      return `🤔 「${command.original}」を理解できませんでした。\n\n💡 例:\n  🧠 「〇〇の戦略考えて」→ CEO計画立案\n  📌 「〇〇を3件やって」→ タスク作成\n  📊 「今の状況は？」→ 状態確認`;
  }
}
