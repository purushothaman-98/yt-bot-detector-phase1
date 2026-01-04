// src/lib/youtube.ts
export type YouTubeComment = {
  commentId: string;
  authorName: string;
  authorChannelId: string | null;
  text: string;
  likeCount: number;
  publishedAt: string;
};

type YouTubeApiThreadItem = {
  id: string;
  snippet: {
    topLevelComment: {
      id: string;
      snippet: {
        authorDisplayName: string;
        authorChannelId?: { value?: string };
        textDisplay?: string;
        textOriginal?: string;
        likeCount?: number;
        publishedAt?: string;
      };
    };
  };
};

export async function fetchTopLevelComments(params: {
  videoId: string;
  apiKey: string;
  maxComments: number;
}): Promise<YouTubeComment[]> {
  const { videoId, apiKey, maxComments } = params;

  const comments: YouTubeComment[] = [];
  let pageToken: string | undefined = undefined;

  while (comments.length < maxComments) {
    const remaining = maxComments - comments.length;
    const maxResults = Math.min(100, Math.max(1, remaining)); // API allows 1..100 :contentReference[oaicite:2]{index=2}

    const url = new URL("https://www.googleapis.com/youtube/v3/commentThreads");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("videoId", videoId);
    url.searchParams.set("maxResults", String(maxResults));
    url.searchParams.set("textFormat", "plainText");
    url.searchParams.set("order", "relevance");
    url.searchParams.set("key", apiKey);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString(), { method: "GET" });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `YouTube API error (${res.status}): ${text || res.statusText}`
      );
    }

    const data = (await res.json()) as {
      items?: YouTubeApiThreadItem[];
      nextPageToken?: string;
    };

    const items = data.items ?? [];
    for (const it of items) {
      const s = it?.snippet?.topLevelComment?.snippet;
      if (!s) continue;

      comments.push({
        commentId: it.snippet.topLevelComment.id,
        authorName: s.authorDisplayName ?? "Unknown",
        authorChannelId: s.authorChannelId?.value ?? null,
        text: s.textOriginal ?? s.textDisplay ?? "",
        likeCount: s.likeCount ?? 0,
        publishedAt: s.publishedAt ?? "",
      });

      if (comments.length >= maxComments) break;
    }

    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  return comments;
}
