/**
 * The spam filter settings hold two independent controls: the trusted-sender
 * list and the AI classifier switch. Saving one must keep the other, or
 * editing the list would silently turn the classifier back on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  stored: null as string | null,
  written: [] as string[],
}))

vi.mock('../settings.helpers', () => ({
  requireSettings: async () => ({ id: 'settings_1', spamFilterConfig: hoisted.stored }),
  requireSettingsCached: async () => ({ id: 'settings_1', spamFilterConfig: hoisted.stored }),
  invalidateSettingsCache: async () => {},
}))
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    update: () => ({
      set: (patch: { spamFilterConfig: string }) => ({
        where: async () => {
          hoisted.written.push(patch.spamFilterConfig)
          hoisted.stored = patch.spamFilterConfig
        },
      }),
    }),
  },
}))

import { updateSpamFilterConfig } from '../settings.spam'

beforeEach(() => {
  hoisted.stored = null
  hoisted.written = []
})

describe('updateSpamFilterConfig', () => {
  it('keeps the AI classifier off when only the trusted-sender list is saved', async () => {
    hoisted.stored = JSON.stringify({ trustedSenders: [], aiClassifier: false })
    const result = await updateSpamFilterConfig({ trustedSenders: ['acme.com'] })
    expect(result).toEqual({ trustedSenders: ['acme.com'], aiClassifier: false })
    expect(JSON.parse(hoisted.written[0])).toEqual(result)
  })

  it('keeps the trusted-sender list when only the switch is saved', async () => {
    hoisted.stored = JSON.stringify({ trustedSenders: ['jane@acme.com'], aiClassifier: false })
    const result = await updateSpamFilterConfig({ aiClassifier: true })
    expect(result).toEqual({ trustedSenders: ['jane@acme.com'], aiClassifier: true })
  })
})
