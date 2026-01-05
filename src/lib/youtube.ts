// src/lib/youtube.ts

export type YouTubeComment = {
  id: string;
  author: string;
  text: string;
  likeCount: number;
  publishedAt: string;
  authorChannelId?: string;
  authorProfileImageUrl?: string;
};

export type YouTubeVideoMeta = {
  id: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  thumbnailUrl: string;
};

async function ytFetch(url: string) {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`YouTube API error (${res.status}): ${text.slice(0, 500)}`);
  return JSON.parse(text) as any;
}

export async function fetchVideoMeta(args: {
  apiKey: string;
  videoId: string;
}): Promise<YouTubeVideoMeta> {
  const { apiKey, videoId } = args;

  const url =
    "https://www.googleapis.com/youtube/v3/videos" +
    `?part=snippet&id=${encodeURIComponent(videoId)}` +
    `&key=${encodeURIComponent(apiKey)}`;

  const data = await ytFetch(url);

  const item = data?.items?.[0];
  if (!item) throw new Error("Video not found (check video ID / API key permissions).");

  const sn = item.snippet;
  const thumbs = sn?.thumbnails ?? {};
  const thumb =
    thumbs.maxres?.url ||
    thumbs.standard?.url ||
    thumbs.high?.url ||
    thumbs.medium?.url ||
    thumbs.default?.url ||
    "";

  return {
    id: item.id,
    title: sn?.title ?? "",
    channelTitle: sn?.channelTitle ?? "",
    publishedAt: sn?.publishedAt ?? "",
    thumbnailUrl: thumb,
  };
}

export async function fetchTopLevelComments(args: {
  apiKey: string;
  videoId: string;
  maxComments: number;
}): Promise<YouTubeComment[]> {
  const { apiKey, videoId, maxComments } = args;

  const out: YouTubeComment[] = [];
  let pageToken: string | undefined;

  // YouTube API maxResults max is 100
  const pageSize = Math.min(100, Math.max(1, Math.floor(maxComments)));

  while (out.length < maxComments) {
    const url =
      "https://www.googleapis.com/youtube/v3/commentThreads" +
      `?part=snippet&videoId=${encodeURIComponent(videoId)}` +
      `&maxResults=${pageSize}` +
      `&textFormat=plainText` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "") +
      `&key=${encodeURIComponent(apiKey)}`;

    const data = await ytFetch(url);

    const items = data?.items ?? [];
    for (const it of items) {
      const c = it?.snippet?.topLevelComment;
      const cs = c?.snippet;
      if (!c?.id || !cs) continue;

      out.push({
        id: c.id,
        author: cs.authorDisplayName ?? "",
        text: cs.textDisplay ?? "",
        likeCount: Number(cs.likeCount ?? 0),
        publishedAt: cs.publishedAt ?? "",
        authorChannelId: cs.authorChannelId?.value ?? undefined,
        authorProfileImageUrl: cs.authorProfileImageUrl ?? undefined,
      });

      if (out.length >= maxComments) break;
    }

    pageToken = data?.nextPageToken;
    if (!pageToken) break;
  }

  return out;
}
