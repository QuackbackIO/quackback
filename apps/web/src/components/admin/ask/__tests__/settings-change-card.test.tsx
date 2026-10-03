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
  it('links each area to its actual settings page', () => {
    const props = mount()
    fireEvent.click(screen.getAllByRole('button', { name: 'Open in settings' })[1]!)
    expect(props.onOpenSettings).toHaveBeenCalledWith('/admin/settings/channels/messenger')
  })
})
