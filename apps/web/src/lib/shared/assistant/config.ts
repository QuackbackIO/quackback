import { z } from 'zod'

export const ASSISTANT_CONFIG_VERSION = 3 as const
export const ASSISTANT_NAME_MAX_LENGTH = 80
export const ASSISTANT_AVATAR_URL_MAX_LENGTH = 2_000
export const ASSISTANT_ADDITIONAL_INSTRUCTIONS_MAX_LENGTH = 2_000

export const ASSISTANT_TONES = ['warm', 'balanced', 'professional'] as const
export const ASSISTANT_RESPONSE_LENGTHS = ['brief', 'balanced', 'detailed'] as const

export const assistantToneSchema = z.enum(ASSISTANT_TONES)
export const assistantResponseLengthSchema = z.enum(ASSISTANT_RESPONSE_LENGTHS)

export type AssistantTone = z.infer<typeof assistantToneSchema>
export type AssistantResponseLength = z.infer<typeof assistantResponseLengthSchema>

function isHttpUrl(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code <= 0x20 || code === 0x7f) return false
  }

  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export const assistantAvatarUrlSchema = z
  .string()
  .trim()
  .url()
  .max(ASSISTANT_AVATAR_URL_MAX_LENGTH)
  .refine(isHttpUrl, { message: 'Avatar URL must use HTTP or HTTPS' })

export const assistantIdentitySchema = z.object({
  name: z.string().trim().min(1).max(ASSISTANT_NAME_MAX_LENGTH),
  avatarUrl: assistantAvatarUrlSchema.nullable(),
})

export const assistantVoiceSchema = z.object({
  tone: assistantToneSchema,
  responseLength: assistantResponseLengthSchema,
  additionalInstructions: z.string().max(ASSISTANT_ADDITIONAL_INSTRUCTIONS_MAX_LENGTH),
})

/**
 * The two peer agents Quinn drives (D3/D4). A guidance rule, a knowledge map,
 * and every runtime resolution belong to exactly one of these. `roleToAgent`
 * below is the single, exhaustive mint point that maps a pipeline role onto
 * one of these — callers never re-derive it from a role literal (C3).
 */
export const ASSISTANT_AGENTS = ['agent', 'copilot'] as const
export const assistantAgentSchema = z.enum(ASSISTANT_AGENTS)
export type AssistantAgentKind = z.infer<typeof assistantAgentSchema>

/**
 * Per-source knowledge toggles, one const array per agent so the vocabulary
 * lives in exactly one place (C2). The Agent tab never offers team-scoped
 * sources (D8: no tickets/pastConversations/internalNotes), so its list is a
 * strict subset — not the same array narrowed.
 */
export const ASSISTANT_AGENT_KNOWLEDGE_SOURCES = [
  'helpCenter',
  'posts',
  'changelog',
  'status',
] as const
export const ASSISTANT_COPILOT_KNOWLEDGE_SOURCES = [
  'helpCenter',
  'posts',
  'pastConversations',
  'internalNotes',
  'tickets',
  'changelog',
  'status',
] as const

export type AssistantAgentKnowledgeSource = (typeof ASSISTANT_AGENT_KNOWLEDGE_SOURCES)[number]
export type AssistantCopilotKnowledgeSource = (typeof ASSISTANT_COPILOT_KNOWLEDGE_SOURCES)[number]

// The `satisfies Record<...Source, z.ZodBoolean>` constraints tie each schema's
// keys to its vocabulary array (C2): add a source to the array without a schema
// field here (or a field without an array entry) and this stops typechecking.
export const assistantAgentKnowledgeSchema = z.object({
  helpCenter: z.boolean(),
  posts: z.boolean(),
  changelog: z.boolean(),
  status: z.boolean(),
} satisfies Record<AssistantAgentKnowledgeSource, z.ZodBoolean>)
export const assistantCopilotKnowledgeSchema = z.object({
  helpCenter: z.boolean(),
  posts: z.boolean(),
  pastConversations: z.boolean(),
  internalNotes: z.boolean(),
  tickets: z.boolean(),
  changelog: z.boolean(),
  status: z.boolean(),
} satisfies Record<AssistantCopilotKnowledgeSource, z.ZodBoolean>)

/** Copilot capabilities gate the two teammate-facing routes (Q&A, suggested drafts). */
export const assistantCopilotCapabilitiesSchema = z.object({
  qa: z.boolean(),
  suggestedReplies: z.boolean(),
})

/** Agent (customer-facing) sub-config: owns voice (D11) and its knowledge map. */
export const assistantAgentConfigSchema = z.object({
  voice: assistantVoiceSchema,
  knowledge: assistantAgentKnowledgeSchema,
})

/** Copilot (teammate-facing) sub-config: capabilities + a wider knowledge map, no voice (D11). */
export const assistantCopilotConfigSchema = z.object({
  capabilities: assistantCopilotCapabilitiesSchema,
  knowledge: assistantCopilotKnowledgeSchema,
})

// The z.infer of this schema (`AssistantConfig`) has a hand-written structural
// twin, `StoredAssistantConfig`, in packages/db `schema/auth.ts` (that package
// can't import this one). A drift tripwire in `__tests__/config.test.ts` fails
// typecheck if the two diverge — edit both sides together.
export const assistantConfigSchema = z.object({
  version: z.literal(ASSISTANT_CONFIG_VERSION),
  identity: assistantIdentitySchema,
  agents: z.object({
    agent: assistantAgentConfigSchema,
    copilot: assistantCopilotConfigSchema,
  }),
})

export type AssistantIdentity = z.infer<typeof assistantIdentitySchema>
export type AssistantVoice = z.infer<typeof assistantVoiceSchema>
export type AssistantAgentKnowledge = z.infer<typeof assistantAgentKnowledgeSchema>
export type AssistantCopilotKnowledge = z.infer<typeof assistantCopilotKnowledgeSchema>
export type AssistantCopilotCapabilities = z.infer<typeof assistantCopilotCapabilitiesSchema>
export type AssistantAgentConfig = z.infer<typeof assistantAgentConfigSchema>
export type AssistantCopilotConfig = z.infer<typeof assistantCopilotConfigSchema>
export type AssistantConfig = z.infer<typeof assistantConfigSchema>

export const DEFAULT_ASSISTANT_CONFIG: AssistantConfig = {
  version: ASSISTANT_CONFIG_VERSION,
  identity: {
    name: 'Quinn',
    avatarUrl: null,
  },
  agents: {
    agent: {
      voice: {
        tone: 'balanced',
        responseLength: 'balanced',
        additionalInstructions: '',
      },
      knowledge: {
        helpCenter: true,
        posts: false,
        changelog: false,
        status: false,
      },
    },
    copilot: {
      capabilities: {
        qa: true,
        suggestedReplies: true,
      },
      knowledge: {
        helpCenter: true,
        posts: true,
        pastConversations: true,
        internalNotes: true,
        tickets: false,
        changelog: false,
        status: true,
      },
    },
  },
}

export interface AssistantPresetDefinition<Value extends string> {
  id: Value
  labelMessageId: string
  descriptionMessageId: string
  directive: string
}

type AssistantPresetCatalogue<Value extends string> = {
  readonly [Preset in Value]: AssistantPresetDefinition<Preset>
}

export const ASSISTANT_TONE_CATALOGUE = {
  warm: {
    id: 'warm',
    labelMessageId: 'assistant.voice.tone.warm.label',
    descriptionMessageId: 'assistant.voice.tone.warm.description',
    directive:
      'Use a warm, approachable tone. Be empathetic without over-apologizing or sounding overly enthusiastic.',
  },
  balanced: {
    id: 'balanced',
    labelMessageId: 'assistant.voice.tone.balanced.label',
    descriptionMessageId: 'assistant.voice.tone.balanced.description',
    directive:
      'Use a clear, calm, natural tone. Be friendly without adding unnecessary enthusiasm or formality.',
  },
  professional: {
    id: 'professional',
    labelMessageId: 'assistant.voice.tone.professional.label',
    descriptionMessageId: 'assistant.voice.tone.professional.description',
    directive:
      'Use a polished, professional tone. Stay natural and direct; do not sound legalistic or impersonal.',
  },
} as const satisfies AssistantPresetCatalogue<AssistantTone>

export const ASSISTANT_RESPONSE_LENGTH_CATALOGUE = {
  brief: {
    id: 'brief',
    labelMessageId: 'assistant.voice.responseLength.brief.label',
    descriptionMessageId: 'assistant.voice.responseLength.brief.description',
    directive:
      'Prefer the shortest complete answer. Usually use one short paragraph or a compact list.',
  },
  balanced: {
    id: 'balanced',
    labelMessageId: 'assistant.voice.responseLength.balanced.label',
    descriptionMessageId: 'assistant.voice.responseLength.balanced.description',
    directive:
      'Give enough context to make the answer clear, then state the next step. Avoid unnecessary detail.',
  },
  detailed: {
    id: 'detailed',
    labelMessageId: 'assistant.voice.responseLength.detailed.label',
    descriptionMessageId: 'assistant.voice.responseLength.detailed.description',
    directive:
      'Give a fuller explanation and ordered steps when the request benefits from them. Do not add detail unrelated to the request.',
  },
} as const satisfies AssistantPresetCatalogue<AssistantResponseLength>

export const ASSISTANT_TONE_DIRECTIVES: Record<AssistantTone, string> = {
  warm: ASSISTANT_TONE_CATALOGUE.warm.directive,
  balanced: ASSISTANT_TONE_CATALOGUE.balanced.directive,
  professional: ASSISTANT_TONE_CATALOGUE.professional.directive,
}

export const ASSISTANT_RESPONSE_LENGTH_DIRECTIVES: Record<AssistantResponseLength, string> = {
  brief: ASSISTANT_RESPONSE_LENGTH_CATALOGUE.brief.directive,
  balanced: ASSISTANT_RESPONSE_LENGTH_CATALOGUE.balanced.directive,
  detailed: ASSISTANT_RESPONSE_LENGTH_CATALOGUE.detailed.directive,
}

export const ASSISTANT_ROLES = ['customer_support', 'copilot_qa', 'suggested_reply'] as const
export const assistantRoleSchema = z.enum(ASSISTANT_ROLES)
export type AssistantRole = z.infer<typeof assistantRoleSchema>

export interface AssistantRoleDefinition {
  id: AssistantRole
  labelMessageId: string
  descriptionMessageId: string
}

export type AssistantRoleCatalogue = {
  readonly [Role in AssistantRole]: AssistantRoleDefinition & {
    readonly id: Role
  }
}

export const ASSISTANT_ROLE_CATALOGUE = {
  customer_support: {
    id: 'customer_support',
    labelMessageId: 'assistant.role.customerSupport.label',
    descriptionMessageId: 'assistant.role.customerSupport.description',
  },
  copilot_qa: {
    id: 'copilot_qa',
    labelMessageId: 'assistant.role.copilotQa.label',
    descriptionMessageId: 'assistant.role.copilotQa.description',
  },
  suggested_reply: {
    id: 'suggested_reply',
    labelMessageId: 'assistant.role.suggestedReply.label',
    descriptionMessageId: 'assistant.role.suggestedReply.description',
  },
} as const satisfies AssistantRoleCatalogue

/**
 * The sole, exhaustive mint point mapping a pipeline role onto its owning agent
 * (C3): the customer-facing roles (support + the suggested-reply draft path,
 * which uses the Agent's voice per D9) resolve to `agent`; the teammate-facing
 * Q&A role resolves to `copilot`. Runtime voice/knowledge/guidance resolution
 * all funnel through this rather than re-deriving the split from a role literal.
 */
export function roleToAgent(role: AssistantRole): AssistantAgentKind {
  switch (role) {
    case 'customer_support':
    case 'suggested_reply':
      return 'agent'
    case 'copilot_qa':
      return 'copilot'
    default: {
      const exhaustive: never = role
      throw new Error(`roleToAgent: unhandled assistant role "${exhaustive}"`)
    }
  }
}

/** Removes unsafe ASCII controls without changing meaningful customer-authored text. */
export function normalizeAssistantText(value: string): string {
  const characters: string[] = []

  for (const character of value) {
    const code = character.charCodeAt(0)
    const isRemovedControl = (code < 0x20 && code !== 0x09 && code !== 0x0a) || code === 0x7f
    if (!isRemovedControl) characters.push(character)
  }

  return characters.join('').trim()
}

const assistantConfigInputSchema = z.object({
  version: z.literal(ASSISTANT_CONFIG_VERSION),
  identity: z.object({
    name: z.string(),
    avatarUrl: z.string().nullable(),
  }),
  agents: z.object({
    agent: z.object({
      voice: z.object({
        tone: assistantToneSchema,
        responseLength: assistantResponseLengthSchema,
        additionalInstructions: z.string(),
      }),
      knowledge: assistantAgentKnowledgeSchema,
    }),
    copilot: z.object({
      capabilities: assistantCopilotCapabilitiesSchema,
      knowledge: assistantCopilotKnowledgeSchema,
    }),
  }),
})

/** Normalizes a complete V3 input, then validates every persisted boundary. */
export function normalizeAssistantConfig(input: unknown): AssistantConfig {
  const parsed = assistantConfigInputSchema.parse(input)

  return assistantConfigSchema.parse({
    ...parsed,
    identity: {
      ...parsed.identity,
      name: normalizeAssistantText(parsed.identity.name),
    },
    agents: {
      ...parsed.agents,
      agent: {
        ...parsed.agents.agent,
        voice: {
          ...parsed.agents.agent.voice,
          additionalInstructions: normalizeAssistantText(
            parsed.agents.agent.voice.additionalInstructions
          ),
        },
      },
    },
  })
}
