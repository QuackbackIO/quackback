import { it, expect } from 'vitest'
import { toolPermissions } from '../tool-permissions'
import { PERMISSIONS } from '@/lib/shared/permissions'
it('requires only post creation for workspace capture while retaining conversation proxy-vote permission', () => {
  const spec = {
    name: 'capture_feedback',
    risk: 'write' as const,
    permissions: [PERMISSIONS.POST_CREATE, PERMISSIONS.POST_VOTE_ON_BEHALF],
  }
  expect(toolPermissions(spec, true)).toEqual([PERMISSIONS.POST_CREATE])
  expect(toolPermissions(spec, false)).toEqual(spec.permissions)
})

it('requires conversation reply for write tools without a declared permission', () => {
  expect(
    toolPermissions({ name: 'connector_acme__write', risk: 'write', permissions: [] }, false)
  ).toEqual([PERMISSIONS.CONVERSATION_REPLY])
  expect(toolPermissions({ name: 'mcp_write', risk: 'write', permissions: [] }, true)).toEqual([
    PERMISSIONS.CONVERSATION_REPLY,
  ])
  expect(
    toolPermissions({ name: 'connector_acme__read', risk: 'read', permissions: [] }, false)
  ).toEqual([])
})
