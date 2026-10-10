// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

const m = vi.hoisted(() => {
  const make = () => ({ mutateAsync: vi.fn(), isPending: false })
  return {
    userCreate: make(),
    userUpdate: make(),
    userDelete: make(),
    companyCreate: make(),
    companyUpdate: make(),
    companyDelete: make(),
  }
})

vi.mock('@/lib/client/mutations', () => ({
  useCreateUserAttribute: () => m.userCreate,
  useUpdateUserAttribute: () => m.userUpdate,
  useDeleteUserAttribute: () => m.userDelete,
  useCreateCompanyAttribute: () => m.companyCreate,
  useUpdateCompanyAttribute: () => m.companyUpdate,
  useDeleteCompanyAttribute: () => m.companyDelete,
}))

import { UserAttributesList } from '../user-attributes/user-attributes-list'
import { CompanyAttributesList } from '../company-attributes/company-attributes-list'

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

const stored = (over: Record<string, unknown> = {}) => ({
  id: 'attr_1',
  key: 'seats',
  label: 'Seats',
  description: 'Paid seats',
  type: 'number',
  currencyCode: null,
  externalKey: null,
  ...over,
})

const ENTITIES = [
  {
    name: 'users',
    Component: UserAttributesList,
    mocks: () => ({ create: m.userCreate, update: m.userUpdate, del: m.userDelete }),
    builtinLabel: 'Email',
    builtinKey: 'email',
    dialogTitle: 'New user attribute',
    externalLabel: /CDP attribute name/,
  },
  {
    name: 'companies',
    Component: CompanyAttributesList,
    mocks: () => ({ create: m.companyCreate, update: m.companyUpdate, del: m.companyDelete }),
    builtinLabel: 'Email domain',
    builtinKey: 'domain',
    dialogTitle: 'New company attribute',
    externalLabel: /CRM attribute name/,
  },
] as const

describe.each(ENTITIES)('ScalarAttributeList for $name', (entity) => {
  const renderList = (attrs: ReturnType<typeof stored>[] = [stored()]) =>
    render(<entity.Component initialAttributes={attrs as never} />)

  it('lists the built-in fields without a badge and with a locked menu, then the custom rows', () => {
    renderList()
    const builtin = screen.getByText(entity.builtinKey).closest('[data-slot="settings-list-row"]')
    expect(within(builtin as HTMLElement).getByText(entity.builtinLabel)).toBeTruthy()
    expect(within(builtin as HTMLElement).queryByText('Built-in')).toBeNull()
    const custom = screen.getByText('Seats').closest('[data-slot="settings-list-row"]')
    expect(
      within(custom as HTMLElement).getByRole('button', { name: 'Actions for Seats' })
    ).toBeTruthy()
  })

  it('creates an attribute from the dialog and adds its row', async () => {
    const { create } = entity.mocks()
    create.mutateAsync.mockResolvedValue(
      stored({ id: 'attr_2', key: 'plan_tier', label: 'Plan tier', type: 'string' })
    )
    const user = userEvent.setup()
    renderList([])
    await user.click(screen.getAllByRole('button', { name: /new attribute/i })[0])
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(entity.dialogTitle)).toBeTruthy()
    expect(within(dialog).getByText(entity.externalLabel)).toBeTruthy()
    await user.type(within(dialog).getByLabelText(/^Key/), 'plan_tier')
    await user.type(within(dialog).getByLabelText('Display label'), 'Plan tier')
    await user.click(within(dialog).getByRole('button', { name: 'Create attribute' }))
    await waitFor(() => expect(screen.getByText('Plan tier')).toBeTruthy())
    expect(create.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'plan_tier', label: 'Plan tier', type: 'string' })
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('edits an attribute with the key locked and saves the new label', async () => {
    const { update } = entity.mocks()
    update.mutateAsync.mockResolvedValue(stored({ label: 'Active seats' }))
    const user = userEvent.setup()
    renderList()
    await user.click(screen.getByRole('button', { name: 'Actions for Seats' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog')
    expect((within(dialog).getByLabelText(/^Key/) as HTMLInputElement).disabled).toBe(true)
    const label = within(dialog).getByLabelText('Display label')
    await user.clear(label)
    await user.type(label, 'Active seats')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.getByText('Active seats')).toBeTruthy())
    expect(update.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'attr_1', label: 'Active seats' })
    )
  })

  it('deletes only after the confirmation dialog is accepted', async () => {
    const { del } = entity.mocks()
    del.mutateAsync.mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderList()
    await user.click(screen.getByRole('button', { name: 'Actions for Seats' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    const confirm = await screen.findByRole('alertdialog')
    expect(del.mutateAsync).not.toHaveBeenCalled()
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(del.mutateAsync).not.toHaveBeenCalled()
    expect(screen.getByText('Seats')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Actions for Seats' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Delete attribute',
      })
    )
    await waitFor(() => expect(screen.queryByText('Seats')).toBeNull())
    expect(del.mutateAsync).toHaveBeenCalledWith('attr_1')
  })
})
