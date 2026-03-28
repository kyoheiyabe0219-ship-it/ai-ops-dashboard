/**
 * チャットコマンドパーサー
 * 自然言語 → 構造化コマンドに変換
 *
 * 将来的にOpenAI/Claude APIに差し替え可能な設計
 */

export type ParsedCommand =
  | { type: "create_tasks"; tasks: { content: string; priority: string; expected_value: number; cost: number }[] }
  | { type: "status" }
  | { type: "errors" }
  | { type: "roi_report" }
  | { type: "agent_list" }
  | { type: "run_decision" }
  | { type: "unknown"; original: string };

// 数量抽出
function extractCount(text: string): number {
  const match = text.match(/(\d+)\s*[件本個つ]/);
  if (match) return Math.min(parseInt(match[1]), 10); // 最大10件
  return 1;
}

// 優先度抽出
function extractPriority(text: string): string {
  if (/急ぎ|至急|最優先|high/i.test(text)) return "high";
  if (/低|後で|余裕|low/i.test(text)) return "low";
  return "medium";
}

// 価値抽出
function extractValue(text: string): number {
  const match = text.match(/(\d+)\s*万\s*円?/);
  if (match) return parseInt(match[1]) * 10000;
  const match2 = text.match(/(\d+)\s*円/);
  if (match2) return parseInt(match2[1]);
  return 0;
}

// タスク内容抽出（「〇〇を」「〇〇して」パターン）
function extractTaskContent(text: string): string {
  // 「〇〇を3件やって」→「〇〇」
  let content = text
    .replace(/(\d+)\s*[件本個つ]\s*(作って|やって|頼む|お願い|して|生成|作成|追加)/g, "")
    .replace(/(作って|やって|頼む|お願い|して|生成|作成|追加|実行)/g, "")
    .replace(/[をにのが]/g, " ")
    .replace(/急ぎで|至急|高優先|低優先/g, "")
    .replace(/\d+万?円/g, "")
    .trim();

  // 空の場合は元のテキストを使用
  if (!content || content.length < 2) content = text.replace(/(やって|して|頼む|お願い)/g, "").trim();
  return content;
}

export function parseCommand(input: string): ParsedCommand {
  const text = input.trim();

  // 状態確認
  if (/今[のは]?[状どう]|状況|どうなってる|ステータス|status/i.test(text)) {
    return { type: "status" };
  }

  // エラー確認
  if (/問題|エラー|error|異常|アラート|alert|ヤバい|障害/i.test(text)) {
    return { type: "errors" };
  }

  // ROI / 収益レポート
  if (/ROI|収益|売上|利益|儲|revenue|profit/i.test(text)) {
    return { type: "roi_report" };
  }

  // エージェント一覧
  if (/エージェント|agent|誰が|メンバー|チーム/i.test(text)) {
    return { type: "agent_list" };
  }

  // 意思決定実行
  if (/判断|決定|最適化|decision|optimize/i.test(text)) {
    return { type: "run_decision" };
  }

  // タスク生成（「〇〇やって」「〇〇して」「〇〇を作成」等）
  if (/やって|して|作って|頼む|お願い|生成|作成|追加|実行|タスク/i.test(text)) {
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

  return { type: "unknown", original: text };
}

// レスポンステンプレート生成
export function generateResponse(command: ParsedCommand, context: {
  agents?: { id: string; name: string; status: string; task: string; progress: number }[];
  tasks?: { content: string; status: string; roi: number }[];
  alerts?: { type: string; title: string; is_read: boolean }[];
  stats?: { total_tasks: number; avg_roi: number; net_profit: number };
  createdTasks?: number;
  decisionResult?: { total_actions: number };
}): string {
  switch (command.type) {
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
      if (unread.length === 0) return "✅ 未読アラートはありません。問題なく稼働中です。";
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
      if (done.length === 0) msg += "  まだ完了タスクがありません。";
      return msg;
    }

    case "agent_list": {
      const a = context.agents || [];
      let msg = `🤖 エージェント一覧（${a.length}人）\n\n`;
      a.forEach((agent) => {
        const icon = agent.status === "running" ? "🟢" : agent.status === "error" ? "🔴" : agent.status === "idle" ? "⚪" : "🔵";
        msg += `${icon} ${agent.name} [${agent.id}] — ${agent.status}`;
        if (agent.task) msg += ` → ${agent.task}`;
        msg += "\n";
      });
      return msg;
    }

    case "run_decision":
      if (context.decisionResult) {
        return `🧠 意思決定エンジンを実行しました。\n\n結果: ${context.decisionResult.total_actions}件のアクションを実行`;
      }
      return "🧠 意思決定エンジンを実行しています...";

    case "unknown":
      return `🤔 すみません、「${command.original}」の意味が分かりませんでした。\n\n以下のような指示ができます:\n  📌 「〇〇を3件やって」→ タスク作成\n  📊 「今の状況は？」→ 状態確認\n  ⚠️ 「問題ある？」→ エラー確認\n  💰 「ROIは？」→ 収益レポート\n  🤖 「エージェント見せて」→ 一覧\n  🧠 「最適化して」→ 意思決定実行`;
  }
}
