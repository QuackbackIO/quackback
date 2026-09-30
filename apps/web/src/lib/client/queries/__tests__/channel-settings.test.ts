/**
 * The Channels settings pages warm these reads from their loaders; each must
 * keep a fresh window (its own or the client default) so the card reading it
 * does not fetch the data the document just delivered again on mount.
 */
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { channelSettingsQueries } from '../channel-settings'

const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } })

type Options = Parameters<QueryClient['defaultQueryOptions']>[0]

describe('channelSettingsQueries', () => {
  it.each(Object.entries(channelSettingsQueries))(
    '%s stays fresh after it is warmed',
    (_, make) => {
      const { staleTime } = client.defaultQueryOptions((make as () => Options)())
      expect(typeof staleTime === 'number' && staleTime > 0).toBe(true)
    }
  )
})
