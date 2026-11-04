/**
 * Sending-domain watch: the ten-minute automatic check on domains being set up
 * (see sending-domain-watch.ts). Schedule and retry policy live in
 * `jobs/definitions.ts`.
 */
import { logger } from '@/lib/server/logger'
import { watchSendingDomains } from './sending-domain-watch'

const log = logger.child({ component: 'sending-domain-watch' })

export async function runSendingDomainWatch(): Promise<void> {
  const result = await watchSendingDomains()
  if (result.watched > 0) {
    log.debug(result, 'sending-domain watch complete')
  }
}
