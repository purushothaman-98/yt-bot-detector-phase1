// src/app/api/analyze/route.ts
import { NextResponse } from "next/server";
import { extractYouTubeVideoId } from "@/lib/videoId";
import { fetchTopLevelComments, fetchVideoMeta } from "@/lib/youtube";
import { scoreComments, summarize } from "@/lib/scoring";
import type { GeminiReport } from "@/lib/gemini";
import { geminiBotAnalyze } from "@/lib/gemini";

export const runtime = "nodejs";

type AnalyzeRequest = {
  url: string;
  maxComments?: number;
  useAi?: boolean;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AnalyzeRequest;

    const url = (body.url ?? "").trim();
    const maxComments = Math.max(50, Math.min(5000, Number(body.maxComments ?? 500)));
    const useAi = Boolean(body.useAi);

    const videoId = extractYouTubeVideoId(url);
    if (!videoId) {
      return NextResponse.json(
        { error: "Invalid YouTube URL (or video ID). Please paste a full video link." },
        { status: 400 }
      );
    }

    const ytKey = process.env.YOUTUBE_API_KEY;
    if (!ytKey) {
      return NextResponse.json({ error: "Missing server env var: YOUTUBE_API_KEY" }, { status: 500 });
    }

    const video = await fetchVideoMeta({ apiKey: ytKey, videoId });

    const comments = await fetchTopLevelComments({ videoId, apiKey: ytKey, maxComments });
    const scored = scoreComments(comments);

    scored.sort((a, b) => b.botScore - a.botScore);
    const summary = summarize(scored);

    let aiReport: GeminiReport | null = null;

    if (useAi) {
      const geminiKey = process.env.GEMINI_API_KEY;
      if (!geminiKey) {
        return NextResponse.json({ error: "Missing server env var: GEMINI_API_KEY" }, { status: 500 });
      }
      const geminiModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";

      const MAX_AI = 30;
      const candidates = scored.slice(0, MAX_AI);

      const items = candidates.map((c, i) => ({
        idx: i,
        author: c.author ?? "",
        text: c.text ?? "",
        likes: c.likeCount ?? 0,
        publishedAt: c.publishedAt ?? "",
        ruleScore: c.botScore,
        flags: c.flags ?? [],
      }));

      aiReport = await geminiBotAnalyze({
        apiKey: geminiKey,
        model: geminiModel,
        videoId,
        items,
      });

      const aiMap = new Map<number, GeminiReport["per_comment"][number]>();
      for (const p of aiReport.per_comment) aiMap.set(p.idx, p);

      candidates.forEach((c, j) => {
        const a = aiMap.get(j);
        c.ai = a
          ? { score: a.ai_score, label: a.label, reason: a.reason }
          : { score: null, label: "uncertain", reason: "" };
      });
    }

    return NextResponse.json({
      video,
      videoId,
      fetched: comments.length,
      summary,
      comments: scored,
      threshold: 60,
      aiReport,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
