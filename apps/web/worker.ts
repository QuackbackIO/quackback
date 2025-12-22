/**
 * Custom Cloudflare Worker entry point.
 *
 * This file re-exports the OpenNext handler and adds custom exports
 * for Cloudflare Workflows and Durable Objects.
 *
 * @see https://opennext.js.org/cloudflare/howtos/custom-worker
 */

// @ts-ignore - Generated file
import { default as openNextHandler } from './.open-next/worker.js'

// Re-export the OpenNext handler with explicit fetch binding
export default {
  fetch: openNextHandler.fetch,
}

// Export workflow classes for job processing
export { ImportWorkflow, EventWorkflow } from '@quackback/jobs/adapters/cloudflare/workflows'

// Export Durable Object for integration state management
export { IntegrationStateDO } from '@quackback/jobs/adapters/cloudflare'

// Re-export OpenNext Durable Objects for queue and tag cache
// @ts-ignore - Generated file
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from './.open-next/worker.js'
