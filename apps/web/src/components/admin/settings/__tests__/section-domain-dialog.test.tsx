// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PortalSection } from '@/lib/shared/custom-domains'
import type { SectionDomainMap } from '@/lib/shared/section-domains'

const setSectionDomain = vi.fn()
vi.mock('@/lib/server/functions/section-domains', () => ({
  setSectionDomainFn: setSectionDomain,
}))

const { SectionDomainDialog } = await import('../section-domain-dialog')

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

const SECTIONS: PortalSection[] = ['feedback', 'help', 'status']

function renderDialog({
  cloud = false,
  map = {} as SectionDomainMap,
  readyHostnames = [] as string[],
  initial = null as Parameters<typeof SectionDomainDialog>[0]['initial'],
  suffix,
  onSaved = vi.fn(),
  onClose = vi.fn(),
  onMakePrimary = vi.fn(),
  onAddDomain = vi.fn(),
}: {
  cloud?: boolean
  map?: SectionDomainMap
  readyHostnames?: string[]
  initial?: Parameters<typeof SectionDomainDialog>[0]['initial']
  suffix?: string
  onSaved?: () => void
  onClose?: () => void
  onMakePrimary?: (hostname: string) => void
  onAddDomain?: () => void
} = {}) {
  render(
    <SectionDomainDialog
      open
      initial={initial}
      cloud={cloud}
      sections={SECTIONS}
      map={map}
      primaryHost="acme.com"
      readyHostnames={readyHostnames}
      suffix={suffix}
      onSaved={onSaved}
      onClose={onClose}
      onMakePrimary={onMakePrimary}
      onAddDomain={onAddDomain}
    />
  )
  return screen.getByRole('dialog')
}

const tileTitles = (dialog: HTMLElement) =>
  [...dialog.querySelectorAll('[data-slot="used-for-tiles"] [data-slot="visibility-tile"]')].map(
    (t) => t.querySelector('.font-medium')?.textContent
  )

const choose = (dialog: HTMLElement, name: string) =>
  fireEvent.click(within(dialog).getByRole('radio', { name: new RegExp(`^${name}`) }))

describe('Add custom domain', () => {
  it('asks what the domain is used for first, each section as a tile', () => {
    const dialog = renderDialog({ map: { help: { hostname: 'help.acme.com', verifiedAt: null } } })
    expect(within(dialog).getByRole('heading', { name: 'Add custom domain' })).toBeVisible()
    expect(dialog).toHaveTextContent('Used for')
    expect(tileTitles(dialog)).toEqual(['Feedback', 'Help center', 'Status'])
    // Each tile says where it is served now.
    expect(dialog).toHaveTextContent('help.acme.com')
    // A section without its own domain names the primary host, as the card's rows do.
    expect(within(dialog).getByRole('radio', { name: /^Feedback/ })).toHaveAccessibleName(
      /acme\.com/
    )
    expect(dialog).not.toHaveTextContent('Primary domain')
    // No field until a choice is made.
    expect(within(dialog).queryByLabelText('Domain')).toBeNull()
    expect(within(dialog).queryByRole('combobox')).toBeNull()
  })

  it('self-hosted: sets a section to the hostname typed', async () => {
    const onSaved = vi.fn()
    const onClose = vi.fn()
    setSectionDomain.mockResolvedValue({ ok: true, sectionDomains: {} })
    const dialog = renderDialog({ onSaved, onClose })
    choose(dialog, 'Status')
    fireEvent.change(within(dialog).getByLabelText('Domain'), {
      target: { value: 'status.acme.com' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(setSectionDomain).toHaveBeenCalledWith({
      data: { section: 'status', hostname: 'status.acme.com' },
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('self-hosted: shows a refusal in place and keeps the dialog open', async () => {
    const onClose = vi.fn()
    setSectionDomain.mockResolvedValue({
      ok: false,
      code: 'SECTION_DOMAIN_TAKEN',
      message: 'help.acme.com is already used for another section.',
    })
    const dialog = renderDialog({ onClose })
    choose(dialog, 'Status')
    fireEvent.change(within(dialog).getByLabelText('Domain'), {
      target: { value: 'help.acme.com' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'help.acme.com is already used for another section.'
    )
    expect(onClose).not.toHaveBeenCalled()
  })

  it('self-hosted: offers no Portal tile, as BASE_URL sets the primary domain', () => {
    const dialog = renderDialog()
    expect(within(dialog).queryByRole('radio', { name: /^Portal/ })).toBeNull()
  })

  it('on Cloud, offers Portal first, then each section', () => {
    const dialog = renderDialog({ cloud: true })
    expect(tileTitles(dialog)).toEqual(['Portal', 'Feedback', 'Help center', 'Status'])
  })

  it('on a domain page, takes a name in front of that domain, starting from the section', async () => {
    setSectionDomain.mockResolvedValue({ ok: true, sectionDomains: {} })
    const dialog = renderDialog({ suffix: 'acme.com' })
    choose(dialog, 'Help center')
    expect(within(dialog).getByLabelText('Domain')).toHaveValue('help')
    expect(dialog).toHaveTextContent('.acme.com')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(setSectionDomain).toHaveBeenCalledWith({
        data: { section: 'help', hostname: 'help.acme.com' },
      })
    )
  })

  it('refuses a name that is not one, and writes nothing', () => {
    const dialog = renderDialog({ suffix: 'acme.com' })
    choose(dialog, 'Help center')
    fireEvent.change(within(dialog).getByLabelText('Domain'), { target: { value: 'help desk' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Use letters, numbers and hyphens')
    expect(setSectionDomain).not.toHaveBeenCalled()
  })

  it('opens on the section asked for, filled with its hostname', () => {
    const dialog = renderDialog({
      initial: 'help',
      map: { help: { hostname: 'help.acme.com', verifiedAt: null } },
    })
    expect(within(dialog).getByRole('radio', { name: /^Help center/ })).toBeChecked()
    expect(within(dialog).getByLabelText('Domain')).toHaveValue('help.acme.com')
    // Opened from a row that has a domain: it is a change, not an addition.
    expect(within(dialog).getByRole('heading', { name: 'Change custom domain' })).toBeVisible()
  })

  it('suggests a sample hostname for the section chosen, with no brand in it', () => {
    const dialog = renderDialog()
    choose(dialog, 'Status')
    expect(within(dialog).getByLabelText('Domain')).toHaveAttribute(
      'placeholder',
      'status.example.com'
    )
  })

  it('on Cloud, offers only ready custom domains no other section uses', async () => {
    setSectionDomain.mockResolvedValue({ ok: true, sectionDomains: {} })
    const dialog = renderDialog({
      cloud: true,
      readyHostnames: ['help.acme.com', 'status.acme.com', 'news.acme.com'],
      map: { help: { hostname: 'help.acme.com', verifiedAt: '2026-11-01T00:00:00.000Z' } },
    })
    choose(dialog, 'Status')
    expect(within(dialog).queryByRole('textbox')).toBeNull()
    expect(within(dialog).queryByRole('radio', { name: 'help.acme.com' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('radio', { name: 'status.acme.com' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(setSectionDomain).toHaveBeenCalledWith({
        data: { section: 'status', hostname: 'status.acme.com' },
      })
    )
  })

  it('on Cloud, routes to adding a custom domain when none is ready', () => {
    const onAddDomain = vi.fn()
    const dialog = renderDialog({ cloud: true, onAddDomain })
    choose(dialog, 'Status')
    expect(dialog).toHaveTextContent('No custom domain is ready yet.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add a new domain' }))
    expect(onAddDomain).toHaveBeenCalled()
  })

  it('on Cloud, Portal makes a ready custom domain the primary domain', () => {
    const onMakePrimary = vi.fn()
    const dialog = renderDialog({
      cloud: true,
      readyHostnames: ['help.acme.com', 'www.acme.com'],
      map: { help: { hostname: 'help.acme.com', verifiedAt: null } },
      onMakePrimary,
    })
    choose(dialog, 'Portal')
    // A section's domain cannot also be the primary domain.
    expect(within(dialog).queryByRole('radio', { name: 'help.acme.com' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('radio', { name: 'www.acme.com' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(onMakePrimary).toHaveBeenCalledWith('www.acme.com')
    expect(setSectionDomain).not.toHaveBeenCalled()
  })

  it('never uses an em dash', () => {
    const dialog = renderDialog({ cloud: true })
    choose(dialog, 'Status')
    expect(dialog.textContent).not.toContain('—')
  })
})
