// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')
  return {
    ...actual,
    useRouter: () => ({ invalidate: vi.fn() }),
    Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  }
})

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: () => ({
    data: {
      features: { allowAnonymous: true },
      moderationDefault: { requireApproval: 'none', holdImages: false, holdLinks: false },
    },
  }),
}))

vi.mock('@/lib/client/mutations/settings', () => ({
  useUpdateModerationDefault: () => ({ mutateAsync: vi.fn() }),
}))

vi.mock('@/lib/client/queries/settings', () => ({
  settingsQueries: { portalConfig: () => ({ queryKey: ['portal'] }) },
}))

const { ModerationPage } = await import('../settings.moderation')

describe('Moderation page', () => {
  it('keeps approval and content-review cards and has no anonymous-access card', () => {
    render(<ModerationPage />)

    expect(
      screen.getByText('Approval rules and content review for incoming posts and comments.')
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Approval rules' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Content review' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Anonymous access' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('switch', { name: 'Allow anonymous interaction' })
    ).not.toBeInTheDocument()

    expect(screen.getByLabelText('Require approval for anonymous posts')).toBeInTheDocument()
    expect(screen.getByLabelText('Require approval for signed-in posts')).toBeInTheDocument()
    expect(screen.getByLabelText('Hold posts and comments that contain images')).toBeInTheDocument()
    expect(screen.getByLabelText('Hold posts and comments that contain links')).toBeInTheDocument()
    expect(
      screen.queryByText(
        'Posts from visitors without an account wait for review before they appear.'
      )
    ).not.toBeInTheDocument()
  })
})
