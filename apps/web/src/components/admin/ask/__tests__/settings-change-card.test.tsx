// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SettingsChangeCard,
  type SettingsChangeCardProps,
} from '../workspace-settings-proposal-card'

afterEach(cleanup)

function mount(extra: Partial<SettingsChangeCardProps> = {}) {
  const props: SettingsChangeCardProps = {
    changes: [
      {
        id: 'branding.light.primary',
        area: 'branding',
        path: ['light', 'primary'],
        before: '#FFFF00',
        after: '#0F766E',
        settingsHref: '/admin/settings/portal',
      },
      {
        id: 'messenger.enabled',
        area: 'messenger',
        path: ['enabled'],
        before: false,
        after: true,
        settingsHref: '/admin/settings/channels/messenger',
      },
    ],
    status: 'proposed',
    busy: false,
    onApply: vi.fn(),
    onUndo: vi.fn(),
    onOpenSettings: vi.fn(),
    ...extra,
  }
  render(
    <IntlProvider locale="en">
      <SettingsChangeCard {...props} />
    </IntlProvider>
  )
  return props
}

describe('settings change cards', () => {
  it('shows real before and after colors and applies only checked fields', () => {
    const props = mount()
    expect(screen.getByText('#FFFF00')).toBeTruthy()
    expect(screen.getByText('#0F766E')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: /Messenger/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 change' }))
    expect(props.onApply).toHaveBeenCalledWith(['branding.light.primary'])
    expect(props.onUndo).not.toHaveBeenCalled()
  })
  it('never applies an empty selection', () => {
    const props = mount()
    for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox)
    const button = screen.getByRole('button', { name: 'Apply 0 changes' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(button)
    expect(props.onApply).not.toHaveBeenCalled()
  })
  it('offers Undo only after Apply and keeps errors visible', () => {
    const props = mount({
      status: 'executed',
      error: 'These settings changed since Apply. Undo is unavailable.',
    })
    expect(screen.queryByRole('button', { name: /Apply/ })).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('Undo is unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(props.onUndo).toHaveBeenCalledOnce()
  })
  it('shows office hours as readable text, never raw JSON', () => {
    mount({
      changes: [
        {
          id: 'office_hours.intervals',
          area: 'office_hours',
          path: ['intervals'],
          before: [],
          after: [
            { day: 1, start: '09:00', end: '17:00' },
            { day: 2, start: '10:00', end: '18:00' },
          ],
          settingsHref: '/admin/settings/office-hours',
        },
        {
          id: 'office_hours.holidays',
          area: 'office_hours',
          path: ['holidays'],
          before: [],
          after: [{ date: '2026-12-25', name: 'Christmas', recurringAnnual: true }],
          settingsHref: '/admin/settings/office-hours',
        },
      ],
    })
    expect(screen.getByText('Mon 09:00-17:00, Tue 10:00-18:00')).toBeTruthy()
    expect(screen.getByText('Christmas (2026-12-25)')).toBeTruthy()
    expect(screen.getAllByText('Not set')).toHaveLength(2)
    expect(document.body.textContent).not.toContain('{')
  })
  it('lists every effect of turning Messenger on or off', () => {
    mount({
      changes: [
        {
          id: 'messenger.enabled',
          area: 'messenger',
          path: ['enabled'],
          before: false,
          after: true,
          effects: ['messengerTab', 'widget', 'supportInbox'],
          settingsHref: '/admin/settings/channels/messenger',
        },
      ],
    })
    expect(screen.getByText('Shows the Messages tab in the widget')).toBeTruthy()
    expect(screen.getByText('Turns on the widget')).toBeTruthy()
    expect(screen.getByText('Turns on the support inbox and portal chats')).toBeTruthy()
    cleanup()
    mount({
      changes: [
        {
          id: 'messenger.enabled',
          area: 'messenger',
          path: ['enabled'],
          before: true,
          after: false,
          effects: ['messengerTab'],
          settingsHref: '/admin/settings/channels/messenger',
        },
      ],
    })
    expect(screen.getByText('Hides the Messages tab in the widget')).toBeTruthy()
    expect(screen.queryByText('Turns on the widget')).toBeNull()
    expect(screen.queryByText(/support inbox/i)).toBeNull()
  })
  it('links once to each settings page the card changes', () => {
    const props = mount()
    expect(screen.queryByRole('button', { name: 'Open in settings' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Messenger settings' }))
    expect(props.onOpenSettings).toHaveBeenCalledWith('/admin/settings/channels/messenger')
    expect(screen.getByRole('button', { name: 'Branding settings' })).toBeTruthy()
    cleanup()
    const single = mount({
      changes: [
        {
          id: 'branding.light.primary',
          area: 'branding',
          path: ['light', 'primary'],
          before: '#FFFF00',
          after: '#0F766E',
          settingsHref: '/admin/settings/portal',
        },
        {
          id: 'branding.themeMode',
          area: 'branding',
          path: ['themeMode'],
          before: 'user',
          after: 'dark',
          settingsHref: '/admin/settings/portal',
        },
      ],
    })
    expect(screen.getAllByRole('button', { name: 'Open in settings' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Open in settings' }))
    expect(single.onOpenSettings).toHaveBeenCalledWith('/admin/settings/portal')
  })
})
