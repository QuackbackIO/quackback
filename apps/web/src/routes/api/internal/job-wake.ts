import { createFileRoute } from '@tanstack/react-router'
import { authorizeFleetInternal } from '@/lib/server/fleet/internal-auth'
import { readTextBodyWithLimit } from '@/lib/server/utils/read-body'
import {
  handleJobWake,
  isJobWorkerRunning,
  type JobWakeAbort,
  type JobWakeRequest,
} from '@/lib/server/jobs/worker'

const MAX_BODY_BYTES = 16 * 1024
const MAX_JOB_IDS = 50

function asJobId(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith('job_') && value.length < 80 ? value : null
}

function asAbort(value: unknown): JobWakeAbort | undefined {
  if (!value || typeof value !== 'object') return undefined
  const body = value as { team?: unknown; channel?: unknown; thread?: unknown }
  if (
    typeof body.team !== 'string' ||
    typeof body.channel !== 'string' ||
    typeof body.thread !== 'string' ||
    !body.team ||
    !body.channel ||
    !body.thread
  )
    return undefined
  return { team: body.team, channel: body.channel, thread: body.thread }
}

export async function handleJobWakeRequest(request: Request): Promise<Response> {
  if (!authorizeFleetInternal(request)) {
    return new Response(null, { status: 401 })
  }
  // Capped on the bytes read, not only the Content-Length header: a chunked
  // body has none, and a header can understate the body.
  let raw: unknown
  try {
    const text = await readTextBodyWithLimit(request, MAX_BODY_BYTES)
    if (text === null) return new Response(null, { status: 413 })
    raw = JSON.parse(text)
  } catch {
    return new Response(null, { status: 400 })
  }
  if (!raw || typeof raw !== 'object') return new Response(null, { status: 400 })
  const body = raw as { workspaceKey?: unknown; jobIds?: unknown; abort?: unknown }
  if (typeof body.workspaceKey !== 'string' || body.workspaceKey.length < 4) {
    return new Response(null, { status: 400 })
  }
  const jobIds = Array.isArray(body.jobIds)
    ? body.jobIds
        .map(asJobId)
        .filter((id): id is string => id !== null)
        .slice(0, MAX_JOB_IDS)
    : []
  const payload: JobWakeRequest = {
    workspaceKey: body.workspaceKey,
    jobIds,
    abort: asAbort(body.abort),
  }
  if (!isJobWorkerRunning()) {
    return new Response(null, { status: 503 })
  }
  await handleJobWake(payload)
  return new Response(null, { status: 202 })
}

export const Route = createFileRoute('/api/internal/job-wake')({
  server: { handlers: { POST: ({ request }) => handleJobWakeRequest(request) } },
})
