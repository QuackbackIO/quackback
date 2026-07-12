/**
 * AI + summary sink resolvers (EVENTING-V2 WO-8d) — the system-internal,
 * always-on sinks with fixed type lists, ported from getHookTargets(). Both are
 * gated on a configured AI model: with no OpenAI client, they yield no targets
 * (exactly as the monolith did). feedback_pipeline is intentionally NOT a
 * resolver — it is invoked via its own path, never the hook-target fan-out.
 */
import { getOpenAI } from '@/lib/server/domains/ai/config'
import type { SinkResolver } from './registry'
import type { DomainEvent } from '../envelope'
import type { HookTarget } from '../hook-types'

const AI_EVENT_TYPES = new Set<string>(['post.created'])
const SUMMARY_EVENT_TYPES = new Set<string>(['post.created', 'comment.created'])

export const aiResolver: SinkResolver = {
  sink: 'ai',
  interestedIn: (type) => AI_EVENT_TYPES.has(type),
  async resolve(_event: DomainEvent): Promise<HookTarget[]> {
    if (!getOpenAI()) return []
    return [{ type: 'ai', target: { type: 'ai' }, config: {} }]
  },
}

export const summaryResolver: SinkResolver = {
  sink: 'summary',
  interestedIn: (type) => SUMMARY_EVENT_TYPES.has(type),
  async resolve(_event: DomainEvent): Promise<HookTarget[]> {
    if (!getOpenAI()) return []
    return [{ type: 'summary', target: { type: 'summary' }, config: {} }]
  },
}
