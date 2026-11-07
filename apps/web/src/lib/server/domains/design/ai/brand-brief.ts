/**
 * The brand designer's brief, written into every decision family's prompt
 * when a brand is matched from screenshots: the working principles and the
 * rubric, not a persona line alone. Observation and measuring get none.
 */
import type { ZodType } from 'zod'

export const DESIGNER_BRIEF = `You are a brand designer making a company's customer portal from screenshots of its site.
A portal is the brand's product surface (like its help centre or account area), not its marketing page: carry the identity, not the campaign.
Principles: one bold signature moment, usually the hero, and restraint elsewhere (60/30/10 as a guide); identity colours where they carry meaning; keep the brand's voice (weight, case, spacing, wording) more than its exact details; match its density and corners; never invent what the screenshots do not show; fidelity over taste.`

/** How every family's answer is written: evidence first, then the choice, then how sure. */
export const ANSWER_RULES =
  'Put your reading of the evidence first, then your choices. Choose "not_visible" when the screenshots do not show it, and say "low" confidence when they do not settle it. Answer with the JSON object only.'

/** One decision family's model call: its prompt, the crops it refers to, and its schema. */
export interface FamilyRequest<T> {
  /** For the usage log and the harness cache. */
  family: 'hero' | 'voice' | 'words' | 'words_pick' | 'layout' | 'critic' | 'revise'
  version: string
  prompt: string
  images: Array<{ mime: 'image/png' | 'image/jpeg'; data: Uint8Array }>
  schema: ZodType<T>
  maxTokens: number
  /** Which of several answers asked for at once (a self-consistency check), from 0. */
  sample?: number
}

/** Asks the model for one family's answer, validated against its schema. */
export type FamilyCaller = <T>(request: FamilyRequest<T>) => Promise<T>
