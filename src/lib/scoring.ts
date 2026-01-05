// src/lib/scoring.ts
import type { YouTubeComment } from "./youtube";

export type AiOnComment = {
  score: number | null;
  label: "bot" | "human" | "uncertain";
  reason: string;
};

export type ScoredComment = YouTubeComment & {
  botScore: number; // 0..100
  flags: string[];
  ai?: AiOnComment;
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function normalizeText(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/@\w+|\bwww\.\S+/g, " ")
    .trim();
}

function countMatches(re: RegExp, s: string): number {
  const m = s.match(re);
  return m ? m.length : 0;
}

function uppercaseRatio(s: string): number {
  const letters = s.match(/[A-Za-z]/g);
  if (!letters || letters.length === 0) return 0;
  const uppers = s.match(/[A-Z]/g);
  return (uppers ? uppers.length : 0) / letters.length;
}

function emojiCount(s: string): number {
  // Unicode property class; works in modern Node/JS
  return countMatches(/\p{Extended_Pictographic}/gu, s);
}

function hasSpamKeywords(s: string): boolean {
  const t = normalizeText(s);
  return (
    /\b(telegram|whatsapp|dm me|direct message|contact me|invest|crypto|forex|profit|giveaway|earn|winner|promote|promo)\b/.test(
      t
    ) || /\b(bit\.ly|t\.me|wa\.me)\b/.test(t)
  );
}

function urlCount(s: string): number {
  return countMatches(/https?:\/\/\S+/g, s) + countMatches(/\bwww\.\S+/g, s);
}

export function scoreComments(comments: YouTubeComment[]): ScoredComment[] {
  // Template/duplicate detection based on normalized text frequency
  const freq = new Map<string, number>();
  for (const c of comments) {
    const key = normalizeText(c.text);
    if (!key) continue;
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }

  const scored: ScoredComment[] = comments.map((c) => {
    const flags: string[] = [];
    let score = 0;

    const text = c.text ?? "";
    const norm = normalizeText(text);

    // 1) Links
    const links = urlCount(text);
    if (links >= 1) {
      score += 25;
      flags.push(`contains link (${links})`);
    }

    // 2) Spam keywords
    if (hasSpamKeywords(text)) {
      score += 20;
      flags.push("spam keywords");
    }

    // 3) Emoji burst
    const e = emojiCount(text);
    if (e >= 8) {
      score += 12;
      flags.push(`many emojis (${e})`);
    } else if (e >= 5) {
      score += 7;
      flags.push(`many emojis (${e})`);
    }

    // 4) Excess punctuation
    const punct = countMatches(/[!?.,:;]+/g, text);
    if (punct >= 10) {
      score += 10;
      flags.push("punctuation burst");
    }

    // 5) Excess uppercase
    const up = uppercaseRatio(text);
    if (up >= 0.8 && text.length >= 10) {
      score += 12;
      flags.push(`high uppercase (${Math.round(up * 100)}%)`);
    }

    // 6) Very short generic praise (often bot-like)
    if (norm.length > 0 && norm.length <= 8) {
      score += 6;
      flags.push("very short");
    }

    // 7) Duplicate/template comments
    const f = norm ? (freq.get(norm) ?? 0) : 0;
    if (f >= 3) {
      score += 18;
      flags.push(`template/duplicate x${f}`);
    } else if (f === 2) {
      score += 10;
      flags.push("duplicate x2");
    }

    // 8) Low-effort author pattern (optional heuristic)
    // (Don't over-weight this; many legit users have numbers)
    if (/\d{4,}/.test(c.author ?? "")) {
      score += 4;
      flags.push("author has many digits");
    }

    score = clamp(score, 0, 100);

    return {
      ...c,
      botScore: score,
      flags,
    };
  });

  return scored;
}

export function summarize(scored: ScoredComment[]) {
  const threshold = 60;
  const suspicious = scored.filter((c) => c.botScore >= threshold).length;
  const total = scored.length || 1;
  const pct = Math.round((suspicious / total) * 100);

  const flagCounts = new Map<string, number>();
  for (const c of scored) {
    for (const f of c.flags) flagCounts.set(f, (flagCounts.get(f) ?? 0) + 1);
  }

  const topFlags = [...flagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([flag, count]) => ({ flag, count }));

  return {
    total,
    suspicious,
    percentSuspicious: pct,
    topFlags,
  };
}
