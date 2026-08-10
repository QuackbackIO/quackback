/**
 * The probe registry.
 *
 * Order is deliberate and the runner honours it. P02 consumes single-use
 * sign-in credentials and P07 drives a write whose derived rows the later scans
 * expect to see, so the families are not independent and are never run
 * concurrently.
 */

import { p01SessionCookie } from './p01-session-cookie'
import { p02MagicLinkOtp } from './p02-magic-link-otp'
import { p03StorageToken } from './p03-storage-token'
import { p04WidgetIdentify } from './p04-widget-identify'
import { p05ApiKey } from './p05-api-key'
import { p06SettingsCache } from './p06-settings-cache'
import { p07BackgroundJob } from './p07-background-job'
import { p08CrossRead } from './p08-cross-read'
import { p09AssistantPrincipal } from './p09-assistant-principal'
import type { Probe } from '../types'

export const ALL_PROBES: Probe[] = [
  p01SessionCookie,
  p02MagicLinkOtp,
  p03StorageToken,
  p04WidgetIdentify,
  p05ApiKey,
  p06SettingsCache,
  p07BackgroundJob,
  p08CrossRead,
  p09AssistantPrincipal,
]

export {
  p01SessionCookie,
  p02MagicLinkOtp,
  p03StorageToken,
  p04WidgetIdentify,
  p05ApiKey,
  p06SettingsCache,
  p07BackgroundJob,
  p08CrossRead,
  p09AssistantPrincipal,
}
