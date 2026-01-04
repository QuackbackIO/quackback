/**
 * Stub Durable Object class for migration purposes.
 * This class was previously used but is no longer needed.
 * Keep this stub until Cloudflare migration is complete.
 * @deprecated Remove after successful deployment with delete-class migration
 */
export class IntegrationStateDO {
  constructor(_state: DurableObjectState, _env: unknown) {}

  async fetch(_request: Request): Promise<Response> {
    return new Response('Deprecated', { status: 410 })
  }
}
