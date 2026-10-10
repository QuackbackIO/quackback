import { QueryClient } from '@tanstack/react-query'
import { expect, it } from 'vitest'
import { refreshSettingsAreaQueries } from '../settings-proposal-cache'

it('refreshes a previously visited branding form and launch data after an automatic change', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  })
  const keys = [
    ['settings', 'branding'],
    ['settings', 'logo'],
    ['settings', 'headerLogo'],
    ['admin', 'onboarding'],
    ['settings', 'officeHours'],
  ] as const
  let version = 'original'
  for (const key of keys)
    await client.fetchQuery({
      queryKey: key,
      queryFn: async ({ queryKey }) => {
        expect(keys).toContainEqual(queryKey)
        return { key: queryKey, version }
      },
    })
  version = 'website'
  await refreshSettingsAreaQueries(client, ['branding'])
  for (const key of keys.slice(0, 4))
    expect(client.getQueryData(key)).toEqual({ key, version: 'website' })
  expect(client.getQueryData(keys[4])).toEqual({ key: keys[4], version: 'original' })
  version = 'original'
  await refreshSettingsAreaQueries(client, ['branding'])
  for (const key of keys) expect(client.getQueryData(key)).toEqual({ key, version: 'original' })
  client.clear()
})
