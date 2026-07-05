import { createFileRoute } from '@tanstack/react-router'
import type { Role } from '@/lib/shared/roles'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'import-detect' })

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

/**
 * POST /api/import/detect - normalize a UserVoice export or a Canny API
 * pull into the wizard's canonical CSV (§I3). The wizard treats the
 * response exactly like a freshly-uploaded CSV: the canonical headers this
 * returns auto-map onto the field-mapping step with no admin input needed,
 * so mapping/dry-run/commit are unchanged from the plain-CSV path. `voters`
 * carries real per-row voter identities (keyed by source_id) through to
 * commit so those rows import real post_votes rows instead of a bare count.
 */
export async function handleImportDetect(request: Request): Promise<Response> {
  const { validateApiWorkspaceAccess } = await import('@/lib/server/functions/workspace')
  const { canAccess } = await import('@/lib/server/auth')

  try {
    const validation = await validateApiWorkspaceAccess()
    if (!validation.success) {
      return Response.json({ error: validation.error }, { status: validation.status })
    }

    if (!canAccess(validation.principal.role as Role, ['admin'])) {
      return Response.json({ error: 'Only admins can import data' }, { status: 403 })
    }

    const formData = await request.formData()
    const source = formData.get('source') as string | null

    if (source === 'uservoice') {
      const file = formData.get('file') as File | null
      if (!file) {
        return Response.json({ error: 'No file provided' }, { status: 400 })
      }
      if (file.size > MAX_FILE_SIZE) {
        return Response.json({ error: 'File size exceeds 10MB limit' }, { status: 400 })
      }

      const { detectUserVoiceExport, normalizeUserVoiceExport } = await import(
        '@/lib/server/domains/import/adapters/uservoice/adapter'
      )
      const { parseCsvCamelCase } = await import(
        '@/lib/server/domains/import/adapters/camel-case-csv'
      )

      const text = await file.text()
      const { headers } = parseCsvCamelCase(text)
      if (!detectUserVoiceExport(headers)) {
        return Response.json(
          { error: 'This file does not look like a UserVoice full suggestions export' },
          { status: 400 }
        )
      }

      const result = normalizeUserVoiceExport(text)
      log.info({ rows: result.csv.split('\n').length - 1 }, 'uservoice export normalized')
      return Response.json(result)
    }

    if (source === 'canny') {
      const apiKey = formData.get('apiKey') as string | null
      if (!apiKey) {
        return Response.json({ error: 'A Canny API key is required' }, { status: 400 })
      }

      const { normalizeCannyExport } = await import(
        '@/lib/server/domains/import/adapters/canny/adapter'
      )
      const result = await normalizeCannyExport({ apiKey })
      log.info({ rows: result.csv.split('\n').length - 1 }, 'canny export normalized')
      return Response.json(result)
    }

    return Response.json({ error: 'Unsupported source' }, { status: 400 })
  } catch (error) {
    log.error({ err: error }, 'import detect failed')
    const errorMessage = error instanceof Error ? error.message : 'Internal server error'
    return Response.json({ error: errorMessage }, { status: 500 })
  }
}

export const Route = createFileRoute('/api/import/detect')({
  server: {
    handlers: {
      POST: ({ request }) => handleImportDetect(request),
    },
  },
})
