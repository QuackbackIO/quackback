import { queryOptions } from '@tanstack/react-query'
import { getAssistantSettingsFn } from '@/lib/server/functions/assistant-settings'
import {
  listGuidanceRulesFn,
  listAssistantToolsFn,
} from '@/lib/server/functions/assistant-guidance'
import { getGuidanceRuleStatsFn } from '@/lib/server/functions/assistant-guidance-stats'

const STALE_TIME = 30 * 1000
// The tool catalogue only changes when a connector is enabled/disabled, so it
// can sit stale far longer than the settings a teammate is actively editing.
const TOOLS_STALE_TIME = 5 * 60 * 1000

export const assistantKeys = {
  settings: () => ['assistant', 'settings'] as const,
  guidanceRules: () => ['assistant', 'guidanceRules'] as const,
  guidanceRuleStats: () => ['assistant', 'guidanceRuleStats'] as const,
  tools: () => ['assistant', 'tools'] as const,
}

/** Assistant customization settings queries: tool controls, surface instructions, the Basics preset, guidance rules, and the tool catalogue. */
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

  /** Per-rule Used/Resolved % effectiveness stats, keyed by guidance rule id. */
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
}
