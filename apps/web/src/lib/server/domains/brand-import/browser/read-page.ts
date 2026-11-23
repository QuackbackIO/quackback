/**
 * One rendered read of a website's homepage, in a headless Chromium driven
 * over the DevTools protocol. The reader says what it is: it sends the same
 * agent as the static reader and never works around a bot check. Every
 * request the page makes (redirects, frames, scripts, images) goes through the
 * guard proxy, so it reaches public hosts only. Storage is in memory and gone
 * with the browser; robots.txt was honoured by the app before it asked.
 *
 * It runs in a process of its own, one read per process, so a page that hangs
 * or leaks is ended with its process (reader-server.ts).
 */
import { READER_TOKEN } from '../robots'
import { startGuardProxy } from './guard-proxy'
import { siteLabel } from '../site/site-name'
import { oneFontFamily } from '@/lib/shared/theme/font-names'
import { parseFontFaces, pickSiteFont, stackFamilies, type FontPick } from './font-faces'
import { measurePageExtras, type PageExtras } from './page-extras'
import { listPageFonts, type PageFonts } from './page-fonts'
import { measureHeaderBand, type PageHeaderBand } from './page-header-band'
import { findDarkLogo, type PageDarkLogoHint } from './page-dark-logo'
import {
  answersScheme,
  documentStatus,
  logoInks,
  MAIN_DOCUMENT,
  samePageAgain,
  schemeDarkLogo,
} from './read-helpers'
import {
  assetUrls,
  drawnIcons,
  loadedAssets,
  loadedBody,
  receivedBody,
  withSprites,
  type LoadedResponse,
} from './read-assets'
import { measurePageSigns, type PageSignsRead } from './page-signs'
import { findPaintedLogo, markPageWrapper } from './page-painted'
import {
  measureBrandPage,
  type PageDarkMeasure,
  type PageFontFace,
  type PageLogo,
  type PageMeasure,
  type PageSiteFont,
} from './page-measure'

/** The static reader's agent, so a site sees one reader under one name. */
export const READER_AGENT = `${READER_TOKEN}/1.0 (+https://quackback.io)`

/** The viewport the fixtures were measured at. */
const WIDTH = 1440
const HEIGHT = 900
const LOAD_MS = 12_000
/** The most time for the page's scripts and fonts to settle once loaded. */
const SETTLE_MS = 3_000
/** The least: a page measured sooner is often still drawing. */
const SETTLE_FLOOR_MS = 1_000
/** The network is quiet once nothing has been in flight this long. */
const QUIET_MS = 500

/**
 * Whether a loaded page is ready to measure, `ms` after it loaded: past the
 * floor, with no request in flight and none for a moment, or at the budget.
 * `lastActivity` is when a request last started or ended, in the same clock.
 */
export function settled(network: { pending: number; lastActivity: number }, ms: number): boolean {
  if (ms >= SETTLE_MS) return true
  if (ms < SETTLE_FLOOR_MS) return false
  return network.pending <= 0 && ms - network.lastActivity >= QUIET_MS
}
/** The dark read is extra: only started this far into the read, well inside its budget. */
const DARK_READ_BEFORE_MS = 15_500
/** The logo and icon bytes are extra too: only gathered this far into the read. */
const ASSETS_BEFORE_MS = 16_000
/**
 * The text font's files are extra as well, gathered last: only started this
 * far into the read, and given up on at the deadline, so a slow site still
 * returns its read before the process is ended.
 */
const FONTS_BEFORE_MS = 12_000
const FONTS_DEADLINE_MS = 16_000
/** One font file, and the stylesheet text read to find it. */
const FONT_MAX_BYTES = 400 * 1024
const FONT_SHEET_MAX_BYTES = 1024 * 1024
/** Time for a page's colours to change once the system says dark. */
const DARK_SETTLE_MS = 600
/**
 * Loading the page again under a dark system is the last extra of all: only
 * started this far into the read, and given up on at the deadline.
 */
const DARK_LOAD_BEFORE_MS = 12_500
const DARK_LOAD_DEADLINE_MS = 16_500

export type PageRead =
  | { ok: true; url: string; measure: PageMeasure }
  | { ok: false; reason: 'unreachable' | 'busy' | 'invalid' }

const timeout = (ms: number) =>
  new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), ms))

/**
 * Chromium's flags for one read. Its own sandbox stays on and site isolation
 * is left as Chromium has it: a page is untrusted, and the renderer is the
 * part an exploit reaches first. `QUACKBACK_BROWSER_SANDBOX=off` is for an
 * operator whose runtime cannot give Chromium the namespaces it needs.
 */
export function chromiumArgs(proxyPort: number, env: Record<string, string | undefined>): string[] {
  return [
    `--user-agent=${READER_AGENT}`,
    `--proxy-server=http://127.0.0.1:${proxyPort}`,
    // Even loopback goes through the proxy, which refuses it.
    '--proxy-bypass-list=<-loopback>',
    '--disable-quic',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--disable-sync',
    '--no-pings',
    '--disable-features=Translate,MediaRouter,OptimizationHints',
    '--autoplay-policy=user-gesture-required',
    '--js-flags=--max-old-space-size=384',
    '--lang=en-GB',
    '--hide-scrollbars',
    '--mute-audio',
    ...(env.QUACKBACK_BROWSER_SANDBOX === 'off' ? ['--no-sandbox'] : []),
  ]
}

/**
 * The page again with the visitor's system set to dark, keeping the colours
 * alone. A site whose theme follows the system shows its dark mode; one that
 * does not shows the same page, which the reader then ignores.
 */
type DarkRead = { measure: PageDarkMeasure; logo: PageLogo | null; title: string }

async function readDark(view: Bun.WebView): Promise<DarkRead | null> {
  await view.cdp('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'dark' }],
  })
  await Bun.sleep(DARK_SETTLE_MS)
  return measureDark(view)
}

/** The page as it stands, measured for the dark read. */
async function measureDark(view: Bun.WebView): Promise<DarkRead | null> {
  const m = (await view.evaluate(`(${measureBrandPage.toString()})()`)) as PageMeasure | null
  if (!m || typeof m.bg !== 'string') return null
  const { bg, text, textColor, candidates, buttons, surfaces, texts, borders } = m
  return {
    measure: { bg, text, textColor, candidates, buttons, surfaces, texts, borders },
    logo: m.logo ?? null,
    title: typeof m.title === 'string' ? m.title : '',
  }
}

/**
 * The files a font stack's words are set in: for the text, the regular and
 * the bold of the first family the stack names; for headings, its semibold
 * and bold. From the `@font-face` rules the page could read (page-fonts.ts)
 * and those of the stylesheets it could not (read here from what the browser
 * loaded). A font service's files are never gathered.
 */
async function fontFiles(
  view: Bun.WebView,
  stacks: string[],
  responses: Map<string, LoadedResponse>,
  use: 'text' | 'headings'
): Promise<PageSiteFont | null> {
  if (stacks.length === 0) return null
  const named = new Set(stacks.flatMap(stackFamilies).map((name) => name.toLowerCase()))
  const listed = (await view
    .evaluate(`(${listPageFonts.toString()})(${JSON.stringify(stacks)})`)
    .catch(() => null)) as PageFonts | null
  if (!listed || !Array.isArray(listed.fontFaces) || !Array.isArray(listed.fontSheets)) return null
  const faces: PageFontFace[] = [...listed.fontFaces]
  for (const sheet of listed.fontSheets) {
    const received = await receivedBody(view, sheet, responses)
    if (!received || received.body.length > FONT_SHEET_MAX_BYTES * 1.4) continue
    const css = received.base64 ? Buffer.from(received.body, 'base64').toString() : received.body
    faces.push(...parseFontFaces(css, sheet).filter((face) => named.has(face.family.toLowerCase())))
  }
  const loaded = new Set(
    [...responses].filter(([, response]) => response.status === 200).map(([url]) => url)
  )
  const pick = stacks
    .map((stack) => pickSiteFont(stack, faces, loaded, use))
    .find((found) => found !== null)
  if (!pick) return null
  if (pick.service) return { family: pick.family, service: true, files: [] }
  const files: PageSiteFont['files'] = []
  let tooLarge = false
  for (const { url, ...weights } of pick.picks satisfies FontPick[]) {
    const body = await loadedBody(view, url, responses, FONT_MAX_BYTES)
    if (body === 'too-large') tooLarge = true
    // Without the first file there is no family to copy: the second alone is not sent.
    if (!body || body === 'too-large') {
      if (files.length === 0) break
      continue
    }
    files.push({ url, ...weights, data: body.data })
  }
  return { family: pick.family, ...(tooLarge ? { tooLarge } : {}), files }
}

export async function readPage(address: string, browserPath?: string): Promise<PageRead> {
  const url = new URL(address)
  url.protocol = 'https:'
  const proxy = await startGuardProxy()
  const view = new Bun.WebView({
    width: WIDTH,
    height: HEIGHT,
    dataStore: 'ephemeral',
    backend: {
      type: 'chrome',
      url: false,
      ...(browserPath ? { path: browserPath } : {}),
      argv: chromiumArgs(proxy.port, process.env),
    },
  })
  const started = Date.now()
  // What the page loads, by address, so the logo and icon can be handed back
  // as the browser received them rather than fetched again.
  const responses = new Map<string, LoadedResponse>()
  /** Every document the visit loaded (the page and its frames), by address, with its status. */
  const documents = new Map<string, number>()
  let mainFrame: string | undefined
  try {
    await view.navigate('about:blank')
    await view.cdp('Network.enable').catch(() => undefined)
    // Requests in flight, for the wait until the page's network goes quiet.
    let loadedAt = Date.now()
    const network = { pending: 0, lastActivity: 0 }
    const touch = (change: number) => {
      network.pending = Math.max(0, network.pending + change)
      network.lastActivity = Date.now() - loadedAt
    }
    view.addEventListener('Network.requestWillBeSent', () => touch(1))
    view.addEventListener('Network.loadingFinished', () => touch(-1))
    view.addEventListener('Network.loadingFailed', () => touch(-1))
    view.addEventListener('Network.responseReceived', (event: Event) => {
      const data = (event as MessageEvent).data as {
        requestId: string
        type?: string
        frameId?: string
        response: { url: string; status: number; mimeType: string }
      }
      // The page's own answer (the last document of the redirects that led to it).
      if (data.type === 'Document') {
        documents.set(data.response.url, data.response.status)
        // The first document is the page's own frame: its latest answer stands
        // when the address has moved on since (a script's own navigation).
        mainFrame ??= data.frameId
        if (data.frameId === mainFrame) documents.set(MAIN_DOCUMENT, data.response.status)
      }
      responses.set(data.response.url, {
        requestId: data.requestId,
        status: data.response.status,
        mime: data.response.mimeType,
      })
    })
    // A page that never finishes loading is read as it stands once the wait is up.
    const loaded = await Promise.race([
      view.navigate(url.toString()).then(() => 'loaded'),
      timeout(LOAD_MS),
    ])
    const state = await view.evaluate('document.readyState').catch(() => null)
    if (loaded !== 'loaded' && state !== 'interactive' && state !== 'complete')
      return { ok: false, reason: 'unreachable' }
    loadedAt = Date.now()
    network.lastActivity = 0
    while (!settled(network, Date.now() - loadedAt)) await Bun.sleep(100)
    // A page-long wrapper that paints the page for a body that does not, marked for the measure.
    await view.evaluate(`(${markPageWrapper.toString()})()`).catch(() => null)
    const measure = (await view.evaluate(`(${measureBrandPage.toString()})()`)) as PageMeasure
    if (!measure || typeof measure.bg !== 'string') return { ok: false, reason: 'unreachable' }
    if (!measure.logo) {
      const painted = (await view
        .evaluate(`(${findPaintedLogo.toString()})()`)
        .catch(() => null)) as PageLogo | null
      if (painted && typeof painted.src === 'string' && /^https?:/.test(painted.src))
        measure.logo = { tag: 'IMG', src: painted.src, w: Number(painted.w), h: Number(painted.h) }
    }
    // The declared name and the cards' look, in a quick second pass over the same page.
    const extras = (await view
      .evaluate(
        `(${measurePageExtras.toString()})(${JSON.stringify(siteLabel(url.toString()) ?? '')}, ${JSON.stringify(measure.h1?.font ?? '')})`
      )
      .catch(() => null)) as PageExtras | null
    if (extras) {
      measure.siteName = typeof extras.siteName === 'string' ? extras.siteName : null
      if (Array.isArray(extras.names))
        measure.names = extras.names.filter((name) => typeof name === 'string').slice(0, 6)
      if (measure.h1 && typeof extras.headingMinPx === 'number' && extras.headingMinPx > 0)
        measure.h1.minPx = extras.headingMinPx
      if (measure.logo && typeof extras.logoLabel === 'string' && extras.logoLabel)
        measure.logo.label = extras.logoLabel
      if (typeof extras.nameWritten === 'string')
        measure.nameWritten = extras.nameWritten.slice(0, 200)
      if (extras.cards) measure.cards = extras.cards
    }
    // The logo and menu at the top of a tall band of one colour: that colour is the header's.
    if (!measure.header) {
      const band = (await view
        .evaluate(`(${measureHeaderBand.toString()})()`)
        .catch(() => null)) as PageHeaderBand | null
      if (band && typeof band.bg === 'string') measure.header = band
    }
    // The site's own dark-mode logo, where its markup names one beside the logo.
    const hint = (await view
      .evaluate(`(${findDarkLogo.toString()})()`)
      .catch(() => null)) as PageDarkLogoHint | null
    const hinted: PageMeasure['darkLogo'] =
      measure.logo && hint && typeof hint.src === 'string' && /^https?:/.test(hint.src)
        ? { tag: 'IMG', src: hint.src, w: measure.logo.w, h: measure.logo.h, from: hint.from }
        : undefined
    if (hinted?.from === 'picture') measure.darkLogo = hinted
    let liveDark: DarkRead | null = null
    if (Date.now() - started < DARK_READ_BEFORE_MS) {
      const dark = await readDark(view).catch(() => null)
      liveDark = dark
      if (dark) measure.dark = dark.measure
      // The logo the page itself shows once the system says dark.
      const shown = dark ? schemeDarkLogo(measure.logo, dark.logo) : null
      if (shown && !measure.darkLogo) measure.darkLogo = { ...shown, from: 'scheme' }
    }
    if (hinted && !measure.darkLogo) measure.darkLogo = hinted
    const at = view.url
    const pageUrl = at && at.startsWith('http') ? at : url.toString()
    // Whether this is the site's own page is the app's to say, from these signs.
    const signs = (await view
      .evaluate(`(${measurePageSigns.toString()})()`)
      .catch(() => null)) as PageSignsRead | null
    if (signs && typeof signs.words === 'number' && Array.isArray(signs.links))
      measure.page = {
        status: documentStatus(documents, pageUrl, url.toString()),
        heading: String(signs.heading ?? '').slice(0, 200),
        lead: String(signs.lead ?? '').slice(0, 1500),
        words: signs.words,
        links: signs.links.slice(0, 150),
      }
    if (Date.now() - started < ASSETS_BEFORE_MS) {
      const assets = await loadedAssets(view, assetUrls(measure, pageUrl), responses).catch(
        () => []
      )
      await drawnIcons(view, measure, assets).catch(() => undefined)
      if (assets.length > 0) measure.assets = assets
      // A logo drawn from another file's sprite, made whole.
      for (const logo of [measure.logo, measure.darkLogo]) {
        if (logo?.svg)
          logo.svg = await withSprites(view, logo.svg, pageUrl, responses).catch(() => logo.svg)
      }
    }
    // Each logo drawn and its inks counted, so the app knows how much of it shows on a surface.
    for (const logo of [measure.logo, measure.darkLogo]) {
      if (!logo || Date.now() - started >= ASSETS_BEFORE_MS) continue
      const inks = await logoInks(view, logo, measure.assets ?? [])
      if (inks) logo.inks = inks
    }
    if (Date.now() - started < FONTS_BEFORE_MS) {
      const within = <T>(work: Promise<T>) =>
        Promise.race([
          work.catch(() => null),
          Bun.sleep(Math.max(0, FONTS_DEADLINE_MS - (Date.now() - started))).then(() => null),
        ])
      const textStacks = [measure.textFont, measure.bodyFont].filter(
        (stack): stack is string => !!stack
      )
      const font = await within(fontFiles(view, textStacks, responses, 'text'))
      if (font) measure.siteFont = font
      // The largest heading's files too, when it is set in a family of its own
      // (another cut of the text's family is the text font to the portal).
      const headingStack = measure.h1?.font
      if (headingStack && !textStacks.includes(headingStack)) {
        const heading = await within(fontFiles(view, [headingStack], responses, 'headings'))
        if (heading && !(font && oneFontFamily(heading.family, font.family)))
          measure.headingFont = heading
      }
    }
    // A site that takes its scheme once, as it loads, shows its dark mode only
    // to a page loaded dark: the page is loaded again, the system still set to
    // dark. Last of all, so nothing read above is touched; never when the page
    // already answered, and never taken from another page shown in its place.
    // Whatever of it is not done at the deadline is left: the read goes back as it stands.
    if (
      liveDark &&
      measure.dark &&
      !answersScheme(measure, liveDark.measure) &&
      Date.now() - started < DARK_LOAD_BEFORE_MS
    ) {
      const left = () => Math.max(0, started + DARK_LOAD_DEADLINE_MS - Date.now())
      const first = { title: measure.title, status: measure.page?.status ?? null }
      const lightLogo = measure.logo
      const assets = measure.assets ?? []
      const loadDark = async (): Promise<{ dark: DarkRead; logo: PageLogo | null } | null> => {
        documents.delete(MAIN_DOCUMENT)
        await view.navigate(pageUrl)
        loadedAt = Date.now()
        network.pending = 0
        network.lastActivity = 0
        while (!settled(network, Date.now() - loadedAt)) await Bun.sleep(100)
        await view.evaluate(`(${markPageWrapper.toString()})()`).catch(() => null)
        const dark = await measureDark(view)
        const status = documents.get(MAIN_DOCUMENT) ?? null
        if (!dark || !samePageAgain(first, { title: dark.title, status })) return null
        // The logo the page loaded dark shows, drawn and counted as the others are.
        const shown = answersScheme(measure, dark.measure)
          ? schemeDarkLogo(lightLogo, dark.logo)
          : null
        if (!shown) return { dark, logo: null }
        const svg = shown.svg
          ? await withSprites(view, shown.svg, pageUrl, responses).catch(() => shown.svg)
          : undefined
        const logo = { ...shown, ...(svg !== undefined ? { svg } : {}) }
        const inks = await logoInks(view, logo, assets).catch(() => null)
        return { dark, logo: inks ? { ...logo, inks } : logo }
      }
      const again = await Promise.race([loadDark().catch(() => null), timeout(left())])
      if (again && again !== 'timeout') {
        if (!answersScheme(measure, again.dark.measure)) measure.dark.loaded = true
        else {
          measure.dark = { ...again.dark.measure, loaded: true }
          // Over a twin its markup only marks, never over a picture's own dark source.
          if (again.logo && (!measure.darkLogo || measure.darkLogo.from === 'pair'))
            measure.darkLogo = { ...again.logo, from: 'scheme' }
        }
      }
    }
    return { ok: true, url: pageUrl, measure }
  } finally {
    view.close()
    await proxy.close()
  }
}
