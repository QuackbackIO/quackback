import { describe, expect, it } from 'vitest'
import type { StoredAssistantConfig } from '@/lib/shared/db-types'
import {
  ASSISTANT_ADDITIONAL_INSTRUCTIONS_MAX_LENGTH,
  ASSISTANT_AVATAR_URL_MAX_LENGTH,
  ASSISTANT_NAME_MAX_LENGTH,
  ASSISTANT_RESPONSE_LENGTH_CATALOGUE,
  ASSISTANT_RESPONSE_LENGTH_DIRECTIVES,
  ASSISTANT_RESPONSE_LENGTHS,
  ASSISTANT_ROLE_CATALOGUE,
  ASSISTANT_ROLES,
  ASSISTANT_TONE_CATALOGUE,
  ASSISTANT_TONE_DIRECTIVES,
  ASSISTANT_TONES,
  ASSISTANT_AGENTS,
  DEFAULT_ASSISTANT_CONFIG,
  assistantConfigSchema,
  assistantRoleSchema,
  normalizeAssistantConfig,
  normalizeAssistantText,
  roleToAgent,
  type AssistantConfig,
} from '../config'

function validConfig(): AssistantConfig {
  return structuredClone(DEFAULT_ASSISTANT_CONFIG)
}

// ── Drift tripwire ─────────────────────────────────────────────────────────
// `StoredAssistantConfig` (packages/db `schema/auth.ts`) is a hand-written
// structural twin of `AssistantConfig` because packages/db can't import this
// schema. It intentionally widens the schema's enum/literal types to plain
// string/number, so plain `Equal<AssistantConfig, StoredAssistantConfig>` would
// (correctly) fail. We normalize that deliberate widening with `DeepWiden` and
// then assert exact structural equality: any added/removed/renamed/re-nested
// field on either side breaks typecheck until both twins are updated together.
type DeepWiden<T> = T extends null
  ? null
  : T extends boolean
    ? boolean
    : T extends string
      ? string
      : T extends number
        ? number
        : { [K in keyof T]: DeepWiden<T[K]> }

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false
type Expect<T extends true> = T

// If this line errors, the two twins have drifted — reconcile config.ts and
// packages/db `schema/auth.ts`.
type _AssistantConfigTwinsAgree = Expect<Equal<DeepWiden<AssistantConfig>, StoredAssistantConfig>>
// Reference the alias so it isn't flagged as unused; the assertion is the type
// above, this just keeps it live.
const _assistantConfigTwinsAgree: _AssistantConfigTwinsAgree = true

describe('assistantConfigSchema', () => {
  it('accepts and preserves the V3 default', () => {
    expect(assistantConfigSchema.parse(DEFAULT_ASSISTANT_CONFIG)).toEqual({
      version: 3,
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
          knowledge: { helpCenter: true, posts: false, changelog: false, status: false },
        },
        copilot: {
          capabilities: { qa: true },
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
    })
  })

  it('rejects a V2-shaped config (strict reader accepts only v3)', () => {
    expect(
      assistantConfigSchema.safeParse({
        version: 2,
        identity: { name: 'Quinn', avatarUrl: null },
        voice: { tone: 'balanced', responseLength: 'balanced', additionalInstructions: '' },
      }).success
    ).toBe(false)
  })

  it('enforces the assistant name boundaries after trimming', () => {
    const minimum = validConfig()
    minimum.identity.name = ' Q '
    expect(assistantConfigSchema.parse(minimum).identity.name).toBe('Q')

    const maximum = validConfig()
    maximum.identity.name = ` ${'a'.repeat(ASSISTANT_NAME_MAX_LENGTH)} `
    expect(assistantConfigSchema.parse(maximum).identity.name).toHaveLength(
      ASSISTANT_NAME_MAX_LENGTH
    )

    for (const name of ['', '   ', 'a'.repeat(ASSISTANT_NAME_MAX_LENGTH + 1)]) {
      const config = validConfig()
      config.identity.name = name
      expect(assistantConfigSchema.safeParse(config).success).toBe(false)
    }
  })

  it('enforces the global instruction maximum', () => {
    const maximum = validConfig()
    maximum.agents.agent.voice.additionalInstructions = 'a'.repeat(
      ASSISTANT_ADDITIONAL_INSTRUCTIONS_MAX_LENGTH
    )
    expect(assistantConfigSchema.safeParse(maximum).success).toBe(true)

    const globalOver = validConfig()
    globalOver.agents.agent.voice.additionalInstructions = 'a'.repeat(
      ASSISTANT_ADDITIONAL_INSTRUCTIONS_MAX_LENGTH + 1
    )
    expect(assistantConfigSchema.safeParse(globalOver).success).toBe(false)
  })

  it('accepts every tone and response length value', () => {
    for (const tone of ASSISTANT_TONES) {
      const config = validConfig()
      config.agents.agent.voice.tone = tone
      expect(assistantConfigSchema.safeParse(config).success).toBe(true)
    }

    for (const responseLength of ASSISTANT_RESPONSE_LENGTHS) {
      const config = validConfig()
      config.agents.agent.voice.responseLength = responseLength
      expect(assistantConfigSchema.safeParse(config).success).toBe(true)
    }
  })

  it('rejects unknown versions and presets', () => {
    expect(assistantConfigSchema.safeParse({ ...validConfig(), version: 1 }).success).toBe(false)

    const badTone = validConfig()
    ;(badTone.agents.agent.voice as { tone: string }).tone = 'casual'
    expect(assistantConfigSchema.safeParse(badTone).success).toBe(false)

    const badLength = validConfig()
    ;(badLength.agents.agent.voice as { responseLength: string }).responseLength = 'unlimited'
    expect(assistantConfigSchema.safeParse(badLength).success).toBe(false)
  })
})

describe('avatar URL policy', () => {
  it('accepts null and trimmed HTTP(S) URLs', () => {
    for (const avatarUrl of [
      null,
      ' http://example.com/avatar.png ',
      'https://cdn.example.com/avatar.webp?size=80',
      'HTTPS://EXAMPLE.COM/avatar.png',
    ]) {
      const config = validConfig()
      config.identity.avatarUrl = avatarUrl
      const result = assistantConfigSchema.safeParse(config)
      expect(result.success).toBe(true)
      if (result.success && avatarUrl !== null) {
        expect(result.data.identity.avatarUrl).toBe(avatarUrl.trim())
      }
    }
  })

  it('rejects non-HTTP, relative, malformed, empty, and internally controlled URLs', () => {
    for (const avatarUrl of [
      '',
      '/avatar.png',
      'ftp://example.com/avatar.png',
      'data:image/png;base64,AAAA',
      'javascript:alert(1)',
      'mailto:support@example.com',
      'https://',
      'https://exa\nmple.com/avatar.png',
    ]) {
      const config = validConfig()
      config.identity.avatarUrl = avatarUrl
      expect(assistantConfigSchema.safeParse(config).success, avatarUrl).toBe(false)
    }
  })

  it('enforces the 2,000-character URL boundary', () => {
    const prefix = 'https://example.com/'
    const atLimit = `${prefix}${'a'.repeat(ASSISTANT_AVATAR_URL_MAX_LENGTH - prefix.length)}`
    const maximum = validConfig()
    maximum.identity.avatarUrl = atLimit
    expect(atLimit).toHaveLength(ASSISTANT_AVATAR_URL_MAX_LENGTH)
    expect(assistantConfigSchema.safeParse(maximum).success).toBe(true)

    const overLimit = validConfig()
    overLimit.identity.avatarUrl = `${atLimit}a`
    expect(assistantConfigSchema.safeParse(overLimit).success).toBe(false)
  })
})

describe('assistant configuration normalization', () => {
  it('removes every ASCII control except tab and newline, then trims external whitespace', () => {
    const removedControls = [
      ...Array.from({ length: 9 }, (_, code) => String.fromCharCode(code)),
      String.fromCharCode(11),
      String.fromCharCode(12),
      ...Array.from({ length: 19 }, (_, index) => String.fromCharCode(index + 13)),
      String.fromCharCode(127),
    ].join('')

    expect(normalizeAssistantText(` \t\nAlpha${removedControls}\tBeta\n `)).toBe(`Alpha\tBeta`)
  })

  it('normalizes names and instructions while preserving internal newlines, Unicode, and RTL text', () => {
    const input = validConfig()
    input.identity.name = ' \u0000Quinn وكيل\u007f '
    input.agents.agent.voice.additionalInstructions =
      ' \u0001Use café ☕.\r\nاكتب بالعربية.\nכתוב בעברית.\u001f '

    expect(normalizeAssistantConfig(input)).toMatchObject({
      identity: { name: 'Quinn وكيل' },
      agents: {
        agent: {
          voice: {
            additionalInstructions: 'Use café ☕.\nاكتب بالعربية.\nכתוב בעברית.',
          },
        },
      },
    })
  })

  it('is pure and also trims an avatar URL', () => {
    const input = validConfig()
    input.identity.avatarUrl = ' https://example.com/avatar.png '
    input.agents.agent.voice.additionalInstructions = '  Keep this concise.  '
    const before = structuredClone(input)

    const normalized = normalizeAssistantConfig(input)

    expect(input).toEqual(before)
    expect(normalized).not.toBe(input)
    expect(normalized.identity.avatarUrl).toBe('https://example.com/avatar.png')
    expect(normalized.agents.agent.voice.additionalInstructions).toBe('Keep this concise.')
  })

  it('rejects normalized values over every limit rather than truncating them', () => {
    const cases: Array<[string, (config: AssistantConfig) => void]> = [
      [
        'name',
        (config) => {
          config.identity.name = 'n'.repeat(ASSISTANT_NAME_MAX_LENGTH + 1)
        },
      ],
      [
        'avatar URL',
        (config) => {
          const prefix = 'https://example.com/'
          config.identity.avatarUrl = `${prefix}${'a'.repeat(
            ASSISTANT_AVATAR_URL_MAX_LENGTH + 1 - prefix.length
          )}`
        },
      ],
      [
        'global instructions',
        (config) => {
          config.agents.agent.voice.additionalInstructions = 'g'.repeat(
            ASSISTANT_ADDITIONAL_INSTRUCTIONS_MAX_LENGTH + 1
          )
        },
      ],
    ]

    for (const [label, change] of cases) {
      const config = validConfig()
      change(config)
      expect(() => normalizeAssistantConfig(config), label).toThrow()
    }
  })
})

describe('voice preset catalogues', () => {
  it('exhaustively catalogues every preset with stable copy IDs and directives', () => {
    expect(Object.keys(ASSISTANT_TONE_CATALOGUE)).toEqual([...ASSISTANT_TONES])
    expect(Object.keys(ASSISTANT_RESPONSE_LENGTH_CATALOGUE)).toEqual([
      ...ASSISTANT_RESPONSE_LENGTHS,
    ])

    const messageIds = new Set<string>()
    for (const tone of ASSISTANT_TONES) {
      const preset = ASSISTANT_TONE_CATALOGUE[tone]
      expect(preset.id).toBe(tone)
      expect(preset.directive).toBe(ASSISTANT_TONE_DIRECTIVES[tone])
      messageIds.add(preset.labelMessageId)
      messageIds.add(preset.descriptionMessageId)
    }
    for (const responseLength of ASSISTANT_RESPONSE_LENGTHS) {
      const preset = ASSISTANT_RESPONSE_LENGTH_CATALOGUE[responseLength]
      expect(preset.id).toBe(responseLength)
      expect(preset.directive).toBe(ASSISTANT_RESPONSE_LENGTH_DIRECTIVES[responseLength])
      messageIds.add(preset.labelMessageId)
      messageIds.add(preset.descriptionMessageId)
    }

    expect(messageIds.size).toBe((ASSISTANT_TONES.length + ASSISTANT_RESPONSE_LENGTHS.length) * 2)
  })

  it('uses the normative prompt directives', () => {
    expect(ASSISTANT_TONE_DIRECTIVES).toEqual({
      warm: "Use a warm, approachable tone: write in the first person, use contractions, and acknowledge how the customer feels before getting to the answer ('I can see how frustrating that is'). Stay genuine — no over-apologizing, no forced enthusiasm.",
      balanced:
        'Use a clear, calm, natural tone. Be friendly without adding unnecessary enthusiasm or formality.',
      professional:
        'Use a polished, professional tone: structured, direct sentences with no exclamation marks, no small talk, and feelings acknowledged at most once, briefly. Stay natural — never legalistic or robotic.',
    })
    expect(ASSISTANT_RESPONSE_LENGTH_DIRECTIVES).toEqual({
      brief:
        'Keep replies short: 1-3 sentences, or a compact list when steps are unavoidable. No preamble, no recap of the question, no closing filler — lead with the answer and stop.',
      balanced:
        'Give enough context to make the answer clear, then state the next step. Avoid unnecessary detail.',
      detailed:
        'Give a thorough answer: a one-line framing of the situation, ordered steps where applicable, and the relevant caveats, alternatives, or what-to-expect-next. Prefer completeness over brevity, but never pad with detail unrelated to the request.',
    })
  })
})

describe('assistant role catalogue', () => {
  it('is exhaustive and accepted by the role schema', () => {
    expect(Object.keys(ASSISTANT_ROLE_CATALOGUE)).toEqual([...ASSISTANT_ROLES])

    for (const role of ASSISTANT_ROLES) {
      expect(assistantRoleSchema.parse(role)).toBe(role)
      expect(ASSISTANT_ROLE_CATALOGUE[role].id).toBe(role)
    }
    expect(assistantRoleSchema.safeParse('other').success).toBe(false)
  })

  it('provides stable localized catalogue IDs for every role', () => {
    for (const role of ASSISTANT_ROLES) {
      expect(ASSISTANT_ROLE_CATALOGUE[role].labelMessageId).toContain('assistant.role.')
      expect(ASSISTANT_ROLE_CATALOGUE[role].descriptionMessageId).toContain('assistant.role.')
    }
  })
})

describe('roleToAgent', () => {
  it('maps customer-facing roles to the Agent and copilot_qa to the Copilot (D9)', () => {
    expect(roleToAgent('customer_support')).toBe('agent')
    expect(roleToAgent('copilot_qa')).toBe('copilot')
  })

  it('resolves every role to a known agent kind', () => {
    for (const role of ASSISTANT_ROLES) {
      expect(ASSISTANT_AGENTS).toContain(roleToAgent(role))
    }
  })
})

describe('v3 per-agent sub-config', () => {
  it("defaults the Agent's knowledge to help-center only and Copilot to the wider team set", () => {
    expect(DEFAULT_ASSISTANT_CONFIG.agents.agent.knowledge).toEqual({
      helpCenter: true,
      posts: false,
      changelog: false,
      status: false,
    })
    expect(DEFAULT_ASSISTANT_CONFIG.agents.copilot.knowledge).toEqual({
      helpCenter: true,
      posts: true,
      pastConversations: true,
      internalNotes: true,
      tickets: false,
      changelog: false,
      status: true,
    })
    expect(DEFAULT_ASSISTANT_CONFIG.agents.copilot.capabilities).toEqual({
      qa: true,
    })
  })

  it('rejects a config missing a knowledge source key or capability', () => {
    const missingKnowledge = structuredClone(DEFAULT_ASSISTANT_CONFIG)
    delete (missingKnowledge.agents.agent.knowledge as { helpCenter?: boolean }).helpCenter
    expect(assistantConfigSchema.safeParse(missingKnowledge).success).toBe(false)

    const missingCapability = structuredClone(DEFAULT_ASSISTANT_CONFIG)
    delete (missingCapability.agents.copilot.capabilities as { qa?: boolean }).qa
    expect(assistantConfigSchema.safeParse(missingCapability).success).toBe(false)
  })
})
