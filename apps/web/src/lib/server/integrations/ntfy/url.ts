/**
 * Parsing/validation for ntfy publish URLs.
 *
 * An ntfy "channel" is a full URL like `https://ntfy.sh/<topic>`. ntfy topic
 * names are restricted to `[-_A-Za-z0-9]`, max 64 chars — anything else (a
 * trailing slash, a multi-segment path like `/a/b`, spaces) is rejected by the
 * server with an opaque 400, so we validate up front.
 */
const TOPIC_RE = /^[A-Za-z0-9_-]{1,64}$/

export interface ParsedNtfyUrl {
  /** Scheme + host (+ port), e.g. `https://ntfy.sh`. Publish target is `${origin}/`. */
  origin: string
  /** The validated topic name. */
  topic: string
}

/**
 * Parse an ntfy publish URL into its origin and topic, validating the topic
 * against ntfy's allowed character set. Returns null if the URL is malformed or
 * the topic is missing/invalid (e.g. trailing slash, sub-path, illegal chars).
 */
export function parseNtfyUrl(url: string): ParsedNtfyUrl | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const topic = parsed.pathname.replace(/^\/+|\/+$/g, '')
  if (!TOPIC_RE.test(topic)) return null
  return { origin: parsed.origin, topic }
}
