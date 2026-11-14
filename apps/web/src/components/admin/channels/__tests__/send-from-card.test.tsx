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
      {/* Nothing chosen yet: the real trigger shows its placeholder. */}
      {value === '' && <option value="" />}
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

// The menu's popup also relies on layout APIs happy-dom lacks; render its items
// in place, so what it offers and what picking one does are drivable.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div role="menu">{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" role="menuitem" onClick={onClick}>
      {children}
    </button>
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
    identities: Array<{ id: string; label: string; live: boolean }>
  }> = {}
) {
  return render(
    <SendFromCard
      senders={{ ...NONE, ...over.senders }}
      identities={over.identities ?? [HELLO, NEWS, PENDING]}
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
/** The kinds of email the "Use a different address for" menu offers. */
const addable = () => screen.queryAllByRole('menuitem').map((item) => item.textContent)
const pick = (name: string) => fireEvent.click(screen.getByRole('menuitem', { name }))
const rowNames = () => screen.getAllByRole('combobox').map((s) => s.getAttribute('aria-label'))

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
      screen.getByText("No default address is set, so email can't be sent until you choose one.")
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
    expect(screen.getByText(`Conversations not started by email use ${HELLO.label}.`)).toBeTruthy()
  })

  it('says what it sends from instead while that address cannot send', () => {
    renderCard(withBehind(PENDING.id))
    expect(
      screen.getByText(
        `help@pending.example isn't verified yet, so conversations not started by email use ${PLATFORM} for now.`
      )
    ).toBeTruthy()
  })

  it('names it as what replies fall back to while the inbox address cannot send', () => {
    renderCard({ ...withBehind(HELLO.id), forwardingTargetPermitted: false })
    expect(
      screen.getByText(`acme.com isn't verified, so replies come from ${HELLO.label}.`)
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
        "acme.com isn't verified, so replies come from Acme <acme@in.platform.test>."
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
      screen.getByText(`acme.com isn't verified, so replies come from ${HELLO.label}.`)
    ).toBeTruthy()
  })
})

describe('a chosen address that cannot send', () => {
  it('says the default goes out from the platform address meanwhile', () => {
    renderCard({ senders: { default: { mode: 'address', id: PENDING.id } } })
    expect(
      screen.getByText(
        `help@pending.example isn't verified yet, so email comes from ${PLATFORM} for now.`
      )
    ).toBeTruthy()
  })

  it('says no longer verified for an address whose domain stopped verifying', () => {
    render(
      <SendFromCard
        senders={{ ...NONE, changelog: { mode: 'address', id: 'ca_old' } }}
        identities={[{ id: 'ca_old', label: 'Acme <news@old.example>', live: false, lapsed: true }]}
        platformFrom={PLATFORM}
        forwardingTarget={null}
        forwardingTargetPermitted={null}
        hasInboundRoute={false}
        onError={() => undefined}
      />
    )
    expect(
      screen.getByText(
        `news@old.example is no longer verified, so email comes from ${PLATFORM} until it's fixed.`
      )
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
      screen.getByText(
        `help@pending.example isn't verified yet, so email comes from ${PLATFORM} for now.`
      )
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
        `help@pending.example isn't verified yet, so email comes from ${HELLO.label} for now.`
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
    expect(screen.getByText(`Email comes from ${PLATFORM}.`)).toBeTruthy()
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

describe('the kinds of email that differ from the default', () => {
  it('lists only the default while every kind uses it', () => {
    renderCard()
    expect(rowNames()).toEqual(['Default'])
    expect(screen.queryByText('Except')).toBeNull()
    expect(addable()).toEqual(['Support', 'Feedback board', 'Changelog', 'Status page'])
  })

  it('lists a kind once it sends from something else, with its own addresses to choose', () => {
    renderCard({ senders: { changelog: { mode: 'address', id: NEWS.id } } })
    expect(rowNames()).toEqual(['Default', 'Changelog'])
    expect(screen.getByText('Except')).toBeTruthy()
    // Going back to the default is the remove button, not an option.
    expect(options('Changelog')).toEqual([HELLO.label, NEWS.label])
    expect(select('Changelog').value).toBe(NEWS.id)
    expect(addable()).toEqual(['Support', 'Feedback board', 'Status page'])
  })

  it('goes back to the default when the exception is removed', () => {
    renderCard({ senders: { changelog: { mode: 'address', id: NEWS.id } } })
    fireEvent.click(screen.getByRole('button', { name: 'Use the default for Changelog' }))
    expect(setSender).toHaveBeenLastCalledWith(
      { surface: 'changelog', choice: null },
      expect.anything()
    )
  })

  it('adds a kind from the menu, and saves only once an address is chosen', () => {
    renderCard()
    pick('Feedback board')
    expect(rowNames()).toEqual(['Default', 'Feedback board'])
    expect(select('Feedback board').value).toBe('')
    expect(addable()).not.toContain('Feedback board')
    expect(setSender).not.toHaveBeenCalled()

    fireEvent.change(select('Feedback board'), { target: { value: HELLO.id } })
    expect(setSender).toHaveBeenLastCalledWith(
      { surface: 'feedback', choice: { mode: 'address', id: HELLO.id } },
      expect.anything()
    )
  })

  it('drops a kind picked from the menu without saving anything', () => {
    renderCard()
    pick('Status page')
    fireEvent.click(screen.getByRole('button', { name: 'Use the default for Status page' }))
    expect(rowNames()).toEqual(['Default'])
    expect(setSender).not.toHaveBeenCalled()
  })

  it('offers nothing to add while there is no address to point a kind at', () => {
    renderCard({ identities: [PENDING] })
    expect(addable()).toEqual([])
    expect(screen.queryByText('Use a different address for')).toBeNull()
  })

  it('offers support alone when the inbox is the only other choice', () => {
    renderCard({ identities: [], hasInboundRoute: true })
    expect(addable()).toEqual(['Support'])
  })
})

describe('support', () => {
  it('offers the address the customer wrote to first when the workspace receives email', () => {
    renderCard({ hasInboundRoute: true, senders: { support: { mode: 'inbox' } } })
    expect(options('Support')).toEqual(['Address the customer wrote to', HELLO.label, NEWS.label])
    expect(select('Support').value).toBe('__inbox')
  })

  it('uses the default without an inbound route, whatever was chosen while there was one', () => {
    renderCard({ senders: { support: { mode: 'inbox' } } })
    expect(rowNames()).toEqual(['Default'])
    expect(addable()).toContain('Support')
  })

  it('chooses the inbox', () => {
    renderCard({ hasInboundRoute: true })
    pick('Support')
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
      screen.getByText(`acme.com isn't verified, so replies come from ${HELLO.label}.`)
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
      screen.getByText(`acme.com isn't verified, so replies come from ${PLATFORM}.`)
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
    expect(screen.queryByText(/isn't verified, so replies come from/)).toBeNull()
  })
})

describe('showing only some rows', () => {
  it('offers only the kinds of email asked for', () => {
    renderCard({ rows: ['default', 'feedback', 'changelog'] })
    expect(rowNames()).toEqual(['Default'])
    expect(addable()).toEqual(['Feedback board', 'Changelog'])
  })

  it('says which address the default is when the default row is not shown', () => {
    renderCard({ rows: ['support'], senders: { default: { mode: 'address', id: HELLO.id } } })
    // The card's one setting, named for what it does rather than for the card.
    expect(rowNames()).toEqual(['Reply from'])
    expect(options('Reply from')[0]).toBe('Workspace default')
    expect(screen.queryByRole('button', { name: /Use the default for/ })).toBeNull()
    expect(screen.getByText(`Replies come from ${HELLO.label}.`)).toBeTruthy()
  })

  it('names the Quackback address as that default when none is chosen', () => {
    renderCard({ rows: ['support'] })
    expect(screen.getByText(`Replies come from ${PLATFORM}.`)).toBeTruthy()
  })

  it('says nothing more once the row has its own address', () => {
    renderCard({ rows: ['support'], senders: { support: { mode: 'address', id: NEWS.id } } })
    expect(screen.queryByText(/Replies come from/)).toBeNull()
  })

  it('has no way back to the default among the options beside the default row', () => {
    renderCard({
      rows: ['default', 'support'],
      senders: { support: { mode: 'address', id: HELLO.id } },
    })
    expect(options('Support')).toEqual([HELLO.label, NEWS.label])
  })
})
