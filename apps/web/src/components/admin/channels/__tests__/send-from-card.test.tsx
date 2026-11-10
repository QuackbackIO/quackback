// @vitest-environment happy-dom
import { Children, isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { EmailSendersDTO } from '@/lib/server/functions/channel-accounts'

const setSender = vi.fn()
vi.mock('@/lib/client/mutations/channel-accounts', () => ({
  useSetEmailSender: () => ({ mutate: setSender, isPending: false }),
}))

/** The trigger's accessible name, read off the Select's children. */
function triggerLabel(children: ReactNode): string | undefined {
  let label: string | undefined
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    const props = child.props as { 'aria-label'?: string }
    if (props['aria-label']) label = props['aria-label']
  })
  return label
}

// The Select's popup relies on layout APIs happy-dom lacks; render it as a
// native <select> named after its trigger, so options and choices are drivable.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string
    onValueChange: (v: string) => void
    children: ReactNode
  }) => (
    <select
      aria-label={triggerLabel(children)}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: ReactNode; 'aria-label'?: string }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}))

const { SendFromCard } = await import('../send-from-card')

const NONE: EmailSendersDTO = {
  default: null,
  support: null,
  feedback: null,
  changelog: null,
  status: null,
}
const PLATFORM = 'Acme <noreply@mail.platform.test>'
const HELLO = { id: 'ca_hello', label: 'Acme <hello@acme.com>', live: true }
const NEWS = { id: 'ca_news', label: 'Acme Updates <news@acme.com>', live: true }
const PENDING = { id: 'ca_pending', label: 'Acme <help@pending.example>', live: false }

function renderCard(
  over: Partial<{
    senders: Partial<EmailSendersDTO>
    hasInboundRoute: boolean
    forwardingTarget: string | null
    forwardingTargetPermitted: boolean | null
    rows: Array<keyof EmailSendersDTO>
    platformFrom: string | null
    platformName: string
    platformInbox: string | null
  }> = {}
) {
  return render(
    <SendFromCard
      senders={{ ...NONE, ...over.senders }}
      identities={[HELLO, NEWS, PENDING]}
      platformFrom={over.platformFrom === undefined ? PLATFORM : over.platformFrom}
      platformName={over.platformName}
      platformInbox={over.platformInbox}
      forwardingTarget={over.forwardingTarget ?? null}
      forwardingTargetPermitted={over.forwardingTargetPermitted ?? null}
      hasInboundRoute={over.hasInboundRoute ?? false}
      rows={over.rows}
      onError={() => undefined}
    />
  )
}

const select = (name: string) => screen.getByRole('combobox', { name }) as HTMLSelectElement
const options = (name: string) => [...select(name).options].map((o) => o.textContent)

beforeEach(() => setSender.mockReset())
afterEach(cleanup)

describe('a server with its own default address', () => {
  it('names the configured address the server default', () => {
    renderCard({ platformName: 'Server default', platformFrom: 'Acme <noreply@acme.com>' })
    expect(options('Default')).toContain('Server default (Acme <noreply@acme.com>)')
  })

  it('says when no address is configured at all', () => {
    renderCard({ platformName: 'Server default', platformFrom: null })
    expect(options('Default')).toContain('Server default (not set)')
    expect(
      screen.getByText('No default address is configured, so choose one to send email.')
    ).toBeTruthy()
  })
})

describe('support replying from the inbox with an address behind it', () => {
  const withBehind = (id: string) => ({
    senders: { support: { mode: 'inbox' as const, fallbackId: id } },
    hasInboundRoute: true,
    forwardingTarget: 'support@acme.com',
    forwardingTargetPermitted: true,
  })

  it('keeps the inbox chosen and says where other support email comes from', () => {
    renderCard(withBehind(HELLO.id))
    expect(select('Support').value).toBe('__inbox')
    expect(screen.getByText(`Other support email comes from ${HELLO.label}.`)).toBeTruthy()
  })

  it('says what it sends from instead while that address cannot send', () => {
    renderCard(withBehind(PENDING.id))
    expect(
      screen.getByText(
        `help@pending.example isn't verified yet, so other support email comes from ${PLATFORM}.`
      )
    ).toBeTruthy()
  })

  it('names it as what replies fall back to while the inbox address cannot send', () => {
    renderCard({ ...withBehind(HELLO.id), forwardingTargetPermitted: false })
    expect(
      screen.getByText(`support@acme.com isn't verified yet, so replies come from ${HELLO.label}.`)
    ).toBeTruthy()
  })
})

describe('an inbox address that cannot send yet', () => {
  const unverifiedInbox = {
    senders: { support: { mode: 'inbox' as const } },
    hasInboundRoute: true,
    forwardingTarget: 'support@acme.com',
    forwardingTargetPermitted: false,
  }

  it("names the workspace's own inbox on the platform, which replies fall back to", () => {
    renderCard({ ...unverifiedInbox, platformInbox: 'Acme <acme@in.platform.test>' })
    expect(
      screen.getByText(
        "support@acme.com isn't verified yet, so replies come from Acme <acme@in.platform.test>."
      )
    ).toBeTruthy()
  })

  it('names the default when one is chosen, which comes first', () => {
    renderCard({
      ...unverifiedInbox,
      senders: { ...unverifiedInbox.senders, default: { mode: 'address', id: HELLO.id } },
      platformInbox: 'Acme <acme@in.platform.test>',
    })
    expect(
      screen.getByText(`support@acme.com isn't verified yet, so replies come from ${HELLO.label}.`)
    ).toBeTruthy()
  })
})

describe('a chosen address that cannot send', () => {
  it('says the default goes out from the platform address meanwhile', () => {
    renderCard({ senders: { default: { mode: 'address', id: PENDING.id } } })
    expect(
      screen.getByText(`help@pending.example isn't verified yet, so email sends from ${PLATFORM}.`)
    ).toBeTruthy()
  })

  it('reads the address off a label whose name has brackets of its own', () => {
    render(
      <SendFromCard
        senders={{ ...NONE, default: { mode: 'address', id: 'ca_odd' } }}
        identities={[{ id: 'ca_odd', label: 'Acme <Support> <help@pending.example>', live: false }]}
        platformFrom={PLATFORM}
        forwardingTarget={null}
        forwardingTargetPermitted={null}
        hasInboundRoute={false}
        onError={() => undefined}
      />
    )
    expect(
      screen.getByText(`help@pending.example isn't verified yet, so email sends from ${PLATFORM}.`)
    ).toBeTruthy()
  })

  it('says an override goes out from the default meanwhile', () => {
    renderCard({
      senders: {
        default: { mode: 'address', id: HELLO.id },
        changelog: { mode: 'address', id: PENDING.id },
      },
    })
    expect(
      screen.getByText(
        `help@pending.example isn't verified yet, so email sends from ${HELLO.label}.`
      )
    ).toBeTruthy()
  })
})

describe('the default sender', () => {
  it('offers the verified addresses and the Quackback address', () => {
    renderCard()
    expect(options('Default')).toEqual([HELLO.label, NEWS.label, `Quackback address (${PLATFORM})`])
  })

  it('says what email sends from while no default is chosen', () => {
    renderCard()
    expect(select('Default').value).toBe('__platform')
    expect(screen.getByText(`Email sends from ${PLATFORM}.`)).toBeTruthy()
  })

  it('says nothing more once a default is chosen', () => {
    renderCard({ senders: { default: { mode: 'address', id: HELLO.id } } })
    expect(select('Default').value).toBe(HELLO.id)
    expect(screen.queryByText(/Email sends from/)).toBeNull()
  })

  it('keeps a chosen address in the list after its domain stops verifying', () => {
    renderCard({ senders: { default: { mode: 'address', id: PENDING.id } } })
    expect(options('Default')).toContain(PENDING.label)
  })

  it('sets and clears the default', () => {
    renderCard()
    fireEvent.change(select('Default'), { target: { value: HELLO.id } })
    expect(setSender).toHaveBeenLastCalledWith(
      { surface: 'default', choice: { mode: 'address', id: HELLO.id } },
      expect.anything()
    )
    fireEvent.change(select('Default'), { target: { value: '__platform' } })
    expect(setSender).toHaveBeenLastCalledWith(
      { surface: 'default', choice: null },
      expect.anything()
    )
  })
})

describe('the per-kind overrides', () => {
  it.each(['Feedback board', 'Changelog', 'Status page'])(
    '%s starts at Same as default, then the verified addresses',
    (name) => {
      renderCard({ hasInboundRoute: true })
      expect(options(name)).toEqual(['Same as default', HELLO.label, NEWS.label])
      expect(select(name).value).toBe('__default')
    }
  )

  it('points a kind of email at an address, and back to the default', () => {
    renderCard({ senders: { changelog: { mode: 'address', id: NEWS.id } } })
    expect(select('Changelog').value).toBe(NEWS.id)
    fireEvent.change(select('Changelog'), { target: { value: '__default' } })
    expect(setSender).toHaveBeenLastCalledWith(
      { surface: 'changelog', choice: null },
      expect.anything()
    )
  })
})

describe('support', () => {
  it('offers the address the customer wrote to first when the workspace receives email', () => {
    renderCard({ hasInboundRoute: true, senders: { support: { mode: 'inbox' } } })
    expect(options('Support')).toEqual([
      'Address the customer wrote to',
      'Same as default',
      HELLO.label,
      NEWS.label,
    ])
    expect(select('Support').value).toBe('__inbox')
  })

  it('starts at Same as default without an inbound route', () => {
    renderCard({ senders: { support: { mode: 'inbox' } } })
    expect(options('Support')).toEqual(['Same as default', HELLO.label, NEWS.label])
    expect(select('Support').value).toBe('__default')
  })

  it('chooses the inbox', () => {
    renderCard({ hasInboundRoute: true })
    fireEvent.change(select('Support'), { target: { value: '__inbox' } })
    expect(setSender).toHaveBeenLastCalledWith(
      { surface: 'support', choice: { mode: 'inbox' } },
      expect.anything()
    )
  })

  it('says replies come from the default while the forwarded address is unverified', () => {
    renderCard({
      hasInboundRoute: true,
      senders: { default: { mode: 'address', id: HELLO.id }, support: { mode: 'inbox' } },
      forwardingTarget: 'support@acme.com',
      forwardingTargetPermitted: false,
    })
    expect(
      screen.getByText(`support@acme.com isn't verified yet, so replies come from ${HELLO.label}.`)
    ).toBeTruthy()
  })

  it('names the Quackback address as the fallback when no default is chosen', () => {
    renderCard({
      hasInboundRoute: true,
      senders: { support: { mode: 'inbox' } },
      forwardingTarget: 'support@acme.com',
      forwardingTargetPermitted: false,
    })
    expect(
      screen.getByText(`support@acme.com isn't verified yet, so replies come from ${PLATFORM}.`)
    ).toBeTruthy()
  })

  it.each([
    ['the forwarded address is verified', { forwardingTargetPermitted: true }],
    ['support is set to an address', { senders: { support: { mode: 'address', id: HELLO.id } } }],
    ['nothing is forwarded', { forwardingTarget: null }],
  ] as const)('shows no hint when %s', (_label, over) => {
    renderCard({
      hasInboundRoute: true,
      senders: { support: { mode: 'inbox' }, default: { mode: 'address', id: HELLO.id } },
      forwardingTarget: 'support@acme.com',
      forwardingTargetPermitted: false,
      ...over,
    } as Parameters<typeof renderCard>[0])
    expect(screen.queryByText(/isn't verified yet/)).toBeNull()
  })
})

describe('showing only some rows', () => {
  const rowNames = () => screen.getAllByRole('combobox').map((s) => s.getAttribute('aria-label'))

  it('shows only the kinds of email asked for', () => {
    renderCard({ rows: ['default', 'feedback', 'changelog'] })
    expect(rowNames()).toEqual(['Default', 'Feedback board', 'Changelog'])
  })

  it('says which address the default is when the default row is not shown', () => {
    renderCard({ rows: ['support'], senders: { default: { mode: 'address', id: HELLO.id } } })
    expect(rowNames()).toEqual(['Support'])
    expect(options('Support')[0]).toBe('Workspace default')
    expect(screen.getByText(`Sends from ${HELLO.label}.`)).toBeTruthy()
  })

  it('names the Quackback address as that default when none is chosen', () => {
    renderCard({ rows: ['support'] })
    expect(screen.getByText(`Sends from ${PLATFORM}.`)).toBeTruthy()
  })

  it('says nothing more once the row has its own address', () => {
    renderCard({ rows: ['support'], senders: { support: { mode: 'address', id: NEWS.id } } })
    expect(screen.queryByText(/Sends from/)).toBeNull()
  })

  it('keeps the short wording beside the default row', () => {
    renderCard({ rows: ['default', 'support'] })
    expect(options('Support')[0]).toBe('Same as default')
  })
})
