import type { UserId } from '@quackback/ids'
import { db, eq, user } from '@/lib/server/db'

export interface OnboardingProgress {
  tourSeenAt?: string
  /** The viewer chose Not now on the tour offer. */
  tourDismissedAt?: string
  firstWinShownAt?: string
}

const PROGRESS_KEYS = ['tourSeenAt', 'tourDismissedAt', 'firstWinShownAt'] as const

export function readOnboardingProgress(metadata: string | null): OnboardingProgress {
  try {
    const value = JSON.parse(metadata ?? '{}')?.onboarding
    const progress: OnboardingProgress = {}
    for (const key of PROGRESS_KEYS) {
      if (typeof value?.[key] === 'string') progress[key] = value[key]
    }
    return progress
  } catch {
    return {}
  }
}

/** Serialize per-user claims while preserving unrelated profile metadata. */
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
    if (!row || readOnboardingProgress(row.metadata)[key]) return false
    let metadata: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(row.metadata ?? '{}')
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) metadata = parsed
    } catch {
      /* Invalid metadata reads as an empty profile. */
    }
    const previous = metadata.onboarding
    const onboarding =
      previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {}
    await tx
      .update(user)
      .set({
        metadata: JSON.stringify({
          ...metadata,
          onboarding: { ...onboarding, [key]: new Date().toISOString() },
        }),
      })
      .where(eq(user.id, userId))
    return true
  })
}
