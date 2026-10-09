/**
 * Settings copy that exists twice: once in English where it is defined, once
 * as a translatable message. The two must stay word for word the same, or
 * English readers see different text depending on which one renders.
 */
import { describe, expect, it } from 'vitest'
import en from '@/locales/en.json'
import { catalogForSurface } from '@/lib/shared/notifications/catalog'
import { SSO_MANAGED_EMAIL_MESSAGE } from '@/lib/shared/sso-managed-email'
import { TYPE_LABELS } from '../notification-matrix-form'

const catalog = en as Record<string, string>

describe('notification matrix labels', () => {
  const portalRows = catalogForSurface('portal')

  it('translates every row the portal shows', () => {
    expect(portalRows.filter((meta) => !TYPE_LABELS[meta.type]).map((m) => m.type)).toEqual([])
  })

  it.each(portalRows)('words $type exactly as the notification catalog does', (meta) => {
    const labels = TYPE_LABELS[meta.type]!
    expect(labels.label.defaultMessage).toBe(meta.label)
    expect(catalog[labels.label.id]).toBe(meta.label)
    expect(labels.description.defaultMessage).toBe(meta.description)
    expect(catalog[labels.description.id]).toBe(meta.description)
  })
})

describe('email change', () => {
  it('words the single sign-on refusal as the server does', () => {
    expect(catalog['portal.settings.email.error.ssoManaged']).toBe(SSO_MANAGED_EMAIL_MESSAGE)
  })
})
