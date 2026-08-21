const MAX_BODY_BYTES = 64 * 1024

export async function handleProjectionPost<T>(
  request: Request,
  opts: {
    verify: (token: string) => Promise<{ workspaceKey: string; projection: T }>
    write: (workspaceKey: string, projection: T) => Promise<{ applied: boolean; version: number }>
    isWriteError: (error: unknown) => error is { code: string }
    log: { warn: (fields: Record<string, unknown>, message: string) => void }
    refusedMessage: string
    signatureRefusedMessage: string
  }
): Promise<Response> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return Response.json({ error: 'payload_too_large' }, { status: 413 })
  }

  let token: string | null = null
  try {
    const body = (await request.json()) as { token?: unknown }
    token = typeof body.token === 'string' ? body.token : null
  } catch {
    // Mapped to the same non-oracular authentication response below.
  }
  if (!token) return Response.json({ error: 'invalid_projection' }, { status: 401 })

  try {
    const verified = await opts.verify(token)
    const result = await opts.write(verified.workspaceKey, verified.projection)
    return result.applied ? Response.json(result) : new Response(null, { status: 204 })
  } catch (error) {
    if (opts.isWriteError(error)) {
      const status =
        error.code === 'stale_version' || error.code === 'version_conflict'
          ? 409
          : error.code === 'settings_missing'
            ? 503
            : 403
      opts.log.warn({ reason: error.code }, opts.refusedMessage)
      return Response.json({ error: error.code }, { status })
    }
    opts.log.warn(
      { reason: error instanceof Error ? error.message : 'verification_failed' },
      opts.signatureRefusedMessage
    )
    return Response.json({ error: 'invalid_projection' }, { status: 401 })
  }
}
