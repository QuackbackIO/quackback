import { describe, it, expect } from 'vitest'
import { updateWidgetConfigSchema } from '@/lib/server/functions/settings'

describe('updateWidgetConfigSchema', () => {
  it('keeps the launcher announcement switch', () => {
    const parsed = updateWidgetConfigSchema.parse({ changelog: { announceOnLauncher: true } })
    expect(parsed.changelog).toEqual({ announceOnLauncher: true })
  })

  it('rejects a non-boolean announcement switch', () => {
    const result = updateWidgetConfigSchema.safeParse({ changelog: { announceOnLauncher: 'yes' } })
    expect(result.success).toBe(false)
  })
})
