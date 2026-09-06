import { it, expect } from 'vitest'
import { toolPermissions } from '../tool-permissions'
import { PERMISSIONS } from '@/lib/shared/permissions'
it('requires only post creation for workspace capture while retaining conversation proxy-vote permission', () => {
  const spec = {
    name: 'capture_feedback',
    permissions: [PERMISSIONS.POST_CREATE, PERMISSIONS.POST_VOTE_ON_BEHALF],
  }
  expect(toolPermissions(spec, true)).toEqual([PERMISSIONS.POST_CREATE])
  expect(toolPermissions(spec, false)).toEqual(spec.permissions)
})
