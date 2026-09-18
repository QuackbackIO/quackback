/**
 * Built-in conversation inactivity settings. Stored in the settings.metadata
 * bag under `conversationInactivity` (no dedicated column). A workspace that
 * never saved this key still gets the defaults so idle threads close without
 * installing a workflow.
 */
import { z } from 'zod'

export const DEFAULT_ASSISTANT_CLOSING_MESSAGE =
  'This conversation has been closed. Reply any time if you still need help.'

export const DEFAULT_ASSISTANT_FOLLOW_UP_MESSAGE =
  'Did that answer your question? Reply here if you still need help.'

export const DEFAULT_MESSENGER_CHECK_IN_MESSAGE =
  "Still need a hand? Just reply here and we'll pick it back up."

export const DEFAULT_MESSENGER_CLOSING_MESSAGE =
  'This conversation has been closed. Reply any time if you still need help.'

export type InactivityMode = 'built_in' | 'custom' | 'off'
export type FollowUpPurpose = 'check_resolution' | 'offer_human_help'
export interface IndependentActions {
  followUpEnabled?: boolean
  closeEnabled?: boolean
  followUpMessage?: string
  closingMessage?: string
  followUpPurpose?: FollowUpPurpose
  closeWhenAnswered?: boolean
  closeWhenUnanswered?: boolean
}

export interface AssistantEmailInactivitySettings extends IndependentActions {
  /** Null disables the follow-up email while leaving auto-close on. */
  checkInHours: number | null
  closeHours: number
}

export interface AssistantInactivitySettings extends IndependentActions {
  enabled: boolean
  checkInMinutes: number
  closeMinutes: number
  closeWhenAnswered: boolean
  closeWhenUnanswered: boolean
  closingMessage: string
  email: AssistantEmailInactivitySettings
}

/** Quinn inactivity clocks are split: chat is minutes, email is hours. */
export type AssistantInactivityGroup = 'messenger' | 'email'

export interface AssistantInactivityWindows {
  /** Null when the follow-up for that group is off. */
  checkInMs: number | null
  closeMs: number
}

export interface MessengerInactivitySettings extends IndependentActions {
  enabled: boolean
  /** Null disables the check-in while leaving auto-close on. */
  checkInMinutes: number | null
  closeMinutes: number
  closingMessage: string
}

export interface EmailInactivitySettings extends IndependentActions {
  enabled: boolean
  /** Null disables the check-in (the default — a nudge would be an email). */
  checkInHours: number | null
  closeHours: number
}

export interface ConversationInactivitySettings {
  publishedWorkflows?: Array<{ id: string; name: string; channels: AssistantInactivityGroup[] }>
  version?: 2
  revision?: number
  channels?: Record<AssistantInactivityGroup, InactivityMode>
  assistant: AssistantInactivitySettings
  messenger: MessengerInactivitySettings
  email: EmailInactivitySettings
}

export const DEFAULT_CONVERSATION_INACTIVITY: ConversationInactivitySettings = {
  version: 2,
  revision: 0,
  channels: { messenger: 'built_in', email: 'built_in' },
  assistant: {
    enabled: true,
    checkInMinutes: 5,
    closeMinutes: 15,
    closeWhenAnswered: true,
    closeWhenUnanswered: true,
    closingMessage: DEFAULT_ASSISTANT_CLOSING_MESSAGE,
    email: {
      checkInHours: 24,
      closeHours: 72,
      closeWhenAnswered: true,
      closeWhenUnanswered: true,
      closingMessage: DEFAULT_ASSISTANT_CLOSING_MESSAGE,
    },
  },
  messenger: {
    enabled: true,
    checkInMinutes: 15,
    closeMinutes: 30,
    closingMessage: DEFAULT_MESSENGER_CLOSING_MESSAGE,
  },
  email: {
    enabled: true,
    checkInHours: null,
    closeHours: 72,
  },
}

const minutes = z.number().int().min(3).max(1440)
const hours = z.number().int().min(1).max(168)

const independentActions = {
  followUpEnabled: z.boolean().optional(),
  closeEnabled: z.boolean().optional(),
  followUpMessage: z.string().max(500).optional(),
  closingMessage: z.string().max(500).optional(),
  followUpPurpose: z.enum(['check_resolution', 'offer_human_help']).optional(),
  closeWhenAnswered: z.boolean().optional(),
  closeWhenUnanswered: z.boolean().optional(),
}
export const conversationInactivitySchema = z
  .object({
    version: z.literal(2).optional(),
    revision: z.number().int().nonnegative().optional(),
    channels: z
      .object({
        messenger: z.enum(['built_in', 'custom', 'off']),
        email: z.enum(['built_in', 'custom', 'off']),
      })
      .optional(),
    assistant: z
      .object({
        ...independentActions,
        enabled: z.boolean(),
        checkInMinutes: minutes,
        closeMinutes: minutes,
        closeWhenAnswered: z.boolean(),
        closeWhenUnanswered: z.boolean(),
        closingMessage: z.string().max(500),
        email: z
          .object({
            ...independentActions,
            checkInHours: hours.nullable(),
            closeHours: hours,
          })
          .partial(),
      })
      .partial(),
    messenger: z
      .object({
        ...independentActions,
        enabled: z.boolean(),
        checkInMinutes: minutes.nullable(),
        closeMinutes: minutes,
        closingMessage: z.string().max(500),
      })
      .partial(),
    email: z
      .object({
        ...independentActions,
        enabled: z.boolean(),
        checkInHours: hours.nullable(),
        closeHours: hours,
      })
      .partial(),
  })
  .partial()

export type StoredConversationInactivity = z.infer<typeof conversationInactivitySchema>
const updateBase = {
  revision: z.number().int().nonnegative(),
  mode: z.enum(['built_in', 'custom', 'off']).optional(),
}
export const updateConversationInactivitySchema = z.discriminatedUnion('section', [
  z
    .object({
      ...updateBase,
      section: z.literal('messenger'),
      policy: conversationInactivitySchema.shape.messenger.unwrap().strict(),
    })
    .strict(),
  z
    .object({
      ...updateBase,
      section: z.literal('email'),
      policy: conversationInactivitySchema.shape.email.unwrap().strict(),
    })
    .strict(),
  z
    .object({
      revision: updateBase.revision,
      section: z.literal('assistant'),
      policy: conversationInactivitySchema.shape.assistant.unwrap().strict(),
    })
    .strict(),
])
export type UpdateConversationInactivityInput = z.infer<typeof updateConversationInactivitySchema>

/** One projection shared by the scheduler, workers, validation and timing preview. */
export function inactivityPolicy(
  settings: ConversationInactivitySettings,
  owner: 'team' | 'assistant',
  group: AssistantInactivityGroup
) {
  const policy =
    owner === 'assistant'
      ? group === 'email'
        ? settings.assistant.email
        : settings.assistant
      : settings[group]
  const master = owner === 'assistant' ? settings.assistant.enabled : settings[group].enabled
  const factor = group === 'email' ? 3_600_000 : 60_000
  const check = 'checkInHours' in policy ? policy.checkInHours : policy.checkInMinutes
  const close = 'closeHours' in policy ? policy.closeHours : policy.closeMinutes
  return {
    mode: settings.channels?.[group] ?? 'built_in',
    followUpEnabled: policy.followUpEnabled ?? (master && check != null),
    closeEnabled: policy.closeEnabled ?? master,
    followUpMs: (check ?? (group === 'email' ? 24 : 5)) * factor,
    closeMs: close * factor,
    followUpMessage: policy.followUpMessage ?? '',
    closingMessage:
      policy.closingMessage ?? (owner === 'assistant' ? settings.assistant.closingMessage : ''),
    purpose: policy.followUpPurpose ?? 'check_resolution',
    closeWhenAnswered: policy.closeWhenAnswered ?? settings.assistant.closeWhenAnswered,
    closeWhenUnanswered: policy.closeWhenUnanswered ?? settings.assistant.closeWhenUnanswered,
  }
}

export function inactivityValidation(
  settings: ConversationInactivitySettings,
  section: 'messenger' | 'email' | 'assistant'
): string | null {
  for (const group of section === 'assistant' ? (['messenger', 'email'] as const) : [section]) {
    const p = inactivityPolicy(settings, section === 'assistant' ? 'assistant' : 'team', group)
    if (section !== 'assistant' && p.mode !== 'built_in') continue
    const factor = group === 'email' ? 3_600_000 : 60_000,
      min = group === 'email' ? 1 : 3,
      max = group === 'email' ? 168 : 1440
    if (
      [
        p.followUpEnabled ? p.followUpMs / factor : min,
        p.closeEnabled ? p.closeMs / factor : min,
      ].some((v) => !Number.isInteger(v) || v < min || v > max)
    )
      return `Choose a duration between ${min} and ${max} ${group === 'email' ? 'hours' : 'minutes'}.`
    if (p.followUpEnabled && p.closeEnabled && p.followUpMs >= p.closeMs)
      return `${group === 'email' ? 'Email' : 'Chat'} follow-up must be earlier than auto-close.`
  }
  return null
}

export function inactivityWorkflowChannels(
  triggerSettings: Record<string, unknown>
): AssistantInactivityGroup[] {
  const channels = triggerSettings.channels
  if (!Array.isArray(channels) || channels.length === 0) return ['messenger', 'email']
  return (['messenger', 'email'] as const).filter((channel) => channels.includes(channel))
}

export function assistantWindows(
  settings: ConversationInactivitySettings,
  group: AssistantInactivityGroup,
  opts?: { chatCloseMinutes?: number }
): AssistantInactivityWindows {
  const policy = inactivityPolicy(settings, 'assistant', group)
  return {
    checkInMs: policy.mode === 'built_in' && policy.followUpEnabled ? policy.followUpMs : null,
    closeMs:
      policy.mode === 'built_in' && policy.closeEnabled
        ? group === 'messenger' && opts?.chatCloseMinutes
          ? opts.chatCloseMinutes * 60_000
          : policy.closeMs
        : Infinity,
  }
}

/** True when silence has reached the close window for that channel group. */
export function assistantInvolvementIsStale(input: {
  settings: ConversationInactivitySettings
  group: AssistantInactivityGroup
  elapsedMs: number
  chatCloseMinutes?: number
}): boolean {
  const { closeMs } = assistantWindows(input.settings, input.group, {
    chatCloseMinutes: input.chatCloseMinutes,
  })
  return input.elapsedMs >= closeMs
}

/**
 * True when a follow-up is due: past the check-in, still before close, and
 * the follow-up for that group is on.
 */
export function assistantFollowUpDue(input: {
  settings: ConversationInactivitySettings
  group: AssistantInactivityGroup
  elapsedMs: number
}): boolean {
  const { checkInMs, closeMs } = assistantWindows(input.settings, input.group)
  if (checkInMs == null || checkInMs >= closeMs) return false
  return input.elapsedMs >= checkInMs && input.elapsedMs < closeMs
}
