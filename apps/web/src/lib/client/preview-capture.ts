/**
 * A picture of the drawn preview, for the critic: the frame's same-origin
 * page copied with its styles, its loaded fonts and its images inlined,
 * drawn through an SVG foreignObject onto a canvas, as a JPEG. The top of
 * the page only (what a visitor first sees), scaled to the model's size.
 *
 * Nothing leaves the page to do it: styles are read from the document's own
 * sheets, fonts and images fetched from the portal's own origin. A
 * background image in CSS is left out (an SVG drawn as an image loads
 * nothing), and anything that cannot be read is skipped, so the worst case
 * is a plainer picture, or null when no picture can be made at all.
 */

/** The picture's width, px, and how much of the page it shows at most. */
const OUT_WIDTH = 1024
const MAX_HEIGHT = 1100
/** Fonts inlined at most, bytes, so a page with many faces stays quick. */
const FONT_BUDGET = 3_000_000

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((done, fail) => {
    const reader = new FileReader()
    reader.onload = () => done(String(reader.result))
    reader.onerror = () => fail(reader.error)
    reader.readAsDataURL(blob)
  })

async function fetchAsDataUrl(url: string, origin: string): Promise<string | null> {
  try {
    if (new URL(url).origin !== origin) return null
    const res = await fetch(url, { credentials: 'same-origin' })
    return res.ok ? await blobToDataUrl(await res.blob()) : null
  } catch {
    return null
  }
}

const familyName = (f: string) =>
  f
    .trim()
    .replace(/^["']|["']$/g, '')
    .toLowerCase()

/** The page's CSS as text, with the @font-face rules of the faces in use inlined. */
async function pageCss(doc: Document, used: Set<string>): Promise<string> {
  const origin = doc.defaultView!.location.origin
  const out: string[] = []
  let fontBytes = 0
  for (const sheet of [...doc.styleSheets]) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    const base = sheet.href ?? doc.baseURI
    for (const rule of [...rules]) {
      const css = rule.cssText
      if (!css.startsWith('@font-face')) {
        out.push(css)
        continue
      }
      const family = /font-family:\s*([^;]+);/.exec(css)?.[1]
      if (!family || !used.has(familyName(family))) continue
      // Latin faces only: a page's text here is in a Latin script far more often than not.
      const range = /unicode-range:\s*([^;]+);/.exec(css)?.[1]
      if (range && !/U\+0{1,4}-0{0,2}FF\b/i.test(range)) continue
      const src = /url\((["']?)([^"')]+)\1\)/.exec(css)?.[2]
      if (!src || fontBytes > FONT_BUDGET) continue
      const data = await fetchAsDataUrl(new URL(src, base).href, origin)
      if (!data) continue
      fontBytes += data.length
      out.push(css.replace(/src:[^;]+;/, `src: url("${data}");`))
    }
  }
  return out.join('\n')
}

/** The images in view, as data URLs by their place in the document; others drawn blank. */
async function inlineImages(doc: Document, clone: HTMLElement, height: number) {
  const origin = doc.defaultView!.location.origin
  const originals = [...doc.querySelectorAll('img')]
  const copies = [...clone.querySelectorAll('img')]
  await Promise.all(
    originals.map(async (img, i) => {
      const copy = copies[i]
      if (!copy) return
      copy.removeAttribute('srcset')
      copy.removeAttribute('loading')
      const top = img.getBoundingClientRect().top
      const data =
        top < height && img.currentSrc ? await fetchAsDataUrl(img.currentSrc, origin) : null
      if (data) copy.setAttribute('src', data)
      else copy.removeAttribute('src')
    })
  )
}

/**
 * Animations and transitions held at their end. An SVG drawn as an image is
 * a still taken at its first moment, so a list that fades in (animate-in with
 * fill-mode backwards) would be drawn at opacity 0: the empty feed the
 * critic scored on 11-02.
 */
export const STILL_CSS =
  '*, *::before, *::after { animation: none !important; transition: none !important; }'

/** The frame's page as a JPEG data URL, or null when it cannot be drawn. */
export async function capturePreview(frame: HTMLIFrameElement | null): Promise<string | null> {
  const doc = frame?.contentDocument
  const win = doc?.defaultView
  if (!doc || !win) return null
  try {
    await doc.fonts?.ready
    const width = doc.documentElement.clientWidth || win.innerWidth
    const height = Math.min(MAX_HEIGHT, Math.max(win.innerHeight, 600))
    const used = new Set<string>()
    doc.fonts?.forEach((face) => {
      if (face.status === 'loaded') used.add(familyName(face.family))
    })
    const css = await pageCss(doc, used)
    const clone = doc.documentElement.cloneNode(true) as HTMLElement
    for (const el of clone.querySelectorAll('script, noscript, iframe, link, style, template'))
      el.remove()
    await inlineImages(doc, clone, height)
    // The page from its top, as wide as the frame.
    clone.style.setProperty('width', `${width}px`)
    clone.style.setProperty('height', `${height}px`)
    clone.style.setProperty('overflow', 'hidden')
    const head = clone.querySelector('head') ?? clone
    const style = doc.createElement('style')
    style.textContent = `${css}\n${STILL_CSS}`
    head.prepend(style)
    const html = new XMLSerializer().serializeToString(clone)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject x="0" y="0" width="100%" height="100%">${html}</foreignObject></svg>`
    const image = new Image()
    image.decoding = 'sync'
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    await image.decode()
    const scale = Math.min(1, OUT_WIDTH / width)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = win.getComputedStyle(doc.body).backgroundColor || '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.82)
  } catch {
    return null
  }
}
