import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  withApiKeyAuthMock: vi.fn(),
  principalFindFirstMock: vi.fn(),
  principalFindManyMock: vi.fn(),
  parseTypeIdMock: vi.fn(),
  loadPermissionSetMock: vi.fn(),
  getTicketForPortalUserMock: vi.fn(),
  getTicketMock: vi.fn(),
  getThreadMock: vi.fn(),
  attachToThreadMock: vi.fn(),
  listForThreadMock: vi.fn(),
  listSharesForTicketMock: vi.fn(),
  toResourceScopeMock: vi.fn(),
  canViewTicketMock: vi.fn(),
  canReplyPublicMock: vi.fn(),
  canCommentInternalMock: vi.fn(),
  canEditFieldsMock: vi.fn(),
  canShareCrossTeamMock: vi.fn(),
  removeAttachmentMock: vi.fn(),
  isS3ConfiguredMock: vi.fn(),
  isAllowedAttachmentTypeMock: vi.fn(),
  generateStorageKeyMock: vi.fn(),
  uploadObjectMock: vi.fn(),
  getPublicOriginFromRequestMock: vi.fn(),
  eqMock: vi.fn(),
  ticketAttachmentFindFirstMock: vi.fn(),
  ticketThreadFindFirstMock: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

vi.mock('@/lib/server/auth', () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => hoisted.getSessionMock(...args),
    },
  },
}))

vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => hoisted.withApiKeyAuthMock(...args),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      principal: {
        findFirst: (...args: unknown[]) => hoisted.principalFindFirstMock(...args),
        findMany: (...args: unknown[]) => hoisted.principalFindManyMock(...args),
      },
      ticketAttachments: {
        findFirst: (...args: unknown[]) => hoisted.ticketAttachmentFindFirstMock(...args),
      },
      ticketThreads: {
        findFirst: (...args: unknown[]) => hoisted.ticketThreadFindFirstMock(...args),
      },
    },
  },
  eq: (...args: unknown[]) => hoisted.eqMock(...args),
  principal: {
    id: 'principal.id',
    userId: 'principal.userId',
  },
  ticketAttachments: {
    id: 'ticketAttachments.id',
  },
  ticketThreads: {
    id: 'ticketThreads.id',
  },
}))

vi.mock('@/lib/server/domains/api/validation', () => ({
  parseTypeId: (...args: unknown[]) => hoisted.parseTypeIdMock(...args),
}))

vi.mock('@/lib/server/domains/authz/authz.service', () => ({
  loadPermissionSet: (...args: unknown[]) => hoisted.loadPermissionSetMock(...args),
}))

vi.mock('@/lib/server/domains/tickets/ticket.portal-query', () => ({
  getTicketForPortalUser: (...args: unknown[]) => hoisted.getTicketForPortalUserMock(...args),
}))

vi.mock('@/lib/server/domains/tickets', () => ({
  getTicket: (...args: unknown[]) => hoisted.getTicketMock(...args),
  getThread: (...args: unknown[]) => hoisted.getThreadMock(...args),
  attachToThread: (...args: unknown[]) => hoisted.attachToThreadMock(...args),
  removeAttachment: (...args: unknown[]) => hoisted.removeAttachmentMock(...args),
  listForThread: (...args: unknown[]) => hoisted.listForThreadMock(...args),
  listSharesForTicket: (...args: unknown[]) => hoisted.listSharesForTicketMock(...args),
  toResourceScope: (...args: unknown[]) => hoisted.toResourceScopeMock(...args),
  canViewTicket: (...args: unknown[]) => hoisted.canViewTicketMock(...args),
  canReplyPublic: (...args: unknown[]) => hoisted.canReplyPublicMock(...args),
  canCommentInternal: (...args: unknown[]) => hoisted.canCommentInternalMock(...args),
  canEditFields: (...args: unknown[]) => hoisted.canEditFieldsMock(...args),
  canShareCrossTeam: (...args: unknown[]) => hoisted.canShareCrossTeamMock(...args),
}))

vi.mock('@/lib/server/storage/s3', () => ({
  isS3Configured: (...args: unknown[]) => hoisted.isS3ConfiguredMock(...args),
  isAllowedAttachmentType: (...args: unknown[]) => hoisted.isAllowedAttachmentTypeMock(...args),
  MAX_ATTACHMENT_FILE_SIZE: 10,
  generateStorageKey: (...args: unknown[]) => hoisted.generateStorageKeyMock(...args),
  uploadObject: (...args: unknown[]) => hoisted.uploadObjectMock(...args),
}))

vi.mock('@/lib/server/integrations/oauth', () => ({
  getPublicOriginFromRequest: (...args: unknown[]) =>
    hoisted.getPublicOriginFromRequestMock(...args),
}))

import { Route } from '../$ticketId.threads.$threadId.attachments'
import { Route as DeleteAttachmentRoute } from '../$ticketId.threads.$threadId.attachments.$attachmentId'

type HandlerArgs = { request: Request; params: Record<string, string> }
type RouteWithHandlers = {
  options: { server: { handlers: Record<string, (args: HandlerArgs) => Promise<Response>> } }
}

const handlers = (Route as unknown as RouteWithHandlers).options.server.handlers
const deleteHandlers = (DeleteAttachmentRoute as unknown as RouteWithHandlers).options.server
  .handlers

const TICKET = 'ticket_123'
const THREAD = 'ticket_thread_123'
const ATTACHMENT = 'ticket_att_123'
const PRINCIPAL = 'principal_agent'
const USER = 'user_123'
const SCOPE = { kind: 'ticket-scope' }

function routeArgs(request = new Request('http://test/api/v1/tickets/x/threads/y/attachments')) {
  return { request, params: { ticketId: TICKET, threadId: THREAD } }
}

function deleteArgs(
  request = new Request('http://test/api/v1/tickets/x/threads/y/attachments/z', {
    method: 'DELETE',
  })
) {
  return { request, params: { ticketId: TICKET, threadId: THREAD, attachmentId: ATTACHMENT } }
}

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: TICKET,
    primaryTeamId: 'team_primary',
    assigneePrincipalId: null,
    assigneeTeamId: null,
    ...overrides,
  }
}

function thread(overrides: Record<string, unknown> = {}) {
  return {
    id: THREAD,
    ticketId: TICKET,
    principalId: PRINCIPAL,
    audience: 'public',
    deletedAt: null,
    ...overrides,
  }
}

function attachment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'att_1',
    threadId: THREAD,
    uploadedByPrincipalId: PRINCIPAL,
    filename: 'note.txt',
    mimeType: 'text/plain',
    sizeBytes: 4,
    storageKey: 'ticket-attachments/note.txt',
    publicUrl: 'https://cdn.example/note.txt',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

function uploadRequest(file: File | null) {
  const form = new FormData()
  if (file) form.set('file', file)
  return new Request('http://test/api/v1/tickets/x/threads/y/attachments', {
    method: 'POST',
    body: form,
  })
}

function multipartUploadRequest(filename: string) {
  const boundary = '----vitest-ticket-attachment'
  const body = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    'Content-Type: text/plain',
    '',
    'x',
    `--${boundary}--`,
    '',
  ].join('\r\n')

  return new Request('http://test/api/v1/tickets/x/threads/y/attachments', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
  })
}

async function responseData(response: Response) {
  return (await response.json()).data
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.eqMock.mockImplementation((left: unknown, right: unknown) => ['eq', left, right])
  hoisted.getSessionMock.mockResolvedValue(null)
  hoisted.withApiKeyAuthMock.mockResolvedValue({ principalId: PRINCIPAL, role: 'team' })
  hoisted.principalFindFirstMock.mockResolvedValue({ id: PRINCIPAL })
  hoisted.principalFindManyMock.mockResolvedValue([{ id: PRINCIPAL }])
  hoisted.parseTypeIdMock.mockImplementation((value: string) => value)
  hoisted.loadPermissionSetMock.mockResolvedValue(new Set<string>())
  hoisted.getTicketForPortalUserMock.mockResolvedValue(ticket())
  hoisted.getTicketMock.mockResolvedValue(ticket())
  hoisted.getThreadMock.mockResolvedValue(thread())
  hoisted.listSharesForTicketMock.mockResolvedValue([{ teamId: 'team_shared', revokedAt: null }])
  hoisted.toResourceScopeMock.mockReturnValue(SCOPE)
  hoisted.canViewTicketMock.mockReturnValue(true)
  hoisted.canReplyPublicMock.mockReturnValue(true)
  hoisted.canCommentInternalMock.mockReturnValue(true)
  hoisted.canEditFieldsMock.mockReturnValue(false)
  hoisted.canShareCrossTeamMock.mockReturnValue(true)
  hoisted.listForThreadMock.mockResolvedValue([attachment()])
  hoisted.ticketAttachmentFindFirstMock.mockResolvedValue(attachment({ id: ATTACHMENT }))
  hoisted.ticketThreadFindFirstMock.mockResolvedValue({ ticketId: TICKET })
  hoisted.isS3ConfiguredMock.mockReturnValue(true)
  hoisted.isAllowedAttachmentTypeMock.mockReturnValue(true)
  hoisted.generateStorageKeyMock.mockReturnValue('ticket-attachments/generated.txt')
  hoisted.uploadObjectMock.mockResolvedValue('https://cdn.example/generated.txt')
  hoisted.getPublicOriginFromRequestMock.mockReturnValue('https://app.example')
  hoisted.attachToThreadMock.mockResolvedValue(
    attachment({
      storageKey: 'ticket-attachments/generated.txt',
      publicUrl: 'https://cdn.example/generated.txt',
    })
  )
  hoisted.removeAttachmentMock.mockResolvedValue(undefined)
})

describe('/api/v1/tickets/:ticketId/threads/:threadId/attachments', () => {
  it('lists attachments for an API-key principal with ticket view permission', async () => {
    const response = await handlers.GET(routeArgs())

    expect(response.status).toBe(200)
    expect(await responseData(response)).toEqual([
      {
        id: 'att_1',
        threadId: THREAD,
        uploadedByPrincipalId: PRINCIPAL,
        filename: 'note.txt',
        mimeType: 'text/plain',
        sizeBytes: 4,
        storageKey: 'ticket-attachments/note.txt',
        publicUrl: 'https://cdn.example/note.txt',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ])
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })
    expect(hoisted.listForThreadMock).toHaveBeenCalledWith(THREAD)
  })

  it('allows a session portal user to list public-thread attachments without agent permissions', async () => {
    hoisted.getSessionMock.mockResolvedValueOnce({ user: { id: USER } })
    hoisted.canViewTicketMock.mockReturnValue(false)

    const response = await handlers.GET(routeArgs())

    expect(response.status).toBe(200)
    expect(hoisted.withApiKeyAuthMock).not.toHaveBeenCalled()
    expect(hoisted.getTicketForPortalUserMock).toHaveBeenCalledWith({
      userId: USER,
      ticketId: TICKET,
    })
  })

  it('falls back to API-key auth when a session user has no principal row', async () => {
    hoisted.getSessionMock.mockResolvedValue({ user: { id: USER } })
    hoisted.principalFindFirstMock.mockResolvedValueOnce(null)

    const response = await handlers.GET(routeArgs())

    expect(response.status).toBe(200)
    expect(hoisted.withApiKeyAuthMock).toHaveBeenCalledWith(expect.any(Request), { role: 'team' })
    expect(hoisted.listForThreadMock).toHaveBeenCalledWith(THREAD)
  })

  it('uses a session principal with ticket view permission without portal fallback', async () => {
    hoisted.getSessionMock.mockResolvedValue({ user: { id: USER } })

    const response = await handlers.GET(routeArgs())

    expect(response.status).toBe(200)
    expect(hoisted.withApiKeyAuthMock).not.toHaveBeenCalled()
    expect(hoisted.getTicketForPortalUserMock).toHaveBeenCalledWith({
      userId: USER,
      ticketId: TICKET,
    })
  })

  it('maps a session user with no ticket principal to an API error', async () => {
    hoisted.getSessionMock.mockResolvedValue({ user: { id: USER } })
    hoisted.principalFindManyMock.mockResolvedValueOnce([])

    const response = await handlers.GET(routeArgs())

    expect(response.status).toBe(500)
    expect(hoisted.listForThreadMock).not.toHaveBeenCalled()
  })

  it('returns not found for missing ticket or mismatched thread', async () => {
    hoisted.getTicketMock.mockResolvedValueOnce(null)
    const ticketResponse = await handlers.GET(routeArgs())
    expect(ticketResponse.status).toBe(404)

    hoisted.getTicketMock.mockResolvedValueOnce(ticket())
    hoisted.getThreadMock.mockResolvedValueOnce(thread({ ticketId: 'ticket_other' }))
    const threadResponse = await handlers.GET(routeArgs())
    expect(threadResponse.status).toBe(404)
  })

  it('forbids GET when neither permissions nor portal ownership allow viewing', async () => {
    hoisted.canViewTicketMock.mockReturnValue(false)

    const response = await handlers.GET(routeArgs())

    expect(response.status).toBe(403)
    expect(hoisted.listForThreadMock).not.toHaveBeenCalled()
  })

  it('uploads an attachment after audience-aware permission and storage validation', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'note.txt', { type: 'text/plain' })
    const response = await handlers.POST(routeArgs(uploadRequest(file)))

    expect(response.status).toBe(201)
    expect(hoisted.canReplyPublicMock).toHaveBeenCalledWith(expect.any(Set), SCOPE)
    expect(hoisted.uploadObjectMock).toHaveBeenCalledWith(
      'ticket-attachments/generated.txt',
      Buffer.from([1, 2, 3, 4]),
      'text/plain',
      'https://app.example'
    )
    expect(hoisted.attachToThreadMock).toHaveBeenCalledWith({
      threadId: THREAD,
      uploadedByPrincipalId: PRINCIPAL,
      filename: 'note.txt',
      mimeType: 'text/plain',
      sizeBytes: 4,
      storageKey: 'ticket-attachments/generated.txt',
      publicUrl: 'https://cdn.example/generated.txt',
    })
  })

  it('returns not found before upload when the ticket is missing', async () => {
    hoisted.getTicketMock.mockResolvedValueOnce(null)
    const file = new File([new Uint8Array([1])], 'note.txt', { type: 'text/plain' })

    const response = await handlers.POST(routeArgs(uploadRequest(file)))

    expect(response.status).toBe(404)
    expect(hoisted.attachToThreadMock).not.toHaveBeenCalled()
  })

  it('allows portal users to attach only to their own public threads', async () => {
    hoisted.getSessionMock.mockResolvedValue({ user: { id: USER } })
    hoisted.principalFindManyMock.mockResolvedValue([{ id: 'principal_portal' }])
    hoisted.canViewTicketMock.mockReturnValue(false)
    hoisted.getThreadMock.mockResolvedValue(thread({ principalId: 'principal_other' }))
    const file = new File([new Uint8Array([1])], 'note.txt', { type: 'text/plain' })

    const denied = await handlers.POST(routeArgs(uploadRequest(file)))
    expect(denied.status).toBe(403)
    expect(hoisted.attachToThreadMock).not.toHaveBeenCalled()

    hoisted.getThreadMock.mockResolvedValue(thread({ principalId: 'principal_portal' }))
    const allowed = await handlers.POST(routeArgs(uploadRequest(file)))
    expect(allowed.status).toBe(201)
    expect(hoisted.attachToThreadMock).toHaveBeenCalledWith(
      expect.objectContaining({ uploadedByPrincipalId: 'principal_portal' })
    )
  })

  it('rejects portal uploads when portal ownership cannot be proven', async () => {
    hoisted.getSessionMock.mockResolvedValue({ user: { id: USER } })
    hoisted.principalFindManyMock.mockResolvedValue([{ id: 'principal_portal' }])
    hoisted.canViewTicketMock.mockReturnValue(false)
    hoisted.getThreadMock.mockResolvedValue(thread({ principalId: 'principal_portal' }))
    hoisted.getTicketForPortalUserMock.mockRejectedValueOnce(new Error('not owned'))
    const file = new File([new Uint8Array([1])], 'note.txt', { type: 'text/plain' })

    const response = await handlers.POST(routeArgs(uploadRequest(file)))

    expect(response.status).toBe(403)
    expect(hoisted.attachToThreadMock).not.toHaveBeenCalled()
  })

  it('rejects POST for deleted threads, missing storage, malformed forms, and invalid files', async () => {
    const validFile = new File([new Uint8Array([1])], 'note.txt', { type: 'text/plain' })

    hoisted.getThreadMock.mockResolvedValueOnce(thread({ deletedAt: new Date() }))
    expect(await handlers.POST(routeArgs(uploadRequest(validFile)))).toHaveProperty('status', 404)

    hoisted.getThreadMock.mockResolvedValue(thread())
    hoisted.isS3ConfiguredMock.mockReturnValueOnce(false)
    expect(await handlers.POST(routeArgs(uploadRequest(validFile)))).toHaveProperty('status', 500)

    expect(await handlers.POST(routeArgs(uploadRequest(null)))).toHaveProperty('status', 400)

    hoisted.isAllowedAttachmentTypeMock.mockReturnValueOnce(false)
    expect(await handlers.POST(routeArgs(uploadRequest(validFile)))).toHaveProperty('status', 400)

    const emptyFile = new File([], 'empty.txt', { type: 'text/plain' })
    expect(await handlers.POST(routeArgs(uploadRequest(emptyFile)))).toHaveProperty('status', 400)

    const largeFile = new File([new Uint8Array(11)], 'large.txt', { type: 'text/plain' })
    expect(await handlers.POST(routeArgs(uploadRequest(largeFile)))).toHaveProperty('status', 400)
  })

  it('enforces internal and shared-team attachment permissions for API-key callers', async () => {
    const file = new File([new Uint8Array([1])], 'note.txt', { type: 'text/plain' })

    hoisted.canReplyPublicMock.mockReturnValueOnce(false)
    const publicDenied = await handlers.POST(routeArgs(uploadRequest(file)))
    expect(publicDenied.status).toBe(403)

    hoisted.getThreadMock.mockResolvedValueOnce(thread({ audience: 'internal' }))
    hoisted.canCommentInternalMock.mockReturnValueOnce(false)
    const internalDenied = await handlers.POST(routeArgs(uploadRequest(file)))
    expect(internalDenied.status).toBe(403)

    hoisted.getThreadMock.mockResolvedValueOnce(thread({ audience: 'shared_team' }))
    hoisted.canShareCrossTeamMock.mockReturnValueOnce(false)
    const sharedDenied = await handlers.POST(routeArgs(uploadRequest(file)))
    expect(sharedDenied.status).toBe(403)
  })

  it('generates fallback filenames for unnamed uploads', async () => {
    const response = await handlers.POST(routeArgs(multipartUploadRequest('')))

    expect(response.status).toBe(201)
    expect(hoisted.generateStorageKeyMock).toHaveBeenCalledWith(
      'ticket-attachments',
      expect.stringMatching(/^upload-\d+\.bin$/)
    )
  })

  it('deletes an attachment when the caller is the uploader or can edit fields', async () => {
    const uploaderResponse = await deleteHandlers.DELETE(deleteArgs())
    expect(uploaderResponse.status).toBe(204)
    expect(hoisted.removeAttachmentMock).toHaveBeenCalledWith(ATTACHMENT, PRINCIPAL)
    expect(hoisted.parseTypeIdMock).toHaveBeenCalledWith(ATTACHMENT, 'ticket_att', 'attachment ID')

    hoisted.ticketAttachmentFindFirstMock.mockResolvedValueOnce(
      attachment({ id: ATTACHMENT, uploadedByPrincipalId: 'principal_other' })
    )
    hoisted.canEditFieldsMock.mockReturnValueOnce(true)
    const editorResponse = await deleteHandlers.DELETE(deleteArgs())
    expect(editorResponse.status).toBe(204)
    expect(hoisted.canEditFieldsMock).toHaveBeenCalledWith(expect.any(Set), SCOPE)
  })

  it('rejects attachment deletion when ticket, thread, attachment, or permissions do not line up', async () => {
    hoisted.getTicketMock.mockResolvedValueOnce(null)
    expect(await deleteHandlers.DELETE(deleteArgs())).toHaveProperty('status', 404)

    hoisted.getTicketMock.mockResolvedValueOnce(ticket())
    hoisted.canViewTicketMock.mockReturnValueOnce(false)
    expect(await deleteHandlers.DELETE(deleteArgs())).toHaveProperty('status', 403)

    hoisted.ticketAttachmentFindFirstMock.mockResolvedValueOnce(null)
    expect(await deleteHandlers.DELETE(deleteArgs())).toHaveProperty('status', 404)

    hoisted.ticketAttachmentFindFirstMock.mockResolvedValueOnce(
      attachment({ id: ATTACHMENT, threadId: 'ticket_thread_other' })
    )
    expect(await deleteHandlers.DELETE(deleteArgs())).toHaveProperty('status', 404)

    hoisted.ticketThreadFindFirstMock.mockResolvedValueOnce(null)
    expect(await deleteHandlers.DELETE(deleteArgs())).toHaveProperty('status', 404)

    hoisted.ticketThreadFindFirstMock.mockResolvedValueOnce({ ticketId: 'ticket_other' })
    expect(await deleteHandlers.DELETE(deleteArgs())).toHaveProperty('status', 404)

    hoisted.ticketAttachmentFindFirstMock.mockResolvedValueOnce(
      attachment({ id: ATTACHMENT, uploadedByPrincipalId: 'principal_other' })
    )
    hoisted.canEditFieldsMock.mockReturnValueOnce(false)
    expect(await deleteHandlers.DELETE(deleteArgs())).toHaveProperty('status', 403)
  })
})
