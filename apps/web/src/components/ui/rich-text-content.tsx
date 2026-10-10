/** Read stored TipTap JSON without loading the editor or emoji dataset. */
import type { JSONContent } from '@tiptap/core'
import DOMPurify from 'dompurify'
import { cn } from '@/lib/shared/utils'
import { generateContentHTML } from '@/lib/shared/content-html'

interface RichTextContentProps {
  content: JSONContent
  className?: string
}

// DOMPurify config for sanitizing rendered TipTap HTML (defense-in-depth)
const DOMPURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'p',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'strong',
    'em',
    'u',
    's',
    'code',
    'pre',
    'a',
    'ul',
    'ol',
    'li',
    'blockquote',
    'hr',
    'br',
    'img',
    'iframe',
    'video',
    'div',
    'table',
    'tr',
    'th',
    'td',
    'input',
    'span',
  ],
  ALLOWED_ATTR: [
    'id',
    'href',
    'src',
    'alt',
    'class',
    'style',
    'target',
    'rel',
    'width',
    'height',
    'loading',
    'decoding',
    'frameborder',
    'allow',
    'allowfullscreen',
    'type',
    'title',
    'checked',
    'disabled',
    'controls',
    'start',
    'preload',
    'playsinline',
    'data-type',
    'data-name',
    'data-principal-id',
    'data-display-name',
    'data-quackback-embed',
    'data-kind',
    'data-id',
  ],
  ALLOW_DATA_ATTR: false,
  ADD_TAGS: ['iframe'],
  ADD_ATTR: ['allowfullscreen', 'frameborder', 'allow'],
}

export function RichTextContent({ content, className }: RichTextContentProps) {
  // Generate HTML from JSON content, with DOMPurify defense-in-depth on client
  if (typeof content === 'object' && content.type === 'doc') {
    const rawHtml = generateContentHTML(content)
    // DOMPurify requires a DOM — on the server, generateContentHTML already produces
    // controlled HTML from validated JSON (content is sanitized at ingestion time)
    const html = DOMPurify.isSupported ? DOMPurify.sanitize(rawHtml, DOMPURIFY_CONFIG) : rawHtml
    return (
      <div
        className={cn(
          'prose prose-neutral dark:prose-invert min-w-0 max-w-full [overflow-wrap:anywhere] [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto',
          className
        )}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }

  return null
}

// Helper to check if content is TipTap JSON
export function isRichTextContent(content: unknown): content is JSONContent {
  return (
    typeof content === 'object' &&
    content !== null &&
    'type' in content &&
    (content as JSONContent).type === 'doc'
  )
}
