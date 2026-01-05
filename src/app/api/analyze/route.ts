// src/app/api/analyze/route.ts
import { NextResponse } from "next/server";
import { extractYouTubeVideoId } from "@/lib/videoId";
import { fetchTopLevelComments, fetchVideoMeta } from "@/lib/youtube";
import { scoreComments, summarize } from "@/lib/scoring";
import { geminiBotAnalyze } from "@/lib/gemini";

export const runtime = "nodejs";

type AnalyzeRequest = {
  url: string;
  maxComments?: number;
  useAi?: boolean; // ✅ add this
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

    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing server env var: YOUTUBE_API_KEY" }, { status: 500 });
    }

    // Optional Gemini env (only required if useAi=true)
    const geminiKey = process.env.GEMINI_API_KEY;
    const geminiModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";

    // Fetch video metadata + comments
    const video = await fetchVideoMeta({ apiKey, videoId });
    const comments = await fetchTopLevelComments({ videoId, apiKey, maxComments });

    // Rule scoring
    const scored = scoreComments(comments);
    const summary = summarize(scored); // or summarize(scored, 60) if you added threshold param

    // Gemini AI report (optional)
    let aiReport: any = null;

    if (useAi) {
      if (!geminiKey) {
        return NextResponse.json(
          { error: "Missing server env var: GEMINI_API_KEY" },
          { status: 500 }
        );
      }

      // Send only top candidates to control cost/time
      const MAX_AI = 30; // 20–50 is sensible
      const candidates = [...scored].sort((a, b) => b.botScore - a.botScore).slice(0, MAX_AI);

      // Build minimal payload to Gemini
      const items = candidates.map((c, i) => ({
        idx: i,
        author: (c as any).authorName ?? "", // ✅ your type uses authorName
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

      // Attach Gemini per-comment result back into candidates
      const aiMap = new Map<number, any>();
      (aiReport?.per_comment ?? []).forEach((p: any) => aiMap.set(Number(p.idx), p));

      candidates.forEach((c, j) => {
        const a = aiMap.get(j);
        (c as any).ai = a
          ? { score: a.ai_score, label: a.label, reason: a.reason }
          : { score: null, label: "uncertain", reason: "" };
      });
    }

    // Sort for UI (rule score high → low)
    scored.sort((a, b) => b.botScore - a.botScore);

    return NextResponse.json({
      video,
      videoId,
      fetched: comments.length,
      summary,
      comments: scored,
      threshold: 60,
      aiReport, // ✅ include in response
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
