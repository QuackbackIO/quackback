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
  }> = {}
) {
  return render(
    <SendFromCard
      senders={{ ...NONE, ...over.senders }}
      identities={[HELLO, NEWS, PENDING]}
      platformFrom={PLATFORM}
      forwardingTarget={over.forwardingTarget ?? null}
      forwardingTargetPermitted={over.forwardingTargetPermitted ?? null}
      hasInboundRoute={over.hasInboundRoute ?? false}
      onError={() => undefined}
    />
  )
}

const select = (name: string) => screen.getByRole('combobox', { name }) as HTMLSelectElement
const options = (name: string) => [...select(name).options].map((o) => o.textContent)

beforeEach(() => setSender.mockReset())
afterEach(cleanup)

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
