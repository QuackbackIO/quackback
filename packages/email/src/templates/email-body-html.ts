/**
 * Make serialized rich-text HTML safe to drop into an email body.
 *
 * The body HTML comes from the app's content serializer, which styles elements
 * with Tailwind classes (`max-w-full h-auto rounded-lg` on images). Emails have
 * no stylesheet, so those classes do nothing: a 1920px screenshot renders at
 * 1920px, stretches the 560px card, and pushes the text off the side in webmail.
 * Mobile mail apps that shrink an oversized message to fit the screen then boost
 * the font size back up while keeping the pixel line-heights, so the lines run
 * into each other.
 *
 * This rewrites the opening tags that can overflow (img, pre, table) with
 * inline styles every client honours. The input is serializer output whose
 * attribute values are already escaped (no raw `>` or `"`), so matching the
 * opening tags with a regex is safe here; it is not a general HTML parser.
 */

const IMG_TAG = /<img\b([^>]*?)\s*\/?>/gi
const PRE_TAG = /<pre\b([^>]*)>/gi
const TABLE_TAG = /<table\b([^>]*)>/gi
const ATTR = (name: string) => new RegExp(`\\s${name}="[^"]*"`, 'gi')

function stripAttrs(attrs: string, names: string[]): string {
  return names.reduce((acc, name) => acc.replace(ATTR(name), ''), attrs)
}

function styleOf(attrs: string): string {
  return /\sstyle="([^"]*)"/i.exec(attrs)?.[1] ?? ''
}

function withStyle(tag: string, attrs: string, style: string): string {
  const existing = styleOf(attrs).trim()
  const rest = stripAttrs(attrs, ['class', 'style']).trim()
  const merged = existing ? `${style}${existing.endsWith(';') ? existing : `${existing};`}` : style
  return `<${tag}${rest ? ` ${rest}` : ''} style="${merged}">`
}

export function emailBodyHtml(html: string): string {
  return html
    .replace(IMG_TAG, (_match, rawAttrs: string) => {
      // A resized image keeps its chosen width, but never wider than the email.
      const width = /(?:^|;)\s*width:\s*(\d+)px/i.exec(styleOf(rawAttrs))?.[1]
      const sizing = width ? `width:100%;max-width:${width}px;` : 'max-width:100%;'
      const attrs = stripAttrs(rawAttrs, ['class', 'style', 'loading', 'decoding']).trim()
      const style = `display:block;${sizing}height:auto;border:0;border-radius:8px;`
      return `<img${attrs ? ` ${attrs}` : ''} style="${style}" />`
    })
    .replace(PRE_TAG, (_match, attrs: string) =>
      withStyle('pre', attrs, 'white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;')
    )
    .replace(TABLE_TAG, (_match, attrs: string) =>
      withStyle('table', attrs, 'width:100%;max-width:100%;border-collapse:collapse;')
    )
}
