/**
 * The brand match's inputs, dependencies and result (brand-match.ts).
 */
import type { Measures } from './measure-shots'
import type { AppliedDesignChange, UntrustedChanges } from '@/lib/shared/design/apply-changes'
import type { Fingerprint } from '@/lib/shared/design/fingerprint'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { UnmatchedFont } from '@/lib/shared/design/match-brand'
import type { FoundElements } from '../extract/finder'
import type { MeasuredDesign } from '../extract/measured-design'
import type { Image } from '../extract/png'
import type { RolesCaller } from '../extract/roles-classifier'
import type { ColourRoles } from '../extract/roles'
import type { SiteRead } from '../site/types'
import type { FamilyCaller } from './brand-brief'
import type { TypeMatches } from './brand-fonts'
import type { Shot } from './brand-measure'
import type * as heroPhoto from './brand-photo'
import type { DesignAiResult } from './design-ai'
import type { BrandStep } from './brand-match'
import type { SiteAssetStore, SiteUse } from './brand-site-use'

export interface BrandShotInput {
  /** The screenshot at CSS-pixel width, for the finder and the tools. */
  analysis: string
  /** The top of the page at its own resolution, lossless, for the logo and the fonts. */
  strip?: string
  /** The first screen at its own resolution, JPEG, for a hero photo taller than the strip. */
  hero?: string
  /** The screenshot's own size. */
  width: number
  height: number
  /** What the builder warned about it before sending (the person kept it anyway). */
  told?: { dimmed?: boolean; banner?: boolean }
}

export interface BrandMatchDeps {
  find: (img: Image) => Promise<FoundElements | null>
  /** The colour roles classifier, or null to keep the rules' defaults. */
  roles: RolesCaller | null
  family: FamilyCaller
  /** Stores the logo cutout, giving its key, or null when it cannot be stored. */
  storeLogo: (png: Uint8Array) => Promise<string | null>
  /** Stores a hero photo cut from a screenshot (JPEG), giving its key; absent, none is proposed. */
  storePhoto?: heroPhoto.PhotoStore
  /** The previous whole-look match, for when the screenshots cannot be read. */
  fallback: () => Promise<DesignAiResult>
  now?: () => number
  /** The font stage, off the request thread by default; gives no match past `deadlineMs`. */
  matchType?: (shot: Shot, deadlineMs: number) => Promise<TypeMatches>
  /** The measure stage, off the request thread by default. */
  measure?: (shots: readonly Shot[], primary: Shot) => Promise<Measures>
  /** Stores an image from the brand's site (favicon, logo, share image), giving its key. */
  storeAsset?: SiteAssetStore
}

export interface BrandMatchInput {
  design: PortalDesign
  shots: BrandShotInput[]
  /** The brand's name as read before sending, or the workspace's. */
  name: string | null
  workspaceName: string
  allows: Omit<UntrustedChanges, 'links'> & { gates: PortalPageGates }
  locale?: string
  /** The brand's website, read (or being read) beside the screenshots. */
  site?: SiteRead | Promise<SiteRead | null> | null
}

export type BrandMatchResult = Extract<DesignAiResult, { ok: true }> & {
  applied: Array<AppliedDesignChange & { why?: string }>
  asks: string[]
  notes: string[]
  chips: string[]
  /** The logo placed, where it was cut from, for its card. */
  logo: {
    image: number
    box: { x: number; y: number; w: number; h: number }
    full: boolean
    title: string | null
  } | null
  /** Each stage's time, ms. */
  timings: Partial<Record<BrandStep | 'apply', number>>
  /** What was measured, for the critic loop to compare the drawn preview with. */
  target: {
    measured: MeasuredDesign | null
    roles: ColourRoles | null
    /** The same, as a fingerprint by the rig's roles. */
    fingerprint: Fingerprint
    /** Whether the match finished inside its budget, so the loop may run after it. */
    checkable: boolean
    /** The fields the match set, changed or already as it chose: what a revision may touch. */
    paths: string[]
  } | null
  /** What the brand's site gave, when it was read. */
  site?: SiteUse | null
  /** The site's own face no bundled face is, for the reply's "Upload <family>". */
  font?: UnmatchedFont
  /** The fonts drawn are only the nearest to the brand's, so the summary does not claim them. */
  fontsNearest?: boolean
}
