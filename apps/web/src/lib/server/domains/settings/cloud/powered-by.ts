import type { CloudConfig } from './cloud.types'

/**
 * Whether the "Powered by Quackback" badge should render on the portal,
 * widget, and branded emails.
 *
 * Self-hosted (cloud disabled) always shows it. `isEntitled('hideBranding')` is
 * the wrong check: that function is true when cloud is off, which would hide
 * the badge on every OSS install.
 */
export function shouldShowPoweredBy(config: CloudConfig): boolean {
  if (!config.enabled) return true
  return config.entitlements.hideBranding !== true
}
