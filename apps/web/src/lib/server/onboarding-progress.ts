import type { UserId } from '@quackback/ids'
import { db, eq, user } from '@/lib/server/db'

export interface OnboardingProgress {
  tourSeenAt?: string
  /** The viewer chose Not now on the tour offer. */
  tourDismissedAt?: string
  firstWinShownAt?: string
}

const PROGRESS_KEYS = ['tourSeenAt', 'tourDismissedAt', 'firstWinShownAt'] as const

/**
 * Where the markers live in `user.metadata`. Keys starting with `_` are
 * internal and never surface as custom attributes (People, the API,
 * workflows). Markers were once saved under `onboarding`, which is still read.
 */
const PROGRESS_KEY = '_onboarding'
const LEGACY_PROGRESS_KEY = 'onboarding'

type Metadata = Record<string, unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseMetadata(metadata: string | null): Metadata {
  try {
    const parsed: unknown = JSON.parse(metadata ?? '{}')
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function markersIn(value: unknown): OnboardingProgress {
  const progress: OnboardingProgress = {}
  if (!isRecord(value)) return progress
  for (const key of PROGRESS_KEYS) {
    if (typeof value[key] === 'string') progress[key] = value[key]
  }
  return progress
}

/** A legacy `onboarding` value that holds nothing but these markers. */
function isLegacyMarkers(value: unknown): value is OnboardingProgress {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => (PROGRESS_KEYS as readonly string[]).includes(key))
  )
}

export function readOnboardingProgress(metadata: string | null): OnboardingProgress {
  const parsed = parseMetadata(metadata)
  return { ...markersIn(parsed[LEGACY_PROGRESS_KEY]), ...markersIn(parsed[PROGRESS_KEY]) }
}

/**
 * The metadata with one marker set, or null when it is already set. Markers
 * under the legacy key move to the internal key; a customer attribute that
 * happens to be called `onboarding` is left as it is.
 */
export function withOnboardingMark(
  metadata: string | null,
  key: keyof OnboardingProgress,
  at: string
): string | null {
  if (readOnboardingProgress(metadata)[key]) return null
  const parsed = parseMetadata(metadata)
  const legacy = parsed[LEGACY_PROGRESS_KEY]
  const next: Metadata = { ...parsed }
  let markers: OnboardingProgress = markersIn(parsed[PROGRESS_KEY])
  if (isLegacyMarkers(legacy)) {
    markers = { ...markersIn(legacy), ...markers }
    delete next[LEGACY_PROGRESS_KEY]
  }
  next[PROGRESS_KEY] = { ...markers, [key]: at }
  return JSON.stringify(next)
}

/** Set a marker once, under a row lock so two tabs cannot both claim it. */
export async function markOnboardingProgress(
  userId: UserId,
  key: keyof OnboardingProgress
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ metadata: user.metadata })
      .from(user)
      .where(eq(user.id, userId))
      .for('update')
    if (!row) return false
    const metadata = withOnboardingMark(row.metadata, key, new Date().toISOString())
    if (!metadata) return false
    await tx.update(user).set({ metadata }).where(eq(user.id, userId))
    return true
  })
}
