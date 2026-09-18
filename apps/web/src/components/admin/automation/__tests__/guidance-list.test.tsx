// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { DEFAULT_ASSISTANT_CONFIG } from '@/lib/shared/assistant/config'
import { GuidanceList } from '../guidance-list'

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  rules: vi.fn(),
  skills: vi.fn(),
  saveRule: vi.fn(),
  createRule: vi.fn(),
  saveSkill: vi.fn(),
  saveVoice: vi.fn(),
}))
vi.mock('@/lib/client/queries/assistant', () => ({
  assistantQueries: {
    settings: () => ({ queryKey: ['settings'], queryFn: mocks.settings }),
    guidanceRules: () => ({ queryKey: ['rules'], queryFn: mocks.rules }),
  },
}))
vi.mock('@/lib/client/queries/assistant-skills', () => ({
  skillQueries: { list: () => ({ queryKey: ['skills'], queryFn: mocks.skills }) },
}))
vi.mock('@/lib/client/mutations/assistant', () => ({
  useCreateGuidanceRule: () => ({ mutateAsync: mocks.createRule }),
  useUpdateGuidanceRule: () => ({ mutateAsync: mocks.saveRule }),
  useDeleteGuidanceRule: () => ({ mutateAsync: vi.fn() }),
  useUpdateAssistantVoice: () => ({ mutateAsync: mocks.saveVoice }),
}))
vi.mock('@/lib/client/mutations/assistant-skills', () => ({
  useUpdateSkill: () => ({ mutateAsync: mocks.saveSkill }),
  useDeleteSkill: () => ({ mutateAsync: vi.fn() }),
}))
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
beforeEach(() => {
  vi.clearAllMocks()
  mocks.settings.mockResolvedValue({
    config: structuredClone(DEFAULT_ASSISTANT_CONFIG),
    revision: 7,
    managedFieldPaths: [],
  })
  mocks.rules.mockResolvedValue({ rules: [] })
  mocks.skills.mockResolvedValue({ skills: [] })
  mocks.saveSkill.mockResolvedValue({ id: 'skill_legacy' })
})
afterEach(cleanup)

describe('Guidance compatibility editor', () => {
  it('keeps a long legacy body and every existing role assignment when edited', async () => {
    const body = 'A'.repeat(7900)
    mocks.skills.mockResolvedValue({
      skills: [
        {
          id: 'skill_legacy',
          name: 'Refunds',
          whenToUse: 'Duplicate payment',
          instructions: body,
          enabled: false,
          assignments: { agent: true, copilot: true, workspace: true },
          createdAt: '',
          updatedAt: '',
        },
      ],
    })
    show()
    await screen.findByText('Refunds')
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1])
    expect(screen.getByLabelText('What should Quinn do?')).toHaveValue(body)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Refund review' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(mocks.saveSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'skill_legacy',
          instructions: body,
          enabled: false,
          assignments: { agent: true, copilot: true, workspace: true },
        })
      )
    )
    expect(mocks.saveRule).not.toHaveBeenCalled()
  })
  it('creates one scoped rule, never independent writes pretending to be shared guidance', async () => {
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Add guidance' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Refund policy' } })
    fireEvent.change(screen.getByLabelText('Situation'), {
      target: { value: 'When a customer asks for a refund' },
    })
    fireEvent.change(screen.getByLabelText('What should Quinn do?'), {
      target: { value: 'Look up the current policy before answering.' },
    })
    fireEvent.change(screen.getByLabelText('Uses'), { target: { value: 'copilot' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.createRule).toHaveBeenCalledTimes(1))
    expect(mocks.createRule).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'copilot',
        appliesWhen: 'When a customer asks for a refund',
      })
    )
  })
  it('keeps the opening config revision for an everyday-instruction edit', async () => {
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
  })
  it('leaves a rejected edit available for correction', async () => {
    mocks.saveVoice.mockRejectedValue(new Error('Settings changed; reload before saving.'))
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('What should Quinn do?'), {
      target: { value: 'Use plain English.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Settings changed')
    expect(screen.getByLabelText('What should Quinn do?')).toHaveValue('Use plain English.')
  })
})
