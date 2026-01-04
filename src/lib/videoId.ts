// src/lib/videoId.ts
export function extractYouTubeVideoId(input: string): string | null {
  // Accept raw ID as well (11 chars typical), or full URL
  const trimmed = input.trim();

  // If user pasted an ID directly
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "");

  // youtu.be/<id>
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  }

  // youtube.com/watch?v=<id>
  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    const v = url.searchParams.get("v");
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;

    // youtube.com/shorts/<id>
    const parts = url.pathname.split("/").filter(Boolean);
    const shortsIdx = parts.indexOf("shorts");
    if (shortsIdx >= 0 && parts[shortsIdx + 1]) {
      const id = parts[shortsIdx + 1];
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
  }

  return null;
}
