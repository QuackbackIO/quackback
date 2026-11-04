/**
 * Whether the operator accepts a proven zone as a web address's ownership
 * proof.
 *
 * Off by default. An operator that predates the `proof` field refuses the
 * whole request when it is present, so the field is sent only once the
 * operator says it understands it, by setting this to `true`.
 */
export const PROVEN_ZONE_PROOFS_ENV = 'QUACKBACK_CONTROL_PLANE_PROVEN_ZONES'

export function provenZoneProofsAccepted(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[PROVEN_ZONE_PROOFS_ENV]?.trim().toLowerCase() === 'true'
}
