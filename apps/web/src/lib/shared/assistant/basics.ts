/**
 * The Basics persona preset: a coarse tone + length dial that sits above the
 * granular guidance rules. Most workspaces never touch a guidance rule; this
 * is the one setting nearly everyone reaches for first. Client-safe: settings
 * UI renders the catalogue.
 */
export const ASSISTANT_TONES = ['friendly', 'neutral', 'professional'] as const

export type AssistantTone = (typeof ASSISTANT_TONES)[number]

export const ASSISTANT_TONE_LABELS: Record<AssistantTone, string> = {
  friendly: 'Friendly',
  neutral: 'Neutral',
  professional: 'Professional',
}

export const ASSISTANT_LENGTHS = ['concise', 'standard', 'thorough'] as const

export type AssistantLength = (typeof ASSISTANT_LENGTHS)[number]

export const ASSISTANT_LENGTH_LABELS: Record<AssistantLength, string> = {
  concise: 'Concise',
  standard: 'Standard',
  thorough: 'Thorough',
}
