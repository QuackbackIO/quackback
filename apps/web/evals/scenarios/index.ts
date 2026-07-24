/**
 * The seed golden set (QUINN-TWO-AGENT-SPEC §7.3, scenarios 1–25) plus the
 * grounding-source set (§7.6): closed-ticket summaries + changelog entries
 * (26–29) enabled via per-agent config v3 knowledge maps, and the real-time
 * get_status tool (30, Phase 3).
 */
import type { Scenario } from '../types'
import { groundingScenarios } from './grounding'
import { escalationScenarios } from './escalation'
import { safetyScenarios } from './safety'
import { voiceScenarios } from './voice'
import { roleScenarios } from './roles'
import { languageScenarios } from './language'
import { knowledgeScenarios } from './knowledge'

export const scenarios: Scenario[] = [
  ...groundingScenarios,
  ...escalationScenarios,
  ...safetyScenarios,
  ...voiceScenarios,
  ...roleScenarios,
  ...languageScenarios,
  ...knowledgeScenarios,
]
