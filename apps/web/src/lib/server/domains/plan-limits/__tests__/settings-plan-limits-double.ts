/**
 * A stand-in for the settings plan limits readers over one set of sources.
 * `readCustomHostnames` derives its set from those sources with the real
 * `customHostnamesOf`, so the cheap check and the full read never disagree.
 *
 * Use with:
 *   vi.mock('@/lib/server/domains/settings/settings.plan-limits', async () =>
 *     (await import('@/lib/server/domains/plan-limits/__tests__/settings-plan-limits-double'))
 *       .settingsPlanLimitsDouble(() => sources))
 */
import { vi } from 'vitest'
import { customHostnamesOf } from '@/lib/server/domains/settings/settings.custom-hostnames'

type Sources = { cloudIdentity?: unknown; sectionHostnames?: string[] } & Record<string, unknown>

export function settingsPlanLimitsDouble(sources: () => Sources | null) {
  return {
    readPlanLimitsSources: vi.fn(async () => sources()),
    readCustomHostnames: vi.fn(async () => {
      const current = sources()
      return customHostnamesOf(current?.cloudIdentity ?? null, current?.sectionHostnames ?? [])
    }),
  }
}
