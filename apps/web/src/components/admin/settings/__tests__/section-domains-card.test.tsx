// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PortalSection } from '@/lib/shared/custom-domains'
import type { SectionDomainMap } from '@/lib/shared/section-domains'

const setSectionDomain = vi.fn()
const verifySectionDomain = vi.fn()
vi.mock('@/lib/server/functions/section-domains', () => ({
  setSectionDomainFn: setSectionDomain,
  verifySectionDomainFn: verifySectionDomain,
}))

const { SectionDomainsCard, listedSections } = await import('../section-domains-card')
const { cnameRecord } = await import('../section-domain-record')
// The dialog is loaded when it opens; load it once up front so a busy run does not time the first open out.
await import('../section-domain-dialog')

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

const AT = '2026-11-01T00:00:00.000Z'
const ALL_ON: Record<PortalSection, boolean> = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

function renderCard({
  map = {} as SectionDomainMap,
  sections = ['feedback', 'help', 'status'] as PortalSection[],
  sectionEnabled = ALL_ON,
  cloud = false,
  canAdd = true,
  onChanged = vi.fn(),
}: {
  map?: SectionDomainMap
  sections?: PortalSection[]
  sectionEnabled?: Record<PortalSection, boolean>
  cloud?: boolean
  canAdd?: boolean
  onChanged?: () => void
} = {}) {
  return render(
    <SectionDomainsCard
      view={{ sectionDomains: map, primaryHost: 'acme.com' }}
      sections={sections}
      sectionEnabled={sectionEnabled}
      cloud={cloud}
      readyHostnames={[]}
      canAdd={canAdd}
      onChanged={onChanged}
    />
  )
}

const rows = () =>
  [...document.querySelectorAll('[data-slot="settings-list-row"]')] as HTMLElement[]

const row = (title: string) =>
  screen
    .getByText(title, { selector: 'span.font-medium' })
    .closest('[data-slot="settings-list-row"]') as HTMLElement

async function pick(title: string, item: string) {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: `Actions for ${title}` }))
  await user.click(await screen.findByRole('menuitem', { name: item }))
}

describe('listedSections', () => {
  it('lists the sections in nav order: those that are on, and any off one that keeps a domain', () => {
    expect(
      listedSections({
        nav: {
          items: [
            { id: 'status', type: 'status' },
            { id: 'x', type: 'link', url: 'https://x.io' },
            { id: 'feedback', type: 'feedback' },
          ],
        },
        sectionEnabled: { ...ALL_ON, roadmap: false, support: false },
        map: { support: { hostname: 'support.acme.com', verifiedAt: null } },
      })
    ).toEqual(['status', 'feedback', 'changelog', 'help', 'support'])
  })
})

describe('Custom domains card', () => {
  it('rows the primary domain first, then only the sections with a domain of their own', () => {
    renderCard({ map: { help: { hostname: 'help.acme.com', verifiedAt: AT } } })
    const card = screen.getByRole('heading', { name: 'Custom domains' }).closest('section')!
    expect(card).toHaveAttribute('id', 'custom-domains')
    expect(rows().map((r) => r.querySelector('span.font-medium')?.textContent)).toEqual([
      'Portal',
      'Help center',
    ])
    expect(row('Portal')).toHaveTextContent('acme.com')
    expect(row('Help center')).toHaveTextContent('help.acme.com')
    // A verified domain is the normal state: no badge.
    expect(row('Help center')).not.toHaveTextContent('Pending')
  })

  it('names the sections still on the primary domain in one quiet line', () => {
    renderCard({ map: { help: { hostname: 'help.acme.com', verifiedAt: AT } } })
    expect(row('Portal')).toHaveTextContent('Primary domain · Also serves Feedback, Status')
  })

  it('leaves out a section that is off and has no domain of its own', () => {
    renderCard({ sectionEnabled: { ...ALL_ON, status: false } })
    expect(row('Portal')).toHaveTextContent('Also serves Feedback, Help center')
    expect(row('Portal')).not.toHaveTextContent('Status')
  })

  it('with no section domains, shows a short empty state holding the one Add custom domain', () => {
    renderCard()
    expect(rows()).toHaveLength(1)
    expect(screen.getByText('No section has its own domain yet.')).toBeVisible()
    expect(screen.getAllByRole('button', { name: 'Add custom domain' })).toHaveLength(1)
  })

  it('self-hosted: the primary domain is a fixed row, with no menu', () => {
    renderCard({ map: { help: { hostname: 'help.acme.com', verifiedAt: AT } } })
    expect(screen.queryByRole('button', { name: 'Actions for Portal' })).toBeNull()
  })

  it('on Cloud, changes the primary domain from its row', () => {
    renderCard({ cloud: true })
    expect(screen.getByRole('button', { name: 'Actions for Portal' })).toBeInTheDocument()
  })

  it('marks a domain pending, and one that stopped answering', () => {
    renderCard({
      map: {
        help: { hostname: 'help.acme.com', verifiedAt: null },
        status: { hostname: 'status.acme.com', verifiedAt: AT, unconfirmedSince: AT },
      },
    })
    expect(row('Help center')).toHaveTextContent('Pending')
    expect(row('Status')).toHaveTextContent('Needs attention')
    // The next action, and the date the 7-day grace ends.
    expect(row('Status')).toHaveTextContent('Not answering. Fix DNS by November 8, 2026.')
  })

  it('puts Verify on the row of a domain that needs it, and keeps a verified row quiet', () => {
    renderCard({
      map: {
        feedback: { hostname: 'feedback.acme.com', verifiedAt: AT },
        help: { hostname: 'help.acme.com', verifiedAt: null },
        status: { hostname: 'status.acme.com', verifiedAt: AT, unconfirmedSince: AT },
      },
    })
    expect(within(row('Help center')).getByRole('button', { name: 'Verify' })).toBeVisible()
    expect(within(row('Status')).getByRole('button', { name: 'Verify' })).toBeVisible()
    expect(within(row('Feedback')).queryByRole('button', { name: 'Verify' })).toBeNull()
  })

  it('says what a check found when it did not verify', async () => {
    verifySectionDomain.mockResolvedValue({
      ok: true,
      sectionDomains: {},
      status: { dnsResolved: false, verified: false },
    })
    renderCard({ map: { help: { hostname: 'help.acme.com', verifiedAt: null } } })
    fireEvent.click(within(row('Help center')).getByRole('button', { name: 'Verify' }))
    await waitFor(() =>
      expect(row('Help center')).toHaveTextContent(
        'Not verified yet. DNS changes can take a while to show.'
      )
    )
  })

  it('self-hosted: shows the CNAME a pending domain needs, pointing at this server', async () => {
    renderCard({ map: { help: { hostname: 'help.acme.com', verifiedAt: null } } })
    await screen.findByText('CNAME')
    const record = document.querySelector('[data-slot="section-domain-records"]')!
    expect(record).toHaveTextContent('CNAME')
    expect(record).toHaveTextContent('help.acme.com')
    expect(record).toHaveTextContent('acme.com')
  })

  it('on Cloud, leaves the records to the custom domain itself', () => {
    renderCard({ cloud: true, map: { help: { hostname: 'help.acme.com', verifiedAt: null } } })
    expect(document.querySelector('[data-slot="section-domain-records"]')).toBeNull()
  })

  it('marks a section that is off but keeps its domain', () => {
    renderCard({
      sections: ['feedback', 'status'],
      sectionEnabled: { ...ALL_ON, status: false },
      map: { status: { hostname: 'status.acme.com', verifiedAt: AT } },
    })
    expect(row('Status')).toHaveTextContent('Off')
    // The next step, and where modules are turned on.
    expect(row('Status')).toHaveTextContent(
      'Turn Status on in Settings > General to use this domain.'
    )
  })

  it('forgets what a check found once the domain is changed', async () => {
    verifySectionDomain.mockResolvedValue({
      ok: true,
      sectionDomains: {},
      status: { dnsResolved: false, verified: false },
    })
    setSectionDomain.mockResolvedValue({ ok: true, sectionDomains: {} })
    renderCard({ map: { help: { hostname: 'help.acme.com', verifiedAt: null } } })
    fireEvent.click(within(row('Help center')).getByRole('button', { name: 'Verify' }))
    await waitFor(() => expect(row('Help center')).toHaveTextContent('Not verified yet.'))
    await pick('Help center', 'Change')
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Domain'), {
      target: { value: 'support.acme.com' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(row('Help center')).not.toHaveTextContent('Not verified yet.'))
  })

  it('verifies a section from its row', async () => {
    const onChanged = vi.fn()
    verifySectionDomain.mockResolvedValue({ ok: true, sectionDomains: {}, status: null })
    renderCard({ map: { help: { hostname: 'help.acme.com', verifiedAt: null } }, onChanged })
    fireEvent.click(within(row('Help center')).getByRole('button', { name: 'Verify' }))
    expect(verifySectionDomain).toHaveBeenCalledWith({ data: { section: 'help' } })
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('removes a section domain once confirmed, back to the primary domain', async () => {
    const onChanged = vi.fn()
    setSectionDomain.mockResolvedValue({ ok: true, sectionDomains: {} })
    renderCard({ map: { help: { hostname: 'help.acme.com', verifiedAt: AT } }, onChanged })
    await pick('Help center', 'Remove')
    const confirm = await screen.findByRole('alertdialog')
    expect(confirm).toHaveTextContent('Stop using help.acme.com for Help center?')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(setSectionDomain).toHaveBeenCalledWith({ data: { section: 'help', hostname: null } })
  })

  it('opens Change on that section', async () => {
    renderCard({ map: { help: { hostname: 'help.acme.com', verifiedAt: AT } } })
    await pick('Help center', 'Change')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('radio', { name: /^Help center/ })).toBeChecked()
  })

  it('adds a custom domain from the card, asking what it is used for first', async () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Add custom domain' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Used for')
    expect(within(dialog).queryByLabelText('Domain')).toBeNull()
  })

  it('offers no way to add one without the plan', () => {
    renderCard({ cloud: true, canAdd: false })
    expect(screen.queryByRole('button', { name: 'Add custom domain' })).toBeNull()
  })

  it('shows a refusal from a verify in place', async () => {
    verifySectionDomain.mockResolvedValue({
      ok: false,
      code: 'SECTION_DOMAIN_NOT_SET',
      message: 'Set a domain before verifying it.',
    })
    renderCard({ map: { help: { hostname: 'help.acme.com', verifiedAt: AT } } })
    await pick('Help center', 'Verify')
    expect(await screen.findByRole('alert')).toHaveTextContent('Set a domain before verifying it.')
  })
})

describe('cnameRecord', () => {
  const entry = { hostname: 'help.acme.com', verifiedAt: null }
  const at = (check?: { dnsResolved: boolean; verified: boolean }) =>
    cnameRecord(entry, 'app.example.com', check)

  it('is one CNAME from the hostname to this server', () => {
    expect(at()).toMatchObject({ type: 'CNAME', name: 'help.acme.com', value: 'app.example.com' })
  })

  it('waits until the name resolves, is found once verified, and is a problem in between', () => {
    expect(at().state).toBe('waiting')
    expect(at({ dnsResolved: false, verified: false }).state).toBe('waiting')
    expect(at({ dnsResolved: true, verified: true }).state).toBe('found')
    const broken = at({ dnsResolved: true, verified: false })
    expect(broken.state).toBe('problem')
    expect(broken.problem).toMatch(/does not reach this server/)
  })
})
