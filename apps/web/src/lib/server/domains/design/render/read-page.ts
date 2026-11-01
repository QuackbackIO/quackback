/**
 * One rendered read of a website's home page, in a headless Chromium driven
 * over the DevTools protocol. The reader says what it is: it sends its own
 * agent, keeps the browser's automation flag, respects robots.txt, declines
 * optional cookies, and never works around a bot check. Every request the page
 * makes goes through the guard proxy, so it reaches public hosts only.
 *
 * It runs in a process of its own, one read per process, so a page that hangs
 * or leaks is ended with its process.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { safeFetch } from '@/lib/server/content/ssrf-guard'
import { paletteFromPixels } from '@/lib/shared/design/palette'
import { startGuardProxy } from './guard-proxy'
import { declineConsent, hideOverlays, measurePage, type PageMeasure } from './page-scripts'
import { READER_TOKEN, robotsAllows } from './robots'

export const READER_AGENT = `Mozilla/5.0 (compatible; ${READER_TOKEN}/1.0; +https://quackback.io)`

const WIDTH = 1440
const HEIGHT = 900
/** The screenshot's width: what a model reading images needs, at a modest size. */
const SHOT_WIDTH = 1024
const LOAD_MS = 20_000
const SETTLE_MS = 1_500
const CONSENT_MS = 800
/** How long consent rules may take to find and answer a notice. */
const CONSENT_RULES_MS = 4_000

export type PageRead =
  | {
      ok: true
      url: string
      measure: PageMeasure
      /** The first screen, as a JPEG data URL. */
      screenshot: string | null
      /** The screenshot's main colours by pixel, as for an uploaded screenshot. */
      shotPalette: string[]
      refused: string[]
    }
  | { ok: false; reason: 'robots' | 'unreachable' | 'blocked' }

/** Whether robots.txt lets the reader visit a page; an unreadable file allows it. */
async function robotsLet(url: URL): Promise<boolean> {
  let address = new URL('/robots.txt', url).toString()
  for (let hop = 0; hop < 4; hop++) {
    const response = await safeFetch(address, {
      headers: { 'user-agent': READER_AGENT, accept: 'text/plain' },
      timeoutMs: 5_000,
      maxResponseBytes: 512 * 1024,
    }).catch(() => null)
    if (!response) return true
    const next = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && next) {
      address = new URL(next, address).toString()
      continue
    }
    if (response.status >= 400) return true
    return robotsAllows(await response.text(), url.pathname || '/')
  }
  return true
}

const run = <T>(script: () => T) => `(${script.toString()})()`

/** Pixels read along the screenshot's longer side, as an uploaded screenshot's are. */
const SAMPLE_SIZE = 128

/** Runs in a blank page: an image's pixels, downscaled, for its palette. */
function samplePixels(source: string, size: number): Promise<{ data: number[] } | null> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      const scale = Math.min(1, size / Math.max(image.naturalWidth, image.naturalHeight, 1))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      const context = canvas.getContext('2d')
      if (!context) return resolve(null)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      resolve({ data: [...context.getImageData(0, 0, canvas.width, canvas.height).data] })
    }
    image.onerror = () => resolve(null)
    image.src = source
  })
}

/** The screenshot's palette, decoded in a blank page so the site's own rules do not apply. */
async function shotPalette(view: Bun.WebView, screenshot: string): Promise<string[]> {
  await view.navigate('about:blank').catch(() => null)
  const pixels = (await view
    .evaluate(`(${samplePixels.toString()})(${JSON.stringify(screenshot)}, ${SAMPLE_SIZE})`)
    .catch(() => null)) as { data: number[] } | null
  return pixels ? paletteFromPixels(Uint8ClampedArray.from(pixels.data), 6) : []
}

/**
 * The consent rules, run in the page as it loads: they recognise common
 * consent notices and choose to decline optional cookies. The image sets the
 * script's path; in development it sits beside the installed package.
 */
async function consentRules(): Promise<string | null> {
  const path =
    process.env.QUACKBACK_BROWSER_CONSENT_SCRIPT ??
    join(
      dirname(fileURLToPath(import.meta.resolve('@duckduckgo/autoconsent'))),
      'autoconsent.standalone.js'
    )
  return Bun.file(path)
    .text()
    .catch(() => null)
}

/** Whether the consent rules answered a notice, waiting while they work. */
async function consentAnswered(view: Bun.WebView): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < CONSENT_RULES_MS) {
    const types = (await view
      .evaluate('(window.autoconsentStandalone?.messages ?? []).map((m) => m.type)')
      .catch(() => [])) as string[]
    if (types.includes('autoconsentDone') || types.includes('optOutResult')) return true
    // Nothing recognised once detection has run its course: there is no notice it knows.
    if (!types.includes('popupFound') && Date.now() - started > 2_000) return false
    await Bun.sleep(250)
  }
  return false
}

const timeout = (ms: number) =>
  new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), ms))

export async function readPage(address: string, browser?: string): Promise<PageRead> {
  const url = new URL(address)
  if (url.protocol !== 'https:') url.protocol = 'https:'
  if (!(await robotsLet(url))) return { ok: false, reason: 'robots' }

  const proxy = await startGuardProxy()
  const view = new Bun.WebView({
    width: WIDTH,
    height: HEIGHT,
    backend: {
      type: 'chrome',
      url: false,
      ...(browser ? { path: browser } : {}),
      argv: [
        `--user-agent=${READER_AGENT}`,
        `--proxy-server=http://127.0.0.1:${proxy.port}`,
        // Even loopback goes through the proxy, which refuses it.
        '--proxy-bypass-list=<-loopback>',
        '--disable-quic',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--disable-dev-shm-usage',
        // Memory: a read needs one page, its frames in it, and no video playing.
        '--renderer-process-limit=1',
        '--disable-site-isolation-trials',
        '--disable-features=site-per-process,Translate,MediaRouter,OptimizationHints',
        '--autoplay-policy=user-gesture-required',
        '--js-flags=--max-old-space-size=384',
        '--lang=en-GB',
        '--hide-scrollbars',
        '--mute-audio',
        ...(process.env.QUACKBACK_BROWSER_SANDBOX === 'off' ? ['--no-sandbox'] : []),
      ],
    },
  })
  try {
    const rules = await consentRules()
    if (rules) {
      // The DevTools session opens with a first page; the rules then run in every page after it.
      await view.navigate('about:blank')
      await view.cdp('Page.addScriptToEvaluateOnNewDocument', { source: rules })
    }
    // A page that never finishes loading is read as it stands once the wait is up.
    const loaded = await Promise.race([
      view.navigate(url.toString()).then(() => 'loaded'),
      timeout(LOAD_MS),
    ])
    const status = await view.evaluate('document.readyState').catch(() => null)
    if (loaded !== 'loaded' && status !== 'interactive' && status !== 'complete')
      return { ok: false, reason: 'unreachable' }
    await Bun.sleep(SETTLE_MS)
    const answered = rules ? await consentAnswered(view) : false
    if (!answered && (await view.evaluate(run(declineConsent)).catch(() => false)))
      await Bun.sleep(CONSENT_MS)
    await view.evaluate(run(hideOverlays)).catch(() => 0)
    const measure = (await view.evaluate(run(measurePage))) as PageMeasure
    if (!measure?.page) return { ok: false, reason: 'unreachable' }
    const height = Number(await view.evaluate('innerHeight').catch(() => HEIGHT)) || HEIGHT
    const shot = (await view
      .cdp('Page.captureScreenshot', {
        format: 'jpeg',
        quality: 80,
        clip: { x: 0, y: 0, width: WIDTH, height, scale: SHOT_WIDTH / WIDTH },
      })
      .catch(() => null)) as { data?: string } | null
    const screenshot = shot?.data ? `data:image/jpeg;base64,${shot.data}` : null
    const finalUrl = view.url || url.toString()
    return {
      ok: true,
      url: finalUrl,
      measure,
      screenshot,
      shotPalette: screenshot ? await shotPalette(view, screenshot) : [],
      refused: [...proxy.refused],
    }
  } finally {
    view.close()
    await proxy.close()
  }
}
