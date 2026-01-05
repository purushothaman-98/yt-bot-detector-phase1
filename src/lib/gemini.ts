// src/lib/gemini.ts
export type GeminiPerComment = {
  idx: number;
  ai_score: number; // 0..100
  label: "bot" | "human" | "uncertain";
  reason: string;
};

export type GeminiBotReport = {
  overall_bot_pct: number; // 0..100
  verdict: "bot-heavy" | "mixed" | "mostly-human" | "uncertain";
  key_signals: string[];
  per_comment: GeminiPerComment[];
};

function stripCodeFences(s: string) {
  return s.replace(/```json\s*/i, "").replace(/```/g, "").trim();
}

export async function geminiBotAnalyze(opts: {
  apiKey: string;
  model?: string;
  videoId: string;
  // we send reduced objects only
  items: Array<{
    idx: number;
    author: string;
    text: string;
    likes: number;
    publishedAt: string;
    ruleScore: number;
    flags: string[];
  }>;
}): Promise<GeminiBotReport> {
  const model = opts.model || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent`;

  const system = `
You are analyzing YouTube comments to detect bots/spam.
Return STRICT JSON ONLY (no markdown, no backticks).
Be conservative: do not label excited fans as bots unless there are strong signs (links, contact bait, repeated templates, scams).
`;

  const schemaHint = `
JSON schema:
{
  "overall_bot_pct": number,
  "verdict": "bot-heavy" | "mixed" | "mostly-human" | "uncertain",
  "key_signals": string[],
  "per_comment": [
    { "idx": number, "ai_score": number, "label": "bot" | "human" | "uncertain", "reason": string }
  ]
}
Rules:
- ai_score 0..100
- Keep reason short (<= 140 chars)
- per_comment length must match provided list length
`;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          { text: system.trim() },
          { text: schemaHint.trim() },
          {
            text: `Video: ${opts.videoId}\nComments:\n${JSON.stringify(
              opts.items,
              null,
              2
            )}`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1200,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": opts.apiKey,
    },
    body: JSON.stringify(payload),
  });

  const data: any = await res.json();

  if (!res.ok) {
    const msg = data?.error?.message || "Gemini request failed";
    throw new Error(msg);
  }

  const text =
    data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join("\n") ??
    "";

  if (!text) throw new Error("Gemini returned empty response");

  let parsed: any;
  try {
    parsed = JSON.parse(stripCodeFences(text));
  } catch {
    // If Gemini ever returns extra text, try to salvage JSON object
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("Gemini response not valid JSON");
    parsed = JSON.parse(stripCodeFences(m[0]));
  }

  // basic validation & normalization
  const report: GeminiBotReport = {
    overall_bot_pct: Math.max(0, Math.min(100, Number(parsed.overall_bot_pct ?? 0))),
    verdict: parsed.verdict ?? "uncertain",
    key_signals: Array.isArray(parsed.key_signals) ? parsed.key_signals.slice(0, 12) : [],
    per_comment: Array.isArray(parsed.per_comment) ? parsed.per_comment : [],
  };

  // normalize per_comment
  report.per_comment = report.per_comment.map((x: any) => ({
    idx: Number(x.idx),
    ai_score: Math.max(0, Math.min(100, Number(x.ai_score ?? 0))),
    label: x.label === "bot" || x.label === "human" ? x.label : "uncertain",
    reason: String(x.reason ?? "").slice(0, 200),
  }));

  return report;
}
