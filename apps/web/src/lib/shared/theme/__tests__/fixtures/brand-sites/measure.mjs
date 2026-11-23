// Measures brand sites in headless Chromium: node measure.mjs site.com other.com > measured.json
import { chromium } from 'playwright'
const sites = process.argv.slice(2)
const b = await chromium.launch()
const out = {}
for (const site of sites) {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' })
  try {
    await p.goto('https://' + site, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await p.waitForTimeout(4000)
    out[site] = await p.evaluate(() => {
      const cs = (el) => getComputedStyle(el)
      const vis = (el) => {
        const r = el.getBoundingClientRect()
        const s = cs(el)
        return (
          r.width > 20 &&
          r.height > 14 &&
          r.top < 1400 &&
          s.visibility !== 'hidden' &&
          s.display !== 'none' &&
          +s.opacity > 0.5
        )
      }
      const consent = (el) =>
        /cookie|consent|onetrust|cmp|gdpr|privacy/i.test(
          (el.closest('[id],[class]')?.id || '') +
            ' ' +
            (el.closest('[class]')?.className?.toString() || '') +
            ' ' +
            el.textContent
        )
      const isTransparent = (c) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent'
      const meta = document.querySelector('meta[name="theme-color"]')?.content || null
      const body = cs(document.body)
      let bg = body.backgroundColor
      if (isTransparent(bg)) bg = cs(document.documentElement).backgroundColor
      // buttons: filled, visible, not consent
      const btns = [...document.querySelectorAll('a,button')]
        .filter(
          (el) =>
            vis(el) &&
            !consent(el) &&
            !isTransparent(cs(el).backgroundColor) &&
            el.textContent.trim().length > 1 &&
            el.textContent.trim().length < 40
        )
        .map((el) => {
          const s = cs(el)
          const r = el.getBoundingClientRect()
          return {
            text: el.textContent.trim().replace(/\s+/g, ' '),
            bg: s.backgroundColor,
            fg: s.color,
            radius: s.borderRadius,
            h: Math.round(r.height),
            top: Math.round(r.top),
            font: s.fontFamily.split(',')[0],
          }
        })
        .filter((x) => x.bg !== bg)
        .slice(0, 6)
      const h1 = [...document.querySelectorAll('h1,h2')]
        .filter(vis)
        .sort((a, b) => parseFloat(cs(b).fontSize) - parseFloat(cs(a).fontSize))[0]
      const links = [...document.querySelectorAll('main a, a')]
        .filter((el) => vis(el) && !consent(el))
        .map((el) => cs(el).color)
      const header = document.querySelector('header') || document.querySelector('nav')
      const logo = header ? [...header.querySelectorAll('img,svg')].filter(vis)[0] : null
      return {
        title: document.title,
        themeColor: meta,
        bg,
        text: body.color,
        bodyFont: body.fontFamily,
        headerBg: header ? cs(header).backgroundColor : null,
        h1: h1
          ? {
              text: h1.textContent.trim().slice(0, 60),
              font: cs(h1).fontFamily,
              size: cs(h1).fontSize,
              weight: cs(h1).fontWeight,
              color: cs(h1).color,
            }
          : null,
        buttons: btns,
        linkColours: [...new Set(links)].slice(0, 6),
        logo: logo
          ? {
              tag: logo.tagName,
              src: logo.getAttribute('src') || null,
              w: Math.round(logo.getBoundingClientRect().width),
              h: Math.round(logo.getBoundingClientRect().height),
            }
          : null,
      }
    })
  } catch (e) {
    out[site] = { error: String(e).slice(0, 200) }
  }
  await p.close()
}
console.log(JSON.stringify(out, null, 1))
await b.close()
