import { createContext, useContext, useId, type ComponentProps, type ReactNode } from 'react'
import Markdown, { type Components, type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Element, Root, RootContent } from 'hast'
import { cn } from '@/lib/shared/utils'
import { sanitizeImageUrl, sanitizeUrl } from '@/lib/shared/utils/sanitize'
import { CITATION_MARKER_RE } from '@/lib/shared/assistant/citation-markers'

/** Scope footnote labels per message and add citation placeholders after Markdown
 * has resolved links and code. This
 * keeps numeric link labels intact and never inserts an anchor inside another
 * anchor, or interprets examples inside code as source references. */
function messageReferences(options: { footnotePrefix: string; citations: boolean }) {
  return (tree: Root) => {
    function walk(parent: Root | Element) {
      if (parent.type === 'element') {
        // remark-rehype gives every document the same footnote heading ID.
        const properties = parent.properties
        if (properties.id === 'footnote-label')
          properties.id = `${options.footnotePrefix}footnote-label`
        if (Array.isArray(properties.ariaDescribedBy))
          properties.ariaDescribedBy = properties.ariaDescribedBy.map((id) =>
            id === 'footnote-label' ? `${options.footnotePrefix}footnote-label` : id
          )
        if (['a', 'code', 'pre'].includes(parent.tagName)) return
      }
      const children: RootContent[] = []
      for (const child of parent.children) {
        if (child.type === 'text' && options.citations) {
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

type CitationRenderer = (number: number) => ReactNode
const CitationRendererContext = createContext<CitationRenderer | undefined>(undefined)

function CitationSpan({ node, children }: ComponentProps<'span'> & ExtraProps) {
  const renderCitation = useContext(CitationRendererContext)
  const number = node?.properties['data-citation']
  return typeof number === 'number' && renderCitation ? (
    renderCitation(number)
  ) : (
    <span>{children}</span>
  )
}

// Keep component identities stable across text/citation updates, preserving DOM
// nodes, selections and focus while an answer streams or its sources refresh.
const components: Components = {
  a: ({ node: _node, href, children, className, ...props }) =>
    href ? (
      <a
        {...props}
        href={href}
        target={href.startsWith('#') ? undefined : '_blank'}
        rel="noopener noreferrer"
        className={cn('underline underline-offset-2', className)}
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
  span: CitationSpan,
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
  const footnotePrefix = `message-${useId()}-`
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
      <CitationRendererContext value={renderCitation}>
        <Markdown
          remarkPlugins={[remarkGfm]}
          remarkRehypeOptions={{ clobberPrefix: footnotePrefix }}
          rehypePlugins={[[messageReferences, { footnotePrefix, citations: !!renderCitation }]]}
          components={components}
          urlTransform={(url, key) => (key === 'src' ? sanitizeImageUrl(url) : sanitizeUrl(url))}
        >
          {text}
        </Markdown>
      </CitationRendererContext>
      {trailing}
    </div>
  )
}
