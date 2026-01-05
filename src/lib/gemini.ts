// src/lib/gemini.ts

type GeminiInputItem = {
  idx: number;
  author: string;
  text: string;
  likes: number;
  publishedAt: string;
  ruleScore: number;
  flags: string[];
};

type GeminiResult = {
  summary: {
    verdict: "bot-heavy" | "mixed" | "mostly-human";
    confidence: number; // 0–100
  };
  per_comment: Array<{
    idx: number;
    ai_score: number; // 0–100
    label: "bot" | "human" | "uncertain";
    reason: string;
  }>;
};

/**
 * Extract the first valid JSON object from a text blob
 */
function extractJson(text: string): any {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("No JSON object found in Gemini response");
  }
  return JSON.parse(match[0]);
}

export async function geminiBotAnalyze({
  apiKey,
  model,
  videoId,
  items,
}: {
  apiKey: string;
  model: string;
  videoId: string;
  items: GeminiInputItem[];
}): Promise<GeminiResult> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const prompt = `
You are a bot-detection system.

TASK:
Analyze YouTube comments and decide whether they are bot-generated or human.

STRICT RULES:
- Output ONLY valid JSON
- No markdown
- No explanation outside JSON
- Follow the schema EXACTLY

SCHEMA:
{
  "summary": {
    "verdict": "bot-heavy" | "mixed" | "mostly-human",
    "confidence": number
  },
  "per_comment": [
    {
      "idx": number,
      "ai_score": number,
      "label": "bot" | "human" | "uncertain",
      "reason": string
    }
  ]
}

VIDEO_ID: ${videoId}

COMMENTS:
${JSON.stringify(items, null, 2)}
`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini HTTP error ${res.status}: ${errText}`);
  }

  const raw = await res.json();

  const text =
    raw?.candidates?.[0]?.content?.parts
      ?.map((p: any) => p.text)
      .join("") ?? "";

  if (!text) {
    throw new Error("Empty Gemini response");
  }

  try {
    return extractJson(text) as GeminiResult;
  } catch (e) {
    console.error("Raw Gemini output:", text);
    throw new Error("Gemini response not valid JSON");
  }
}
