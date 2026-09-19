import { queryOptions } from '@tanstack/react-query'
import { getAssistantSettingsFn } from '@/lib/server/functions/assistant-settings'
import {
  listGuidanceRulesFn,
  listAssistantToolsFn,
} from '@/lib/server/functions/assistant-guidance'
import { getGuidanceRuleStatsFn } from '@/lib/server/functions/assistant-guidance-stats'
import { listGuidanceEntriesFn } from '@/lib/server/functions/assistant-guidance-entries'
import { getAssistantReleaseStateFn } from '@/lib/server/functions/assistant-releases'
import { getAssistantEmailChannelFn } from '@/lib/server/functions/assistant-channels'

const STALE_TIME = 30 * 1000
// The tool catalogue is static, so it can sit stale far longer than settings
// a teammate is actively editing.
const TOOLS_STALE_TIME = 5 * 60 * 1000

export const assistantKeys = {
  settings: () => ['assistant', 'settings'] as const,
  guidanceRules: () => ['assistant', 'guidanceRules'] as const,
  guidanceEntries: () => ['assistant', 'guidanceEntries'] as const,
  guidanceRuleStats: () => ['assistant', 'guidanceRuleStats'] as const,
  tools: () => ['assistant', 'tools'] as const,
  releaseState: () => ['assistant', 'releaseState'] as const,
  emailChannel: () => ['assistant', 'emailChannel'] as const,
}

/** AI agent settings, guidance, and action-catalogue queries. */
export const assistantQueries = {
  settings: () =>
    queryOptions({
      queryKey: assistantKeys.settings(),
      queryFn: getAssistantSettingsFn,
      staleTime: STALE_TIME,
    }),

  guidanceRules: () =>
    queryOptions({
      queryKey: assistantKeys.guidanceRules(),
      queryFn: listGuidanceRulesFn,
      staleTime: STALE_TIME,
    }),

  /** Canonical authored guidance with its role bindings resolved. */
  guidanceEntries: () =>
    queryOptions({
      queryKey: assistantKeys.guidanceEntries(),
      queryFn: listGuidanceEntriesFn,
      staleTime: STALE_TIME,
    }),

  /** Honest per-rule Applied count and last-applied timestamp, keyed by rule id. */
  guidanceRuleStats: () =>
    queryOptions({
      queryKey: assistantKeys.guidanceRuleStats(),
      queryFn: getGuidanceRuleStatsFn,
      staleTime: STALE_TIME,
    }),

  tools: () =>
    queryOptions({
      queryKey: assistantKeys.tools(),
      queryFn: listAssistantToolsFn,
      staleTime: TOOLS_STALE_TIME,
    }),

  /**
   * Draft, live, evidence and gate. Never cached: the whole point is to show
   * whether the evidence still belongs to the candidate in front of you.
   */
  releaseState: () =>
    queryOptions({
      queryKey: assistantKeys.releaseState(),
      queryFn: getAssistantReleaseStateFn,
      staleTime: 0,
    }),

  emailChannel: () =>
    queryOptions({
      queryKey: assistantKeys.emailChannel(),
      queryFn: getAssistantEmailChannelFn,
      staleTime: STALE_TIME,
    }),
}
