import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrincipalId, UserId, WorkspaceId } from '@quackback/ids'

// Mock createServerFn so server functions are directly callable in tests
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let _handler: ((args: { data: unknown }) => Promise<unknown>) | null = null
    const fn = (args: { data: unknown }) => {
      if (!_handler) throw new Error('handler not registered')
      return _handler(args)
    }
    fn.validator = () => fn
    fn.handler = (h: (args: { data: unknown }) => Promise<unknown>) => {
      _handler = h
      return fn
    }
    return fn
  },
}))

vi.mock('../../storage/s3', () => ({
  isS3Configured: vi.fn(() => true),
  generatePresignedUploadUrl: vi.fn(async (key: string, _contentType: string) => ({
    uploadUrl: `https://s3.example.com/${key}?presigned`,
    publicUrl: `https://cdn.example.com/${key}`,
    key,
  })),
  generateStorageKey: vi.fn((prefix: string, filename: string) => `${prefix}/${filename}`),
  isAllowedImageType: vi.fn((type: string) =>
    ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(type)
  ),
  MAX_FILE_SIZE: 10 * 1024 * 1024,
}))

vi.mock('../widget-auth', () => ({
  getWidgetSession: vi.fn(),
}))

import { getWidgetSession } from '../widget-auth'
import type { WidgetAuthContext } from '../widget-auth'
import { getWidgetImageUploadUrlFn } from '../uploads'

const mockSession: WidgetAuthContext = {
  settings: { id: 'workspace_test1' as WorkspaceId, slug: 'test', name: 'Test' },
  user: { id: 'user_test1' as UserId, email: 'a@b.com', name: 'A', image: null },
  principal: { id: 'principal_test1' as PrincipalId, role: 'user' as const, type: 'user' },
  contactId: null,
}

describe('getWidgetImageUploadUrlFn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects when no widget session exists', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(null)
    await expect(
      getWidgetImageUploadUrlFn({
        data: { filename: 'test.jpg', contentType: 'image/jpeg', fileSize: 1000 },
      })
    ).rejects.toThrow('Authentication required')
  })

  it('rejects when widget session is anonymous', async () => {
    const anonymousSession: WidgetAuthContext = {
      ...mockSession,
      principal: { ...mockSession.principal, type: 'anonymous' },
    }
    vi.mocked(getWidgetSession).mockResolvedValueOnce(anonymousSession)
    await expect(
      getWidgetImageUploadUrlFn({
        data: { filename: 'test.jpg', contentType: 'image/jpeg', fileSize: 1000 },
      })
    ).rejects.toThrow('Authentication required')
  })

  it('rejects non-image content types', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(mockSession)
    await expect(
      getWidgetImageUploadUrlFn({
        data: { filename: 'video.mp4', contentType: 'video/mp4', fileSize: 1000 },
      })
    ).rejects.toThrow('Invalid image type')
  })

  it('returns presigned URL with widget-images prefix for authenticated user', async () => {
    vi.mocked(getWidgetSession).mockResolvedValueOnce(mockSession)
    const result = await getWidgetImageUploadUrlFn({
      data: { filename: 'screenshot.png', contentType: 'image/png', fileSize: 5000 },
    })
    expect(result.uploadUrl).toContain('widget-images/screenshot.png')
    expect(result.publicUrl).toContain('widget-images/screenshot.png')
  })
})
