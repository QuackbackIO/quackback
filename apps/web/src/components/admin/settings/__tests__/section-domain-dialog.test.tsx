// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PortalSection } from '@/lib/shared/custom-domains'
import { FULL_NAMES_NOTE, type DnsRecordRow } from '@/components/shared/dns-record-table'

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

const AT = '2026-11-01T00:00:00.000Z'
const SECTIONS: PortalSection[] = ['feedback', 'help', 'status']

type Props = Parameters<typeof SectionDomainDialog>[0]

function renderDialog(overrides: Partial<Props> = {}) {
  render(
    <SectionDomainDialog
      open
      initial={null}
      cloud={false}
      sections={SECTIONS}
      map={{}}
      primaryHost="portal.example.net"
      readyHostnames={[]}
      onSaved={vi.fn()}
      onClose={vi.fn()}
      onMakePrimary={vi.fn()}
      onAddDomain={vi.fn()}
      {...overrides}
    />
  )
  return screen.getByRole('dialog')
}

const verified =
  (...names: string[]) =>
  () =>
    Promise.resolve(names)

const tiles = (dialog: HTMLElement, slot: string) =>
  [...dialog.querySelectorAll(`[data-slot="${slot}"] [data-slot="visibility-tile"]`)].map((t) => ({
    title: t.querySelector('.font-medium')?.textContent,
    description: t.querySelector('.text-muted-foreground')?.textContent ?? null,
  }))
const usedForTitles = (dialog: HTMLElement) => tiles(dialog, 'used-for-tiles').map((t) => t.title)
const domainTitles = (dialog: HTMLElement) => tiles(dialog, 'domain-choices').map((t) => t.title)

const choose = (dialog: HTMLElement, name: string) =>
  fireEvent.click(within(dialog).getByRole('radio', { name: new RegExp(`^${name}`) }))

const save = (dialog: HTMLElement) =>
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

const pending = (section: PortalSection, hostname: string) => ({
  ok: true,
  sectionDomains: { [section]: { hostname, verifiedAt: null } },
})

/** Picks the section, waits for the one Verified domain's field, and saves it. */
async function saveOnVerified(dialog: HTMLElement, section = 'Help center', domain = 'acme.com') {
  choose(dialog, section)
  await within(dialog).findByLabelText(`Name in front of ${domain}`)
  save(dialog)
}

describe('Used for', () => {
  it('names each section once, quiet unless it has a domain of its own', () => {
    const dialog = renderDialog({ map: { help: { hostname: 'help.acme.com', verifiedAt: null } } })
    expect(within(dialog).getByRole('heading', { name: 'Add custom domain' })).toBeVisible()
    expect(within(dialog).getByRole('radiogroup', { name: 'Used for' })).toBeVisible()
    expect(tiles(dialog, 'used-for-tiles')).toEqual([
      { title: 'Feedback', description: null },
      { title: 'Help center', description: 'help.acme.com' },
      { title: 'Status', description: null },
    ])
    expect(dialog).not.toHaveTextContent('portal.example.net')
    // At phone width a hostname stays on one line, whole on hover.
    const helpTile = within(dialog).getByText('help.acme.com')
    expect(helpTile).toHaveClass('truncate')
    expect(helpTile).toHaveAttribute('title', 'help.acme.com')
    // Two across at every width.
    expect(dialog.querySelector('[data-slot="used-for-tiles"] [role="radiogroup"]')).toHaveClass(
      'grid-cols-2'
    )
    // No field until a choice is made.
    expect(within(dialog).queryByRole('textbox')).toBeNull()
  })

  it('in Add, a section that has a domain already is not offered; its row changes it', () => {
    const dialog = renderDialog({ map: { help: { hostname: 'help.acme.com', verifiedAt: null } } })
    const help = within(dialog).getByRole('radio', { name: /^Help center/ })
    expect(help).toHaveAttribute('aria-disabled', 'true')
    expect(within(dialog).getByRole('radio', { name: /^Status/ })).not.toHaveAttribute(
      'aria-disabled',
      'true'
    )
  })

  it('on Cloud, Portal comes first and says it is the primary domain', () => {
    const dialog = renderDialog({ cloud: true })
    expect(usedForTitles(dialog)).toEqual(['Portal', 'Feedback', 'Help center', 'Status'])
    expect(tiles(dialog, 'used-for-tiles')[0].description).toBe('Primary domain')
  })

  it('self-hosted: offers no Portal tile, as BASE_URL sets the primary domain', () => {
    const dialog = renderDialog()
    expect(within(dialog).queryByRole('radio', { name: /^Portal/ })).toBeNull()
  })
})

describe('Change custom domain', () => {
  it('names what it is used for as a detail and starts at Domain', () => {
    const dialog = renderDialog({
      initial: 'help',
      map: { help: { hostname: 'help.acme.com', verifiedAt: AT } },
    })
    expect(within(dialog).getByRole('heading', { name: 'Change custom domain' })).toBeVisible()
    expect(within(dialog).queryByRole('radiogroup', { name: 'Used for' })).toBeNull()
    const detail = dialog.querySelector('[data-slot="used-for-detail"]') as HTMLElement
    expect(detail).toHaveTextContent('Used for')
    expect(detail).toHaveTextContent('Help center')
    expect(within(dialog).getByLabelText('Domain')).toHaveValue('help.acme.com')
  })

  it('saves only a hostname that differs from a verified one', () => {
    const dialog = renderDialog({
      initial: 'help',
      map: { help: { hostname: 'help.acme.com', verifiedAt: AT } },
    })
    const saveButton = within(dialog).getByRole('button', { name: 'Save' })
    expect(saveButton).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Domain'), {
      target: { value: 'docs.acme.com' },
    })
    expect(saveButton).toBeEnabled()
  })

  it('a pending one, unchanged, shows its DNS record without saving again', async () => {
    const dialog = renderDialog({
      initial: 'help',
      map: { help: { hostname: 'help.acme.com', verifiedAt: null } },
    })
    expect(within(dialog).queryByRole('button', { name: 'Save' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show DNS record' }))
    expect(await within(dialog).findByRole('button', { name: 'Verify' })).toBeVisible()
    expect(setSectionDomain).not.toHaveBeenCalled()
  })

  it('a pending one, changed, is saved', () => {
    const dialog = renderDialog({
      initial: 'help',
      map: { help: { hostname: 'help.acme.com', verifiedAt: null } },
    })
    fireEvent.change(within(dialog).getByLabelText('Domain'), {
      target: { value: 'docs.acme.com' },
    })
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(within(dialog).queryByRole('button', { name: 'Show DNS record' })).toBeNull()
  })

  it('opens on the Verified domain the section already uses', async () => {
    const dialog = renderDialog({
      initial: 'help',
      loadVerifiedDomains: verified('acme.com', 'acme.io'),
      map: { help: { hostname: 'docs.acme.io', verifiedAt: null } },
    })
    expect(await within(dialog).findByRole('radio', { name: 'acme.io' })).toBeChecked()
    expect(within(dialog).getByLabelText('Name in front of acme.io')).toHaveValue('docs')
  })
})

describe('Domain: a hostname typed in full', () => {
  it('self-hosted: sets a section to the hostname typed', async () => {
    const onSaved = vi.fn()
    const onClose = vi.fn()
    setSectionDomain.mockResolvedValue({
      ok: true,
      sectionDomains: { status: { hostname: 'status.acme.com', verifiedAt: AT } },
    })
    const dialog = renderDialog({ onSaved, onClose })
    choose(dialog, 'Status')
    const field = within(dialog).getByLabelText('Domain')
    expect(field).toHaveAttribute('placeholder', 'status.example.com')
    fireEvent.change(field, { target: { value: 'status.acme.com' } })
    save(dialog)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onSaved).toHaveBeenCalled()
    expect(setSectionDomain).toHaveBeenCalledWith({
      data: { section: 'status', hostname: 'status.acme.com' },
    })
  })

  it('shows a refusal under the field it belongs to', async () => {
    setSectionDomain.mockResolvedValue({
      ok: false,
      code: 'SECTION_DOMAIN_TAKEN',
      message: 'help.acme.com is already used for another section.',
    })
    const onClose = vi.fn()
    const dialog = renderDialog({ onClose })
    choose(dialog, 'Status')
    const field = within(dialog).getByLabelText('Domain')
    fireEvent.change(field, { target: { value: 'help.acme.com' } })
    save(dialog)
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('help.acme.com is already used for another section.')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field.getAttribute('aria-describedby')).toContain(alert.id)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('fills in the zone a sibling section already uses', () => {
    const dialog = renderDialog({
      map: { feedback: { hostname: 'feedback.acme.com', verifiedAt: AT } },
    })
    choose(dialog, 'Status')
    expect(within(dialog).getByLabelText('Domain')).toHaveValue('status.acme.com')
  })

  it('on a domain page, takes a name in front of that domain, starting from the section', async () => {
    setSectionDomain.mockResolvedValue({ ok: true, sectionDomains: {} })
    const dialog = renderDialog({ suffix: 'acme.com' })
    choose(dialog, 'Help center')
    expect(within(dialog).getByLabelText('Name in front of acme.com')).toHaveValue('help')
    save(dialog)
    await waitFor(() =>
      expect(setSectionDomain).toHaveBeenCalledWith({
        data: { section: 'help', hostname: 'help.acme.com' },
      })
    )
  })

  it('refuses a name that is not one, and writes nothing', () => {
    const dialog = renderDialog({ suffix: 'acme.com' })
    choose(dialog, 'Help center')
    const field = within(dialog).getByLabelText('Name in front of acme.com')
    fireEvent.change(field, { target: { value: 'help desk' } })
    save(dialog)
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Use letters, numbers and hyphens')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(setSectionDomain).not.toHaveBeenCalled()
  })

  it('keeps the free field when Verified domains cannot be read', async () => {
    const dialog = renderDialog({
      loadVerifiedDomains: () => Promise.reject(new Error('forbidden')),
      onAddVerifiedDomain: vi.fn(),
    })
    choose(dialog, 'Status')
    expect(await within(dialog).findByLabelText('Domain')).toBeVisible()
    expect(dialog).not.toHaveTextContent('No Verified domains yet.')
  })
})

describe('Domain: picking a Verified domain', () => {
  it('with one Verified domain and nothing else, shows only its name field', async () => {
    setSectionDomain.mockResolvedValue(pending('help', 'docs.acme.com'))
    const dialog = renderDialog({ loadVerifiedDomains: verified('acme.com') })
    choose(dialog, 'Help center')
    const field = await within(dialog).findByLabelText('Name in front of acme.com')
    expect(within(dialog).queryByRole('radiogroup', { name: 'Domain' })).toBeNull()
    expect(field).toHaveValue('help')
    const suffix = dialog.querySelector(`#${field.getAttribute('aria-describedby')?.split(' ')[0]}`)
    expect(suffix).toHaveTextContent('.acme.com')
    fireEvent.change(field, { target: { value: 'docs' } })
    save(dialog)
    await waitFor(() =>
      expect(setSectionDomain).toHaveBeenCalledWith({
        data: { section: 'help', hostname: 'docs.acme.com' },
      })
    )
  })

  it('an empty name is not a name; the bare domain is under Another domain', async () => {
    const dialog = renderDialog({ loadVerifiedDomains: verified('acme.com') })
    choose(dialog, 'Help center')
    const field = await within(dialog).findByLabelText('Name in front of acme.com')
    fireEvent.change(field, { target: { value: '' } })
    save(dialog)
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Use letters, numbers and hyphens')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(setSectionDomain).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Another domain' }))
    expect(within(dialog).getByLabelText('Domain')).toBeVisible()
    // The way back names the hostname it restores.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use help.acme.com' }))
    expect(within(dialog).getByLabelText('Name in front of acme.com')).toHaveValue('help')
  })

  it('with two, offers each then Another domain, the first picked, its field under its tile', async () => {
    const dialog = renderDialog({ loadVerifiedDomains: verified('acme.com', 'acme.io') })
    choose(dialog, 'Help center')
    await waitFor(() =>
      expect(domainTitles(dialog)).toEqual(['acme.com', 'acme.io', 'Another domain'])
    )
    expect(within(dialog).getByRole('radiogroup', { name: 'Domain' })).toBeVisible()
    const tile = within(dialog).getByRole('radio', { name: 'acme.com' })
    expect(tile).toBeChecked()
    const field = within(dialog).getByLabelText('Name in front of acme.com')
    // Directly under the picked tile, before the next one.
    const picked = tile.closest('[data-slot="visibility-tile"]') as HTMLElement
    expect(picked.nextElementSibling).toContainElement(field)
    // The tile picks the domain; the field picks the name.
    fireEvent.change(field, { target: { value: 'docs' } })
    expect(tile).toBeChecked()
  })

  it('picks the Verified domain the other sections already use', async () => {
    const dialog = renderDialog({
      loadVerifiedDomains: verified('acme.com', 'acme.io'),
      map: { feedback: { hostname: 'feedback.acme.io', verifiedAt: AT } },
    })
    choose(dialog, 'Help center')
    expect(await within(dialog).findByRole('radio', { name: 'acme.io' })).toBeChecked()
  })

  it('never offers a hostname another section uses', async () => {
    const dialog = renderDialog({
      loadVerifiedDomains: verified('acme.com', 'acme.io'),
      map: { feedback: { hostname: 'help.acme.com', verifiedAt: null } },
    })
    choose(dialog, 'Help center')
    // Only acme.io is left, so it is offered alone, as its name field.
    expect(await within(dialog).findByLabelText('Name in front of acme.io')).toHaveValue('help')
    expect(within(dialog).queryByLabelText('Name in front of acme.com')).toBeNull()
  })

  it('Another domain reveals the free field', async () => {
    setSectionDomain.mockResolvedValue(pending('status', 'status.other.org'))
    const dialog = renderDialog({ loadVerifiedDomains: verified('acme.com', 'acme.io') })
    choose(dialog, 'Status')
    fireEvent.click(await within(dialog).findByRole('radio', { name: 'Another domain' }))
    const field = within(dialog).getByLabelText('Hostname')
    fireEvent.change(field, { target: { value: 'Status.Other.org' } })
    save(dialog)
    await waitFor(() =>
      expect(setSectionDomain).toHaveBeenCalledWith({
        data: { section: 'status', hostname: 'status.other.org' },
      })
    )
  })

  it('lists many in a compact select', async () => {
    const dialog = renderDialog({
      loadVerifiedDomains: verified('a.com', 'b.com', 'c.com', 'd.com', 'e.com'),
    })
    choose(dialog, 'Help center')
    expect(await within(dialog).findByRole('combobox', { name: 'Domain' })).toBeVisible()
    expect(domainTitles(dialog)).toEqual([])
  })

  it('on Cloud, a ready custom domain says Ready; a Verified one stays quiet', async () => {
    const dialog = renderDialog({
      cloud: true,
      loadVerifiedDomains: verified('acme.com'),
      readyHostnames: ['news.acme.com'],
    })
    choose(dialog, 'Help center')
    await waitFor(() =>
      expect(tiles(dialog, 'domain-choices')).toEqual([
        { title: 'acme.com', description: null },
        { title: 'news.acme.com', description: 'Ready' },
        { title: 'Another domain', description: null },
      ])
    )
  })

  it('on Cloud, offers only ready custom domains no other section uses', async () => {
    setSectionDomain.mockResolvedValue({ ok: true, sectionDomains: {} })
    const dialog = renderDialog({
      cloud: true,
      readyHostnames: ['help.acme.com', 'status.acme.com', 'news.acme.com'],
      map: { help: { hostname: 'help.acme.com', verifiedAt: AT } },
    })
    choose(dialog, 'Status')
    expect(domainTitles(dialog)).toEqual(['status.acme.com', 'news.acme.com', 'Another domain'])
    fireEvent.click(within(dialog).getByRole('radio', { name: /^status\.acme\.com/ }))
    save(dialog)
    await waitFor(() =>
      expect(setSectionDomain).toHaveBeenCalledWith({
        data: { section: 'status', hostname: 'status.acme.com' },
      })
    )
    expect(mutateCloudCustomDomain).not.toHaveBeenCalled()
  })
})

describe('Domain: no Verified domain yet', () => {
  it('says so, with Add domain for the section, closing first', async () => {
    const onClose = vi.fn()
    const onAddVerifiedDomain = vi.fn()
    const dialog = renderDialog({
      loadVerifiedDomains: verified(),
      onAddVerifiedDomain,
      onClose,
    })
    choose(dialog, 'Status')
    expect(await within(dialog).findByText('No Verified domains yet.')).toBeVisible()
    expect(within(dialog).queryByRole('textbox')).toBeNull()
    // Only Add domain, Type a domain and Cancel: nothing to save yet.
    expect(within(dialog).queryByRole('button', { name: 'Save' })).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeVisible()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add domain' }))
    expect(onAddVerifiedDomain).toHaveBeenCalledWith('status')
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(
      onAddVerifiedDomain.mock.invocationCallOrder[0]
    )
  })

  it('Type a domain reveals the free field', async () => {
    const dialog = renderDialog({ loadVerifiedDomains: verified(), onAddVerifiedDomain: vi.fn() })
    choose(dialog, 'Status')
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Type a domain' }))
    expect(within(dialog).getByLabelText('Domain')).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeVisible()
    expect(dialog).not.toHaveTextContent('Another domain')
  })

  it('shows the free field to a viewer who cannot add a domain', async () => {
    const dialog = renderDialog({ loadVerifiedDomains: verified() })
    choose(dialog, 'Status')
    expect(await within(dialog).findByLabelText('Domain')).toBeVisible()
    expect(within(dialog).queryByRole('button', { name: 'Add domain' })).toBeNull()
    expect(dialog).not.toHaveTextContent('No Verified domains yet.')
  })

  it('on Cloud, a ready custom domain is enough: no empty state', async () => {
    const dialog = renderDialog({
      cloud: true,
      readyHostnames: ['status.acme.com'],
      loadVerifiedDomains: verified(),
      onAddVerifiedDomain: vi.fn(),
    })
    choose(dialog, 'Status')
    await waitFor(() => expect(domainTitles(dialog)).toEqual(['status.acme.com', 'Another domain']))
    expect(dialog).not.toHaveTextContent('No Verified domains yet.')
  })
})

describe('Point DNS', () => {
  it('shows the record relative to the Verified domain, with its state, Verify first and focused', async () => {
    const onSaved = vi.fn()
    const onClose = vi.fn()
    setSectionDomain.mockResolvedValue(pending('help', 'help.acme.com'))
    const dialog = renderDialog({ loadVerifiedDomains: verified('acme.com'), onSaved, onClose })
    await saveOnVerified(dialog)
    const verify = await within(dialog).findByRole('button', { name: 'Verify' })
    expect(onSaved).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(within(dialog).queryByText('Used for')).toBeNull()
    const head = dialog.querySelector('[data-slot="point-dns-hostname"]') as HTMLElement
    expect(head).toHaveTextContent('help.acme.com')
    expect(head).toHaveTextContent('Pending')
    expect(dialog).toHaveTextContent(
      'Add this record where you manage DNS for acme.com, then select Verify.'
    )
    expect(within(dialog).getByRole('button', { name: 'Copy name help' })).toBeVisible()
    expect(dialog).not.toHaveTextContent(FULL_NAMES_NOTE)
    // One record: no group label above it.
    expect(dialog.querySelector('[data-slot="dns-record"]')).not.toHaveTextContent('Routing')
    // Verify leads until the domain is verified; Verify later is the way out.
    const done = within(dialog).getByRole('button', { name: 'Verify later' })
    expect(within(dialog).queryByRole('button', { name: 'Done' })).toBeNull()
    expect(verify).toHaveClass('bg-primary')
    expect(done).not.toHaveClass('bg-primary')
    expect(done).toHaveClass('border')
    // On a phone the footer stacks in reverse: Verify comes after Done in the DOM, so on top.
    expect(done.compareDocumentPosition(verify) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await waitFor(() => expect(verify).toHaveFocus())
    expect(within(dialog).getByRole('status')).toHaveAttribute('aria-live', 'polite')
    fireEvent.click(done)
    expect(onClose).toHaveBeenCalled()
  })

  it('a hostname on no Verified domain shows its full name and says so', async () => {
    setSectionDomain.mockResolvedValue(pending('status', 'status.other.org'))
    const dialog = renderDialog()
    choose(dialog, 'Status')
    fireEvent.change(within(dialog).getByLabelText('Domain'), {
      target: { value: 'status.other.org' },
    })
    save(dialog)
    expect(
      await within(dialog).findByText('Add this record at your DNS host, then select Verify.')
    ).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'Copy name status.other.org' })).toBeVisible()
    expect(dialog).toHaveTextContent(FULL_NAMES_NOTE)
  })

  it('without a record to show, says where it is', async () => {
    setSectionDomain.mockResolvedValue(pending('status', 'status.other.org'))
    const dialog = renderDialog({ primaryHost: null })
    choose(dialog, 'Status')
    fireEvent.change(within(dialog).getByLabelText('Domain'), {
      target: { value: 'status.other.org' },
    })
    save(dialog)
    expect(
      await within(dialog).findByText(
        "Couldn't load the DNS record. Find it on the Custom domains card."
      )
    ).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'Verify' })).toBeVisible()
  })

  it('a hostname that is verified already just closes', async () => {
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
    save(dialog)
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it.each([
    [
      'not verified yet',
      { hostname: 'help.acme.com', verifiedAt: null },
      'Not verified yet. DNS changes can take a while to show.',
      'Pending',
    ],
    [
      'not answering',
      { hostname: 'help.acme.com', verifiedAt: AT, unconfirmedSince: AT },
      'Not answering. Fix DNS by November 8, 2026.',
      'Needs attention',
    ],
  ])('Verify says in place when %s', async (_name, entry, words, badge) => {
    const onSaved = vi.fn()
    setSectionDomain.mockResolvedValue(pending('help', 'help.acme.com'))
    let finish: (value: unknown) => void = () => {}
    verifySectionDomain.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const dialog = renderDialog({ loadVerifiedDomains: verified('acme.com'), onSaved })
    await saveOnVerified(dialog)
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Verify' }))
    const busy = within(dialog).getByRole('button', { name: 'Verifying…' })
    expect(busy).toBeDisabled()
    expect(busy).toHaveAttribute('aria-busy', 'true')
    expect(within(dialog).getByRole('status')).toHaveTextContent('')
    await act(async () =>
      finish({
        ok: true,
        sectionDomains: { help: entry },
        status: { dnsResolved: false, verified: false },
      })
    )
    expect(within(dialog).getByRole('status')).toHaveTextContent(words)
    expect(dialog.querySelector('[data-slot="point-dns-hostname"]')).toHaveTextContent(badge)
    expect(within(dialog).getByRole('button', { name: 'Verify' })).toBeEnabled()
    expect(verifySectionDomain).toHaveBeenCalledWith({ data: { section: 'help' } })
    // The card behind reads the result too.
    expect(onSaved).toHaveBeenCalledTimes(2)
  })

  it('clears the last result while a new Verify runs, so it is announced afresh', async () => {
    setSectionDomain.mockResolvedValue(pending('help', 'help.acme.com'))
    const stillPending = {
      ok: true,
      sectionDomains: { help: { hostname: 'help.acme.com', verifiedAt: null } },
      status: { dnsResolved: false, verified: false },
    }
    verifySectionDomain.mockResolvedValueOnce(stillPending)
    const dialog = renderDialog({ loadVerifiedDomains: verified('acme.com') })
    await saveOnVerified(dialog)
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Verify' }))
    const status = within(dialog).getByRole('status')
    await waitFor(() => expect(status).toHaveTextContent('Not verified yet.'))
    let finish: (value: unknown) => void = () => {}
    verifySectionDomain.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Verify' }))
    // The same element stays mounted, emptied until the answer comes.
    expect(within(dialog).getByRole('status')).toBe(status)
    expect(status).toHaveTextContent('')
    await act(async () => finish(stillPending))
    expect(status).toHaveTextContent('Not verified yet.')
  })

  it('once verified, leaves Done alone and says Verified', async () => {
    setSectionDomain.mockResolvedValue(pending('help', 'help.acme.com'))
    verifySectionDomain.mockResolvedValue({
      ok: true,
      sectionDomains: { help: { hostname: 'help.acme.com', verifiedAt: AT } },
      status: { dnsResolved: true, verified: true },
    })
    const dialog = renderDialog({ loadVerifiedDomains: verified('acme.com') })
    await saveOnVerified(dialog)
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Verify' }))
    const done = await within(dialog).findByRole('button', { name: 'Done' })
    // Only the hostname with its badge, and Done, focused.
    expect(dialog.querySelector('[data-slot="point-dns-hostname"]')).toHaveTextContent('Verified')
    expect(within(dialog).queryByRole('button', { name: 'Verify' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Verify later' })).toBeNull()
    expect(done).toHaveClass('bg-primary')
    await waitFor(() => expect(done).toHaveFocus())
    expect(dialog).not.toHaveTextContent('Add this record')
    expect(dialog.querySelector('[data-slot="dns-record"]')).toBeNull()
    expect(dialog).not.toHaveTextContent(FULL_NAMES_NOTE)
    // Still announced, but not shown twice beside the badge.
    const status = within(dialog).getByRole('status')
    expect(status).toHaveTextContent('Verified.')
    expect(status).toHaveClass('sr-only')
  })
})

describe('Cloud: a hostname not yet a custom domain', () => {
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
  const cloud = (overrides: Partial<Props> = {}) =>
    renderDialog({
      cloud: true,
      loadVerifiedDomains: verified('acme.com'),
      loadCloudRecords,
      ...overrides,
    })

  it('adds it as a custom domain, sets the section, and shows its records', async () => {
    mutateCloudCustomDomain.mockResolvedValue({ projection: {}, transferToken: null })
    setSectionDomain.mockResolvedValue(pending('help', 'help.acme.com'))
    const dialog = cloud()
    await saveOnVerified(dialog)
    await within(dialog).findByText('edge.example.net')
    expect(mutateCloudCustomDomain).toHaveBeenCalledWith({
      data: { action: 'add', hostname: 'help.acme.com' },
    })
    expect(mutateCloudCustomDomain.mock.invocationCallOrder[0]).toBeLessThan(
      setSectionDomain.mock.invocationCallOrder[0]
    )
    expect(loadCloudRecords).toHaveBeenCalledWith('help.acme.com')
    expect(dialog).toHaveTextContent(
      'Add these records where you manage DNS for acme.com, then select Verify.'
    )
    // Relative to the zone, as most DNS hosts take them.
    expect(within(dialog).getByRole('button', { name: 'Copy name _qb.help' })).toBeVisible()
  })

  it('says so when the custom domains could not be read, and adds nothing', async () => {
    // A failed read is not "no custom domains": a hostname already added would
    // look new, and Save would add it again.
    setSectionDomain.mockResolvedValue(pending('help', 'help.acme.com'))
    const dialog = cloud({ cloudDomainsUnavailable: true })
    choose(dialog, 'Help center')
    await within(dialog).findByLabelText('Name in front of acme.com')
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      "Couldn't load your custom domains. Try again."
    )
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
    save(dialog)
    fireEvent.submit(within(dialog).getByRole('button', { name: 'Save' }).closest('form')!)
    await act(async () => {})
    expect(mutateCloudCustomDomain).not.toHaveBeenCalled()
    expect(setSectionDomain).not.toHaveBeenCalled()
  })

  it('does not add one that is a custom domain already', async () => {
    setSectionDomain.mockResolvedValue(pending('help', 'help.acme.com'))
    const dialog = cloud({ cloudHostnames: ['help.acme.com'] })
    await saveOnVerified(dialog)
    await within(dialog).findByText('edge.example.net')
    expect(mutateCloudCustomDomain).not.toHaveBeenCalled()
  })

  it('added, then the section step threw: a quiet note to Save again, which only sets the section', async () => {
    const onSaved = vi.fn()
    mutateCloudCustomDomain.mockResolvedValue({ projection: {}, transferToken: null })
    setSectionDomain.mockRejectedValueOnce(new Error('timeout'))
    const dialog = cloud({ onSaved })
    await saveOnVerified(dialog)
    const note = await within(dialog).findByText(
      'help.acme.com is added. Select Save to use it for Help center.'
    )
    expect(note).toHaveAttribute('role', 'status')
    expect(note).toHaveClass('text-muted-foreground')
    expect(within(dialog).queryByRole('alert')).toBeNull()
    expect(within(dialog).getByLabelText('Name in front of acme.com')).not.toHaveAttribute(
      'aria-invalid'
    )
    expect(onSaved).toHaveBeenCalledTimes(1)

    setSectionDomain.mockResolvedValueOnce(pending('help', 'help.acme.com'))
    save(dialog)
    await within(dialog).findByRole('button', { name: 'Verify' })
    expect(setSectionDomain).toHaveBeenCalledTimes(2)
    expect(mutateCloudCustomDomain).toHaveBeenCalledTimes(1)
  })

  it('added, then the section step refused: the real reason, at the field', async () => {
    mutateCloudCustomDomain.mockResolvedValue({ projection: {}, transferToken: null })
    setSectionDomain.mockResolvedValueOnce({
      ok: false,
      code: 'SECTION_DOMAIN_CLOUD_UNAVAILABLE',
      message: 'Custom domains cannot be read right now. Try again shortly.',
    })
    const dialog = cloud()
    await saveOnVerified(dialog)
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'help.acme.com was added. Custom domains cannot be read right now. Try again shortly.'
    )
    expect(within(dialog).getByLabelText('Name in front of acme.com')).toHaveAttribute(
      'aria-invalid',
      'true'
    )
    setSectionDomain.mockResolvedValueOnce(pending('help', 'help.acme.com'))
    save(dialog)
    await within(dialog).findByRole('button', { name: 'Verify' })
    expect(mutateCloudCustomDomain).toHaveBeenCalledTimes(1)
  })

  it('shows a failed add in place and sets nothing', async () => {
    mutateCloudCustomDomain.mockRejectedValue(new Error('That domain is taken.'))
    const dialog = cloud()
    await saveOnVerified(dialog)
    expect(await within(dialog).findByRole('alert')).toBeVisible()
    expect(setSectionDomain).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('without its records, says where they are and keeps Verify', async () => {
    mutateCloudCustomDomain.mockResolvedValue({ projection: {}, transferToken: null })
    setSectionDomain.mockResolvedValue(pending('help', 'help.acme.com'))
    const dialog = cloud({ loadCloudRecords: () => Promise.reject(new Error('unavailable')) })
    await saveOnVerified(dialog)
    expect(
      await within(dialog).findByText(
        "Couldn't load the DNS record. Find it under Domain verification."
      )
    ).toBeVisible()
    expect(dialog).not.toHaveTextContent('Add this record')
    expect(within(dialog).getByRole('button', { name: 'Verify' })).toBeVisible()
  })

  it('Verify checks the custom domain again, then the section', async () => {
    mutateCloudCustomDomain.mockResolvedValue({ projection: {}, transferToken: null })
    setSectionDomain.mockResolvedValue(pending('help', 'help.acme.com'))
    verifySectionDomain.mockResolvedValue({
      ok: true,
      sectionDomains: { help: { hostname: 'help.acme.com', verifiedAt: AT } },
      status: null,
    })
    const dialog = cloud()
    await saveOnVerified(dialog)
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Verify' }))
    expect(await within(dialog).findByText('Verified.')).toBeVisible()
    expect(mutateCloudCustomDomain).toHaveBeenLastCalledWith({
      data: { action: 'refresh', hostname: 'help.acme.com' },
    })
  })
})

describe('Portal on Cloud', () => {
  it('routes to adding a custom domain when none is ready', () => {
    const onAddDomain = vi.fn()
    const dialog = renderDialog({ cloud: true, onAddDomain })
    choose(dialog, 'Portal')
    expect(dialog).toHaveTextContent('No custom domains ready yet.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add domain' }))
    expect(onAddDomain).toHaveBeenCalled()
  })

  it('makes a ready custom domain the primary domain', () => {
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
    save(dialog)
    expect(onMakePrimary).toHaveBeenCalledWith('www.acme.com')
    expect(setSectionDomain).not.toHaveBeenCalled()
  })
})

describe('Layout and words', () => {
  it('keeps the footer out of the scrolling body, so Save is always in reach', () => {
    const dialog = renderDialog()
    const body = dialog.querySelector('[data-slot="section-domain-body"]') as HTMLElement
    const footer = dialog.querySelector('[data-slot="dialog-footer"]') as HTMLElement
    expect(body).toHaveClass('overflow-y-auto')
    expect(body).not.toContainElement(footer)
    expect(dialog).toHaveClass('max-h-[calc(100dvh-2rem)]')
  })

  it('never uses an em dash', async () => {
    const dialog = renderDialog({
      cloud: true,
      loadVerifiedDomains: verified(),
      onAddVerifiedDomain: vi.fn(),
    })
    choose(dialog, 'Status')
    await within(dialog).findByText('No Verified domains yet.')
    expect(dialog.textContent).not.toContain('—')
  })
})
