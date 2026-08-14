/**
 * Teammate web-push registration helpers.
 *
 * Device rows already live in `push_devices` (APNs/FCM for the mobile agent
 * app). Browser web push uses the same preference matrix channel (`push`) and
 * registers a service-worker subscription when VAPID keys are configured.
 */
import { config } from '@/lib/server/config'

/** True when the workspace can deliver browser push (VAPID configured). */
export function isWebPushConfigured(): boolean {
  const publicKey = (config as { vapidPublicKey?: string }).vapidPublicKey
  const privateKey = (config as { vapidPrivateKey?: string }).vapidPrivateKey
  return Boolean(publicKey && privateKey)
}

/**
 * Public VAPID key for the service worker subscribe call, or null when push
 * is not configured. Safe to expose to authenticated teammates.
 */
export function getWebPushPublicKey(): string | null {
  const publicKey = (config as { vapidPublicKey?: string }).vapidPublicKey
  return publicKey && publicKey.length > 0 ? publicKey : null
}
