// src/lib/youtube.ts

export type VideoMeta = {
  videoId: string;
  title: string;
  channelTitle: string;
  publishedAt?: string;
  thumbnailUrl?: string;
};

export type YouTubeComment = {
  text: string;
  authorDisplayName: string;
  publishedAt: string;
  likeCount: number;
};

export async function fetchVideoMeta(opts: { apiKey: string; videoId: string }): Promise<VideoMeta | null> {
  const { apiKey, videoId } = opts;

  const url =
    `https://www.googleapis.com/youtube/v3/videos` +
    `?part=snippet&id=${encodeURIComponent(videoId)}` +
    `&key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data?.error?.message ?? "YouTube videos.list failed");
  }

  const item = data?.items?.[0];
  if (!item) return null;

  const sn = item.snippet;
  const thumbs = sn?.thumbnails ?? {};
  const best =
    thumbs.maxres?.url ||
    thumbs.standard?.url ||
    thumbs.high?.url ||
    thumbs.medium?.url ||
    thumbs.default?.url;

  return {
    videoId,
    title: sn?.title ?? videoId,
    channelTitle: sn?.channelTitle ?? "",
    publishedAt: sn?.publishedAt,
    thumbnailUrl: best,
  };
}

export async function fetchTopLevelComments(opts: { apiKey: string; videoId: string; maxComments: number }): Promise<YouTubeComment[]> {
  const { apiKey, videoId, maxComments } = opts;

  const url =
    `https://www.googleapis.com/youtube/v3/commentThreads` +
    `?part=snippet&videoId=${encodeURIComponent(videoId)}` +
    `&maxResults=${Math.min(100, maxComments)}&key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data?.error?.message ?? "YouTube commentThreads.list failed");
  }

  const comments: YouTubeComment[] = [];
  for (const item of data?.items ?? []) {
    const sn = item.snippet.topLevelComment.snippet;
    comments.push({
      text: sn.textDisplay,
      authorDisplayName: sn.authorDisplayName,
      publishedAt: sn.publishedAt,
      likeCount: sn.likeCount,
    });
  }

  return comments;
}
