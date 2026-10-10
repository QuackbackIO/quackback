import type { IntegrationId } from '@quackback/ids'
import { db, integrations, eq } from '@/lib/server/db'
import { ValidationError } from '@/lib/shared/errors'
import { getIntegrationAuth } from './token-refresh'
import type { IntegrationDefinition } from './types'

/** Public identifiers only; URLs may contain secrets even without a query string. */
export function safeDestinationLabel(value: unknown): string | null {
  return typeof value === 'string' &&
    /^[a-z0-9 _./:-]{1,120}$/i.test(value) &&
    !value.includes('://')
    ? value
    : null
}

/** For non-secret channel, repository, project, and list identifiers. */
export function channelDestination(
  scopeKeys: readonly string[] = []
): NonNullable<IntegrationDefinition['destination']> {
  return {
    scopeKeys,
    label: (target) => {
      const id = (target as { channelId?: unknown } | null)?.channelId
      return safeDestinationLabel(id)
    },
  }
}

/** Validate server-side as well as filtering the destination picker. */
export async function validateIntegrationDestination(
  id: IntegrationId,
  target: unknown
): Promise<void> {
  const integration = await db.query.integrations.findFirst({ where: eq(integrations.id, id) })
  if (!integration || integration.status !== 'active')
    throw new ValidationError('INTEGRATION_UNAVAILABLE', 'Connect the integration first')
  const { getIntegration } = await import('./index')
  const validate = getIntegration(integration.integrationType)?.destination?.validate
  if (!validate) return
  const auth = await getIntegrationAuth(id)
  if (
    !(await validate({
      target,
      config: auth.config,
      accessToken: auth.accessToken,
    }))
  )
    throw new ValidationError(
      'INVALID_DESTINATION',
      'Choose a destination in the connected account'
    )
}
