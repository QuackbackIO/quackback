/**
 * Messenger pre-chat contact capture. Stored on widget messenger config
 * (`contactCapture`). Default is off — anonymous visitors start chatting
 * immediately. When on, the widget asks for an email (and optionally a name)
 * before the first message. The address is unproven and never merges into an
 * identified account.
 */
import { z } from 'zod'

export const CONTACT_CAPTURE_MODES = [
  'off',
  'optional',
  'required',
  'outside_office_hours',
] as const
export type ContactCaptureMode = (typeof CONTACT_CAPTURE_MODES)[number]

export interface ContactCaptureSettings {
  mode: ContactCaptureMode
  askName: boolean
}

export const DEFAULT_CONTACT_CAPTURE: ContactCaptureSettings = {
  mode: 'off',
  askName: false,
}

export const contactCaptureSchema = z.object({
  mode: z.enum(CONTACT_CAPTURE_MODES).optional(),
  askName: z.boolean().optional(),
})

export function parseContactCapture(raw: unknown): ContactCaptureSettings {
  const parsed = contactCaptureSchema.safeParse(raw)
  if (!parsed.success) return DEFAULT_CONTACT_CAPTURE
  return {
    mode: parsed.data.mode ?? DEFAULT_CONTACT_CAPTURE.mode,
    askName: parsed.data.askName ?? DEFAULT_CONTACT_CAPTURE.askName,
  }
}

/** What the visitor thread should show on a new conversation. */
export interface ContactCapturePrompt {
  show: boolean
  required: boolean
  askName: boolean
}

export function resolveContactCapturePrompt(input: {
  settings: ContactCaptureSettings
  isAnonymous: boolean
  visitorHasEmail: boolean
  officeHoursOpen: boolean
}): ContactCapturePrompt {
  const hidden: ContactCapturePrompt = { show: false, required: false, askName: false }
  if (!input.isAnonymous || input.visitorHasEmail || input.settings.mode === 'off') {
    return hidden
  }
  if (input.settings.mode === 'optional') {
    return { show: true, required: false, askName: input.settings.askName }
  }
  if (input.settings.mode === 'required') {
    return { show: true, required: true, askName: input.settings.askName }
  }
  if (input.officeHoursOpen) return hidden
  return { show: true, required: true, askName: input.settings.askName }
}

/** Client-side check that matches the server's conservative address shape. */
export function looksLikeContactEmail(raw: string): boolean {
  const email = raw.trim().toLowerCase()
  return email.length > 0 && email.length <= 254 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)
}
