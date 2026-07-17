// @vitest-environment happy-dom
/**
 * Smoke coverage for the conversation attributes registry manager: the row
 * list renders per definition from listConversationAttributesFn (including
 * the AI badge for aiDetect-enabled definitions), and the editor dialog gates
 * the AI-detect section to select-type attributes, wires aiDetect/
 * detectOnClose into the create/update payloads, and surfaces the "Other"
 * fallback hint when no option looks like a catch-all.
 *
 * Radix Select relies on pointer-capture/layout APIs happy-dom doesn't
 * implement, so `@/components/ui/select` is swapped for a native
 * <select>/<option> pair here — the same pattern condition-editor.test.tsx /
 * monday-config.test.tsx use.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const FIXTURE_ATTRIBUTES = [
  {
    id: 'conversation_attribute_1',
    key: 'issue_type',
    label: 'Issue type',
    description: 'What kind of issue this is.',
    fieldType: 'select',
    options: [
      { id: 'opt_1', label: 'Billing', description: null },
      { id: 'opt_2', label: 'Bug', description: null },
    ],
    requiredToClose: false,
    sourceHint: null,
    aiDetect: true,
    detectOnClose: true,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'conversation_attribute_2',
    key: 'severity',
    label: 'Severity',
    description: null,
    fieldType: 'text',
    options: null,
    requiredToClose: false,
    sourceHint: null,
    aiDetect: false,
    detectOnClose: false,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
]

const hoisted = vi.hoisted(() => ({
  listConversationAttributesFn: vi.fn(),
  createConversationAttributeFn: vi.fn(),
  updateConversationAttributeFn: vi.fn(),
  archiveConversationAttributeFn: vi.fn(),
  restoreConversationAttributeFn: vi.fn(),
  previewAttributeDetectionFn: vi.fn(),
  draftAttributeDescriptionsFn: vi.fn(),
  attributeValueCountsFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/conversation-attributes', () => ({
  listConversationAttributesFn: hoisted.listConversationAttributesFn,
  createConversationAttributeFn: hoisted.createConversationAttributeFn,
  updateConversationAttributeFn: hoisted.updateConversationAttributeFn,
  archiveConversationAttributeFn: hoisted.archiveConversationAttributeFn,
  restoreConversationAttributeFn: hoisted.restoreConversationAttributeFn,
  previewAttributeDetectionFn: hoisted.previewAttributeDetectionFn,
  draftAttributeDescriptionsFn: hoisted.draftAttributeDescriptionsFn,
  attributeValueCountsFn: hoisted.attributeValueCountsFn,
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string
    onValueChange: (v: string) => void
    children: React.ReactNode
  }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectLabel: ({ children }: { children: React.ReactNode }) => (
    <option disabled>{children}</option>
  ),
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}))

import { ConversationAttributesList } from '../conversation-attributes-list'

afterEach(cleanup)

// AttributeValueCountsBreakdown always fires for an edit dialog on an
// aiDetect-enabled definition (FIXTURE_ATTRIBUTES[0]); default it to an
// empty-but-resolved breakdown so tests unrelated to monitoring don't have
// to think about it, and override per-test where the breakdown itself is
// under test.
beforeEach(() => {
  hoisted.attributeValueCountsFn.mockResolvedValue([
    { optionId: 'opt_1', label: 'Billing', count: 0 },
    { optionId: 'opt_2', label: 'Bug', count: 0 },
    { optionId: null, label: 'Not set', count: 0 },
  ])
})

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

/** The Type <select> is the first native select rendered in the form dialog. */
function typeSelect(): HTMLSelectElement {
  return document.querySelectorAll('select')[0] as HTMLSelectElement
}

async function openCreateDialog() {
  const user = userEvent.setup()
  renderWithClient(<ConversationAttributesList />)
  await user.click(await screen.findByRole('button', { name: /new attribute/i }))
  return user
}

/** Opens the edit dialog on FIXTURE_ATTRIBUTES[0] ("Issue type" — select,
 *  aiDetect + detectOnClose both on), the row whose editor exercises the
 *  Phase 3 preview/draft/monitoring sections. */
async function openEditDialogForIssueType() {
  hoisted.listConversationAttributesFn.mockResolvedValue(FIXTURE_ATTRIBUTES)
  const user = userEvent.setup()
  renderWithClient(<ConversationAttributesList />)
  const issueTypeRow = (await screen.findByText('Issue type')).closest(
    '.flex.items-center.gap-4'
  ) as HTMLElement
  await user.click(within(issueTypeRow).getByTitle('Edit attribute'))
  await screen.findByText('Edit attribute')
  return user
}

describe('ConversationAttributesList', () => {
  it('renders a row per definition from listConversationAttributesFn', async () => {
    hoisted.listConversationAttributesFn.mockResolvedValue(FIXTURE_ATTRIBUTES)
    renderWithClient(<ConversationAttributesList />)
    expect(await screen.findByText('Issue type')).toBeInTheDocument()
    expect(screen.getByText('Severity')).toBeInTheDocument()
  })

  it('shows an AI badge only for aiDetect-enabled definitions', async () => {
    hoisted.listConversationAttributesFn.mockResolvedValue(FIXTURE_ATTRIBUTES)
    renderWithClient(<ConversationAttributesList />)

    const issueTypeRow = (await screen.findByText('Issue type')).closest(
      '.flex.items-center.gap-4'
    ) as HTMLElement
    expect(within(issueTypeRow).getByText('AI')).toBeInTheDocument()

    const severityRow = screen
      .getByText('Severity')
      .closest('.flex.items-center.gap-4') as HTMLElement
    expect(within(severityRow).queryByText('AI')).not.toBeInTheDocument()
  })

  it('gates the AI-detect section to select-type attributes in the create dialog', async () => {
    hoisted.listConversationAttributesFn.mockResolvedValue([])
    const user = await openCreateDialog()
    expect(screen.queryByText('Let AI detect this attribute')).not.toBeInTheDocument()

    fireEvent.change(typeSelect(), { target: { value: 'select' } })

    expect(await screen.findByText('Let AI detect this attribute')).toBeInTheDocument()
    expect(
      screen.getByText('Quinn classifies conversations it participates in.')
    ).toBeInTheDocument()
    void user
  })

  it('reveals the detect-on-close switch only once AI detect is enabled', async () => {
    hoisted.listConversationAttributesFn.mockResolvedValue([])
    const user = await openCreateDialog()
    fireEvent.change(typeSelect(), { target: { value: 'select' } })
    await screen.findByText('Let AI detect this attribute')

    expect(screen.queryByText('Re-check on close')).not.toBeInTheDocument()

    await user.click(screen.getAllByRole('switch')[0]) // AI detect switch

    expect(await screen.findByText('Re-check on close')).toBeInTheDocument()
  })

  it('shows a dismissable "Other" fallback hint when no option looks like a catch-all', async () => {
    hoisted.listConversationAttributesFn.mockResolvedValue([])
    const user = await openCreateDialog()
    fireEvent.change(typeSelect(), { target: { value: 'select' } })
    await screen.findByText('Let AI detect this attribute')
    await user.click(screen.getAllByRole('switch')[0]) // enable AI detect

    await user.click(screen.getByRole('button', { name: /add option/i }))
    await user.type(screen.getByPlaceholderText('Option label'), 'Billing')

    expect(await screen.findByText(/consider adding an "other"/i)).toBeInTheDocument()

    await user.click(screen.getByTitle('Dismiss'))
    expect(screen.queryByText(/consider adding an "other"/i)).not.toBeInTheDocument()
  })

  it('skips the "Other" hint once an option label matches the fallback pattern', async () => {
    hoisted.listConversationAttributesFn.mockResolvedValue([])
    const user = await openCreateDialog()
    fireEvent.change(typeSelect(), { target: { value: 'select' } })
    await screen.findByText('Let AI detect this attribute')
    await user.click(screen.getAllByRole('switch')[0]) // enable AI detect

    await user.click(screen.getByRole('button', { name: /add option/i }))
    await user.type(screen.getByPlaceholderText('Option label'), 'Other')

    expect(screen.queryByText(/consider adding an "other"/i)).not.toBeInTheDocument()
  })

  it('wires aiDetect and detectOnClose into the create mutation payload', async () => {
    hoisted.listConversationAttributesFn.mockResolvedValue([])
    hoisted.createConversationAttributeFn.mockResolvedValue({})
    const user = await openCreateDialog()

    await user.type(screen.getByLabelText('Key'), 'issue_type')
    await user.type(screen.getByLabelText('Display label'), 'Issue type')

    fireEvent.change(typeSelect(), { target: { value: 'select' } })
    await screen.findByText('Let AI detect this attribute')
    await user.click(screen.getByRole('button', { name: /add option/i }))
    await user.type(screen.getByPlaceholderText('Option label'), 'Billing')

    await user.click(screen.getAllByRole('switch')[0]) // AI detect on
    await screen.findByText('Re-check on close')
    await user.click(screen.getAllByRole('switch')[1]) // Re-check on close on

    await user.click(screen.getByRole('button', { name: /create attribute/i }))

    expect(hoisted.createConversationAttributeFn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ aiDetect: true, detectOnClose: true }),
      })
    )
  })

  it('does not send aiDetect for non-select attributes', async () => {
    hoisted.listConversationAttributesFn.mockResolvedValue([])
    hoisted.createConversationAttributeFn.mockResolvedValue({})
    const user = await openCreateDialog()

    await user.type(screen.getByLabelText('Key'), 'severity')
    await user.type(screen.getByLabelText('Display label'), 'Severity')
    // Default type is Text — no AI section is reachable.
    await user.click(screen.getByRole('button', { name: /create attribute/i }))

    expect(hoisted.createConversationAttributeFn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ aiDetect: false, detectOnClose: false }),
      })
    )
  })

  // AI-ATTRIBUTES-PARITY-SPEC.md Phase 3: preview harness, draft-descriptions
  // assist, and the read-only monitoring breakdown.
  describe('preview harness ("Test detection")', () => {
    it('only appears once AI detect is enabled on a select attribute', async () => {
      hoisted.listConversationAttributesFn.mockResolvedValue([])
      const user = await openCreateDialog()
      fireEvent.change(typeSelect(), { target: { value: 'select' } })
      await screen.findByText('Let AI detect this attribute')
      expect(screen.queryByRole('button', { name: /test detection/i })).not.toBeInTheDocument()

      await user.click(screen.getAllByRole('switch')[0]) // AI detect on
      expect(await screen.findByRole('button', { name: /test detection/i })).toBeInTheDocument()
    })

    it('calls previewAttributeDetectionFn with the draft definition + sample message and renders the result', async () => {
      hoisted.previewAttributeDetectionFn.mockResolvedValue({
        optionId: 'opt_1',
        optionLabel: 'Billing',
        reasoning: 'Customer mentions a duplicate charge.',
      })
      const user = await openEditDialogForIssueType()

      await user.type(
        screen.getByPlaceholderText(/i was charged twice/i),
        'I got charged twice this month'
      )
      await user.click(screen.getByRole('button', { name: /test detection/i }))

      expect(await screen.findByText('Billing')).toBeInTheDocument()
      expect(await screen.findByText('Customer mentions a duplicate charge.')).toBeInTheDocument()
      expect(hoisted.previewAttributeDetectionFn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            definition: expect.objectContaining({ key: 'issue_type', label: 'Issue type' }),
            sampleMessage: 'I got charged twice this month',
          }),
        })
      )
    })

    it('shows "No option applies" when the predicted optionId is null', async () => {
      hoisted.previewAttributeDetectionFn.mockResolvedValue({
        optionId: null,
        optionLabel: null,
        reasoning: 'Nothing in the message indicates an issue type.',
      })
      const user = await openEditDialogForIssueType()
      await user.type(screen.getByPlaceholderText(/i was charged twice/i), 'Hello!')
      await user.click(screen.getByRole('button', { name: /test detection/i }))

      expect(await screen.findByText('No option applies')).toBeInTheDocument()
    })

    it('disables the button until a sample message is entered', async () => {
      const user = await openEditDialogForIssueType()
      expect(screen.getByRole('button', { name: /test detection/i })).toBeDisabled()
      await user.type(screen.getByPlaceholderText(/i was charged twice/i), 'x')
      expect(screen.getByRole('button', { name: /test detection/i })).not.toBeDisabled()
    })
  })

  describe('"Draft descriptions" assist', () => {
    it('fills the attribute + option description fields from the draft result', async () => {
      hoisted.draftAttributeDescriptionsFn.mockResolvedValue({
        attributeDescription: 'What kind of issue the customer has.',
        options: [
          { label: 'Billing', description: 'Applies when the customer asks about a charge.' },
          { label: 'Bug', description: 'Applies when something is broken.' },
        ],
      })
      const user = await openEditDialogForIssueType()

      await user.click(screen.getByRole('button', { name: /draft descriptions/i }))

      expect(hoisted.draftAttributeDescriptionsFn).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { label: 'Issue type', optionLabels: ['Billing', 'Bug'] },
        })
      )
      // FIXTURE_ATTRIBUTES[0] already has a non-empty attribute description,
      // so this goes through the overwrite-confirmation path.
      await user.click(await screen.findByRole('button', { name: /^overwrite$/i }))

      expect(
        await screen.findByDisplayValue('What kind of issue the customer has.')
      ).toBeInTheDocument()
      expect(
        await screen.findByDisplayValue('Applies when the customer asks about a charge.')
      ).toBeInTheDocument()
    })

    it('asks for confirmation before overwriting an existing description, and applies only on confirm', async () => {
      hoisted.draftAttributeDescriptionsFn.mockResolvedValue({
        attributeDescription: 'New description.',
        options: [
          { label: 'Billing', description: 'New billing description.' },
          { label: 'Bug', description: 'New bug description.' },
        ],
      })
      const user = await openEditDialogForIssueType()

      await user.click(screen.getByRole('button', { name: /draft descriptions/i }))
      expect(await screen.findByText(/will overwrite existing descriptions/i)).toBeInTheDocument()
      // Not applied yet — the original description is untouched.
      expect(screen.queryByDisplayValue('New description.')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /^overwrite$/i }))
      expect(await screen.findByDisplayValue('New description.')).toBeInTheDocument()
    })

    it('is disabled until at least one option has a label', async () => {
      hoisted.listConversationAttributesFn.mockResolvedValue([])
      const user = await openCreateDialog()
      fireEvent.change(typeSelect(), { target: { value: 'select' } })
      await screen.findByRole('button', { name: /draft descriptions/i })
      expect(screen.getByRole('button', { name: /draft descriptions/i })).toBeDisabled()

      await user.click(screen.getByRole('button', { name: /add option/i }))
      await user.type(screen.getByPlaceholderText('Option label'), 'Billing')
      expect(screen.getByRole('button', { name: /draft descriptions/i })).not.toBeDisabled()
    })
  })

  describe('monitoring breakdown', () => {
    it('shows per-option counts for an aiDetect-enabled attribute in the edit dialog', async () => {
      hoisted.attributeValueCountsFn.mockResolvedValue([
        { optionId: 'opt_1', label: 'Billing', count: 7 },
        { optionId: 'opt_2', label: 'Bug', count: 3 },
        { optionId: null, label: 'Not set', count: 2 },
      ])
      await openEditDialogForIssueType()

      expect(await screen.findByText('Detections (last 30 days)')).toBeInTheDocument()
      expect(hoisted.attributeValueCountsFn).toHaveBeenCalledWith(
        expect.objectContaining({ data: { key: 'issue_type', sinceDays: 30 } })
      )
      expect(await screen.findByText('7')).toBeInTheDocument()
      expect(screen.getByText('3')).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()
    })

    it('does not appear in the create dialog (no saved data to show yet)', async () => {
      hoisted.listConversationAttributesFn.mockResolvedValue([])
      await openCreateDialog()
      expect(screen.queryByText('Detections (last 30 days)')).not.toBeInTheDocument()
    })
  })
})
