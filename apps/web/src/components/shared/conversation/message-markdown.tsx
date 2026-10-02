import { useMemo, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Element, Root, RootContent } from 'hast'
import { cn } from '@/lib/shared/utils'
import { sanitizeImageUrl, sanitizeUrl } from '@/lib/shared/utils/sanitize'
import { CITATION_MARKER_RE } from '@/lib/shared/assistant/citation-markers'

/** Add citation placeholders after Markdown has resolved links and code. This
 * keeps numeric link labels intact and never inserts an anchor inside another
 * anchor, or interprets examples inside code as source references. */
function citationPlaceholders() {
  return (tree: Root) => {
    function walk(parent: Root | Element) {
      if (parent.type === 'element' && ['a', 'code', 'pre'].includes(parent.tagName)) return
      const children: RootContent[] = []
      for (const child of parent.children) {
        if (child.type === 'text') {
          let last = 0
          for (const match of child.value.matchAll(CITATION_MARKER_RE)) {
            const index = match.index
            if (index > last) children.push({ type: 'text', value: child.value.slice(last, index) })
            children.push({
              type: 'element',
              tagName: 'span',
              properties: { 'data-citation': Number(match[1]) },
              children: [{ type: 'text', value: match[0] }],
            })
            last = index + match[0].length
          }
          if (last < child.value.length)
            children.push({ type: 'text', value: child.value.slice(last) })
        } else {
          if (child.type === 'element') walk(child)
          children.push(child)
        }
      }
      parent.children = children
    }
    walk(tree)
  }
}

/** Shared by admin and visitor messages. Render Markdown as React elements;
 * raw HTML stays escaped and URL protocols are checked before creating links or
 * images. Keep canonical TipTap documents on the rich-text render path. */
export function MessageMarkdown({
  text,
  className,
  renderCitation,
  trailing,
}: {
  text: string
  className?: string
  renderCitation?: (number: number) => ReactNode
  trailing?: ReactNode
}) {
  const components = useMemo<Components>(
    () => ({
      a: ({ href, children, title }) =>
        href ? (
          <a
            href={href}
            title={title}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            {children}
          </a>
        ) : (
          <>{children}</>
        ),
      img: ({ src, alt, title }) =>
        typeof src === 'string' && src ? (
          <img
            src={src}
            alt={alt ?? ''}
            title={title}
            loading="lazy"
            className="max-w-full rounded-lg"
          />
        ) : (
          <>{alt}</>
        ),
      p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
      table: ({ children }) => (
        <div className="max-w-full overflow-x-auto">
          <table>{children}</table>
        </div>
      ),
      span: ({ node, children }) => {
        const number = node?.properties['data-citation']
        return typeof number === 'number' && renderCitation ? (
          renderCitation(number)
        ) : (
          <span>{children}</span>
        )
      },
    }),
    [renderCitation]
  )

  return (
    <div
      className={cn(
        'min-w-0 max-w-full space-y-2 text-sm leading-relaxed [overflow-wrap:anywhere]',
        '[&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h4]:font-semibold [&_h5]:font-semibold [&_h6]:font-semibold',
        '[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:ps-5 [&_ol]:ps-5 [&_li]:my-1',
        '[&_blockquote]:border-s-2 [&_blockquote]:border-current [&_blockquote]:ps-3',
        '[&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-foreground/5 [&_pre]:p-3',
        '[&_code]:rounded [&_code]:bg-foreground/5 [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.9em] [&_pre_code]:bg-transparent [&_pre_code]:p-0',
        '[&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:p-2 [&_th]:text-start [&_td]:border [&_td]:border-border [&_td]:p-2',
        '[&_.contains-task-list]:list-none',
        className
      )}
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={renderCitation ? [citationPlaceholders] : []}
        components={components}
        urlTransform={(url, key) => (key === 'src' ? sanitizeImageUrl(url) : sanitizeUrl(url))}
      >
        {text}
      </Markdown>
      {trailing}
    </div>
  )
}
