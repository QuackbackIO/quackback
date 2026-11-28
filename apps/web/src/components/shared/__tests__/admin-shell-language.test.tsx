// @vitest-environment happy-dom
/**
 * The admin shell and the shared parts every page shows read in the
 * teammate's language: the shell's strings ride the admin seed, and the
 * parts that work outside React (the slash menu, error notices) take their
 * words from the page.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { createIntl, IntlProvider } from 'react-intl'
import de from '@/locales/de.json'
import ar from '@/locales/ar.json'
import en from '@/locales/en.json'
import { adminSeedMessages, loadPortalMessages, messageArea } from '@/lib/shared/i18n'
import {
  describeError,
  noticeText,
  ERROR_CODE_MESSAGES,
  ERROR_NOTICE_MESSAGES,
} from '@/lib/shared/describe-error'
import { errorNoticeWords, setErrorNoticeWords } from '@/lib/client/error-notice-words'
import { StateBadge } from '@/components/shared/state-badge'
import { ErrorNoticeLanguage } from '@/components/shared/error-notice-language'
import { Calendar } from '@/components/ui/calendar'
import { slashMenuItems } from '@/components/ui/rich-text-editor'
import { SETTINGS_PAGES, settingsPageTitle } from '@/lib/shared/settings-pages'
import { ADMIN_TYPE_LABELS } from '@/components/settings/notification-matrix-admin-labels'
import { NOTIFICATION_CATALOG } from '@/lib/shared/notifications/catalog'

afterEach(cleanup)

const team = { team: true, online: false }
const shellKeys = Object.keys(en).filter(
  (key) =>
    key.startsWith('admin.shell.') ||
    key.startsWith('ui.editor.') ||
    key.startsWith('admin.shell.errorNotice.')
)

describe('where the shell strings load', () => {
  it('has shell strings to check', () => {
    expect(shellKeys.length).toBeGreaterThan(100)
  })

  it('belong to no area, so the admin layout seeds them on every admin page', () => {
    const seeded = adminSeedMessages(de)
    for (const key of shellKeys) {
      expect(messageArea(key), key).toBeNull()
      expect(seeded[key], key).toBe((de as Record<string, string>)[key])
    }
  })

  it("seeds the editor's words on the portal too, which shares the editor", async () => {
    const portal = await loadPortalMessages('de')
    expect(portal['ui.editor.bold']).toBe('Fett')
    expect(portal['admin.shell.notifications.title']).toBeUndefined()
  })
})

describe('in German', () => {
  const wrap = (ui: React.ReactNode, locale = 'de', messages: Record<string, string> = de) => (
    <IntlProvider locale={locale} messages={messages}>
      {ui}
    </IntlProvider>
  )

  it('words a state badge', () => {
    render(wrap(<StateBadge state="connected" />))
    expect(screen.getByText('Verbunden')).toBeTruthy()
  })

  it('names the calendar month and weekdays in the page language', () => {
    render(wrap(<Calendar mode="single" defaultMonth={new Date(2026, 2, 1)} />))
    expect(screen.getByText('März 2026')).toBeTruthy()
    expect(screen.getByLabelText('Zum nächsten Monat')).toBeTruthy()
  })

  it("keeps the picker's own English wording on an English page", () => {
    render(wrap(<Calendar mode="single" defaultMonth={new Date(2026, 2, 1)} />, 'en', {}))
    expect(screen.getByText('March 2026')).toBeTruthy()
    expect(screen.getByText('Su')).toBeTruthy()
    expect(screen.getByLabelText(/next month/i)).toBeTruthy()
  })

  it('names the calendar month in Arabic', () => {
    render(wrap(<Calendar mode="single" defaultMonth={new Date(2026, 2, 1)} />, 'ar', ar))
    expect(screen.getByLabelText('الانتقال إلى الشهر التالي')).toBeTruthy()
  })

  it('words and searches the slash menu', () => {
    const intl = createIntl({ locale: 'de', messages: de })
    const titles = slashMenuItems({ headings: true }, intl).map((item) => item.title)
    expect(titles).toContain('Überschrift 1')
    // The German title and the English one both find the item.
    expect(slashMenuItems({ headings: true }, intl, 'überschrift').length).toBe(3)
    expect(slashMenuItems({ headings: true }, intl, 'heading').length).toBe(3)
  })

  it("words error notices raised outside React while it's mounted", () => {
    const view = render(wrap(<ErrorNoticeLanguage />))
    const offline = describeError(new TypeError('Failed to fetch'), 'x', team, errorNoticeWords())
    expect(offline.title).toBe('Du bist offline')
    expect(
      noticeText(
        describeError(
          new Error('Something went wrong on our side. Try again in a moment. (Ref ABCD-1234)'),
          'Speichern fehlgeschlagen',
          team,
          errorNoticeWords()
        ),
        errorNoticeWords()
      )
    ).toContain('Ref. ABCD-1234')
    const missing = Object.assign(new Error('Notification not found'), {
      code: 'NOTIFICATION_NOT_FOUND',
      statusCode: 404,
    })
    expect(describeError(missing, 'x', team, errorNoticeWords()).title).toBe(
      de['admin.shell.errorNotice.code.notificationNotFound']
    )
    view.unmount()
    expect(
      describeError(new TypeError('Failed to fetch'), 'x', team, errorNoticeWords()).title
    ).toBe("You're offline")
  })

  it('keeps every notice word in the catalogue', () => {
    for (const message of [
      ...Object.values(ERROR_NOTICE_MESSAGES),
      ...Object.values(ERROR_CODE_MESSAGES),
    ]) {
      expect((en as Record<string, string>)[message.id], message.id).toBe(message.defaultMessage)
    }
  })

  it('puts the English back when a surface leaves', () => {
    const release = setErrorNoticeWords({
      ...Object.fromEntries(
        Object.entries(ERROR_NOTICE_MESSAGES).map(([word, m]) => [word, m.defaultMessage])
      ),
      offline: 'offline-x',
    } as never)
    expect(
      describeError(new TypeError('Failed to fetch'), 'x', team, errorNoticeWords()).title
    ).toBe('offline-x')
    release()
    expect(
      describeError(new TypeError('Failed to fetch'), 'x', team, errorNoticeWords()).title
    ).toBe("You're offline")
  })

  it('names settings pages, automation pages included, in the page language', () => {
    const intl = createIntl({ locale: 'de', messages: de })
    expect(settingsPageTitle(intl, '/admin/settings/general', 'General')).toBe('Allgemein')
    expect(settingsPageTitle(intl, '/admin/settings/notifications', 'Notifications')).toBe(
      'Benachrichtigungen'
    )
    expect(settingsPageTitle(intl, '/admin/settings/agent', 'Agent')).toBe(
      (de as Record<string, string>)['automation.nav.agent']
    )
    for (const { label, labelId } of Object.values(SETTINGS_PAGES)) {
      expect((en as Record<string, string>)[labelId], labelId).toBe(label)
    }
  })

  it('words every notification row the admin shows', () => {
    const intl = createIntl({ locale: 'de', messages: de })
    const assigned = ADMIN_TYPE_LABELS.post_owner_assigned!
    expect(intl.formatMessage(assigned.label)).toBe('Beitrag zugewiesen')
    for (const meta of NOTIFICATION_CATALOG.filter((row) => !row.surfaces.includes('portal'))) {
      expect(ADMIN_TYPE_LABELS[meta.type]?.label.defaultMessage, meta.type).toBe(meta.label)
    }
  })
})
