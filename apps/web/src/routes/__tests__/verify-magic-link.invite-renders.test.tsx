// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

const search = vi.hoisted(() => ({
  token: 'tok',
  callbackURL: '/accept-invitation/invite_01h455vb4pex5vsknk084sn02q',
  errorCallbackURL: undefined as string | undefined,
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({
    options,
    useSearch: () => search,
  }),
}))
vi.mock('@/lib/server/functions/invitations', () => ({
  getInviteBrandingFn: async () => ({
    workspaceName: 'Acme',
    logoUrl: null,
    inviterName: 'Sam',
  }),
}))
vi.mock('@/lib/shared/parse-invitation-id', () => ({
  parseInvitationId: (url: string | undefined) => (url ? 'invite_1' : null),
}))

import { Route } from '../verify-magic-link'

afterEach(cleanup)

it('keeps the invitation page to the workspace, the inviter and the one action', async () => {
  const Page = (Route as unknown as { options: { component: ComponentType } }).options.component
  render(<Page />)
  expect(await screen.findByText('Sam invited you to join Acme.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Accept invitation' })).toBeInTheDocument()
  expect(screen.queryByText('AI-powered insights')).toBeNull()
  expect(screen.queryByText('24 integrations')).toBeNull()
})
