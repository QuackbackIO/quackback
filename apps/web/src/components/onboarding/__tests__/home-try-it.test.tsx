// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { afterEach, expect, it, vi } from 'vitest'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import type { LaunchStatus } from '@/lib/shared/launch-checklist'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { HomeTryItYourself } from '../home-try-it'

vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    onboardingStatus: () => ({ queryKey: ['admin', 'onboarding'], staleTime: Infinity }),
  },
}))
vi.mock('@/lib/client/hooks/use-permission', () => ({
  usePermission: (permission: string) => permission === PERMISSIONS.CONVERSATION_VIEW,
}))
afterEach(cleanup)

function renderCard(
  canPostTestIdea: boolean,
  flags: Pick<FeatureFlags, 'supportInbox' | 'feedback'>
) {
  const status: LaunchStatus & { canPostTestIdea: boolean } = {
    hasBoards: true,
    canPostTestIdea,
    memberCount: 1,
    hasBranding: false,
    goals: ['product_feedback', 'customer_support'],
    features: { supportInbox: true, helpCenter: false, statusPage: false, integrations: false },
  }
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryFn: async ({ queryKey }) => {
          expect(queryKey).toEqual(['admin', 'onboarding'])
          return status
        },
      },
    },
  })
  queryClient.setQueryData(['admin', 'onboarding'], status)
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en">
        <HomeTryItYourself flags={flags as FeatureFlags} />
      </IntlProvider>
    </QueryClientProvider>
  )
}

it('offers a message but no test idea when the test customer could not post anywhere', () => {
  renderCard(false, { feedback: true, supportInbox: true })
  expect(screen.getByRole('button', { name: 'Send a message' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Post an idea' })).toBeNull()
})

it('offers both test paths once a test idea can land on a board', () => {
  renderCard(true, { feedback: true, supportInbox: true })
  expect(screen.getByRole('button', { name: 'Post an idea' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Send a message' })).toBeVisible()
})

it('hides the card when neither enabled product has a ready test path', () => {
  renderCard(false, { feedback: true, supportInbox: false })
  expect(screen.queryByText('Try it yourself')).toBeNull()
})
