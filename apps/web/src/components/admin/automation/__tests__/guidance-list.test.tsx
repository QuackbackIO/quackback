// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { DEFAULT_ASSISTANT_CONFIG } from '@/lib/shared/assistant/config'
import type { GuidanceEntryDTO } from '@/lib/shared/assistant/guidance-entry'
import { GUIDANCE_RUNTIME_BUDGETS } from '@/lib/shared/assistant/guidance-entry'

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  entries: vi.fn(),
  saveEntry: vi.fn(),
  deleteEntry: vi.fn(),
  saveVoice: vi.fn(),
}))
vi.mock('@/lib/client/queries/assistant', () => ({
  assistantQueries: {
    settings: () => ({ queryKey: ['settings'], queryFn: mocks.settings }),
    guidanceEntries: () => ({ queryKey: ['entries'], queryFn: mocks.entries }),
  },
}))
vi.mock('@/lib/client/mutations/assistant', () => ({
  useSaveGuidanceEntry: () => ({ mutateAsync: mocks.saveEntry }),
  useDeleteGuidanceEntry: () => ({ mutateAsync: mocks.deleteEntry }),
  useUpdateAssistantVoice: () => ({ mutateAsync: mocks.saveVoice }),
}))
import { GuidanceList } from '../guidance-list'

function entry(overrides: Partial<GuidanceEntryDTO> = {}): GuidanceEntryDTO {
  return {
    id: 'guidance_entry_1',
    kind: 'situational',
    owner: 'canonical',
    title: 'Refunds',
    body: 'Check policy',
    appliesWhen: 'Refund requested',
    enabled: true,
    priority: 0,
    version: 3,
    uses: ['agent'],
    legacySource: null,
    legacyId: null,
    managed: false,
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

const writingGuidelines = entry({
  id: 'guidance_entry_voice',
  kind: 'always',
  owner: 'config',
  title: 'Everyday instructions',
  body: '',
  appliesWhen: null,
  version: 1,
  legacySource: 'voice',
  legacyId: 'agents.agent.voice.additionalInstructions',
})

function show() {
  render(
    <IntlProvider locale="en">
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <GuidanceList />
      </QueryClientProvider>
    </IntlProvider>
  )
}

function listEntries(...rows: GuidanceEntryDTO[]) {
  mocks.entries.mockResolvedValue({
    entries: rows,
    configRevision: 7,
    budgets: GUIDANCE_RUNTIME_BUDGETS,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.settings.mockResolvedValue({
    config: structuredClone(DEFAULT_ASSISTANT_CONFIG),
    revision: 7,
    managedFieldPaths: [],
  })
  listEntries(writingGuidelines)
  mocks.saveEntry.mockResolvedValue(entry())
})
afterEach(cleanup)

describe('Guidance canonical editor', () => {
  it('opens an accessible modal and returns to the list when canceled', async () => {
    show()
    const add = await screen.findByRole('button', { name: 'Add guidance' })
    fireEvent.click(add)
    const dialog = await screen.findByRole('dialog', { name: 'Add guidance' })
    expect(within(dialog).getByLabelText('What should Quinn do?')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    await waitFor(() => expect(add).toHaveFocus())
  })

  it('protects a dirty draft when Escape dismisses the editor', async () => {
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit guidance' })
    fireEvent.change(within(dialog).getByLabelText('What should Quinn do?'), {
      target: { value: 'Keep my draft after Escape.' },
    })
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' })
    const confirm = await screen.findByRole('alertdialog')
    expect(confirm).toHaveTextContent('Discard unsaved changes?')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByRole('dialog', { name: 'Edit guidance' })).toBeInTheDocument()
    expect(screen.getByLabelText('What should Quinn do?')).toHaveValue(
      'Keep my draft after Escape.'
    )
  })

  it('saves the selected application tile using the keyboard shortcut', async () => {
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Add guidance' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Plain language' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Every conversation' }))
    fireEvent.change(screen.getByLabelText('What should Quinn do?'), {
      target: { value: 'Use plain language.' },
    })
    fireEvent.keyDown(screen.getByLabelText('What should Quinn do?'), {
      key: 'Enter',
      ctrlKey: true,
    })
    await waitFor(() =>
      expect(mocks.saveEntry).toHaveBeenCalledWith({
        entry: expect.objectContaining({
          kind: 'always',
          title: 'Plain language',
          appliesWhen: null,
          body: 'Use plain language.',
        }),
      })
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('saves one entry and every role it applies to in a single write', async () => {
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Add guidance' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Refund policy' } })
    fireEvent.change(screen.getByLabelText('Situation'), {
      target: { value: 'When a customer asks for a refund' },
    })
    fireEvent.change(screen.getByLabelText('What should Quinn do?'), {
      target: { value: 'Look up the current policy before answering.' },
    })
    fireEvent.click(screen.getByLabelText('Support teammates'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocks.saveEntry).toHaveBeenCalledTimes(1))
    expect(mocks.saveEntry).toHaveBeenCalledWith({
      entry: expect.objectContaining({
        kind: 'situational',
        title: 'Refund policy',
        appliesWhen: 'When a customer asks for a refund',
        uses: ['agent', 'copilot'],
      }),
    })
  })

  it('keeps a long body and the roles it already had when only the name changes', async () => {
    const body = 'A'.repeat(7_900)
    listEntries(
      writingGuidelines,
      entry({
        id: 'guidance_entry_procedure',
        kind: 'procedure',
        title: 'Refund procedure',
        appliesWhen: 'Duplicate payment',
        body,
        enabled: false,
        uses: ['agent', 'copilot', 'workspace'],
        version: 5,
      })
    )
    show()
    await screen.findByText('Refund procedure')
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1])
    expect(screen.getByLabelText('What should Quinn do?')).toHaveValue(body)
    // A procedure keeps its own application: its body is loaded on request, so
    // the editor offers its when-to-use line rather than the always/situation
    // choice, which would put 7,900 characters in every prompt.
    expect(screen.getByLabelText('When to use')).toHaveValue('Duplicate payment')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Refund review' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(mocks.saveEntry).toHaveBeenCalledWith({
        id: 'guidance_entry_procedure',
        expectedVersion: 5,
        entry: expect.objectContaining({
          kind: 'procedure',
          title: 'Refund review',
          body,
          enabled: false,
          uses: ['agent', 'copilot', 'workspace'],
        }),
      })
    )
  })

  it('sends the everyday instructions through the config write with its revision', async () => {
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('What should Quinn do?'), {
      target: { value: 'Use plain English.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(mocks.saveVoice).toHaveBeenCalledWith({
        expectedRevision: 7,
        voice: {
          ...DEFAULT_ASSISTANT_CONFIG.agents.agent.voice,
          additionalInstructions: 'Use plain English.',
        },
      })
    )
    expect(mocks.saveEntry).not.toHaveBeenCalled()
  })

  it('keeps the draft when another session moved the version', async () => {
    listEntries(writingGuidelines, entry())
    mocks.saveEntry.mockRejectedValue(
      new Error('This guidance changed in another session. Reload it and apply your edit again.')
    )
    show()
    await screen.findByText('Refunds')
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1])
    fireEvent.change(screen.getByLabelText('What should Quinn do?'), {
      target: { value: 'Keep this unsaved instruction.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('changed in another session')
    expect(screen.getByLabelText('What should Quinn do?')).toHaveValue(
      'Keep this unsaved instruction.'
    )
  })

  it('shows managed workspace instructions without an edit path', async () => {
    listEntries(
      writingGuidelines,
      entry({
        id: 'guidance_entry_managed',
        kind: 'always',
        owner: 'config',
        title: 'Workspace and Slack instructions',
        body: 'Summarize for the team.',
        appliesWhen: null,
        uses: ['workspace'],
        legacySource: 'managed',
        legacyId: 'agents.workspace.instructions',
        managed: true,
      })
    )
    show()
    await screen.findByText('Workspace and Slack instructions')
    fireEvent.click(screen.getByRole('button', { name: 'View' }))
    expect(
      screen.getByText('These instructions are managed by your deployment configuration.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })
})

it('combines the guidance type filter with search', async () => {
  listEntries(writingGuidelines, entry())
  show()
  await screen.findByText('Refunds')
  fireEvent.click(screen.getByRole('button', { name: 'Always' }))
  expect(screen.queryByText('Refunds')).not.toBeInTheDocument()
  expect(screen.getByText('Everyday instructions')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Situations' }))
  expect(screen.getByText('Refunds')).toBeInTheDocument()
  expect(screen.queryByText('Everyday instructions')).not.toBeInTheDocument()
  fireEvent.change(screen.getByPlaceholderText('Search guidance'), {
    target: { value: 'unmatched' },
  })
  expect(screen.getByText('No matching guidance.')).toBeInTheDocument()
})

it('requires confirmation before closing unsaved guidance', async () => {
  listEntries(writingGuidelines, entry())
  show()
  await screen.findByText('Refunds')
  fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0])
  fireEvent.change(screen.getByLabelText('What should Quinn do?'), {
    target: { value: 'Keep my draft' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('alertdialog')).toHaveTextContent('Discard unsaved changes?')
  expect(screen.getByLabelText('What should Quinn do?')).toHaveValue('Keep my draft')
  fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1])
  expect(screen.getByLabelText('Name')).toHaveValue('Refunds')
  expect(screen.getByLabelText('What should Quinn do?')).toHaveValue('Check policy')
})
