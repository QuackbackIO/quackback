/**
 * Cloudflare Custom Hostnames for SaaS
 *
 * Cloud-only integration for custom domain SSL certificates.
 * Used when CLOUD_CLOUDFLARE_API_TOKEN and CLOUD_CLOUDFLARE_ZONE_ID are configured.
 */

export { CloudflareClient, getCloudflareClient } from './client'
export {
  createCustomHostname,
  getCustomHostname,
  deleteCustomHostname,
  refreshCustomHostname,
} from './hostnames'
export type {
  CFCustomHostname,
  CFSSLConfig,
  CFSSLStatus,
  CFOwnershipStatus,
  CFValidationRecord,
  CFCreateHostnameResponse,
} from './types'

/**
 * Check if Cloudflare integration is configured
 */
export function isCloudflareConfigured(): boolean {
  return Boolean(process.env.CLOUD_CLOUDFLARE_API_TOKEN && process.env.CLOUD_CLOUDFLARE_ZONE_ID)
}
