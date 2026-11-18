// @vitest-environment happy-dom
/**
 * Add sending address on its own: picking a Verified domain, the empty state,
 * and what each server and viewer falls back to.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const createAddress = vi.fn()
vi.mock('@/lib/client/mutations/channel-accounts', () => ({
  useCreateSendingAddress: () => ({ mutate: createAddress, isPending: false }),
  useUpdateSendingAddressName: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const { SendingAddressDialog } = await import('../sending-address-dialog')

type Mode = 'any' | 'verified-domains' | 'unavailable'

function open({
  mode = 'verified-domains' as Mode,
  verified = ['acme.com'] as readonly string[] | Error,
  /** null: a viewer who may not add a domain. */
  onAddDomain = vi.fn() as (() => void) | null,
  readable = true,
  domain = undefined as string | undefined,
} = {}) {
  const load = vi.fn(() =>
    verified instanceof Error ? Promise.reject(verified) : Promise.resolve(verified)
  )
  const onClose = vi.fn()
  render(
    <SendingAddressDialog
      target={{ kind: 'add', domain }}
      workspaceName="Acme"
      addressMode={mode}
      loadVerifiedDomains={readable ? load : undefined}
      onAddDomain={onAddDomain ?? undefined}
      onClose={onClose}
    />
  )
  return { load, onClose, onAddDomain }
}

async function dialog() {
  const d = await screen.findByRole('dialog')
  await waitFor(() => expect(d.querySelector('[aria-busy="true"]')).toBeNull())
  return d
}

const typeLocal = (d: HTMLElement, value: string) =>
  fireEvent.change(within(d).getByRole('textbox', { name: 'Email address' }), { target: { value } })

const submit = (d: HTMLElement) =>
  fireEvent.click(within(d).getByRole('button', { name: /^Add (address|and show records)$/ }))

beforeEach(() => createAddress.mockReset())
afterEach(cleanup)

describe('picking a Verified domain', () => {
  it('picks the only Verified domain already, fixed after the field', async () => {
    open({ verified: ['acme.com'] })
    const d = await dialog()
    expect(within(d).queryByRole('radio')).toBeNull()
    expect(within(d).getByText('@acme.com')).toBeTruthy()
    typeLocal(d, 'help')
    submit(d)
    expect(createAddress).toHaveBeenCalledWith(
      { address: 'help@acme.com', senderName: null },
      expect.anything()
    )
  })

  it('offers a few as tiles, with the field under the one picked', async () => {
    open({ verified: ['acme.com', 'acme.io'] })
    const d = await dialog()
    const tiles = within(d).getAllByRole('radio')
    expect(tiles).toHaveLength(2)
    expect(within(d).queryByText('Type an address')).toBeNull()
    // Nothing is picked for the person when there is a choice to make.
    expect(within(d).queryByRole('textbox', { name: 'Email address' })).toBeNull()
    expect((within(d).getByRole('button', { name: /^Add/ }) as HTMLButtonElement).disabled).toBe(
      true
    )

    fireEvent.click(within(d).getByText('acme.io'))
    expect(within(d).getByText('@acme.io')).toBeTruthy()
    typeLocal(d, 'news')
    submit(d)
    expect(createAddress).toHaveBeenCalledWith(
      { address: 'news@acme.io', senderName: null },
      expect.anything()
    )
  })

  it('offers more than four as a select', async () => {
    open({ verified: ['a.com', 'b.com', 'c.com', 'd.com', 'e.com'] })
    const d = await dialog()
    expect(within(d).queryByRole('radio')).toBeNull()
    expect(within(d).getByRole('combobox')).toBeTruthy()
  })

  it('counts Type an address among the tiles on a self-hosted server', async () => {
    open({ mode: 'any', verified: ['a.com', 'b.com', 'c.com'] })
    expect(within(await dialog()).getAllByRole('radio')).toHaveLength(4)
    cleanup()
    open({ mode: 'any', verified: ['a.com', 'b.com', 'c.com', 'd.com'] })
    const d = await dialog()
    expect(within(d).queryByRole('radio')).toBeNull()
    expect(within(d).getByRole('combobox')).toBeTruthy()
  })

  it('starts on the domain asked for when it is Verified', async () => {
    open({ verified: ['acme.com', 'acme.io'], domain: 'acme.io' })
    const d = await dialog()
    expect(within(d).getByText('@acme.io')).toBeTruthy()
  })

  it('takes only the local part when a whole address is typed', async () => {
    open({ verified: ['acme.com'] })
    const d = await dialog()
    typeLocal(d, 'help@elsewhere.com')
    submit(d)
    expect(createAddress.mock.calls[0][0].address).toBe('help@acme.com')
  })
})

describe('a self-hosted server', () => {
  it('reveals the free field under Type an address, and adds what is typed', async () => {
    open({ mode: 'any', verified: ['acme.com'] })
    const d = await dialog()
    fireEvent.click(within(d).getByRole('button', { name: 'Type an address' }))
    typeLocal(d, 'help@unverified.example')
    submit(d)
    expect(createAddress).toHaveBeenCalledWith(
      { address: 'help@unverified.example', senderName: null },
      expect.anything()
    )
    fireEvent.click(within(d).getByRole('button', { name: 'Use acme.com' }))
    expect(within(d).getByText('@acme.com')).toBeTruthy()
  })

  it('offers Add domain and Type an address with no Verified domain yet', async () => {
    open({ mode: 'any', verified: [] })
    const d = await dialog()
    expect(within(d).getByText('No Verified domains yet.')).toBeTruthy()
    expect(within(d).getByRole('button', { name: 'Add domain' })).toBeTruthy()
    fireEvent.click(within(d).getByRole('button', { name: 'Type an address' }))
    expect((within(d).getByLabelText('Email address') as HTMLInputElement).type).toBe('email')
  })

  it('shows the free field alone when the domains cannot be read', async () => {
    open({ mode: 'any', verified: new Error('denied') })
    const d = await dialog()
    expect(within(d).queryByText('No Verified domains yet.')).toBeNull()
    expect((within(d).getByLabelText('Email address') as HTMLInputElement).type).toBe('email')
  })

  it('shows the free field alone to a viewer not given the domains', async () => {
    open({ mode: 'any', readable: false })
    const d = await dialog()
    expect((within(d).getByLabelText('Email address') as HTMLInputElement).type).toBe('email')
  })
})

describe('no Verified domain yet on Cloud', () => {
  it('says so, with Add domain, and nothing to add', async () => {
    const { onAddDomain, onClose } = open({ verified: [] })
    const d = await dialog()
    expect(within(d).getByText('No Verified domains yet.')).toBeTruthy()
    expect(within(d).queryByText('Type an address')).toBeNull()
    expect(within(d).queryByRole('button', { name: /^Add (address|and show records)$/ })).toBeNull()
    expect(within(d).queryByText(/Ask an admin/)).toBeNull()
    fireEvent.click(within(d).getByRole('button', { name: 'Add domain' }))
    expect(onClose).toHaveBeenCalled()
    expect(onAddDomain).toHaveBeenCalled()
  })

  it('asks a viewer who cannot add a domain to ask an admin', async () => {
    open({ verified: [], onAddDomain: null })
    const d = await dialog()
    expect(within(d).queryByRole('button', { name: 'Add domain' })).toBeNull()
    expect(within(d).getByText('Ask an admin to verify your domain.')).toBeTruthy()
  })

  it('shows the empty state without the link when the domains cannot be read', async () => {
    open({ verified: new Error('denied') })
    const d = await dialog()
    expect(within(d).getByText('No Verified domains yet.')).toBeTruthy()
    expect(within(d).queryByRole('button', { name: 'Add domain' })).toBeNull()
    expect(within(d).getByText('Ask an admin to verify your domain.')).toBeTruthy()
    expect(within(d).queryByLabelText('Email address')).toBeNull()
  })

  it('never offers a typed address', async () => {
    open({ verified: ['acme.com', 'acme.io'] })
    const d = await dialog()
    expect(within(d).queryByText('Type an address')).toBeNull()
    expect(within(d).queryByRole('textbox', { name: 'Email address' })).toBeNull()
  })
})

describe('a server that takes no custom addresses', () => {
  it('keeps the free field and reads no domains', async () => {
    const { load } = open({ mode: 'unavailable' })
    const d = await dialog()
    expect((within(d).getByLabelText('Email address') as HTMLInputElement).type).toBe('email')
    expect(load).not.toHaveBeenCalled()
  })
})
