import { describe, it, expect, vi } from 'vitest'
import { _internalAssertNotManaged } from '../managed-guard'

describe('_internalAssertNotManaged', () => {
  it('does nothing when the path is not in the managed list', async () => {
    const readPaths = vi.fn(async () => ['workspace.slug'])
    await expect(_internalAssertNotManaged('workspace.name', readPaths)).resolves.toBeUndefined()
  })

  it('throws a ForbiddenError (status 403, code FIELD_MANAGED) when the path matches verbatim', async () => {
    const readPaths = vi.fn(async () => ['workspace.name'])
    await expect(_internalAssertNotManaged('workspace.name', readPaths)).rejects.toMatchObject({
      statusCode: 403,
      code: 'FIELD_MANAGED',
    })
  })

  it('throws when the path is under a whole-block managed parent', async () => {
    const readPaths = vi.fn(async () => ['tierLimits'])
    await expect(
      _internalAssertNotManaged('tierLimits.maxBoards', readPaths)
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'FIELD_MANAGED',
    })
  })

  it('mentions the path in the error message for support trail', async () => {
    const readPaths = vi.fn(async () => ['workspace.name'])
    await expect(_internalAssertNotManaged('workspace.name', readPaths)).rejects.toThrow(
      /workspace\.name/
    )
  })
})
