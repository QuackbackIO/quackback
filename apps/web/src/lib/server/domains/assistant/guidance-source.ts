/**
 * Which store the runtime reads guidance from, and the rollback switch.
 *
 * `canonical` (the default) reads authored entries and their role bindings.
 * `legacy` is the rollback position: the situational-rule table and the skill
 * table exactly as they were read before the guidance gate. One source answers
 * a read, never both, which is what keeps a converted instruction from
 * reaching the prompt twice during cutover.
 *
 * Read from `process.env` on every call, like `assistant-execution-mode.ts`:
 * the answer is a property of the deployment, not of a workspace, and a worker
 * that never loaded the application config still needs it. Anything other than
 * the exact word `legacy` resolves to `canonical`, which is also the default,
 * so a typo cannot quietly select the rollback path.
 */
export const GUIDANCE_SOURCES = ['canonical', 'legacy'] as const
export type GuidanceSource = (typeof GUIDANCE_SOURCES)[number]

export function guidanceSource(): GuidanceSource {
  return process.env.ASSISTANT_GUIDANCE_SOURCE?.trim().toLowerCase() === 'legacy'
    ? 'legacy'
    : 'canonical'
}
