import { hashKey } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { BATCHED_READS } from '@/lib/server/read-registry'
import { settingsQueries } from '@/lib/client/queries/settings'

describe('the reads a loader may ask for together', () => {
  // A read missing from the registry is fetched in a request of its own. The
  // portal summary and the Customise editor warm all of these in one loader.
  it('holds every read the portal settings pages warm', () => {
    const registered = new Set(BATCHED_READS.map((read) => hashKey(read().queryKey)))
    for (const read of [
      settingsQueries.branding,
      settingsQueries.logo,
      settingsQueries.headerLogo,
      settingsQueries.customCss,
      settingsQueries.portalPageConfig,
    ]) {
      expect(registered.has(hashKey(read().queryKey)), read().queryKey.join('.')).toBe(true)
    }
  })
})
