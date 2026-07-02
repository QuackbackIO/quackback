/**
 * Shared fixtures for widget ticket endpoint tests.
 */
import type { PrincipalId, UserId, WorkspaceId, ContactId } from '@quackback/ids'
import type { WidgetAuthContext } from '@/lib/server/functions/widget-auth'

export function makeWidgetSession(
  overrides: Partial<{
    principalType: 'user' | 'anonymous'
    contactId: ContactId | null
    userId: string
    principalId: string
    email: string
  }> = {}
): WidgetAuthContext {
  return {
    settings: {
      id: 'workspace_test1' as WorkspaceId,
      slug: 'test',
      name: 'Test',
    },
    user: {
      id: (overrides.userId ?? 'user_test1') as UserId,
      email: overrides.email ?? '[email protected]',
      name: 'Jane',
      image: null,
    },
    principal: {
      id: (overrides.principalId ?? 'principal_test1') as PrincipalId,
      role: 'user',
      type: overrides.principalType ?? 'user',
    },
    contactId: (overrides.contactId ?? null) as ContactId | null,
  }
}

export function makeRequest(
  url: string,
  init: { method?: string; body?: unknown; bearer?: string } = {}
): Request {
  const headers: Record<string, string> = {}
  if (init.bearer) headers.Authorization = `Bearer ${init.bearer}`
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  return new Request(url, {
    method: init.method ?? 'GET',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
}
