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

const { SectionDomainsCard, cnameRecord, listedSections } = await import('../section-domains-card')

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
  it('rows the portal, then each section, with its domain or the primary domain', () => {
    renderCard({ map: { help: { hostname: 'help.acme.com', verifiedAt: AT } } })
    const card = screen.getByRole('heading', { name: 'Custom domains' }).closest('section')!
    expect(card).toHaveAttribute('id', 'custom-domains')
    expect(rows().map((r) => r.querySelector('span.font-medium')?.textContent)).toEqual([
      'Portal',
      'Feedback',
      'Help center',
      'Status',
    ])
    expect(row('Portal')).toHaveTextContent('Primary domain')
    expect(row('Portal')).toHaveTextContent('acme.com')
    expect(row('Help center')).toHaveTextContent('help.acme.com')
    expect(row('Status')).toHaveTextContent('acme.com')
    // A verified domain is the normal state: no badge.
    expect(row('Help center')).not.toHaveTextContent('Pending')
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
    expect(row('Status')).toHaveTextContent('Not answering')
  })

  it('self-hosted: shows the CNAME a pending domain needs, pointing at this server', () => {
    renderCard({ map: { help: { hostname: 'help.acme.com', verifiedAt: null } } })
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
  })

  it('verifies a section from its row', async () => {
    const onChanged = vi.fn()
    verifySectionDomain.mockResolvedValue({ ok: true, sectionDomains: {}, status: null })
    renderCard({ map: { help: { hostname: 'help.acme.com', verifiedAt: null } }, onChanged })
    await pick('Help center', 'Verify')
    expect(verifySectionDomain).toHaveBeenCalledWith({ data: { section: 'help' } })
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('removes a section domain once confirmed, back to the primary domain', async () => {
    const onChanged = vi.fn()
    setSectionDomain.mockResolvedValue({ ok: true, sectionDomains: {} })
    renderCard({ map: { help: { hostname: 'help.acme.com', verifiedAt: AT } }, onChanged })
    await pick('Help center', 'Remove')
    const confirm = screen.getByRole('alertdialog')
    expect(confirm).toHaveTextContent('Stop using help.acme.com for Help center?')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(setSectionDomain).toHaveBeenCalledWith({ data: { section: 'help', hostname: null } })
  })

  it('opens Change on that section', async () => {
    renderCard({ map: { help: { hostname: 'help.acme.com', verifiedAt: AT } } })
    await pick('Help center', 'Change')
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('radio', { name: /^Help center/ })).toBeChecked()
  })

  it('adds a custom domain from the card, asking what it is used for first', () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Add custom domain' }))
    const dialog = screen.getByRole('dialog')
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
    renderCard({ map: { help: { hostname: 'help.acme.com', verifiedAt: null } } })
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
