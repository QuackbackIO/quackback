import { createServerFn } from '@tanstack/react-start'

/** Public: whether the Powered-by badge should render. Self-hosted is always true. */
export const getShowPoweredByFn = createServerFn({ method: 'GET' }).handler(async () => {
  const { getCloudConfig } = await import('@/lib/server/domains/settings/cloud/cloud.service')
  const { shouldShowPoweredBy } = await import('@/lib/server/domains/settings/cloud/powered-by')
  return shouldShowPoweredBy(await getCloudConfig())
})
