"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import type { VideoMeta } from "@/lib/youtube";

type TopFlag = { flag: string; count: number };

type ApiComment = {
  commentId: string;
  authorName: string;
  authorChannelId: string | null;
  text: string;
  likeCount: number;
  publishedAt: string;
  botScore: number;
  flags: string[];
};

type ApiResponse = {
  videoId: string;
  fetched: number;
  threshold: number;
  summary: {
    total: number;
    suspicious: number;
    pctSuspicious: number;
    topFlags: TopFlag[];
  };
  comments: ApiComment[];
  video: VideoMeta | null;
  error?: string;
};

function downloadCsv(rows: ApiComment[], filename: string) {
  const header = [
    "commentId",
    "authorName",
    "authorChannelId",
    "publishedAt",
    "likeCount",
    "botScore",
    "flags",
    "text",
  ];

  const esc = (s: unknown) => {
    const str = String(s ?? "");
    // CSV escape
    if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };

  const csv = [
    header.join(","),
    ...rows.map((r) =>
      [
        r.commentId,
        r.authorName,
        r.authorChannelId ?? "",
        r.publishedAt,
        r.likeCount,
        r.botScore,
        (r.flags ?? []).join("; "),
        r.text,
      ].map(esc).join(",")
    ),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

export default function Page() {
  const [url, setUrl] = useState("");
  const [maxComments, setMaxComments] = useState(500);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [minScore, setMinScore] = useState(0);
  const [search, setSearch] = useState("");
  const [useAi, setUseAi] = useState(false);

  const filtered = useMemo(() => {
    const rows = data?.comments ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (r.botScore < minScore) return false;
      if (!q) return true;
      return (
        r.text.toLowerCase().includes(q) ||
        r.authorName.toLowerCase().includes(q) ||
        (r.flags ?? []).join(" ").toLowerCase().includes(q)
      );
    });
  }, [data, minScore, search]);

  async function analyze() {
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, maxComments, useAi }),
      });

      const json = (await res.json()) as ApiResponse;

      if (!res.ok) {
        setError(json?.error || "Request failed");
        setLoading(false);
        return;
      }

      setData(json);
      setMinScore(0);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Network error";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="text-2xl font-semibold">YouTube Comment Bot Detector — Phase 1</h1>
        <p className="mt-2 text-sm text-zinc-300">
          Server-side comment fetch + rule-based scoring (API key stays private).
        </p>

        <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="md:col-span-2">
              <label className="text-sm text-zinc-300">YouTube video URL (or 11-char video ID)</label>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=VIDEO_ID"
                className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-zinc-600"
              />
            </div>

            <div>
              <label className="text-sm text-zinc-300">Max comments</label>
              <input
                type="number"
                min={50}
                max={5000}
                value={maxComments}
                onChange={(e) => setMaxComments(Number(e.target.value))}
                className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-zinc-600"
              />
              <div className="mt-2">
                <label className="flex items-center text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={useAi}
                    onChange={(e) => setUseAi(e.target.checked)}
                    className="mr-2"
                  />
                  Enable AI analysis (requires GEMINI_API_KEY)
                </label>
              </div>
              <button
                onClick={analyze}
                disabled={loading || !url.trim()}
                className="mt-3 w-full rounded-xl bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 disabled:opacity-50"
              >
                {loading ? "Analyzing..." : "Analyze"}
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-xl border border-red-900 bg-red-950/40 p-3 text-sm text-red-200">
              {error}
            </div>
          )}
        </div>

        {data?.video && (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 flex gap-4 items-center">
            {data.video.thumbnailUrl && (
              <Image
                src={data.video.thumbnailUrl}
                alt="thumbnail"
                width={112}
                height={64}
                className="w-28 h-16 object-cover rounded-xl border border-white/10"
              />
            )}
            <div className="min-w-0">
              <div className="text-lg font-semibold truncate">{data.video.title}</div>
              <div className="text-white/70 text-sm truncate">{data.video.channelTitle}</div>
              {data.video.publishedAt && (
                <div className="text-white/50 text-xs">
                  {new Date(data.video.publishedAt).toLocaleString()}
                </div>
              )}
            </div>
          </div>
        )}

        {data && (
          <>
            <div className="mt-6 grid gap-4 md:grid-cols-4">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="text-xs text-zinc-400">Video ID</div>
                <div className="mt-1 font-mono text-sm">{data.videoId}</div>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="text-xs text-zinc-400">Fetched comments</div>
                <div className="mt-1 text-xl font-semibold">{data.fetched}</div>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="text-xs text-zinc-400">Suspicious (≥ {data.threshold})</div>
                <div className="mt-1 text-xl font-semibold">{data.summary.suspicious}</div>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
                <div className="text-xs text-zinc-400">% suspicious</div>
                <div className="mt-1 text-xl font-semibold">{data.summary.pctSuspicious}%</div>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-col gap-2 md:flex-row md:items-center">
                  <div className="text-sm text-zinc-300">Filters</div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-400">Min score</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={minScore}
                      onChange={(e) => setMinScore(Number(e.target.value))}
                      className="w-24 rounded-xl border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm outline-none focus:border-zinc-600"
                    />
                  </div>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search text / author / flags..."
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-zinc-600 md:w-96"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => downloadCsv(filtered, `yt-bot-scan-${data.videoId}.csv`)}
                    className="rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm hover:border-zinc-500"
                  >
                    Download CSV (filtered)
                  </button>
                </div>
              </div>

              {data.summary.topFlags?.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs text-zinc-400">Top flags</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {data.summary.topFlags.map((f) => (
                      <span
                        key={f.flag}
                        className="rounded-full border border-zinc-800 bg-zinc-950 px-3 py-1 text-xs text-zinc-200"
                      >
                        {f.flag} · {f.count}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-zinc-800 text-xs text-zinc-400">
                    <tr>
                      <th className="py-2 pr-4">Score</th>
                      <th className="py-2 pr-4">Author</th>
                      <th className="py-2 pr-4">Comment</th>
                      <th className="py-2 pr-4">Flags</th>
                      <th className="py-2 pr-4">Likes</th>
                      <th className="py-2 pr-4">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-900">
                    {filtered.map((r) => (
                      <tr key={r.commentId} className="align-top">
                        <td className="py-3 pr-4 font-semibold">{r.botScore}</td>
                        <td className="py-3 pr-4 whitespace-nowrap text-zinc-200">{r.authorName}</td>
                        <td className="py-3 pr-4 max-w-xl">
                          <div className="whitespace-pre-wrap text-zinc-100">{r.text}</div>
                        </td>
                        <td className="py-3 pr-4">
                          <div className="flex flex-wrap gap-2">
                            {(r.flags ?? []).slice(0, 6).map((f) => (
                              <span
                                key={f}
                                className="rounded-full border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-xs text-zinc-300"
                              >
                                {f}
                              </span>
                            ))}
                            {(r.flags ?? []).length > 6 && (
                              <span className="text-xs text-zinc-500">+{(r.flags ?? []).length - 6} more</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 pr-4">{r.likeCount}</td>
                        <td className="py-3 pr-4 whitespace-nowrap text-xs text-zinc-400">
                          {r.publishedAt ? new Date(r.publishedAt).toLocaleString() : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="mt-3 text-xs text-zinc-500">
                  Note: This is probabilistic. High score ≠ guaranteed bot; low score ≠ guaranteed human.
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
