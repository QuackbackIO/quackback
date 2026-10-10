import { config } from '@/lib/server/config'
import { isS3Usable } from '@/lib/server/storage/s3'

/**
 * The automatic lookup runs only when the operator has not switched it off
 * (`DISABLE_AUTOMATIC_BRANDING`) and workspace storage can hold the logo.
 */
export function automaticBrandingAvailable(): boolean {
  return config.disableAutomaticBranding !== true && isS3Usable()
}
