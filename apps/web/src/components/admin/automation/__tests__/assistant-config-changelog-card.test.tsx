// @vitest-environment happy-dom
/**
 * Smoke coverage for the AI config changelog card: renders friendly labels
 * for each assistant-config audit event (mocked getAssistantConfigChangelogFn),
 * the actor email, a timestamp, and the empty state.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const hoisted = vi.hoisted(() => ({
  getAssistantConfigChangelogFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/assistant-config-changelog', () => ({
  getAssistantConfigChangelogFn: hoisted.getAssistantConfigChangelogFn,
}))

import { AssistantConfigChangelogCard } from '../assistant-config-changelog-card'

afterEach(cleanup)

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const ENTRIES = [
  {
    id: 'audit_1',
    eventType: 'assistant.guidance.created',
    actorEmail: 'admin@example.com',
    actorRole: 'admin',
    occurredAt: '2026-07-01T12:00:00.000Z',
    targetType: 'assistant_guidance',
    targetId: 'assistant_guidance_1',
    metadata: null,
  },
  {
    id: 'audit_2',
    eventType: 'assistant.connector.deleted',
    actorEmail: 'owner@example.com',
    actorRole: 'admin',
    occurredAt: '2026-07-02T09:30:00.000Z',
    targetType: 'data_connector',
    targetId: 'data_connector_1',
    metadata: null,
  },
]

describe('AssistantConfigChangelogCard', () => {
  it('mounts with no required props', () => {
    hoisted.getAssistantConfigChangelogFn.mockResolvedValue([])
    expect(() => renderWithClient(<AssistantConfigChangelogCard />)).not.toThrow()
  })

  it('renders a friendly label and actor email per entry', async () => {
    hoisted.getAssistantConfigChangelogFn.mockResolvedValue(ENTRIES)
    renderWithClient(<AssistantConfigChangelogCard />)

    expect(await screen.findByText('Guidance rule created')).toBeInTheDocument()
    expect(screen.getByText('Connector deleted')).toBeInTheDocument()
    expect(screen.getByText('admin@example.com')).toBeInTheDocument()
    expect(screen.getByText('owner@example.com')).toBeInTheDocument()
  })

  it('shows the empty state when there are no entries', async () => {
    hoisted.getAssistantConfigChangelogFn.mockResolvedValue([])
    renderWithClient(<AssistantConfigChangelogCard />)

    expect(await screen.findByText(/no ai config changes recorded yet/i)).toBeInTheDocument()
  })

  it('falls back to the raw event string for an unrecognized event type', async () => {
    hoisted.getAssistantConfigChangelogFn.mockResolvedValue([
      { ...ENTRIES[0], eventType: 'assistant.something.unmapped' },
    ])
    renderWithClient(<AssistantConfigChangelogCard />)

    expect(await screen.findByText('assistant.something.unmapped')).toBeInTheDocument()
  })
})
