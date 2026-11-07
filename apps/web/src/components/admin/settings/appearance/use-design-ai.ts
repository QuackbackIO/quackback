import { useCallback, useRef, useState } from 'react'
import { designerLookChosen, trackBuilder, type MatchFrom } from '@/lib/client/builder-events'
import { brandLogoChange } from '@/lib/client/brand-logo'
import { checkBrandMatch } from '@/lib/client/brand-check'
import {
  streamBrandMatch,
  type BrandMatchCapture,
  type BrandMatchOutcome,
} from '@/lib/client/brand-match-stream'
import { readBrandShot } from '@/lib/client/brand-shots'
import { readMatchShots } from './match-shots'
import { askPortalDesignAiFn, designAgentStepFn } from '@/lib/server/functions/portal-design-ai'
import { readWebsiteFn } from '@/lib/server/functions/site-capture'
import { readingSummary } from '@/lib/shared/design/agent/website-tool'
import { runBuilderEditLoop, type ServerStep } from '@/lib/client/edit-loop'
import { LOOP_BUDGET, stoppedReply, trailOf } from '@/lib/shared/design/agent/loop'
import { routeRequest } from '@/lib/shared/design/agent/router'
import { STYLE_REGISTRY } from '@/lib/shared/design/agent/style-registry'
import { designPreview } from './use-design-draft'
import { snapToMark } from '@/lib/shared/design/brand-shots'
import {
  isBrandStart,
  isSiteStart,
  readAsWordmark,
  titleToSet,
  websiteIn,
  type UnmatchedFont,
} from '@/lib/shared/design/match-brand'
import type {
  AiElementPick,
  AppliedDesignChange,
  DesignAiScope,
} from '@/lib/shared/design/apply-changes'
import type { DesignerPage } from '@/lib/shared/design/outline'
import type { DesignAdjustment } from '@/lib/shared/design/resolve'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { SupportedLocale } from '@/lib/shared/i18n'
import { SCOPE_LABEL } from './design-composer'
import type { BrandShot } from '@/lib/client/brand-shots'
import type { ShotBox } from '@/lib/shared/design/brand-shots'
import type { CheckReport } from '@/lib/shared/design/brand-check'
import type { CheckFrame } from '@/lib/client/check-frame'
import type { DesignValue } from '@/lib/shared/design/apply-changes'

/** What the brand match's check needs from the draft and the canvas. */
export interface DesignCheckHooks {
  /** Makes the changes until `end` one step, so the match and its check undo together. */
  begin: (label: string) => void
  end: () => void
  /** Shows a whole design as a step, its exact values kept. */
  replace: (design: PortalDesign, label?: string) => void
  /** The canvas's frame, which the drawn preview is read from when the check's own cannot open. */
  frame: () => HTMLIFrameElement | null
  /** Opens the check's own frame: Home at the screenshots' width, off screen. */
  open?: (design: PortalDesign) => Promise<CheckFrame<PortalDesign>>
  /** The draft as it is now, which the edit loop starts from and checks against. */
  current?: () => PortalDesign
}

/** The step the check streams, the same in every round so it updates in place. */
const CHECK_STEP = 'Checking the match'

/** A value at a dotted path of the design. */
const valueAt = (doc: unknown, path: string): DesignValue =>
  (path
    .split('.')
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined,
      doc
    ) ?? null) as DesignValue

/** The measured colours a revision may use. */
function measuredPalette(target: NonNullable<Extract<BrandMatchOutcome, { ok: true }>['target']>) {
  const r = target.roles
  if (!r) return []
  const all = [
    r.identity.value,
    r.action.value.hex,
    r.links.value.hex,
    r.highlight.value,
    r.text,
    ...r.extras,
    ...r.logoColours,
  ]
  return [
    ...new Set(
      all.filter((c): c is string => !!c && /^#[0-9a-f]{6}$/i.test(c)).map((c) => c.toLowerCase())
    ),
  ].slice(0, 12)
}

/** An image attached to a chat message: its main colours, and the picture where it could be read. */
export interface ChatImage {
  palette: string[]
  image?: string
}

/** What the read of attached screenshots found: the brand's name, its mark, banners and dimming. */
export interface ShotsRead {
  name: string
  icon: { image: number; box: ShotBox; wordmark: boolean } | null
  banners: Array<{ image: number; box: ShotBox }>
  dimmed: number[]
}

/** Screenshots sent to match the brand, as the browser read them, for the logo the start places. */
export interface BrandContext {
  shots: BrandShot[]
  name: string
  icon: ShotsRead['icon']
  /** Each screenshot's warning before sending (dimmed by a pop-up, or under a banner), kept or not. */
  warnings?: ReadonlyArray<'dimmed' | 'banner' | null>
}

export type DesignAiTurn =
  | { role: 'user'; text: string; palette?: string[]; images?: string[] }
  | {
      role: 'assistant'
      text: string
      changes?: AppliedDesignChange[]
      /** A brand match, said in one line of the parts it matched. */
      matched?: boolean
      /** What the solver adjusted to keep text readable after these changes. */
      readability?: string[]
      /** The logo a brand match placed, which its card can adjust. */
      brand?: BrandLogo
      /** The part the changes were made in, such as "Headline". */
      where?: string
      /** The request, to ask again about the whole site when it reached outside the section. */
      widen?: string
      /** Questions a brand match's screenshots could not settle, asked quietly. */
      asks?: string[]
      /** What a brand match left as it was, and why. */
      notes?: string[]
      /** Follow-up requests, each of which fills the request box. */
      chips?: string[]
      /** How a brand match's check went, round by round, for the record. */
      check?: CheckReport
      /** The edit loop's steps: what each did and what it checked. */
      trail?: string[]
      /** The capture of the brand's site a match was made from, with the address to capture again. */
      capture?: BrandMatchCapture & { url: string }
      /** The brand's own face a match drew in the nearest bundled one, offered for upload. */
      font?: UnmatchedFont
    }

/** The logo a brand match placed: cut from one screenshot, as an icon and title or a full logo. */
export interface BrandLogo {
  shot: BrandShot
  box: ShotBox
  full: boolean
  title: string | null
}

type Report = {
  adjustments: DesignAdjustment[]
  errors: string[]
  css: Array<{ message: string; line?: number; fix?: { find: string; replace: string } }>
}

/** A request as its undo step's name: its own words, short. */
export function requestLabel(text: string): string {
  const words = text.trim().replace(/\s+/g, ' ')
  if (!words) return 'Change'
  const short = words.length > 40 ? `${words.slice(0, 39).trimEnd()}…` : words
  return short.charAt(0).toUpperCase() + short.slice(1)
}

/** What a request that failed on its way says; the draft is as it was. */
const FAILED = 'Something went wrong, so nothing changed. Try again.'

/**
 * The Appearance conversation. A request's changes are already in the draft
 * when the answer arrives; the conversation only reports them.
 */
export function useDesignAi({
  flush,
  adopt,
  update,
  workspaceName,
  view,
  check,
}: {
  /** Saves a pending draft change first, so the server reads the latest draft. */
  flush: () => Promise<void>
  adopt: (design: PortalDesign, report: Report, label?: string, revision?: string) => void
  /** Changes the draft as one named step, as the logo a brand match places is; `ai` when the AI makes it. */
  update: (change: (draft: PortalDesign) => void, label?: string, by?: 'ai') => void
  /** The workspace's name, which a title read from screenshots only replaces when it differs. */
  workspaceName: string
  /** The page and language the person sees, so a request is read, and words written, for them. */
  view?: { page: DesignerPage; locale: SupportedLocale }
  /** The draft and canvas hooks the check after a brand match needs; without them it is skipped. */
  check?: DesignCheckHooks
}) {
  const [turns, setTurns] = useState<DesignAiTurn[]>([])
  // What is being worked on just now, said as a stage, or null when nothing is.
  const [stage, setStage] = useState<string | null>(null)
  // A brand match's stages so far, as the server reports them.
  const [steps, setSteps] = useState<string[]>([])
  const busy = stage !== null
  const setBusy = (on: boolean) => setStage(on ? 'Working on it…' : null)
  // Why Ask AI cannot run this allowance window, once the server has said so.
  const [limited, setLimited] = useState<string | null>(null)
  // Whether the draft now holds anything Quackback AI put there, for the publish event.
  const shaped = useRef(false)
  const seen = useRef(view)
  seen.current = view
  const say = (turn: DesignAiTurn) => setTurns((previous) => [...previous, turn])
  // The request running, which Stop aborts.
  const running = useRef<AbortController | null>(null)
  /** A request starts: its signal, which Stop aborts. */
  const started = () => {
    const controller = new AbortController()
    running.current = controller
    return controller.signal
  }
  /** A request ends, unless a newer one has started since. */
  const ended = (signal: AbortSignal) => {
    if (running.current?.signal === signal) running.current = null
  }
  /** Why a request ended early: Stop, said as such, or a failure. */
  const failed = (signal: AbortSignal) =>
    say({ role: 'assistant', text: signal.aborted ? stoppedReply(false) : FAILED })
  /**
   * Stops the request running: the server takes no further step, what
   * already applied stays (with its Undo), and the conversation says so.
   */
  const stop = useCallback(() => running.current?.abort(), [])
  /** A refusal said in the conversation; one for the allowance is kept to show in place of the composer. */
  const refused = (result: { code: string; message: string }, prefix = '') => {
    if (result.code === 'AI_LIMIT') setLimited(result.message)
    say({ role: 'assistant', text: `${prefix}${result.message}` })
  }

  /**
   * The logo a brand match places from screenshots: the mark the read found,
   * fitted to its own pixels, as the icon with the title, or as a full logo
   * when it is a wordmark. None when no mark was found or it cannot be stored.
   */
  const placeLogo = useCallback(
    async (brand: BrandContext): Promise<BrandLogo | null> => {
      const shot = brand.icon && brand.shots[brand.icon.image]
      if (!brand.icon || !shot) return null
      const box = snapToMark(shot.pixels, shot.pixelWidth, shot.pixelHeight, brand.icon.box)
      const full = readAsWordmark({
        wordmark: brand.icon.wordmark,
        width: box.w * shot.width,
        height: box.h * shot.height,
      })
      const logo = { shot, box, full, title: titleToSet(brand.name, workspaceName) }
      try {
        const change = await brandLogoChange(shot, box, { full, title: logo.title })
        update(change, full ? 'Full logo' : 'Icon and title', 'ai')
        return logo
      } catch {
        return null
      }
    },
    [update, workspaceName]
  )

  /**
   * A brand matched from screenshots, on the server in stages, each shown as
   * it starts: the changes land in the draft as one step, with the logo cut
   * there; when the server places no logo, the mark read before sending is
   * placed from the browser, as before.
   */
  const matchBrand = useCallback(
    async (
      text: string,
      attachments: ChatImage[],
      given: BrandContext | null,
      website?: { url: string; recapture?: boolean },
      signal?: AbortSignal
    ) => {
      await flush()
      const result = await streamBrandMatch(
        {
          message: text,
          images: (given?.shots ?? []).map((shot, index) => ({
            palette: attachments[index]?.palette ?? [],
            image: shot.jpeg,
            analysis: shot.analysis,
            ...(shot.strip && { strip: shot.strip }),
            ...(shot.hero && { hero: shot.hero }),
            width: shot.width,
            height: shot.height,
            ...(given?.warnings?.[index] && {
              told: given.warnings[index] === 'dimmed' ? { dimmed: true } : { banner: true },
            }),
          })),
          ...(given?.name.trim() ? { brand: given.name.trim() } : {}),
          ...(seen.current?.locale ? { locale: seen.current.locale } : {}),
          ...(website && { url: website.url }),
          ...(website?.recapture && { recapture: true }),
        },
        (step) => {
          setStage(`${step}…`)
          setSteps((now) => [...now, step])
        },
        undefined,
        signal
      )
      if (!result.ok) {
        refused(result)
        return
      }
      // A website matched alone: its capture stands in for a screenshot, for the logo's card.
      const captured = !given && result.capture ? await shotOf(result.capture.image) : null
      const brand: BrandContext = given ?? {
        shots: captured ? [captured] : [],
        name: '',
        icon: null,
      }
      const target = result.target
      const checking =
        !!check && !!target?.checkable && !!result.report && result.applied.length > 0
      // The match, its logo and every revision the check keeps undo as one step.
      if (checking) check.begin('Match your brand')
      try {
        if (result.report && result.revision && result.applied.length > 0)
          adopt(result.design, result.report, 'Match your brand', result.revision)
        const placed = result.logo && brand.shots[result.logo.image]
        const logo: BrandLogo | null = placed
          ? {
              shot: placed,
              box: result.logo!.box,
              full: result.logo!.full,
              title: result.logo!.title,
            }
          : await placeLogo(brand)
        trackBuilder('designer_brand_matched', {
          images: attachments.length,
          changes: result.applied.length,
        })
        shaped.current = true
        designerLookChosen('ai')
        say({
          role: 'assistant',
          text: result.reply,
          changes: result.applied,
          matched: true,
          readability: result.readability,
          ...(logo ? { brand: logo } : {}),
          ...(result.asks?.length ? { asks: result.asks } : {}),
          ...(result.notes?.length ? { notes: result.notes } : {}),
          ...(result.chips?.length ? { chips: result.chips } : {}),
          ...(result.capture && website
            ? { capture: { ...result.capture, url: website.url } }
            : {}),
          ...(result.font ? { font: result.font } : {}),
        })
        // Stopped once the match landed: it stays, and the check does not start.
        if (!checking || !target || signal?.aborted) return
        // The verified critic loop: read the drawn preview, score it against what was
        // measured, and keep a revision only when the measured match improves.
        setSteps((now) => [...now, CHECK_STEP])
        const report = await checkBrandMatch(
          {
            target: target.fingerprint,
            shots: brand.shots.map((shot) => shot.jpeg),
            ...(brand.name.trim() ? { brand: brand.name.trim().slice(0, 60) } : {}),
            paths: target.paths ?? result.applied.map((c) => c.path),
            palette: measuredPalette(target),
            design: result.design,
          },
          {
            frame: check.frame,
            ...(check.open ? { open: check.open } : {}),
            show: (design) => check.replace(design, 'Match your brand'),
            flush,
            progress: (text) => {
              setStage(`${text}…`)
              setSteps((now) => [...now.filter((step) => !step.startsWith(CHECK_STEP)), text])
            },
          }
        )
        const kept = report.rounds.filter((r) => r.round > 0 && r.kept).flatMap((r) => r.changes)
        setTurns((previous) => {
          const at = previous.findLastIndex((turn) => turn.role === 'assistant')
          return previous.map((turn, index) => {
            if (index !== at || turn.role !== 'assistant') return turn
            const changes = [...(turn.changes ?? [])]
            for (const c of kept) {
              const after = c.value as DesignValue
              const had = changes.findIndex((each) => each.path === c.path)
              if (had >= 0) changes[had] = { ...changes[had]!, after, why: c.why }
              else
                changes.push({
                  path: c.path,
                  before: valueAt(result.design, c.path),
                  after,
                  why: c.why,
                })
            }
            // How the check went is kept for the record, not said: the reply stays one line.
            return { ...turn, changes, check: report }
          })
        })
        trackBuilder('designer_brand_checked', {
          rounds: report.rounds.length - 1,
          kept: kept.length,
          stopped: report.stopped,
        })
      } finally {
        if (checking) check.end()
      }
    },
    [flush, adopt, placeLogo, check]
  )

  const ask = useCallback(
    async (
      text: string,
      scope: DesignAiScope,
      attachments?: ChatImage[],
      /** A Home block picked in the designer, which narrows a Home request to it. */
      blockId?: string,
      /** Screenshots as the browser read them, for a brand matched from them. */
      brand?: BrandContext,
      /** An element picked on the canvas, which "just this" names. */
      element?: AiElementPick
    ) => {
      const images = attachments?.length ?? 0
      // A website named with screenshots is read beside them; named alone, it is captured.
      const site =
        isSiteStart(text) || (!!brand && isBrandStart(text, images)) ? websiteIn(text) : null
      const matching =
        (!!brand && isBrandStart(text, images)) || (!!site && (images === 0 || !!brand))
      const thumbnails = (attachments ?? []).flatMap((attached) =>
        attached.image ? [attached.image] : []
      )
      setStage(matching ? 'Matching your brand…' : 'Working on it…')
      const signal = started()
      const history = turns.map((turn) => ({ role: turn.role, content: turn.text }))
      say({ role: 'user', text, ...(thumbnails.length ? { images: thumbnails } : {}) })
      try {
        if (matching) {
          await matchBrand(
            text,
            attachments ?? [],
            brand ?? null,
            site ? { url: site } : undefined,
            signal
          )
          return
        }
        await flush()
        // States, looks by feel, pictures to match, contrast and element styles take the
        // loop (act, check what was drawn, correct); plain changes take one call.
        const route =
          check?.current &&
          routeRequest(STYLE_REGISTRY, { message: text, images: attachments?.length ?? 0 })
        if (check?.current && route && route.mode === 'loop') {
          check.begin(requestLabel(text))
          // The captures read_website brought, to show beside the reply.
          const captures = new Map<string, string>()
          const found: string[] = []
          try {
            const result = await runBuilderEditLoop(
              {
                message: text,
                scope,
                ...(blockId ? { blockId } : {}),
                ...(element ? { element } : {}),
                history,
                ...(attachments?.length ? { images: attachments } : {}),
                ...(seen.current ?? {}),
                design: check.current(),
                targets: route.targets,
                budget: LOOP_BUDGET,
                signal,
              },
              {
                step: async (body) =>
                  (await designAgentStepFn({ data: body, signal })) as ServerStep,
                adopt: (design, report, revision) =>
                  adopt(design, report as Report, requestLabel(text), revision),
                ...(check.open ? { open: check.open } : {}),
                previewCss: (design) => designPreview(design).css,
                readWebsite: async (url) => {
                  const read = await readWebsiteFn({ data: { url } })
                  if (read.capture) captures.set(read.reading.host ?? url, read.capture)
                  found.push(readingSummary(read.reading))
                  return read
                },
                matchWebsite: async (url) => {
                  const matched = await streamBrandMatch(
                    { message: '', images: [], url },
                    () => {},
                    undefined,
                    signal
                  )
                  if (!matched.ok)
                    return {
                      match: {
                        ok: false,
                        host: url,
                        reply: matched.message,
                        changed: [],
                        notes: [],
                      },
                      design: null,
                      applied: [],
                    }
                  if (matched.report && matched.revision && matched.applied.length > 0)
                    adopt(matched.design, matched.report, requestLabel(text), matched.revision)
                  return {
                    match: {
                      ok: true,
                      host: matched.capture?.host ?? url,
                      reply: matched.reply,
                      changed: matched.applied.map((c) => c.path),
                      notes: matched.notes ?? [],
                    },
                    design: matched.design,
                    applied: matched.applied,
                  }
                },
                progress: (line) => {
                  setStage(`${line}…`)
                  setSteps((now) => [...now, line])
                },
              }
            )
            if (!result.ok) {
              refused(result)
              return
            }
            if (result.applied.length > 0) shaped.current = true
            const [shown] = captures.entries()
            say({
              role: 'assistant',
              text: result.reply,
              changes: result.applied,
              trail: trailOf(result.steps),
              ...(found.length ? { notes: found } : {}),
              ...(shown && {
                capture: {
                  host: shown[0],
                  url: shown[0],
                  image: shown[1],
                  cached: true,
                  capturedAt: new Date().toISOString(),
                  againFrom: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                },
              }),
              ...(scope !== 'site' ? { where: SCOPE_LABEL[scope] } : {}),
            })
          } finally {
            check.end()
          }
          return
        }
        const result = await askPortalDesignAiFn({
          data: {
            message: text,
            scope,
            ...(blockId ? { blockId } : {}),
            ...(element ? { element } : {}),
            history,
            ...(attachments?.length ? { images: attachments } : {}),
            ...(seen.current ?? {}),
          },
          signal,
        })
        if (!result.ok) {
          refused(result)
          return
        }
        if ('report' in result && result.applied.length > 0) {
          adopt(result.design, result.report, requestLabel(text), result.revision)
          shaped.current = true
        }
        say({
          role: 'assistant',
          text: result.reply,
          changes: result.applied,
          readability: result.readability,
          ...(scope !== 'site' ? { where: SCOPE_LABEL[scope] } : {}),
          ...(result.outOfScope ? { widen: text } : {}),
        })
      } catch {
        failed(signal)
      } finally {
        ended(signal)
        setBusy(false)
        setSteps([])
      }
    },
    [turns, flush, adopt, matchBrand]
  )

  /**
   * Changes the logo a brand match placed, from its card: the crop adjusted,
   * or shown as a full logo or as the icon and title, as one named step.
   */
  const adjustLogo = useCallback(
    async (at: number, next: { box?: ShotBox; full?: boolean }) => {
      const turn = turns[at]
      if (turn?.role !== 'assistant' || !turn.brand) return
      const logo = { ...turn.brand, ...next }
      const change = await brandLogoChange(logo.shot, logo.box, {
        full: logo.full,
        title: logo.title,
      })
      update(change, logo.full ? 'Full logo' : 'Icon and title')
      trackBuilder('designer_brand_logo_changed', {
        how: next.box ? 'adjusted' : logo.full ? 'full_logo' : 'icon',
      })
      setTurns((previous) =>
        previous.map((each, index) =>
          index === at && each.role === 'assistant' ? { ...each, brand: logo } : each
        )
      )
    },
    [turns, update]
  )

  /** Captures the brand's site again and matches it, from a capture's Capture again. */
  const recapture = useCallback(
    async (url: string) => {
      setStage('Matching your brand…')
      const signal = started()
      try {
        await matchBrand('', [], null, { url, recapture: true }, signal)
      } catch {
        failed(signal)
      } finally {
        ended(signal)
        setBusy(false)
        setSteps([])
      }
    },
    [matchBrand]
  )

  /**
   * A brand match started outside the chat, such as from Theme's Brand kit or
   * a hand-off from onboarding: the brand's website, up to three screenshots,
   * or both. It runs as one typed in Ask AI does and shows in the conversation,
   * its changes one undo step. Nothing given, nothing runs.
   */
  const startBrandMatch = useCallback(
    async ({
      website,
      screenshots = [],
      from,
    }: {
      website?: string
      screenshots?: readonly File[]
      from: MatchFrom
    }) => {
      const site = website?.trim() || null
      if (!site && !screenshots.length) return
      setStage('Matching your brand…')
      const signal = started()
      try {
        const { attachments, brand } = await readMatchShots(screenshots)
        trackBuilder('designer_brand_match_started', {
          from,
          website: !!site,
          screenshots: attachments.length,
        })
        const thumbnails = attachments.flatMap((each) => (each.image ? [each.image] : []))
        say({
          role: 'user',
          text: site ?? 'Match my brand',
          ...(thumbnails.length ? { images: thumbnails } : {}),
        })
        if (!site && !brand) {
          say({ role: 'assistant', text: 'Those screenshots could not be read. Try others.' })
          return
        }
        await matchBrand(
          site ? '' : 'Match my brand',
          attachments,
          brand,
          site ? { url: site } : undefined,
          signal
        )
      } catch {
        failed(signal)
      } finally {
        ended(signal)
        setBusy(false)
        setSteps([])
      }
    },
    [matchBrand]
  )

  /** Adds a turn made elsewhere, so its changes show here with Undo. */
  const record = say
  return {
    turns,
    busy,
    stage,
    steps,
    limited,
    ask,
    stop,
    adjustLogo,
    recapture,
    startBrandMatch,
    shaped,
    record,
  }
}

/** A capture, as a screenshot the browser has read, for the logo's card; null when it cannot be read. */
async function shotOf(dataUrl: string): Promise<BrandShot | null> {
  try {
    const blob = await (await fetch(dataUrl)).blob()
    return await readBrandShot(new File([blob], 'capture.jpg', { type: 'image/jpeg' }))
  } catch {
    return null
  }
}
