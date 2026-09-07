import { WORKSPACE_ROLE_PROMPT } from './workspace-prompt'
/**
 * Production prompt policy for every assistant role.
 *
 * This module is intentionally pure. The runtime resolves configuration,
 * context, guidance, and the actual tool set, then passes one immutable turn
 * snapshot here for ordered composition.
 */
import {
  buildAdminInstructionMessage,
  buildAttributeCatalogueMessage,
  buildBoardCatalogueMessage,
  buildTrustedContextMessage,
  type AssistantAttributeCatalogueEntry,
  type AssistantAttributeOption,
  type AssistantBoardCatalogueEntry,
} from './prompt-catalogues'
import {
  ASSISTANT_RESPONSE_LENGTH_DIRECTIVES,
  ASSISTANT_TONE_DIRECTIVES,
  roleToAgent,
  type AssistantAgentKind,
  type AssistantResponseLength,
  type AssistantRole,
  type AssistantTone,
} from '@/lib/shared/assistant/config'
import type { AssistantWriteToolPolicy } from './assistant.toolspec'
import type { AssistantSurface } from '@/lib/shared/assistant/surfaces'
import { buildPlatformPolicyMessage } from './assistant.platform-policy'

export const ASSISTANT_PROMPT_VERSION = 'support-agent-v6' as const

export type {
  AssistantAttributeCatalogueEntry,
  AssistantAttributeOption,
  AssistantBoardCatalogueEntry,
}

export type AssistantPromptRole = AssistantRole
export type AssistantPromptTone = AssistantTone
export type AssistantPromptResponseLength = AssistantResponseLength

export interface AssistantPromptConfig {
  identity: {
    name: string
  }
  voice: {
    tone: AssistantPromptTone
    responseLength: AssistantPromptResponseLength
    additionalInstructions?: string | null
  }
}

export interface AssistantPromptTool {
  /** The stable name from the tool registry. */
  name: string
  /** The model-facing guidance from the same registry entry. */
  promptGuidance: string
  risk?: 'read' | 'write' | 'control'
}

export interface AssistantPromptGuidance {
  instruction: string
  /**
   * Omitted means "applies to the resolved agent": the runtime already selects
   * candidates by agent (guidance.service.ts), so a bare instruction is
   * included. A set value is re-checked against the turn's agent here.
   */
  agent?: AssistantAgentKind
}

export interface BuildAssistantPromptInput {
  role: AssistantPromptRole
  config: AssistantPromptConfig
  /** A normalized platform value, never a name copied from a conversation. */
  workspaceName: string
  /** The actual post-policy tool set assembled for this turn. */
  tools: readonly AssistantPromptTool[]
  /** One line per enabled+assigned skill for this agent. */
  skillCatalogue?: readonly { name: string; whenToUse: string }[]
  /** Platform-resolved facts, not a conversation transcript or retrieved excerpt. */
  trustedRuntimeContext?: string | null
  /** Active customer channel. */
  channel?: string | null
  /** Deploy surface. Slack formatting rules are composed into the platform policy. */
  surface?: AssistantSurface | null
  /** Already selected guidance. Role and channel eligibility are checked again here. */
  guidance?: readonly (AssistantPromptGuidance | string)[]
  workflowInstructions?: string | null
  /** Live, non-archived definitions. Used only when set_attribute is assembled. */
  attributeCatalogue?: readonly AssistantAttributeCatalogueEntry[]
  /** Live boards. Used only when capture_feedback is assembled — its required
   *  boardId is unknowable to the model without this enumeration. */
  boardCatalogue?: readonly AssistantBoardCatalogueEntry[]
}

export interface AssistantRolePolicy {
  /** Whether customer tone, length, and global voice instructions apply. */
  customerVoice: boolean
  contentAudience: 'public' | 'team'
  /**
   * The runtime must apply this before tool assembly. Derived from the tool
   * union rather than restated, minus `simulate` — that is a runtime-only
   * override for the sandbox and is never assignable to a role.
   */
  writeToolPolicy: Exclude<AssistantWriteToolPolicy, 'simulate'>
  pipelineStep: 'assistant'
  inabilitySemantics: 'cannot_answer'
  textAudience: 'customer' | 'teammate'
  responseContract: string
  /** A concrete instance of the contract, shown to the model as a few-shot example. */
  responseExample: string
}

export interface AssistantPromptBuildResult {
  systemMessages: string[]
  rolePolicy: AssistantRolePolicy
}

const CUSTOMER_RESPONSE_CONTRACT =
  '{"text": string, "citations": [{"type": "article"|"post"|"snippet"|"summary", "id": string}]}'

const CUSTOMER_RESPONSE_EXAMPLE =
  '{"text": "You can export your workspace data from Settings under Data Export [1]. The export arrives by email as a ZIP within a few minutes.", "citations": [{"type": "article", "id": "art_01h4kxt2e8z9y3b1n72k9q5m8p"}]}'

const COPILOT_RESPONSE_CONTRACT =
  '{"text": string, "citations": [{"type": "article"|"post"|"snippet"|"summary", "id": string}], "answerType": "draft_reply"|"analysis"}'

const COPILOT_RESPONSE_EXAMPLE =
  '{"text": "Hi! Data export lives in Settings under Data Export [1]. You\'ll get a ZIP by email within a few minutes.", "citations": [{"type": "article", "id": "art_01h4kxt2e8z9y3b1n72k9q5m8p"}], "answerType": "draft_reply"}'

/** Every role must decide every behavioral axis in one compiler-checked record. */
export const ASSISTANT_ROLE_POLICIES: Readonly<Record<AssistantPromptRole, AssistantRolePolicy>> = {
  customer_support: {
    customerVoice: true,
    contentAudience: 'public',
    writeToolPolicy: 'execute',
    pipelineStep: 'assistant',
    inabilitySemantics: 'cannot_answer',
    textAudience: 'customer',
    responseContract: CUSTOMER_RESPONSE_CONTRACT,
    responseExample: CUSTOMER_RESPONSE_EXAMPLE,
  },
  workspace_assistant: {
    customerVoice: false,
    contentAudience: 'team',
    writeToolPolicy: 'propose',
    pipelineStep: 'assistant',
    inabilitySemantics: 'cannot_answer',
    textAudience: 'teammate',
    responseContract: COPILOT_RESPONSE_CONTRACT,
    responseExample: COPILOT_RESPONSE_EXAMPLE,
  },
  copilot_qa: {
    customerVoice: false,
    contentAudience: 'team',
    writeToolPolicy: 'propose',
    pipelineStep: 'assistant',
    inabilitySemantics: 'cannot_answer',
    textAudience: 'teammate',
    responseContract: COPILOT_RESPONSE_CONTRACT,
    responseExample: COPILOT_RESPONSE_EXAMPLE,
  },
}

export function resolveAssistantRolePolicy(role: AssistantPromptRole): AssistantRolePolicy {
  return ASSISTANT_ROLE_POLICIES[role]
}

function escapeElementContent(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function normalizeSystemValue(value: string, fallback: string, maxLength: number): string {
  // These values sit on trusted structural lines, so control characters must
  // not let a name create a new heading or element.
  const withoutControls = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127 ? ' ' : character
  }).join('')
  const normalized = withoutControls.replace(/\s+/g, ' ').trim()
  const bounded = normalized.slice(0, maxLength) || fallback
  return escapeElementContent(bounded)
}

export function buildAssistantRoleProfile(
  role: AssistantPromptRole,
  input: Pick<BuildAssistantPromptInput, 'config' | 'workspaceName' | 'tools'>
): string {
  const toolNames = new Set(input.tools.map((tool) => tool.name))

  switch (role) {
    case 'customer_support': {
      const assistantName = normalizeSystemValue(input.config.identity.name, 'Quinn', 80)
      const workspaceName = normalizeSystemValue(input.workspaceName, 'this workspace', 160)
      const humanSupport = toolNames.has('handoff_to_human')
        ? `- Hand off when the customer explicitly asks for a person, safety requires human judgment,
  repeated attempts have failed, or the request requires a capability you do not have.
- When frustration is building but the customer has not asked for a person, acknowledge it and
  OFFER to connect them with someone on the team instead of pressing for another clarification;
  hand off as soon as they accept.
- Do not hand off merely because one useful clarification is needed.
- When handing off, use handoff_to_human first. Include reason, customerNeed, attempted, and
  recommendedNextStep in the teammate packet. Provide the customer-facing transition only after
  the tool confirms the handoff was accepted.
- handoff_to_human IS your transfer capability: while it is listed, never tell the customer you
  cannot transfer or escalate, and never substitute an inability report for a requested handoff.`
        : `- Human support is required when the customer explicitly asks for a person, safety requires
  human judgment, repeated attempts have failed, or the request requires a capability you do
  not have. When frustration is building, acknowledge it and offer the option of a teammate.
- Do not escalate merely because one useful clarification is needed.
- If human support is required but no handoff capability is available this turn, explain that
  limitation honestly and never claim that a transfer happened.`

      return `# Active role
You are ${assistantName}, ${workspaceName}'s AI customer-support agent. You are speaking directly
with a customer.

Help the customer make progress now. Speak as the support team only when doing so does not imply a
human performed an action or made a commitment. Never pretend to be a human.

# Human support
${humanSupport}`
    }
    case 'workspace_assistant':
      return WORKSPACE_ROLE_PROMPT
    case 'copilot_qa': {
      // The propose affordance exists only when the turn actually assembled a
      // write tool; a read-only turn keeps the plain honesty rule so the model
      // is never told about a capability it cannot exercise.
      const hasWriteTools = input.tools.some((tool) => tool.risk === 'write')
      const actions = hasWriteTools
        ? `# Acting on the teammate's behalf
On this surface a write tool never executes directly: calling it files a proposal the teammate
reviews and approves before anything runs. When the teammate asks you to take an action a listed
write tool covers, call that tool — proposing through the tool is the only way to set the action
in motion; describing it in text does nothing. Report a proposed action as awaiting the
teammate's approval, report an executed action as done only when its tool result confirms it, and
never imply either happened otherwise.`
        : `Never imply that an action was performed when you only recommended it.`

      return `# Active role
You are an AI copilot assisting a support teammate who is working this conversation or ticket.
Answer the teammate directly. Do not speak to the customer unless the teammate explicitly asks for
a ready-to-send reply.

Team-visible sources may be used for analysis. Clearly distinguish verified facts, reasonable
inference, and missing information.

${actions}

Use answerType "draft_reply" only when text is ready for the teammate to send to the customer
exactly as written; otherwise use "analysis".`
    }
  }
}

function buildToolGuidanceMessage(
  role: AssistantPromptRole,
  tools: readonly AssistantPromptTool[]
): string {
  if (tools.length === 0) {
    return `# Actual available tools and operating guidance
No tools are available this turn. Answer only from trusted runtime context and the conversation,
and be explicit about anything you cannot verify or do.`
  }

  const names = new Set(tools.map((tool) => tool.name))
  const lines = [
    '# Actual available tools and operating guidance',
    'Only the tools listed below are available this turn. Follow each registry-supplied rule:',
    ...tools.map((tool) => `- ${tool.name}: ${tool.promptGuidance}`),
  ]

  if (names.has('search')) {
    lines.push(
      '- search: Search for product, pricing, policy, capability, or procedure questions not already answered by trusted runtime context. Allow one focused refinement when the first search is insufficient.'
    )
  }
  if (names.has('get_status')) {
    lines.push(
      '- get_status: Any question about current operational state — whether the service is up, degraded, in an incident, or under maintenance — must be answered from a get_status call made in THIS turn. Status changes minute to minute: never answer it from memory, the conversation, or an earlier turn. Its result carries no citation id: report the status in your text (with the statusPageUrl it returns) and add nothing to the citations array for it.'
    )
  }
  if (names.has('report_inability')) {
    lines.push(
      '- report_inability: Use it when sources remain insufficient, a required capability is absent, or essential context cannot be obtained. In particular, when your searches all came back empty and nothing else resolved the request, call it BEFORE answering. Then write a concise honest explanation.'
    )
  }
  if (names.has('handoff_to_human') && role === 'customer_support') {
    lines.push(
      '- handoff_to_human: Use it only under the active customer-support role handoff policy and provide reason, customerNeed, attempted, and recommendedNextStep. This tool decides that a handoff is needed; platform routing decides where it goes.'
    )
  }

  return lines.join('\n')
}

function buildVoiceMessage(config: AssistantPromptConfig): string {
  return `# Customer-facing voice
${ASSISTANT_TONE_DIRECTIVES[config.voice.tone]}
${ASSISTANT_RESPONSE_LENGTH_DIRECTIVES[config.voice.responseLength]}`
}

function buildGuidanceMessage(
  guidance: readonly (AssistantPromptGuidance | string)[],
  agent: AssistantAgentKind
): string | null {
  const applicable = guidance.flatMap((entry) => {
    const rule: AssistantPromptGuidance = typeof entry === 'string' ? { instruction: entry } : entry
    // A bare instruction (or one with no agent) was already filtered by the
    // runtime for this agent; a set agent is re-checked here.
    if (rule.agent !== undefined && rule.agent !== agent) return []
    const instruction = rule.instruction.trim()
    return instruction ? [instruction] : []
  })
  if (applicable.length === 0) return null

  return buildAdminInstructionMessage(
    'Situational guidance',
    'situational_guidance',
    applicable.map((instruction, index) => `${index + 1}. ${instruction}`).join('\n')
  )
}

function composeAssistantSystemMessages(
  input: BuildAssistantPromptInput,
  rolePolicy: AssistantRolePolicy
): string[] {
  const messages = [
    buildPlatformPolicyMessage(
      rolePolicy.responseContract,
      rolePolicy.responseExample,
      input.surface
    ),
    buildAssistantRoleProfile(input.role, input),
    buildToolGuidanceMessage(input.role, input.tools),
  ]

  const trustedContext = input.trustedRuntimeContext
    ? buildTrustedContextMessage(input.trustedRuntimeContext)
    : null
  if (trustedContext) messages.push(trustedContext)

  if (rolePolicy.customerVoice) {
    messages.push(buildVoiceMessage(input.config))
    const workspaceInstructions = buildAdminInstructionMessage(
      'Workspace instructions',
      'workspace_instructions',
      input.config.voice.additionalInstructions ?? ''
    )
    if (workspaceInstructions) messages.push(workspaceInstructions)
  }

  const guidance = buildGuidanceMessage(input.guidance ?? [], roleToAgent(input.role))
  if (guidance) messages.push(guidance)

  const workflowInstructions = buildAdminInstructionMessage(
    'Workflow instructions',
    'workflow_instructions',
    input.workflowInstructions ?? ''
  )
  if (workflowInstructions) messages.push(workflowInstructions)

  if (input.tools.some((tool) => tool.name === 'set_attribute')) {
    const catalogue = buildAttributeCatalogueMessage(input.attributeCatalogue ?? [])
    if (catalogue) messages.push(catalogue)
  }

  if (input.tools.some((tool) => tool.name === 'capture_feedback')) {
    const catalogue = buildBoardCatalogueMessage(input.boardCatalogue ?? [])
    if (catalogue) messages.push(catalogue)
  }

  if (input.tools.some((tool) => tool.name === 'use_skill') && input.skillCatalogue?.length) {
    const lines = input.skillCatalogue.map((skill) => `- ${skill.name}: ${skill.whenToUse}`)
    messages.push(
      `# Skills
Packaged procedures you may load on demand with use_skill. Loading a skill never grants a new tool; it only tells you how to use tools you already have. Load a skill only when its when-to-use line matches the current request.
${lines.join('\n')}`
    )
  }

  return messages
}

/** Build the immutable role policy and ordered system-message array for one turn. */
export function buildAssistantPrompt(input: BuildAssistantPromptInput): AssistantPromptBuildResult {
  const rolePolicy = resolveAssistantRolePolicy(input.role)
  return {
    rolePolicy,
    systemMessages: composeAssistantSystemMessages(input, rolePolicy),
  }
}

/** Convenience for runtimes that consume only TanStack AI's system prompt array. */
export function buildAssistantSystemMessages(input: BuildAssistantPromptInput): string[] {
  return buildAssistantPrompt(input).systemMessages
}
