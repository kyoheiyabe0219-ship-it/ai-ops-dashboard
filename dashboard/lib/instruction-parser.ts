/**
 * 指示構造化エンジン
 *
 * ユーザーの曖昧な自然言語を strategy / constraints / goal に分解
 * → CEOに構造化入力として渡す
 *
 * 優先順位: constraint > goal > strategy
 */

export type StructuredInstruction = {
  strategy: string | null;
  constraints: string[];
  goal: string | null;
  goalValue: number | null; // 数値目標（円）
};

// ============================================================
// キーワード辞書
// ============================================================

const STRATEGY_PATTERNS: { regex: RegExp; label: string }[] = [
  { regex: /増やす|拡大|攻める|強化|伸ばす|成長|スケール|scale/i, label: "拡大・成長" },
  { regex: /収益|稼ぐ|マネタイズ|売上|利益/i, label: "収益最大化" },
  { regex: /新しい|新規|開拓|探索|チャレンジ/i, label: "新規開拓" },
  { regex: /効率|最適化|改善|optimize/i, label: "効率最適化" },
  { regex: /コンテンツ|記事|動画|ブログ|SEO/i, label: "コンテンツ戦略" },
  { regex: /横展開|展開|コピー|複製|量産/i, label: "横展開・量産" },
];

const CONSTRAINT_PATTERNS: { regex: RegExp; label: string; weight_key: string }[] = [
  { regex: /リスク.*(抑|低|避|減)|安全|慎重/i, label: "リスク低減", weight_key: "risk_weight" },
  { regex: /コスト.*(抑|低|減)|安く|節約/i, label: "コスト削減", weight_key: "cost" },
  { regex: /安定|維持|守|保守/i, label: "安定性重視", weight_key: "stability_weight" },
  { regex: /速|早|急|すぐ|短期/i, label: "スピード重視", weight_key: "short_term_weight" },
  { regex: /品質|質|クオリティ/i, label: "品質重視", weight_key: "quality" },
  { regex: /失敗.*(しない|避|防)/i, label: "失敗回避", weight_key: "risk_weight" },
];

const GOAL_PATTERNS: { regex: RegExp; extract: (text: string) => { label: string; value: number | null } }[] = [
  {
    regex: /(\d+)\s*万\s*(円|\/月|目標)?/,
    extract: (text) => {
      const m = text.match(/(\d+)\s*万/);
      const v = m ? parseInt(m[1]) * 10000 : null;
      return { label: `月${m?.[1]}万円`, value: v };
    }
  },
  {
    regex: /(\d+)\s*(円|\/月)/,
    extract: (text) => {
      const m = text.match(/(\d+)\s*円/);
      return { label: `${m?.[1]}円`, value: m ? parseInt(m[1]) : null };
    }
  },
  {
    regex: /(\d+)\s*(PV|pv|ページビュー)/,
    extract: (text) => {
      const m = text.match(/(\d+)\s*(万)?\s*(PV|pv)/);
      const pv = m ? (m[2] ? parseInt(m[1]) * 10000 : parseInt(m[1])) : null;
      return { label: `${m?.[1]}${m?.[2] || ""}PV`, value: pv ? pv * 5 : null }; // 1PV=5円
    }
  },
  {
    regex: /目標|達成|いきたい|したい|なりたい/,
    extract: (text) => ({ label: text.replace(/(目標|達成|いきたい|したい|なりたい|に|を|は)/g, "").trim(), value: null })
  },
];

// ============================================================
// 解析
// ============================================================

export function parseInstruction(input: string): StructuredInstruction {
  const text = input.trim();

  // Strategy抽出
  let strategy: string | null = null;
  for (const p of STRATEGY_PATTERNS) {
    if (p.regex.test(text)) { strategy = p.label; break; }
  }

  // Constraints抽出（複数可）
  const constraints: string[] = [];
  for (const p of CONSTRAINT_PATTERNS) {
    if (p.regex.test(text)) constraints.push(p.label);
  }

  // Goal抽出
  let goal: string | null = null;
  let goalValue: number | null = null;
  for (const p of GOAL_PATTERNS) {
    if (p.regex.test(text)) {
      const { label, value } = p.extract(text);
      goal = label;
      goalValue = value;
      break;
    }
  }

  return { strategy, constraints, goal, goalValue };
}

// ============================================================
// 制約 → goal_function weight調整マップ
// ============================================================

export function constraintsToWeightAdjustments(constraints: string[]): Record<string, number> {
  const adj: Record<string, number> = {};
  for (const c of constraints) {
    const pattern = CONSTRAINT_PATTERNS.find(p => p.label === c);
    if (pattern) {
      adj[pattern.weight_key] = (adj[pattern.weight_key] || 0) + 0.05;
    }
  }
  return adj;
}

// ============================================================
// 構造化指示 → CEOプロンプト文字列
// ============================================================

export function instructionToPrompt(inst: StructuredInstruction): string {
  let prompt = "";

  if (inst.goal) {
    prompt += `【目標】${inst.goal}${inst.goalValue ? `（${inst.goalValue.toLocaleString()}円相当）` : ""}\n`;
  }

  if (inst.constraints.length > 0) {
    prompt += `【制約条件】${inst.constraints.join("、")}\n`;
    prompt += `※ 上記制約を必ず守ること。違反する提案は禁止。\n`;
  }

  if (inst.strategy) {
    prompt += `【戦略方針】${inst.strategy}\n`;
  }

  if (!prompt) {
    prompt = "【自由判断】特に制約なし。CEO判断で最適な計画を立案してください。\n";
  }

  return prompt;
}
