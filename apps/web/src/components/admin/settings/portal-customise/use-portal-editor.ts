import { useCallback, useMemo, useRef, useState } from 'react'
import { useBlocker } from '@tanstack/react-router'
import { toast } from 'sonner'
import { track } from '@/lib/client/analytics'
import { usePublishPortalCustomisation } from '@/lib/client/mutations/settings'
import {
  describePlanRefusal,
  describePlanUpgrade,
  isPlanRefusal,
  type UpgradeDescription,
} from '@/lib/shared/describe-upgrade'
import type { BrandAsset } from '@/lib/shared/theme/brand-import'
import type {
  PortalCustomisePart,
  PortalCustomiseValues,
  PublishPortalCustomisationResult,
} from '@/lib/shared/schemas/portal-customise'
import {
  applyToHistory,
  brandAssetKey,
  brokenNavLink,
  carriedAssets,
  draftChanges,
  draftFromLoaded,
  draftRemainder,
  publishedFromLoaded,
  publishInput,
  redoHistory,
  startHistory,
  undoHistory,
  type LoadedPortal,
  type ImportedBrand,
  type PortalDraft,
} from './portal-draft'

/**
 * What the preview shows: the draft (After), the draft as it was just before
 * the last change (Before), or the published look (Live).
 */
export type CompareView = 'before' | 'after' | 'live'

type Conflict = Extract<PublishPortalCustomisationResult, { ok: false }>

/**
 * A publish waiting on the person: it would put live imported brand assets
 * nobody has confirmed yet, and those are listed for them to confirm or drop.
 */
export interface AssetCheck {
  brand: ImportedBrand
  assets: BrandAsset[]
  /** The publish was to leave the Advanced CSS out, as its confirmed one does. */
  parkCss: boolean
}

/** A plan refusal: what the plan lacks, and whether it is the Advanced CSS rules alone. */
export interface PlanRefusal {
  description: UpgradeDescription
  customCss: boolean
}

/** The parts of a conflict, in the words the conflict dialog lists them with. */
const PART_NAMES: Record<PortalCustomisePart, string> = {
  headerName: 'Name in the header',
  theme: 'Colours, font and shape',
  customCss: 'Advanced CSS',
  'portal.nav': 'Tabs',
  'portal.welcomeCard': 'Welcome message',
  'helpCenter.homepageTitle': 'Help Center title',
  'helpCenter.homepageDescription': 'Help Center description',
  'helpCenter.headerLinks': 'Help Center links',
  'logo.wideKey': 'Logo',
  'logo.darkKey': 'Logo',
  'logo.headerDisplayMode': 'Logo',
  'logo.icon': 'Icon',
}

export const conflictPartNames = (parts: PortalCustomisePart[]) => [
  ...new Set(parts.map((part) => PART_NAMES[part])),
]

/** `base` with the parts in `values` replaced (portal and Help Center field by field). */
function mergeValues(
  base: PortalCustomiseValues,
  values: PortalCustomiseValues
): PortalCustomiseValues {
  return {
    ...base,
    ...values,
    portal: { ...base.portal, ...values.portal },
    helpCenter: { ...base.helpCenter, ...values.helpCenter },
    logo: { ...base.logo, ...values.logo },
  }
}

/** The draft as the published values give it, for the parts someone else changed. */
function withTheirs(draft: PortalDraft, theirs: PortalDraft, parts: PortalCustomisePart[]) {
  const next = { ...draft }
  if (parts.includes('theme') || parts.includes('customCss')) {
    next.cssText = theirs.cssText
    next.themeMode = theirs.themeMode
    next.buttonShape = theirs.buttonShape
    next.cardStyle = theirs.cardStyle
    if (theirs.customFont) next.customFont = theirs.customFont
    else delete next.customFont
    if (theirs.customHeadingFont) next.customHeadingFont = theirs.customHeadingFont
    else delete next.customHeadingFont
    if (theirs.headingScope) next.headingScope = theirs.headingScope
    else delete next.headingScope
  }
  if (parts.includes('headerName')) next.headerName = theirs.headerName
  if (parts.includes('logo.wideKey')) next.logo = { ...next.logo, wideKey: theirs.logo.wideKey }
  if (parts.includes('logo.darkKey')) {
    const { darkKey: _mine, ...logo } = next.logo
    next.logo = theirs.logo.darkKey ? { ...logo, darkKey: theirs.logo.darkKey } : logo
  }
  if (parts.includes('logo.headerDisplayMode')) next.logo = { ...next.logo, mode: theirs.logo.mode }
  if (parts.includes('logo.icon')) next.logo = { ...next.logo, icon: theirs.logo.icon }
  if (parts.includes('portal.nav')) next.nav = theirs.nav
  if (parts.includes('portal.welcomeCard')) next.welcomeBody = theirs.welcomeBody
  if (next.helpCenter && theirs.helpCenter) {
    const helpCenter = { ...next.helpCenter }
    if (parts.includes('helpCenter.homepageTitle'))
      helpCenter.homepageTitle = theirs.helpCenter.homepageTitle
    if (parts.includes('helpCenter.homepageDescription'))
      helpCenter.homepageDescription = theirs.helpCenter.homepageDescription
    if (parts.includes('helpCenter.headerLinks'))
      helpCenter.headerLinks = theirs.helpCenter.headerLinks
    next.helpCenter = helpCenter
  }
  return next
}

function loadedFromValues(values: PortalCustomiseValues, hasHelpCenter: boolean): LoadedPortal {
  return {
    headerName: values.headerName ?? '',
    theme: values.theme ?? {},
    customCss: values.customCss ?? '',
    portal: {
      nav: values.portal?.nav ?? undefined,
      welcomeCard: values.portal?.welcomeCard ?? undefined,
    } as LoadedPortal['portal'],
    helpCenter: hasHelpCenter ? (values.helpCenter as LoadedPortal['helpCenter']) : null,
    logo: {
      wideKey: values.logo?.wideKey ?? null,
      darkKey: values.logo?.darkKey ?? null,
      mode: values.logo?.headerDisplayMode ?? 'logo_and_name',
      icon: values.logo?.icon ?? null,
    },
  }
}

/**
 * The Customise draft and everything around it: one history (undo and redo,
 * a drag or a typing burst as one step), what changed against what is live,
 * Before and Live to look back at in the preview, the leave guard, and one
 * atomic publish with its two refusals (a plan that
 * lacks a part, someone else's change) answered in place.
 */
export function usePortalEditor(loaded: LoadedPortal) {
  const publishMutation = usePublishPortalCustomisation()
  const [history, setHistory] = useState(() => startHistory(draftFromLoaded(loaded)))
  const [baseline, setBaseline] = useState(history.present)
  const published = useRef(publishedFromLoaded(loaded))
  const hasHelpCenter = loaded.helpCenter !== null
  // Advanced CSS rules the plan refused, kept in the draft but not sent.
  const [parkedCss, setParkedCss] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [planRefusal, setPlanRefusal] = useState<PlanRefusal | null>(null)
  // The last import, for the confirmation a publish of its brand assets asks for.
  const importedBrand = useRef<ImportedBrand | null>(null)
  const setImportedBrand = useCallback((value: ImportedBrand | null) => {
    importedBrand.current = value
  }, [])
  // The files of brand assets the person confirmed in this session: a retry
  // of the same publish (their change kept, the rest published) never asks again.
  const confirmedKeys = useRef(new Set<string>())
  const [assetCheck, setAssetCheck] = useState<AssetCheck | null>(null)

  const draft = history.present
  const remainder = useMemo(() => draftRemainder(draft), [draft])
  const parked = parkedCss !== null && parkedCss === remainder && remainder !== ''
  const changes = useMemo(() => {
    const all = draftChanges(baseline, draft)
    return parked ? all.filter((change) => change !== 'Advanced CSS') : all
  }, [baseline, draft, parked])
  const dirty = changes.length > 0

  // Looking back is tied to the draft it was chosen on: any new draft (an
  // edit, an undo, their change loaded) shows After again, with no effect.
  const [compare, setCompare] = useState<{ view: CompareView; at: PortalDraft } | null>(null)
  const previous = history.past.at(-1) ?? null
  const canBefore = previous !== null
  const canLive = useMemo(() => draftChanges(baseline, draft).length > 0, [baseline, draft])
  const chosen = compare?.at === draft ? compare.view : 'after'
  const view: CompareView =
    (chosen === 'before' && !canBefore) || (chosen === 'live' && !canLive) ? 'after' : chosen
  const shown = view === 'before' ? previous! : view === 'live' ? baseline : draft
  const setView = useCallback(
    (next: CompareView) => setCompare(next === 'after' ? null : { view: next, at: draft }),
    [draft]
  )

  const update = useCallback(
    (edit: (draft: PortalDraft) => PortalDraft, burst?: string) =>
      setHistory((h) => applyToHistory(h, edit(h.present), { burst })),
    []
  )
  const undo = useCallback(() => setHistory(undoHistory), [])
  const redo = useCallback(() => setHistory(redoHistory), [])

  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      dirty && !publishing && current.pathname !== next.pathname,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  })

  const publish = useCallback(
    async (
      options: {
        parkCss?: boolean
        /** The draft to publish, when it is newer than this render's (assets just dropped). */
        draft?: PortalDraft
        /** The imported brand assets the person just confirmed. */
        confirmed?: readonly BrandAsset[]
      } = {}
    ): Promise<boolean> => {
      const sent = options.draft ?? draft
      if (brokenNavLink(sent)) {
        toast.error('Fix the tab link before publishing. Links need a full https:// address.')
        return false
      }
      const parkCss = options.parkCss || (parkedCss !== null && parkedCss === remainder)
      const brand = importedBrand.current
      const probe = publishInput(baseline, sent, published.current, { parkCss })
      if (!probe) return false
      const carried = brand ? carriedAssets(probe, baseline, brand) : []
      // A portal on the site's own domain is the brand itself: nothing to ask,
      // and the record says nobody clicked (the server checks the domain itself).
      const onSite = brand?.portalOnSite === true
      if (brand && !onSite) {
        for (const asset of options.confirmed ?? []) {
          const key = brandAssetKey(brand, asset)
          if (key) confirmedKeys.current.add(key)
        }
        const unconfirmed = carried.filter((asset) => {
          const key = brandAssetKey(brand, asset)
          return !key || !confirmedKeys.current.has(key)
        })
        if (unconfirmed.length > 0) {
          setAssetCheck({ brand, assets: unconfirmed, parkCss })
          return false
        }
      }
      const input = brand
        ? publishInput(baseline, sent, published.current, {
            parkCss,
            brandAssets: { brand, confirmed: carried, preTicked: onSite ? carried : [] },
          })
        : probe
      if (!input) return false
      setAssetCheck(null)
      setPublishing(true)
      try {
        const result = await publishMutation.mutateAsync(input)
        published.current = mergeValues(published.current, result.published)
        setBaseline(sent)
        if (parkCss) setParkedCss(draftRemainder(sent) || null)
        else if (input.customCss !== undefined) setParkedCss(null)
        void track('portal_customise_published', { parts: result.parts })
        toast.success(`Published. Live on ${window.location.host}.`)
        return true
      } catch (error) {
        const refusal = (error as { conflict?: Conflict }).conflict
        if (refusal) {
          setConflict(refusal)
        } else if (isPlanRefusal(error)) {
          const description = describePlanRefusal(
            error,
            describePlanUpgrade('Custom colours', 'business', { plural: true })
          )
          setPlanRefusal({ description, customCss: description.feature === 'Custom CSS' })
        }
        return false
      } finally {
        setPublishing(false)
      }
    },
    [draft, baseline, parkedCss, remainder, publishMutation]
  )

  /** After a plan refusal of the Advanced CSS: publish everything else, rules parked. */
  const publishRest = useCallback(() => {
    setPlanRefusal(null)
    return publish({ parkCss: true })
  }, [publish])

  /** Someone else's change stands only where they made it: publish over it. */
  const keepMine = useCallback(() => {
    if (!conflict) return Promise.resolve(false)
    published.current = mergeValues(published.current, conflict.current)
    setConflict(null)
    return publish()
  }, [conflict, publish])

  /** Take someone else's change into the draft (and as live), for the parts they changed. */
  const loadTheirs = useCallback(() => {
    if (!conflict) return
    published.current = mergeValues(published.current, conflict.current)
    const theirs = draftFromLoaded(loadedFromValues(published.current, hasHelpCenter))
    setBaseline((b) => withTheirs(b, theirs, conflict.parts))
    setHistory((h) => applyToHistory(h, withTheirs(h.present, theirs, conflict.parts)))
    setConflict(null)
  }, [conflict, hasHelpCenter])

  /** Back to what is live, as one undoable step. */
  const discard = useCallback(() => {
    setHistory((h) => applyToHistory(h, baseline))
  }, [baseline])

  return {
    draft,
    baseline,
    update,
    /** The last import (or none), kept for the next publish. */
    setImportedBrand,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    /** The draft just before the last change, if there was one. */
    previous,
    /** Which look the preview shows; it never changes the draft. */
    view,
    setView,
    /** The draft the preview shows for that view. */
    shown,
    canBefore,
    canLive,
    changes,
    dirty,
    /** The Advanced CSS rules are in the draft but not live (the plan refused them). */
    parked,
    publishing,
    publish,
    publishRest,
    discard,
    conflict,
    keepMine,
    loadTheirs,
    dismissConflict: () => setConflict(null),
    planRefusal,
    dismissPlanRefusal: () => setPlanRefusal(null),
    /** A publish waiting for the person to confirm its imported brand assets. */
    assetCheck,
    dismissAssetCheck: () => setAssetCheck(null),
    blocker,
  }
}

export type PortalEditor = ReturnType<typeof usePortalEditor>
