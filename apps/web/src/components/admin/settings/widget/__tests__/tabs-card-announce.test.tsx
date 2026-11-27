// @vitest-environment happy-dom
/**
 * The changelog tab's launcher announcement switch: off unless stored on,
 * saved like its neighbouring switches, and unavailable while the changelog
 * tab is off.
 */
import type { ReactNode } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { mutateAsync } = vi.hoisted(() => ({
  mutateAsync: vi.fn(async (_input: unknown) => ({})),
}))

vi.mock('@tanstack/react-router', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')
  return {
    ...actual,
    useRouter: () => ({ invalidate: vi.fn() }),
    Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  }
})

vi.mock('@/lib/client/mutations/settings', () => ({
  useUpdateWidgetConfig: () => ({ mutateAsync, isPending: false }),
  useUploadWidgetHeroImage: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteWidgetHeroImage: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

const { TabsCard } = await import('@/components/admin/settings/widget/widget-settings-page')

type Config = Parameters<typeof TabsCard>[0]['config']

function renderCard(config: Config) {
  return render(
    <IntlProvider locale="en">
      <TabsCard
        config={config}
        boards={[]}
        helpCenterFlagEnabled={false}
        supportInboxFlagEnabled={false}
        feedbackFlagEnabled
        changelogFlagEnabled
        supportTicketsFlagEnabled={false}
      />
    </IntlProvider>
  )
}

const announceSwitch = () =>
  screen.getByRole('switch', { name: 'Announce new updates above the launcher' })

afterEach(() => {
  mutateAsync.mockClear()
  document.body.innerHTML = ''
})

describe('TabsCard launcher announcement', () => {
  it('is off when the setting is absent', () => {
    renderCard({ tabs: { feedback: true, changelog: true } })
    expect(announceSwitch().getAttribute('aria-checked')).toBe('false')
  })

  it('reflects a stored on value', () => {
    renderCard({
      tabs: { feedback: true, changelog: true },
      changelog: { announceOnLauncher: true },
    })
    expect(announceSwitch().getAttribute('aria-checked')).toBe('true')
  })

  it('saves the switch under the changelog settings', async () => {
    renderCard({ tabs: { feedback: true, changelog: true } })
    fireEvent.click(announceSwitch())
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ changelog: { announceOnLauncher: true } })
    )
    expect(announceSwitch().getAttribute('aria-checked')).toBe('true')
  })

  it('reverts when the save fails', async () => {
    mutateAsync.mockRejectedValueOnce(new Error('save failed'))
    renderCard({ tabs: { feedback: true, changelog: true } })
    fireEvent.click(announceSwitch())
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())
    await waitFor(() => expect(announceSwitch().getAttribute('aria-checked')).toBe('false'))
  })

  it('is disabled while the changelog tab is off', () => {
    renderCard({ tabs: { feedback: true, changelog: false } })
    expect(announceSwitch().hasAttribute('disabled')).toBe(true)
  })
})
