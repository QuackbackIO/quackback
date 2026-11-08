/**
 * An in-page audit of what a visitor sees, run in the browser:
 *
 * - contrast: each visible run of text against what is painted behind it,
 *   at 4.5:1, or 3:1 for large text (24px, or 18.66px bold), as WCAG 1.4.3
 *   and axe's color-contrast rule measure it. Colours are read back from a
 *   canvas, so oklch() and color-mix() count as the browser paints them.
 *   Text over an image or a gradient is left out, as axe leaves it for review.
 * - type: no visible text under 12px.
 * - targets: every control a pointer can hit at least 24 by 24px (WCAG 2.5.8),
 *   links inside a line of text excepted.
 *
 * axe-core is not a dependency here, so this measures the same things in a
 * few dozen lines; it reports each failure with a selector and the numbers.
 */
import type { Page } from '@playwright/test'

export interface AuditOptions {
  contrast?: boolean
  type?: boolean
  targets?: boolean
  /** Only what is inside this selector. */
  within?: string
}

export interface AuditFailure {
  rule: 'contrast' | 'type' | 'target'
  where: string
  detail: string
}

export async function audit(page: Page, options: AuditOptions = {}): Promise<AuditFailure[]> {
  const { contrast = true, type = true, targets = true, within } = options
  return page.evaluate(
    ({ contrast, type, targets, within }) => {
      const failures: Array<{
        rule: 'contrast' | 'type' | 'target'
        where: string
        detail: string
      }> = []
      const root = within ? document.querySelector(within) : document.body
      if (!root) return [{ rule: 'type', where: within ?? 'body', detail: 'not found' }]
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      const rgba = (css: string): [number, number, number, number] => {
        ctx.clearRect(0, 0, 1, 1)
        ctx.fillStyle = '#000'
        ctx.fillStyle = css
        ctx.fillRect(0, 0, 1, 1)
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
        return [r!, g!, b!, a! / 255]
      }
      const over = (top: number[], under: number[]) =>
        [0, 1, 2].map((i) => top[i]! * top[3]! + under[i]! * (1 - top[3]!)).concat(1)
      const luminance = ([r, g, b]: number[]) => {
        const lin = (c: number) => {
          const v = c / 255
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
        }
        return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!)
      }
      const ratio = (a: number[], b: number[]) => {
        const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
        return (hi! + 0.05) / (lo! + 0.05)
      }
      const name = (el: Element) => {
        const part = el.closest('[data-qb-part]')?.getAttribute('data-qb-part')
        const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)
        return `${el.tagName.toLowerCase()}${part ? ` in ${part}` : ''} "${text}"`
      }
      const shown = (el: Element) => {
        const style = getComputedStyle(el)
        if (style.visibility !== 'visible' || style.display === 'none') return false
        const rect = el.getBoundingClientRect()
        if (rect.width < 2 || rect.height < 2) return false
        // Visually hidden text (sr-only) is clipped to a pixel.
        if (style.clip === 'rect(0px, 0px, 0px, 0px)' || style.clipPath === 'inset(50%)')
          return false
        for (let at: Element | null = el; at; at = at.parentElement)
          if (Number(getComputedStyle(at).opacity) === 0) return false
        return true
      }
      // What is painted behind a point: each element under it, top down, until one is opaque.
      const behind = (el: Element, x: number, y: number): number[] | null => {
        const stack = document.elementsFromPoint(x, y)
        const start = stack.indexOf(el)
        const layers: number[][] = []
        for (const each of start >= 0 ? stack.slice(start) : stack) {
          const style = getComputedStyle(each)
          if (style.backgroundImage !== 'none') return null
          const bg = rgba(style.backgroundColor)
          if (bg[3] === 0) continue
          layers.push(bg)
          if (bg[3] >= 1) break
        }
        // The canvas under everything is white.
        let colour = [255, 255, 255, 1]
        for (const layer of layers.reverse()) colour = over(layer, colour)
        return colour
      }
      const texts: Element[] = []
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement
        if (!parent || !node.textContent?.trim() || texts.includes(parent)) continue
        if (parent.closest('script, style, noscript, svg, [aria-hidden=true]')) continue
        if (shown(parent)) texts.push(parent)
      }
      for (const el of texts) {
        const style = getComputedStyle(el)
        const size = parseFloat(style.fontSize)
        if (type && size < 12) failures.push({ rule: 'type', where: name(el), detail: `${size}px` })
        if (!contrast || (el as HTMLButtonElement).disabled) continue
        const range = document.createRange()
        range.selectNodeContents(el)
        const rect = [...range.getClientRects()].find((r) => r.width > 1 && r.height > 1)
        if (!rect) continue
        const x = rect.left + Math.min(rect.width / 2, 4)
        const y = rect.top + rect.height / 2
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue
        const bg = behind(el, x, y)
        if (!bg) continue
        const fg = over(rgba(style.color), bg)
        const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700)
        const need = large ? 3 : 4.5
        const got = ratio(fg, bg)
        if (got < need - 0.005)
          failures.push({
            rule: 'contrast',
            where: name(el),
            detail: `${got.toFixed(2)}:1 < ${need}:1 (${style.color} on rgb(${bg.slice(0, 3).map(Math.round).join(' ')}))`,
          })
      }
      if (targets) {
        const controls = root.querySelectorAll<HTMLElement>(
          'a[href], button, [role=button], [role=tab], [role=radio], [role=checkbox], input:not([type=hidden]), select, textarea, summary'
        )
        for (const el of controls) {
          if (!shown(el)) continue
          const style = getComputedStyle(el)
          // A link in a line of text is exempt, as WCAG 2.5.8 says.
          if (el.tagName === 'A' && style.display === 'inline') continue
          let { width, height } = el.getBoundingClientRect()
          // A pseudo-element placed over or around it takes clicks too: a link stretched
          // over its card, a small chip's 24px hit area (qb-hit-24).
          const own = ['relative', 'absolute', 'fixed', 'sticky'].includes(style.position)
          const box = (own ? el : el.offsetParent)?.getBoundingClientRect()
          for (const pseudo of ['::before', '::after']) {
            const p = getComputedStyle(el, pseudo)
            if (!box || p.content === 'none' || p.position !== 'absolute') continue
            const side = (v: string) => (v === 'auto' ? null : parseFloat(v))
            const [top, right, bottom, left] = [p.top, p.right, p.bottom, p.left].map(side)
            if (top === null || bottom === null || left === null || right === null) continue
            width = Math.max(width, box.width - left - right)
            height = Math.max(height, box.height - top - bottom)
          }
          if (width < 23.5 || height < 23.5)
            failures.push({
              rule: 'target',
              where:
                name(el) +
                (el.getAttribute('aria-label') ? ` [${el.getAttribute('aria-label')}]` : ''),
              detail: `${Math.round(width)}x${Math.round(height)}px`,
            })
        }
      }
      return failures
    },
    { contrast, type, targets, within }
  )
}

/** The failures, one per line, for a readable assertion. */
export const describeFailures = (failures: AuditFailure[]) =>
  failures.map((f) => `${f.rule}: ${f.where}: ${f.detail}`)
