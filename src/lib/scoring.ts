// src/lib/scoring.ts
import type { YouTubeComment } from "./youtube";

export type ScoredComment = YouTubeComment & {
  botScore: number;     // 0..100
  flags: string[];
};

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\bwww\.\S+/g, " ")
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
  // Works in modern Node/JS: extended pictographic set
  return countMatches(/\p{Extended_Pictographic}/gu, s);
}

function hasPunctBurst(s: string): boolean {
  return /[!?.,]{4,}/.test(s) || /(!!+|\?\?+)/.test(s);
}

function hasLinkLike(s: string): boolean {
  return /(https?:\/\/|www\.)/i.test(s) || /\b[a-z0-9-]+\.(com|net|org|io|ru|xyz|top)\b/i.test(s);
}

function keywordFlags(text: string): string[] {
  const t = text.toLowerCase();

  const flags: string[] = [];
  const add = (label: string, cond: boolean) => cond && flags.push(label);

  add("promo/cta", /\b(subscribe|follow|channel|giveaway|promo|discount|free)\b/.test(t));
  add("scam-ish contact", /\b(whatsapp|telegram|dm me|inbox|contact me)\b/.test(t));
  add("money/crypto", /\b(crypto|bitcoin|invest|profit|forex|trading)\b/.test(t));
  add("adult/spam bait", /\b(sexy|dating|hot girls|onlyfans)\b/.test(t));

  return flags;
}

export function scoreComments(comments: YouTubeComment[]): ScoredComment[] {
  // Duplicate / template detection across the fetched set
  const normCount = new Map<string, number>();
  for (const c of comments) {
    const n = normalizeText(c.text);
    if (!n) continue;
    normCount.set(n, (normCount.get(n) ?? 0) + 1);
  }

  return comments.map((c) => {
    const flags: string[] = [];
    let score = 0;

    const text = c.text ?? "";
    const n = normalizeText(text);

    const dup = n ? (normCount.get(n) ?? 1) : 1;
    if (dup >= 3) {
      score += 25;
      flags.push(`template/duplicate x${dup}`);
    }

    // Links
    if (hasLinkLike(text)) {
      score += 30;
      flags.push("contains link/domain");
    }

    // Emoji spam
    const eCount = emojiCount(text);
    if (eCount >= 7) {
      score += 15;
      flags.push(`many emojis (${eCount})`);
    }

    // Uppercase shouting
    const uRatio = uppercaseRatio(text);
    if (text.length >= 12 && uRatio >= 0.6) {
      score += 10;
      flags.push(`high uppercase (${Math.round(uRatio * 100)}%)`);
    }

    // Punctuation bursts
    if (hasPunctBurst(text)) {
      score += 10;
      flags.push("punctuation burst");
    }

    // Keyword patterns
    const kf = keywordFlags(text);
    for (const f of kf) {
      flags.push(f);
      if (f === "promo/cta") score += 15;
      if (f === "scam-ish contact") score += 30;
      if (f === "money/crypto") score += 20;
      if (f === "adult/spam bait") score += 25;
    }

    // Very short generic praise (weak signal)
    const tLower = text.toLowerCase().trim();
    if (text.length <= 25 && /\b(nice|great|amazing|love it|awesome|wow)\b/.test(tLower)) {
      score += 8;
      flags.push("generic short praise");
    }

    // Cap and floor
    score = Math.max(0, Math.min(100, score));

    return {
      ...c,
      botScore: score,
      flags,
    };
  });
}

export function summarize(scored: ScoredComment[]) {
  const total = scored.length;
  const suspicious = scored.filter((c) => c.botScore >= 60).length;
  const pctSuspicious = total ? Math.round((suspicious / total) * 1000) / 10 : 0;

  // Top flags
  const flagCounts = new Map<string, number>();
  for (const c of scored) {
    for (const f of c.flags) {
      flagCounts.set(f, (flagCounts.get(f) ?? 0) + 1);
    }
  }
  const topFlags = [...flagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([flag, count]) => ({ flag, count }));

  return { total, suspicious, pctSuspicious, topFlags };
}
