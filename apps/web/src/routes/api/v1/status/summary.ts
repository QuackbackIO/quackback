import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import type { Actor } from '@/lib/server/policy'
import type { SegmentId } from '@quackback/ids'
import { serializePublicComponent, serializePublicIncident } from './-serialize'

export const Route = createFileRoute('/api/v1/status/summary')({
  server: {
    handlers: {
      /**
       * GET /api/v1/status/summary
       * Public status-page snapshot for API/automation consumers: top-level
       * status, every component, and active incidents.
       */
      GET: async ({ request }) => {
        try {
          const auth = await withApiKeyAuth(request)

          const { getStatusPageSnapshot } = await import('@/lib/server/domains/status')
          const { getStatusSettings } =
            await import('@/lib/server/domains/settings/settings.status')

          // Build a service-principal Actor from the API-key auth so every
          // component is visible — an API key acts on behalf of the
          // workspace, not a single (possibly segment-gated) portal viewer.
          // Team roles (admin | member) short-circuit segment filtering via
          // isTeamActor (policy/status.ts), so segmentIds is deliberately
          // left empty. Mirrors apps/boards.ts's convention for API-key
          // reads that need team-level visibility.
          const actor: Actor = {
            principalId: auth.principalId,
            role: auth.role,
            principalType: 'service',
            segmentIds: new Set<SegmentId>(),
          }

          const settings = await getStatusSettings()
          const snapshot = await getStatusPageSnapshot(actor, settings)

          const components = [
            ...snapshot.ungroupedComponents,
            ...snapshot.groups.flatMap((g) => g.components),
          ]

          return successResponse({
            status: snapshot.topLevel.status,
            components: components.map(serializePublicComponent),
            activeIncidents: snapshot.activeIncidents.map(serializePublicIncident),
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
