// src/lib/scoring.ts
import type { YouTubeComment } from "./youtube";

export type ScoredComment = YouTubeComment & {
  botScore: number; // 0..100
  flags: string[];
};

// -------------------------
// Helpers
// -------------------------
function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function safeStr(x: any): string {
  return typeof x === "string" ? x : "";
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function stripUrls(s: string): string {
  // remove typical URL patterns for fingerprinting
  return s
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\bwww\.\S+/gi, " ")
    .replace(/\byoutu\.be\/\S+/gi, " ")
    .replace(/\byoutube\.com\/\S+/gi, " ");
}

function stripMentionsAndTags(s: string): string {
  return s
    .replace(/@\w+/g, " ")
    .replace(/#[\p{L}\p{N}_]+/gu, " ");
}

function stripPunctuation(s: string): string {
  // keep letters/numbers/spaces for fingerprint
  return s.replace(/[^\p{L}\p{N}\s]/gu, " ");
}

function normalizeForFingerprint(text: string): string {
  // Goal: detect repeated templates, so remove volatile tokens (urls/mentions) and punctuation
  const s = safeStr(text)
    .normalize("NFKD")
    .toLowerCase();
  return normalizeWhitespace(stripPunctuation(stripMentionsAndTags(stripUrls(s))));
}

function countMatches(re: RegExp, s: string): number {
  const m = s.match(re);
  return m ? m.length : 0;
}

function extractUrls(s: string): string[] {
  const urls: string[] = [];
  const re = /(https?:\/\/\S+)|(\bwww\.\S+)|(\byoutu\.be\/\S+)|(\byoutube\.com\/\S+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    urls.push(m[0]);
  }
  return urls;
}

function hasEmail(s: string): boolean {
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(s);
}

function hasPhoneLike(s: string): boolean {
  // fairly strict-ish: +country optional, 8-15 digits overall allowing spaces/dashes
  // avoids flagging years/dates too often
  const cleaned = s.replace(/[^\d+]/g, "");
  if (!cleaned) return false;

  // patterns like +91xxxxxxxxxx
  if (/^\+\d{8,15}$/.test(cleaned)) return true;

  // plain digit runs, but require >=10 digits and not too many plus signs
  const digitRuns = s.match(/\d{10,15}/g);
  return !!digitRuns && digitRuns.length > 0;
}

function uppercaseRatio(s: string): number {
  const letters = s.match(/[A-Za-z]/g);
  if (!letters || letters.length === 0) return 0;
  const uppers = s.match(/[A-Z]/g);
  return (uppers ? uppers.length : 0) / letters.length;
}

function emojiCount(s: string): number {
  // Works on modern Node (used by Next). Fallback if unsupported.
  try {
    const re = /\p{Extended_Pictographic}/gu;
    return countMatches(re, s);
  } catch {
    // very rough fallback
    return countMatches(/[\u{1F300}-\u{1FAFF}]/gu, s);
  }
}

function repeatedCharRun(s: string): number {
  // longest run of same character, e.g., "!!!!!!!!!" or "loooove"
  let best = 1;
  let cur = 1;
  for (let i = 1; i < s.length; i++) {
    if (s[i] === s[i - 1]) {
      cur++;
      best = Math.max(best, cur);
    } else {
      cur = 1;
    }
  }
  return best;
}

function repeatedWordCount(s: string): number {
  // count consecutive repeated words (simple)
  const words = normalizeWhitespace(s.toLowerCase()).split(" ").filter(Boolean);
  let reps = 0;
  for (let i = 1; i < words.length; i++) {
    if (words[i] === words[i - 1]) reps++;
  }
  return reps;
}

function hashtagCount(s: string): number {
  return countMatches(/#[\p{L}\p{N}_]+/gu, s);
}

function isMostlyNonLetters(text: string): boolean {
  const s = safeStr(text);
  const letters = countMatches(/[\p{L}]/gu, s);
  const total = s.length;
  if (total < 10) return false;
  return letters / total < 0.15; // mostly emojis/symbols/links
}

// -------------------------
// Keyword sets (tuned for Phase-1)
// -------------------------
const CONTACT_BAIT = [
  "whatsapp",
  "telegram",
  "t.me",
  "wa.me",
  "inbox",
  "dm me",
  "message me",
  "text me",
  "contact me",
  "call me",
  "reach me",
  "my number",
];

const PROMO_BAIT = [
  "subscribe",
  "sub4sub",
  "follow me",
  "check my channel",
  "visit my channel",
  "support my channel",
  "like and subscribe",
  "join my channel",
];

const SCAM_GIVEAWAY = [
  "giveaway",
  "winner",
  "won",
  "congratulations",
  "claim",
  "prize",
  "gift",
  "free",
  "limited offer",
  "urgent",
  "click",
  "link in bio",
];

const CRYPTO_INVEST = [
  "crypto",
  "bitcoin",
  "btc",
  "eth",
  "usdt",
  "forex",
  "investment",
  "trading",
  "profit",
  "earn",
  "double",
  "guaranteed",
  "airdrop",
];

const LINK_SHORTENERS = [
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "ow.ly",
  "is.gd",
  "cutt.ly",
  "rb.gy",
  "rebrand.ly",
  "shorturl.at",
];

function includesAny(textLower: string, needles: string[]): string[] {
  const hits: string[] = [];
  for (const n of needles) {
    if (textLower.includes(n)) hits.push(n);
  }
  return hits;
}

// -------------------------
// Main scoring
// -------------------------
export function scoreComments(comments: YouTubeComment[]): ScoredComment[] {
  // 1) Build fingerprint frequency map for template/duplicate detection
  const fpCount = new Map<string, number>();
  const fps: string[] = new Array(comments.length).fill("");

  for (let i = 0; i < comments.length; i++) {
    const text = safeStr((comments[i] as any).text ?? (comments[i] as any).comment ?? "");
    const fp = normalizeForFingerprint(text);
    fps[i] = fp;

    // Ignore extremely short fingerprints (avoid false duplicates like "nice")
    if (fp.length >= 18) {
      fpCount.set(fp, (fpCount.get(fp) ?? 0) + 1);
    }
  }

  // 2) Score each comment using improved heuristics + duplicate boost
  const out: ScoredComment[] = comments.map((c, idx) => {
    const text = safeStr((c as any).text ?? (c as any).comment ?? "");
    const textTrim = text.trim();
    const textLower = textTrim.toLowerCase();

    const flags: string[] = [];
    let points = 0;

    // --- Strong signals: links & contact ---
    const urls = extractUrls(textTrim);
    if (urls.length > 0) {
      const add = clamp(20 + urls.length * 10, 20, 55);
      points += add;
      flags.push(urls.length === 1 ? "contains link" : `contains links (${urls.length})`);
    }

    const shortenerHit = LINK_SHORTENERS.find((d) => textLower.includes(d));
    if (shortenerHit) {
      points += 18;
      flags.push("link shortener");
    }

    if (hasEmail(textTrim)) {
      points += 18;
      flags.push("email present");
    }

    if (hasPhoneLike(textTrim)) {
      points += 30;
      flags.push("phone number pattern");
    }

    const contactHits = includesAny(textLower, CONTACT_BAIT);
    if (contactHits.length > 0) {
      points += 28;
      flags.push("contact bait");
    }

    // --- Scam / giveaway / crypto ---
    const scamHits = includesAny(textLower, SCAM_GIVEAWAY);
    if (scamHits.length > 0) {
      points += clamp(14 + scamHits.length * 4, 14, 30);
      flags.push("giveaway/scam keywords");
    }

    const cryptoHits = includesAny(textLower, CRYPTO_INVEST);
    if (cryptoHits.length > 0) {
      points += clamp(14 + cryptoHits.length * 4, 14, 30);
      flags.push("crypto/invest keywords");
    }

    // --- Self promo (lower than scams) ---
    const promoHits = includesAny(textLower, PROMO_BAIT);
    if (promoHits.length > 0) {
      points += clamp(10 + promoHits.length * 3, 10, 22);
      flags.push("self-promo bait");
    }

    // --- Duplicate/template detection (big win) ---
    const fp = fps[idx];
    const freq = fp.length >= 18 ? (fpCount.get(fp) ?? 0) : 0;
    if (freq >= 3) {
      // scale with frequency; heavy because bot farms reuse templates
      const dupBoost = clamp(25 + Math.floor((freq - 3) * 6), 25, 60);
      points += dupBoost;
      flags.push(`template/duplicate x${freq}`);
    }

    // --- Style/format signals (lighter weights to reduce false positives) ---
    const em = emojiCount(textTrim);
    if (em >= 7) {
      points += em >= 15 ? 12 : 7;
      flags.push(`many emojis (${em})`);
    }

    const up = uppercaseRatio(textTrim);
    const letterCount = countMatches(/[A-Za-z]/g, textTrim);
    if (letterCount >= 10 && up >= 0.85) {
      points += up >= 0.95 ? 10 : 7;
      flags.push(`high uppercase (${Math.round(up * 100)}%)`);
    }

    const punct = countMatches(/[!?.,:;'"“”‘’()\[\]{}]/g, textTrim);
    if (punct >= 10) {
      points += 6;
      flags.push("punctuation burst");
    }

    const run = repeatedCharRun(textTrim);
    if (run >= 6) {
      points += run >= 10 ? 8 : 5;
      flags.push("repeated chars");
    }

    const reps = repeatedWordCount(textTrim);
    if (reps >= 2) {
      points += 6;
      flags.push("repeated words");
    }

    const tags = hashtagCount(textTrim);
    if (tags >= 5) {
      points += 6;
      flags.push(`many hashtags (${tags})`);
    }

    if (isMostlyNonLetters(textTrim)) {
      points += 6;
      flags.push("mostly symbols/emojis");
    }

    // --- Length sanity (small tweaks) ---
    const len = textTrim.length;
    if (len <= 4) {
      points += 3;
      flags.push("very short");
    } else if (len >= 280) {
      // long spam walls sometimes
      points += 4;
      flags.push("very long");
    }

    // --- Convert points to 0..100 score ---
    // Keep linear but capped; points already weighted to be meaningful.
    const botScore = clamp(Math.round(points), 0, 100);

    return {
      ...(c as any),
      botScore,
      flags,
    } as ScoredComment;
  });

  return out;
}

// -------------------------
// Summary for UI
// -------------------------
export type Summary = {
  total: number;
  suspicious: number;
  suspiciousPct: number;
  topFlags: { flag: string; count: number }[];
};

export function summarize(scored: ScoredComment[], threshold = 60): Summary {
  const total = scored.length;
  const suspicious = scored.filter((c) => c.botScore >= threshold).length;
  const suspiciousPct = total === 0 ? 0 : Math.round((suspicious / total) * 1000) / 10;

  const counts = new Map<string, number>();
  for (const c of scored) {
    for (const f of c.flags) {
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
  }

  const topFlags = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([flag, count]) => ({ flag, count }));

  return { total, suspicious, suspiciousPct, topFlags };
}
