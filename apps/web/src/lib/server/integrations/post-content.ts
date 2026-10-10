import { stripHtml, truncate } from '@/lib/server/events/hook-utils'

type PostMedia = {
  kind: 'image' | 'video'
  url: string
  label: string
}

const VIDEO_FILE_RE = /\.(?:m4v|mov|mp4|webm)(?:[?#]|$)/i

function absoluteMediaUrl(rawUrl: string, rootUrl: string): string {
  const url = rawUrl.trim().replace(/^<|>$/g, '')
  if (!url.startsWith('/')) return url
  try {
    return new URL(url, `${rootUrl.replace(/\/$/, '')}/`).toString()
  } catch {
    return url
  }
}

function attribute(tag: string, name: string): string {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))
  return match?.[2] ?? ''
}

function fileName(url: string): string {
  try {
    const path = new URL(url, 'https://quackback.invalid').pathname
    return decodeURIComponent(path.split('/').pop() || 'recording')
  } catch {
    return 'recording'
  }
}

function safeAlt(raw: string): string {
  return raw.replace(/[\[\]\r\n]/g, ' ').trim()
}

function videoLabel(rawLabel: string, url: string): string {
  const label = safeAlt(rawLabel)
  return !label || label === url || label.startsWith('/') || /^https?:\/\//i.test(label)
    ? fileName(url)
    : label
}

/** Extract rich media before the legacy HTML-stripping step removes its tags. */
function extractMedia(content: string, rootUrl: string): PostMedia[] {
  const media: PostMedia[] = []
  const seen = new Set<string>()
  const add = (kind: PostMedia['kind'], rawUrl: string, label: string) => {
    const url = absoluteMediaUrl(rawUrl, rootUrl)
    if (!url || seen.has(url)) return
    seen.add(url)
    media.push({ kind, url, label: safeAlt(label) })
  }

  for (const match of content.matchAll(/<(img|video)\b[^>]*>/gi)) {
    const tag = match[0]
    const kind = match[1].toLowerCase() === 'video' ? 'video' : 'image'
    add(kind, attribute(tag, 'src'), attribute(tag, kind === 'video' ? 'title' : 'alt'))
  }

  for (const match of content.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)) {
    add('image', match[2], match[1])
  }

  for (const match of content.matchAll(/(?<!!)\[([^\]]*)\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)) {
    if (VIDEO_FILE_RE.test(match[2])) add('video', match[2], match[1])
  }

  return media
}

/** Make app-relative markdown assets fetchable outside Quackback, preserving formatting. */
export function absolutizeMarkdownUrls(
  content: string,
  rootUrl: string,
  embedVideos: boolean
): string {
  return content.replace(/(!?\[[^\]]*\]\()([^)\s]+)([^)]*\))/g, (_all, open, url, close) => {
    const absolute = absoluteMediaUrl(url, rootUrl)
    if (!embedVideos || !VIDEO_FILE_RE.test(absolute) || open.startsWith('!')) {
      return `${open}${absolute}${close}`
    }
    const label = videoLabel(open.slice(1, open.indexOf(']')), absolute)
    return `![Video: ${label}](${absolute}${close.slice(0, -1)})`
  })
}

function mediaMarkdown(media: PostMedia, embedVideos: boolean): string {
  if (media.kind === 'video') {
    return `${embedVideos ? '!' : ''}[Video: ${videoLabel(media.label, media.url)}](${media.url})`
  }
  return `![${media.label || 'Screenshot'}](${media.url})`
}

/** Keep media complete and fetchable even when the narrative is shortened. */
export function buildIntegrationPostContent(
  source: string,
  rootUrl: string,
  options: { embedVideos?: boolean; maxLength?: number } = {}
): string {
  const { embedVideos = false, maxLength = 2000 } = options
  const media = extractMedia(source, rootUrl)
  const markdown = absolutizeMarkdownUrls(stripHtml(source), rootUrl, embedVideos)
  let content = truncate(markdown, maxLength)
  if (markdown.length > maxLength) {
    const cutoff = maxLength - 3
    // Do not leave partial images/links as broken markup in the shortened narrative.
    for (const match of markdown.matchAll(/!?\[[^\]]*\]\([^)]+\)/g)) {
      if (match.index < cutoff && match.index + match[0].length > cutoff) {
        content = markdown.slice(0, match.index) + '...'
        break
      }
    }
  }
  const retained = new Set(extractMedia(content, rootUrl).map((item) => item.url))
  const omitted = media
    .filter((item) => !retained.has(item.url))
    .map((item) => mediaMarkdown(item, embedVideos))
  return [content, ...(omitted.length ? ['', '**Attachments**', ...omitted] : [])].join('\n')
}
