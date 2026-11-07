import { useQuery } from '@tanstack/react-query'
import { getAutomaticWebsiteBrandingStatusFn } from '@/lib/server/functions/website-branding'

/**
 * The workspace's website as far as the workspace knows it (the one its
 * website branding looked up, or its admins' company domain), to prefill
 * Match your brand. Null when unknown or not for this person to see.
 */
export function useBrandWebsite(): string | null {
  const status = useQuery({
    queryKey: ['designer', 'brand-website'],
    queryFn: () => getAutomaticWebsiteBrandingStatusFn(),
    staleTime: Infinity,
    retry: false,
  })
  return status.data?.domain ?? null
}
