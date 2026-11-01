/**
 * Settings copy that exists twice: once in English where it is defined, once
 * as a translatable message. The two must stay word for word the same, or
 * English readers see different text depending on which one renders.
 */
import { describe, expect, it } from 'vitest'
import { createIntl } from 'react-intl'
import en from '@/locales/en.json'
import { ADMIN_WORDS } from '@/lib/shared/design/view'
import { catalogForSurface } from '@/lib/shared/notifications/catalog'
import { SSO_MANAGED_EMAIL_MESSAGE } from '@/lib/shared/sso-managed-email'
import { TYPE_LABELS } from '../notification-matrix-form'

const catalog = en as Record<string, string>

describe('notification matrix labels', () => {
  const portalRows = catalogForSurface('portal')

  it('translates every row the portal shows', () => {
    expect(portalRows.filter((meta) => !TYPE_LABELS[meta.type]).map((m) => m.type)).toEqual([])
  })

  // The catalog words a row as the admin does; the portal's message names the
  // post in the portal's word, which in the admin is post.
  const intl = createIntl({ locale: 'en', messages: catalog, onError: () => {} })
  const asAdmin = (descriptor: { id: string; defaultMessage: string }) =>
    intl.formatMessage(descriptor, { ...ADMIN_WORDS }) as string

  it.each(portalRows)('words $type exactly as the notification catalog does', (meta) => {
    const labels = TYPE_LABELS[meta.type]!
    expect(labels.label.defaultMessage).toBe(catalog[labels.label.id])
    expect(asAdmin(labels.label)).toBe(meta.label)
    expect(labels.description.defaultMessage).toBe(catalog[labels.description.id])
    expect(asAdmin(labels.description)).toBe(meta.description)
  })
})

describe('email change', () => {
  it('words the single sign-on refusal as the server does', () => {
    expect(catalog['portal.settings.email.error.ssoManaged']).toBe(SSO_MANAGED_EMAIL_MESSAGE)
  })
})
