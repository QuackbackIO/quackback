// @vitest-environment happy-dom
/**
 * What the release surfaces say, and what they refuse to offer.
 *
 * Two contracts worth pinning: with release management off, none of this is
 * rendered at all, because the settings row is live and a save is already the
 * publication; and with it on, Publish is offered only when every required
 * check has passed against the candidate in front of the reviewer, with the
 * out-of-date reading distinguished from never having run.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import type { ReactElement } from 'react'

const releaseState = vi.fn()

vi.mock('@/lib/server/functions/assistant-releases', () => ({
  getAssistantReleaseStateFn: () => releaseState(),
  runAssistantReleaseCheckFn: vi.fn(),
  publishAssistantReleaseFn: vi.fn(),
  rollbackAssistantReleaseFn: vi.fn(),
  setAssistantReleaseManagementFn: vi.fn(),
  runAssistantCandidateSandboxFn: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}))

import { QuinnReleaseReview, candidateNote } from '../quinn-release-review'
import { QuinnReleaseCard } from '../quinn-release-card'
import { RELEASE_CHECKS, evaluateReleaseGate } from '@/lib/shared/assistant/release'

const CANDIDATE = 'hash-candidate'

function state(
  overrides: {
    managementEnabled?: boolean
    checks?: Array<{ key: string; status: string; candidateHash: string }>
    draftMatchesLive?: boolean
  } = {}
) {
  const checks = (overrides.checks ?? []).map((check) => ({
    ...check,
    summary: null,
    ranAt: '2026-09-19T00:00:00.000Z',
  }))
  const live = {
    id: 'assistant_release_live',
    releaseNumber: 1,
    status: 'published',
    origin: 'save',
    snapshotId: 'assistant_snapshot_live',
    candidateHash: 'hash-live',
    configRevision: 1,
    note: 'First release',
    scope: null,
    previousReleaseId: null,
    restoredFromId: null,
    publishedByPrincipalId: null,
    publishedAt: '2026-09-18T00:00:00.000Z',
    createdAt: '2026-09-18T00:00:00.000Z',
  }
  return {
    managementEnabled: overrides.managementEnabled ?? true,
    configured: true,
    catalogue: RELEASE_CHECKS,
    live,
    draft: {
      ...live,
      id: 'assistant_release_draft',
      releaseNumber: null,
      status: 'draft',
      candidateHash: CANDIDATE,
      note: null,
      publishedAt: null,
      scope: { uses: ['customer'], changedPaths: ['agents.agent.voice.tone'] },
    },
    draftMatchesLive: overrides.draftMatchesLive ?? false,
    checks,
    gate: evaluateReleaseGate(CANDIDATE, checks as never),
    history: [live],
  }
}

function allPassing(hash = CANDIDATE) {
  return RELEASE_CHECKS.filter((check) => check.required).map((check) => ({
    key: check.key,
    status: 'passed',
    candidateHash: hash,
  }))
}

afterEach(() => {
  cleanup()
  releaseState.mockReset()
})

function renderWithProviders(node: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <IntlProvider locale="en" messages={{}} onError={() => {}}>
      <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
    </IntlProvider>
  )
}

describe('candidateNote', () => {
  it('says nothing when the draft already matches what is live', () => {
    expect(candidateNote({ draftMatchesLive: true, publishable: true })).toBeNull()
  })

  it('names the two states a reviewer can act on', () => {
    expect(candidateNote({ draftMatchesLive: false, publishable: true })).toBe('Ready to publish')
    expect(candidateNote({ draftMatchesLive: false, publishable: false })).toBe(
      'Checks outstanding'
    )
  })
})

describe('QuinnReleaseReview', () => {
  it('renders nothing at all when release management is off', async () => {
    releaseState.mockResolvedValue(state({ managementEnabled: false }))
    const { container } = renderWithProviders(<QuinnReleaseReview />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(container.querySelector('section')).toBeNull()
  })

  it('offers Publish once every required check passed against this candidate', async () => {
    releaseState.mockResolvedValue(state({ checks: allPassing() }))
    renderWithProviders(<QuinnReleaseReview />)
    const publish = await screen.findByRole('button', { name: 'Publish' })
    expect(publish).not.toBeDisabled()
  })

  it('blocks Publish and says the evidence is out of date after an edit', async () => {
    releaseState.mockResolvedValue(state({ checks: allPassing('hash-older') }))
    renderWithProviders(<QuinnReleaseReview />)
    const publish = await screen.findByRole('button', { name: 'Publish' })
    expect(publish).toBeDisabled()
    expect(screen.getAllByText('Out of date').length).toBe(
      RELEASE_CHECKS.filter((check) => check.required).length
    )
  })

  it('blocks Publish on a required check that was skipped, and names it as skipped', async () => {
    const checks = allPassing()
    checks[0] = { ...checks[0], status: 'skipped' }
    releaseState.mockResolvedValue(state({ checks }))
    renderWithProviders(<QuinnReleaseReview />)
    expect(await screen.findByRole('button', { name: 'Publish' })).toBeDisabled()
    expect(screen.getByText('Skipped')).toBeInTheDocument()
  })

  it('offers no Publish and no diff when the draft already matches what is live', async () => {
    releaseState.mockResolvedValue(state({ checks: allPassing(), draftMatchesLive: true }))
    renderWithProviders(<QuinnReleaseReview />)
    expect(await screen.findByText('Nothing to publish.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
  })

  it('offers rollback on a superseded release and not on the live one', async () => {
    releaseState.mockResolvedValue(state({ checks: allPassing() }))
    renderWithProviders(<QuinnReleaseReview />)
    expect(await screen.findByText('Release 1')).toBeInTheDocument()
    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Roll back' })).toBeNull()
  })
})

describe('QuinnReleaseCard', () => {
  it('shows only the switch while release management is off', async () => {
    releaseState.mockResolvedValue(state({ managementEnabled: false }))
    renderWithProviders(<QuinnReleaseCard />)
    expect(
      await screen.findByRole('switch', { name: 'Review changes before they go live' })
    ).not.toBeChecked()
    expect(screen.queryByText('Review and publish')).toBeNull()
  })

  it('names the live release and what is waiting once it is on', async () => {
    releaseState.mockResolvedValue(state({ checks: allPassing() }))
    renderWithProviders(<QuinnReleaseCard />)
    expect(await screen.findByText('Release 1')).toBeInTheDocument()
    expect(screen.getByText('Ready to publish')).toBeInTheDocument()
    expect(screen.getByText('Review and publish')).toBeInTheDocument()
  })
})
