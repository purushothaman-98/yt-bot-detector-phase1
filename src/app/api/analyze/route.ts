// src/app/api/analyze/route.ts
import { NextResponse } from "next/server";
import { extractYouTubeVideoId } from "@/lib/videoId";
import { fetchTopLevelComments, fetchVideoMeta } from "@/lib/youtube";
import { scoreComments, summarize } from "@/lib/scoring";
export const runtime = "nodejs";

type AnalyzeRequest = {
  url: string;
  maxComments?: number;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AnalyzeRequest;

    const url = (body.url ?? "").trim();
    const maxComments = Math.max(50, Math.min(5000, Number(body.maxComments ?? 500)));

    const videoId = extractYouTubeVideoId(url);
    if (!videoId) {
      return NextResponse.json(
        { error: "Invalid YouTube URL (or video ID). Please paste a full video link." },
        { status: 400 }
      );
    }

    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing server env var: YOUTUBE_API_KEY" },
        { status: 500 }
      );
    }
    const video = await fetchVideoMeta({ apiKey, videoId });

    const comments = await fetchTopLevelComments({ videoId, apiKey, maxComments });
    const scored = scoreComments(comments);
    const summary = summarize(scored);

    // Sort high-score first by default
    scored.sort((a, b) => b.botScore - a.botScore);

    return NextResponse.json({
      video,
      videoId,
      fetched: comments.length,
      summary,
      comments: scored,
      threshold: 60,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
