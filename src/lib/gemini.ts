// src/lib/gemini.ts

export type GeminiItem = {
  idx: number;
  author: string;
  text: string;
  likes: number;
  publishedAt: string;
  ruleScore: number;
  flags: string[];
};

export type GeminiPerComment = {
  idx: number;
  ai_score: number; // 0..100
  label: "bot" | "human" | "uncertain";
  reason: string;
};

export type GeminiReport = {
  summary: {
    bot_likelihood: number; // 0..100
    notes: string;
  };
  per_comment: GeminiPerComment[];
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("Gemini response not valid JSON");
  }
}

export async function geminiBotAnalyze(args: {
  apiKey: string;
  model: string;
  videoId: string;
  items: GeminiItem[];
}): Promise<GeminiReport> {
  const { apiKey, model, videoId, items } = args;

  const responseJsonSchema = {
    type: "object",
    properties: {
      summary: {
        type: "object",
        properties: {
          bot_likelihood: { type: "integer", minimum: 0, maximum: 100 },
          notes: { type: "string" },
        },
        required: ["bot_likelihood", "notes"],
      },
      per_comment: {
        type: "array",
        items: {
          type: "object",
          properties: {
            idx: { type: "integer" },
            ai_score: { type: "integer", minimum: 0, maximum: 100 },
            label: { type: "string", enum: ["bot", "human", "uncertain"] },
            reason: { type: "string" },
          },
          required: ["idx", "ai_score", "label", "reason"],
        },
      },
    },
    required: ["summary", "per_comment"],
  };

  const prompt = `
Return ONLY valid JSON matching the provided schema. No markdown, no extra text.

You are classifying YouTube comments for bot-likeness.

Video ID: ${videoId}

Items:
${items
  .map(
    (it) => `idx:${it.idx}
author:${it.author}
likes:${it.likes}
publishedAt:${it.publishedAt}
ruleScore:${it.ruleScore}
flags:${(it.flags || []).join(", ")}
text:${it.text.replace(/\s+/g, " ").slice(0, 700)}
`
  )
  .join("\n")}
`.trim();

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048,

        // ✅ forces JSON
        responseMimeType: "application/json",
        responseJsonSchema,
      },
    }),
  });

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`Gemini API error (${res.status}): ${rawText.slice(0, 500)}`);
  }

  const wrapper = JSON.parse(rawText) as any;
  const text =
    wrapper?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";

  if (!text.trim()) throw new Error("Gemini returned empty output");

  const parsed = safeJsonParse(text);

  const report: GeminiReport = {
    summary: {
      bot_likelihood: clamp(Number(parsed?.summary?.bot_likelihood ?? 0), 0, 100),
      notes: String(parsed?.summary?.notes ?? ""),
    },
    per_comment: Array.isArray(parsed?.per_comment)
      ? parsed.per_comment.map((p: any) => ({
          idx: Number(p.idx),
          ai_score: clamp(Number(p.ai_score ?? 0), 0, 100),
          label:
            p.label === "bot" || p.label === "human" || p.label === "uncertain"
              ? p.label
              : "uncertain",
          reason: String(p.reason ?? ""),
        }))
      : [],
  };

  return report;
}
