/**
 * Shared handling for probe responses that are media rather than text.
 *
 * Image/video/audio-generation targets return the generated asset as a base64
 * data URL in the same `response_text` field a chat target uses for its reply —
 * there is no separate media channel on LlmCall. Three views render that field
 * and only one of them knew that: the agent Runtime tab rendered real media,
 * while the findings panel and the artifact drawer printed the raw base64.
 *
 * That is not just ugly. A data URL is a single token with no whitespace, so
 * there is no break opportunity in it and CSS cannot wrap it — a truncated
 * 220-character slice still rendered as one 220-character-wide line that broke
 * out of its card and gave the whole page a horizontal scrollbar. And the bytes
 * themselves are worthless as evidence: no auditor can read a JPEG header.
 *
 * Detect the shape once here, and let each view decide whether it has room to
 * show the asset (`mediaFromResponseText`) or should describe it
 * (`describeMediaResponse`).
 */

const DATA_URL_MEDIA_RE = /^data:(image|video|audio)\/([a-zA-Z0-9.+-]+);base64,/;

export type ProbeMedia = {
  kind: "image" | "video" | "audio";
  /** The full data URL — safe to hand to <img>/<video>/<audio> src. */
  url: string;
  /** Subtype from the MIME string, e.g. "jpeg", "png", "mp4". */
  format: string;
  /** Decoded size of the asset in bytes, derived from the base64 payload. */
  bytes: number;
};

/** Returns the media descriptor when `text` is a base64 data URL, else null. */
export function mediaFromResponseText(text: string | null | undefined): ProbeMedia | null {
  if (!text) return null;
  const trimmed = text.trim();
  const match = trimmed.match(DATA_URL_MEDIA_RE);
  if (!match) return null;

  // base64 encodes 3 bytes per 4 characters; trailing '=' padding is not data.
  const payload = trimmed.slice(trimmed.indexOf(",") + 1);
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  const bytes = Math.max(0, Math.floor((payload.length * 3) / 4) - padding);

  return { kind: match[1] as ProbeMedia["kind"], url: trimmed, format: match[2].toLowerCase(), bytes };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * One-line, human-readable stand-in for a media response — for views too compact
 * to render the asset. e.g. "JPEG image · 34 KB".
 */
export function describeMediaResponse(media: ProbeMedia): string {
  return `${media.format.toUpperCase()} ${media.kind} · ${formatBytes(media.bytes)}`;
}
