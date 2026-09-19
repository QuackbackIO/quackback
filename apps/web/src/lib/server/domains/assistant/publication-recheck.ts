/**
 * Re-reading a candidate's evidence at the moment of publication.
 *
 * A run can outlive a policy change. An article is unpublished, a category
 * turns private, a document is deleted or a source's customer-use switch is
 * turned off while the model is generating, and the retrieval that produced the
 * citation was correct when it ran and is wrong by the time the answer lands.
 * This is the read that makes the publication fence able to see that.
 *
 * It deliberately reuses `getCustomerCitationSource`, the same function the
 * customer-facing citation endpoint serves from. That function is the existing
 * definition of "may a customer be shown this source right now": per-type
 * knowledge toggle, per-source use switch and the source's own visibility
 * predicate, all live. Reusing it means the answer and the link the customer
 * clicks can never disagree, and a future tightening of one tightens both.
 *
 * A source type that function does not serve (a ticket summary, a past
 * conversation) is correctly ineligible: nothing customer-facing may cite one.
 */
import { logger } from '@/lib/server/logger'
import { getCustomerCitationSource } from './public-source'

const log = logger.child({ component: 'assistant-publication-recheck' })

export interface CitationRef {
  type: string
  id: string
}

/**
 * The subset of these citations a customer may still be shown.
 *
 * Fails CLOSED: a read that throws contributes nothing to the eligible set, so
 * a database or settings failure refuses publication rather than letting a
 * possibly revoked source through.
 */
export async function eligibleCustomerCitationIds(
  citations: readonly CitationRef[]
): Promise<Set<string>> {
  const eligible = new Set<string>()
  if (citations.length === 0) return eligible

  let knowledge: Awaited<
    ReturnType<
      typeof import('@/lib/server/domains/settings/settings.assistant').getAssistantRuntimeConfig
    >
  >['config']['agents']['agent']['knowledge']
  try {
    const { getAssistantRuntimeConfig } =
      await import('@/lib/server/domains/settings/settings.assistant')
    knowledge = (await getAssistantRuntimeConfig()).config.agents.agent.knowledge
  } catch (err) {
    log.warn({ err }, 'could not read the knowledge configuration; refusing every citation')
    return eligible
  }

  await Promise.all(
    citations.map(async (citation) => {
      try {
        const source = await getCustomerCitationSource(citation.type, citation.id, knowledge)
        if (source) eligible.add(citation.id)
      } catch (err) {
        log.warn(
          { err, citation_type: citation.type, citation_id: citation.id },
          'citation eligibility recheck failed; treating the source as revoked'
        )
      }
    })
  )
  return eligible
}
