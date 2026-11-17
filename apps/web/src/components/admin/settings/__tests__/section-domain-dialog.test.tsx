// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PortalSection } from '@/lib/shared/custom-domains'
import type { SectionDomainMap } from '@/lib/shared/section-domains'
import type { DnsRecordRow } from '@/components/shared/dns-record-table'

const setSectionDomain = vi.fn()
const verifySectionDomain = vi.fn()
vi.mock('@/lib/server/functions/section-domains', () => ({
  setSectionDomainFn: setSectionDomain,
  verifySectionDomainFn: verifySectionDomain,
}))

const mutateCloudCustomDomain = vi.fn()
vi.mock('@/lib/server/functions/cloud-identity', () => ({
  mutateCloudCustomDomainFn: mutateCloudCustomDomain,
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
  loadVerifiedDomains,
  loadCloudRecords,
  cloudHostnames = [] as string[],
  onAddVerifiedDomain,
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
  loadVerifiedDomains?: () => Promise<readonly string[]>
  loadCloudRecords?: (hostname: string) => Promise<DnsRecordRow[]>
  cloudHostnames?: string[]
  onAddVerifiedDomain?: () => void
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
      loadVerifiedDomains={loadVerifiedDomains}
      loadCloudRecords={loadCloudRecords}
      cloudHostnames={cloudHostnames}
      onAddVerifiedDomain={onAddVerifiedDomain}
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
    setSectionDomain.mockResolvedValue({
      ok: true,
      sectionDomains: { status: { hostname: 'status.acme.com', verifiedAt: AT } },
    })
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

  it('on Cloud, Portal routes to adding a custom domain when none is ready', () => {
    const onAddDomain = vi.fn()
    const dialog = renderDialog({ cloud: true, onAddDomain })
    choose(dialog, 'Portal')
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

const AT = '2026-11-01T00:00:00.000Z'

const verified =
  (...names: string[]) =>
  () =>
    Promise.resolve(names)

/** The Domain step's choices, by their titles, in order. */
const domainChoices = (dialog: HTMLElement) =>
  [...dialog.querySelectorAll('[data-slot="domain-choices"] [data-slot="visibility-tile"]')].map(
    (t) => t.querySelector('.font-medium')?.textContent
  )

const SAVED_PENDING = (section: PortalSection, hostname: string) => ({
  ok: true,
  sectionDomains: { [section]: { hostname, verifiedAt: null } },
})

describe('Add custom domain: picking a verified domain', () => {
  it('offers each verified domain under the section, then Another domain', async () => {
    const dialog = renderDialog({ loadVerifiedDomains: verified('acme.com', 'acme.io') })
    choose(dialog, 'Help center')
    await waitFor(() =>
      expect(domainChoices(dialog)).toEqual(['help.acme.com', 'help.acme.io', 'Another domain'])
    )
    // Two to pick from: neither is picked for the admin, and no field shows yet.
    expect(within(dialog).queryByLabelText('Domain')).toBeNull()
  })

  it('picks the one verified domain, the name in front editable in place', async () => {
    setSectionDomain.mockResolvedValue(SAVED_PENDING('help', 'docs.acme.com'))
    const dialog = renderDialog({ loadVerifiedDomains: verified('acme.com') })
    choose(dialog, 'Help center')
    const tile = await within(dialog).findByRole('radio', { name: 'help.acme.com' })
    expect(tile).toBeChecked()
    // The domain is fixed; only the name in front of it is typed.
    const prefix = within(dialog).getByLabelText('Domain')
    expect(prefix).toHaveValue('help')
    expect(dialog).toHaveTextContent('.acme.com')
    fireEvent.change(prefix, { target: { value: 'docs' } })
    expect(within(dialog).getByRole('radio', { name: 'docs.acme.com' })).toBeChecked()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(setSectionDomain).toHaveBeenCalledWith({
        data: { section: 'help', hostname: 'docs.acme.com' },
      })
    )
  })

  it('never offers a hostname another section uses', async () => {
    const dialog = renderDialog({
      loadVerifiedDomains: verified('acme.com', 'acme.io'),
      map: { feedback: { hostname: 'help.acme.com', verifiedAt: null } },
    })
    choose(dialog, 'Help center')
    await waitFor(() => expect(domainChoices(dialog)).toEqual(['help.acme.io', 'Another domain']))
  })

  it('Another domain reveals the free field', async () => {
    setSectionDomain.mockResolvedValue(SAVED_PENDING('status', 'status.other.org'))
    const dialog = renderDialog({ loadVerifiedDomains: verified('acme.com', 'acme.io') })
    choose(dialog, 'Status')
    fireEvent.click(await within(dialog).findByRole('radio', { name: 'Another domain' }))
    const field = within(dialog).getByLabelText('Domain')
    expect(field).toHaveAttribute('placeholder', 'status.example.com')
    fireEvent.change(field, { target: { value: 'Status.Other.org' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(setSectionDomain).toHaveBeenCalledWith({
        data: { section: 'status', hostname: 'status.other.org' },
      })
    )
  })

  it('opens Change on the verified domain the section already uses', async () => {
    const dialog = renderDialog({
      initial: 'help',
      loadVerifiedDomains: verified('acme.com', 'acme.io'),
      map: { help: { hostname: 'docs.acme.io', verifiedAt: null } },
    })
    expect(await within(dialog).findByRole('radio', { name: 'docs.acme.io' })).toBeChecked()
    expect(within(dialog).getByLabelText('Domain')).toHaveValue('docs')
  })

  it('lists many verified domains in a compact select', async () => {
    const dialog = renderDialog({
      loadVerifiedDomains: verified('a.com', 'b.com', 'c.com', 'd.com', 'e.com'),
    })
    choose(dialog, 'Help center')
    expect(await within(dialog).findByRole('combobox', { name: 'Domain' })).toBeVisible()
    expect(
      dialog.querySelector('[data-slot="domain-choices"] [data-slot="visibility-tile"]')
    ).toBeNull()
  })

  it('keeps the free field when verified domains cannot be read', async () => {
    const dialog = renderDialog({
      loadVerifiedDomains: () => Promise.reject(new Error('forbidden')),
      onAddVerifiedDomain: vi.fn(),
    })
    choose(dialog, 'Status')
    expect(await within(dialog).findByLabelText('Domain')).toHaveAttribute(
      'placeholder',
      'status.example.com'
    )
    expect(dialog).not.toHaveTextContent('Add and verify your domain first.')
  })
})

describe('Add custom domain: no verified domain yet', () => {
  it('says to add one first, with Add domain, and keeps Another domain', async () => {
    const onClose = vi.fn()
    const onAddVerifiedDomain = vi.fn()
    const dialog = renderDialog({
      loadVerifiedDomains: verified(),
      onAddVerifiedDomain,
      onClose,
    })
    choose(dialog, 'Status')
    expect(await within(dialog).findByText('Add and verify your domain first.')).toBeVisible()
    // Not a blank field to start with.
    expect(within(dialog).queryByLabelText('Domain')).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(dialog.textContent).not.toContain('—')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add domain' }))
    // The dialog closes before the page moves.
    expect(onClose).toHaveBeenCalled()
    expect(onAddVerifiedDomain).toHaveBeenCalled()
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(
      onAddVerifiedDomain.mock.invocationCallOrder[0]
    )
  })

  it('Another domain under it reveals the free field', async () => {
    const dialog = renderDialog({ loadVerifiedDomains: verified(), onAddVerifiedDomain: vi.fn() })
    choose(dialog, 'Status')
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Another domain' }))
    expect(within(dialog).getByLabelText('Domain')).toHaveAttribute(
      'placeholder',
      'status.example.com'
    )
  })

  it('shows the free field to a viewer who cannot add a domain', async () => {
    const dialog = renderDialog({ loadVerifiedDomains: verified() })
    choose(dialog, 'Status')
    expect(await within(dialog).findByLabelText('Domain')).toBeVisible()
    expect(within(dialog).queryByRole('button', { name: 'Add domain' })).toBeNull()
    expect(dialog).not.toHaveTextContent('Add and verify your domain first.')
  })

  it('on Cloud, a ready custom domain is enough: no empty state', async () => {
    const dialog = renderDialog({
      cloud: true,
      readyHostnames: ['status.acme.com'],
      loadVerifiedDomains: verified(),
      onAddVerifiedDomain: vi.fn(),
    })
    choose(dialog, 'Status')
    await waitFor(() =>
      expect(domainChoices(dialog)).toEqual(['status.acme.com', 'Another domain'])
    )
    expect(dialog).not.toHaveTextContent('Add and verify your domain first.')
  })
})

describe('Add custom domain: pointing DNS', () => {
  it('self-hosted: stays open on the record to add, with Verify and Done', async () => {
    const onSaved = vi.fn()
    const onClose = vi.fn()
    setSectionDomain.mockResolvedValue(SAVED_PENDING('help', 'help.acme.com'))
    const dialog = renderDialog({ loadVerifiedDomains: verified('acme.com'), onSaved, onClose })
    choose(dialog, 'Help center')
    await within(dialog).findByRole('radio', { name: 'help.acme.com' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(onClose).not.toHaveBeenCalled()
    expect(dialog).toHaveTextContent('CNAME')
    expect(dialog).toHaveTextContent('help.acme.com')
    expect(within(dialog).queryByText('Used for')).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Verify' })).toBeVisible()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('self-hosted: a hostname that is verified already just closes', async () => {
    const onClose = vi.fn()
    setSectionDomain.mockResolvedValue({
      ok: true,
      sectionDomains: { status: { hostname: 'status.acme.com', verifiedAt: AT } },
    })
    const dialog = renderDialog({ onClose })
    choose(dialog, 'Status')
    fireEvent.change(within(dialog).getByLabelText('Domain'), {
      target: { value: 'status.acme.com' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it.each([
    [
      'not verified yet',
      { dnsResolved: false, verified: false },
      { hostname: 'help.acme.com', verifiedAt: null },
      'Not verified yet. DNS changes can take a while to show.',
    ],
    [
      'verified',
      { dnsResolved: true, verified: true },
      { hostname: 'help.acme.com', verifiedAt: AT },
      'Verified.',
    ],
    [
      'not answering',
      { dnsResolved: false, verified: false },
      { hostname: 'help.acme.com', verifiedAt: AT, unconfirmedSince: AT },
      'Not answering. Fix DNS by November 8, 2026.',
    ],
  ])('Verify says in place when %s', async (_name, status, entry, words) => {
    const onSaved = vi.fn()
    setSectionDomain.mockResolvedValue(SAVED_PENDING('help', 'help.acme.com'))
    verifySectionDomain.mockResolvedValue({ ok: true, sectionDomains: { help: entry }, status })
    const dialog = renderDialog({ loadVerifiedDomains: verified('acme.com'), onSaved })
    choose(dialog, 'Help center')
    await within(dialog).findByRole('radio', { name: 'help.acme.com' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Verify' }))
    expect(await within(dialog).findByText(words)).toBeVisible()
    expect(verifySectionDomain).toHaveBeenCalledWith({ data: { section: 'help' } })
    // The card behind reads the result too.
    expect(onSaved).toHaveBeenCalledTimes(2)
  })
})

describe('Add custom domain: Cloud, a verified domain not yet a custom domain', () => {
  const RECORDS: DnsRecordRow[] = [
    {
      label: 'Routing',
      type: 'CNAME',
      name: 'help.acme.com',
      value: 'edge.example.net',
      state: 'waiting',
    },
    {
      label: 'Verification',
      type: 'TXT',
      name: '_qb.help.acme.com',
      value: 'qb-proof=1',
      state: 'waiting',
    },
  ]
  const loadCloudRecords = vi.fn(async () => RECORDS)

  it('adds it as a custom domain, sets the section, and shows the records to add', async () => {
    mutateCloudCustomDomain.mockResolvedValue({ projection: {}, transferToken: null })
    setSectionDomain.mockResolvedValue(SAVED_PENDING('help', 'help.acme.com'))
    const dialog = renderDialog({
      cloud: true,
      loadVerifiedDomains: verified('acme.com'),
      loadCloudRecords,
    })
    choose(dialog, 'Help center')
    await within(dialog).findByRole('radio', { name: 'help.acme.com' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await within(dialog).findByText('edge.example.net')
    expect(mutateCloudCustomDomain).toHaveBeenCalledWith({
      data: { action: 'add', hostname: 'help.acme.com' },
    })
    expect(mutateCloudCustomDomain.mock.invocationCallOrder[0]).toBeLessThan(
      setSectionDomain.mock.invocationCallOrder[0]
    )
    expect(dialog).toHaveTextContent('qb-proof=1')
    expect(loadCloudRecords).toHaveBeenCalledWith('help.acme.com')
  })

  it('does not add one that is a custom domain already', async () => {
    setSectionDomain.mockResolvedValue(SAVED_PENDING('help', 'help.acme.com'))
    const dialog = renderDialog({
      cloud: true,
      cloudHostnames: ['help.acme.com'],
      loadVerifiedDomains: verified('acme.com'),
      loadCloudRecords,
    })
    choose(dialog, 'Help center')
    await within(dialog).findByRole('radio', { name: 'help.acme.com' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await within(dialog).findByText('edge.example.net')
    expect(mutateCloudCustomDomain).not.toHaveBeenCalled()
  })

  it('Verify checks the custom domain again, then the section', async () => {
    mutateCloudCustomDomain.mockResolvedValue({ projection: {}, transferToken: null })
    setSectionDomain.mockResolvedValue(SAVED_PENDING('help', 'help.acme.com'))
    verifySectionDomain.mockResolvedValue({
      ok: true,
      sectionDomains: { help: { hostname: 'help.acme.com', verifiedAt: AT } },
      status: null,
    })
    const dialog = renderDialog({
      cloud: true,
      loadVerifiedDomains: verified('acme.com'),
      loadCloudRecords,
    })
    choose(dialog, 'Help center')
    await within(dialog).findByRole('radio', { name: 'help.acme.com' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Verify' }))
    expect(await within(dialog).findByText('Verified.')).toBeVisible()
    expect(mutateCloudCustomDomain).toHaveBeenLastCalledWith({
      data: { action: 'refresh', hostname: 'help.acme.com' },
    })
  })

  it('shows a failed add in place and sets nothing', async () => {
    mutateCloudCustomDomain.mockRejectedValue(new Error('That domain is taken.'))
    const dialog = renderDialog({
      cloud: true,
      loadVerifiedDomains: verified('acme.com'),
      loadCloudRecords,
    })
    choose(dialog, 'Help center')
    await within(dialog).findByRole('radio', { name: 'help.acme.com' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toBeVisible()
    expect(setSectionDomain).not.toHaveBeenCalled()
    // Still on the choice, to try again.
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled()
  })
})
