"use client";

import { useState } from "react";

export default function Home() {
  const [url, setUrl] = useState("");
  const [maxComments, setMaxComments] = useState(500);
  const [useAi, setUseAi] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function analyze() {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          maxComments,
          useAi, // ✅ THIS IS THE LINE YOU ASKED ABOUT
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed");

      setResult(data);
    } catch (err: any) {
      setError(err.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-2xl font-semibold">
          YouTube Comment Bot Analyzer
        </h1>

        <div className="space-y-3">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste YouTube video URL"
            className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2"
          />

          <div className="flex gap-4 items-center">
            <input
              type="number"
              value={maxComments}
              min={50}
              max={5000}
              onChange={(e) => setMaxComments(Number(e.target.value))}
              className="w-32 rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2"
            />

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={useAi}
                onChange={(e) => setUseAi(e.target.checked)}
              />
              Gemini AI analysis
            </label>
          </div>

          <button
            onClick={analyze}
            disabled={loading || !url}
            className="rounded-lg bg-white text-black px-4 py-2 disabled:opacity-50"
          >
            {loading ? "Analyzing..." : "Analyze"}
          </button>
        </div>

        {error && (
          <div className="text-red-400 text-sm">{error}</div>
        )}

        {result && (
          <div className="mt-6 space-y-4">
            <div className="rounded-lg bg-zinc-900 p-4">
              <div className="font-medium">{result.video?.title}</div>
              <div className="text-sm text-zinc-400">
                {result.video?.channelTitle}
              </div>
            </div>

            <div className="rounded-lg bg-zinc-900 p-4 text-sm">
              <div>Total comments: {result.fetched}</div>
              <div>
                Suspicious: {result.summary?.suspicious} (
                {result.summary?.suspiciousPct}%)
              </div>
            </div>

            {result.aiReport && (
              <div className="rounded-lg bg-zinc-900 p-4">
                <div className="font-medium">Gemini AI verdict</div>
                <div className="text-sm text-zinc-300">
                  {result.aiReport.verdict} · Bot %
                  {result.aiReport.overall_bot_pct}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
