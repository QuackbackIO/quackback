/**
 * The seed golden set (QUINN-TWO-AGENT-SPEC §7.3, scenarios 1–25) plus the
 * Phase 4 grounding-source set (§7.6, scenarios 26–29): closed-ticket summaries
 * and changelog entries behind the `assistantKnowledge` flag.
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
