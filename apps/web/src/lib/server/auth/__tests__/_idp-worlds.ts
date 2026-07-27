/**
 * Mock IdP shapes for every identity-resolution outcome.
 *
 * There is no executable coverage of the identity path in this repo: the
 * registration suite tests only the pure config builder, with no token
 * exchange, no token decode and no userinfo fetch. That is the gap this
 * fixture closes, and it exists BEFORE the resolver so the resolver has
 * something to be verified against rather than the other way round.
 *
 * The names come from the diagnosis of a real customer failure. A provider's
 * "world" is decided by two independent settings on the IdP: which scope gates
 * each claim, and whether the claim rides in the ID token or only at the
 * userinfo endpoint.
 */

/** Unsigned JWT. Nothing in the resolution path verifies signatures. */
export function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.signature`
}

export interface IdpWorld {
  name: string
  /** What the token endpoint returned. */
  tokens: { idToken?: string; accessToken?: string }
  /** What the userinfo endpoint returns, or null when it is unreachable. */
  userinfo: Record<string, unknown> | null
  /** What a correct resolver should produce. */
  expect: {
    id: string | null
    email: string | null
    name: string | null
    /** Which source each resolved field came from. */
    sources?: Partial<Record<'id' | 'email' | 'name', string>>
    /** Set when resolution must fail outright. */
    failure?: 'subject_mismatch' | 'no_identity'
  }
}

const SUB = 'idp-subject-123'
const EXP = Math.floor(Date.now() / 1000) + 3600

/** Everything in the ID token. The compliant case: Okta, Entra, Google. */
export const WORLD_A: IdpWorld = {
  name: 'World A — complete ID token',
  tokens: {
    idToken: fakeJwt({ sub: SUB, email: 'a@example.com', name: 'World A', exp: EXP }),
    accessToken: 'opaque-access-token',
  },
  userinfo: { sub: SUB, email: 'a@example.com', name: 'World A' },
  expect: {
    id: SUB,
    email: 'a@example.com',
    name: 'World A',
    sources: { id: 'idToken', email: 'idToken', name: 'idToken' },
  },
}

/**
 * Subject in the ID token, everything else only at userinfo. The Doorkeeper
 * default, and the population the cascade exists to rescue: sign-in works today
 * by discarding the ID token wholesale, while the connection test fails.
 */
export const WORLD_B: IdpWorld = {
  name: 'World B — claims at userinfo only',
  tokens: {
    idToken: fakeJwt({ sub: SUB, exp: EXP }),
    accessToken: 'opaque-access-token',
  },
  userinfo: { sub: SUB, email: 'b@example.com', name: 'World B' },
  expect: {
    id: SUB,
    email: 'b@example.com',
    name: 'World B',
    sources: { id: 'idToken', email: 'userinfo', name: 'userinfo' },
  },
}

/** No email anywhere. Needs a synthesized placeholder to sign in at all. */
export const WORLD_C: IdpWorld = {
  name: 'World C — no email released',
  tokens: {
    idToken: fakeJwt({ sub: SUB, name: 'World C', exp: EXP }),
    accessToken: 'opaque-access-token',
  },
  userinfo: { sub: SUB, name: 'World C' },
  expect: {
    id: SUB,
    email: null,
    name: 'World C',
    sources: { id: 'idToken', name: 'idToken' },
  },
}

/**
 * No ID token at all; identity lives in a JWT access token with non-standard
 * claim names and no email. The EVE Online shape from the community PR.
 */
export const WORLD_NO_ID_TOKEN: IdpWorld = {
  name: 'No ID token — identity in the access token',
  tokens: {
    accessToken: fakeJwt({
      sub: 'CHARACTER:EVE:2119123456',
      name: 'Some Pilot',
      owner: 'jFj9dK2mQ0xR',
      exp: EXP,
    }),
  },
  userinfo: { CharacterID: 2119123456, CharacterName: 'Some Pilot' },
  expect: {
    id: 'CHARACTER:EVE:2119123456',
    email: null,
    name: 'Some Pilot',
    sources: { id: 'accessTokenJwt', name: 'accessTokenJwt' },
  },
}

/**
 * Userinfo reports a DIFFERENT subject from the ID token. OIDC Core 5.3.2
 * requires discarding it; because trusted-provider linking matches on address,
 * quietly preferring one source could bind an attacker's email to the wrong
 * account. Must fail, never merge.
 */
export const WORLD_SUBJECT_MISMATCH: IdpWorld = {
  name: 'Subject mismatch between ID token and userinfo',
  tokens: {
    idToken: fakeJwt({ sub: SUB, exp: EXP }),
    accessToken: 'opaque-access-token',
  },
  userinfo: { sub: 'a-different-subject', email: 'attacker@example.com', name: 'Someone Else' },
  expect: { id: null, email: null, name: null, failure: 'subject_mismatch' },
}

/** Userinfo unreachable and the ID token thin. Nothing to resolve. */
export const WORLD_UNRESOLVABLE: IdpWorld = {
  name: 'No identity available',
  tokens: { accessToken: 'opaque-access-token' },
  userinfo: null,
  expect: { id: null, email: null, name: null, failure: 'no_identity' },
}

export const ALL_WORLDS: IdpWorld[] = [
  WORLD_A,
  WORLD_B,
  WORLD_C,
  WORLD_NO_ID_TOKEN,
  WORLD_SUBJECT_MISMATCH,
  WORLD_UNRESOLVABLE,
]

/** A userinfo fetcher backed by a world, for injecting into the resolver. */
export function userinfoFetcherFor(world: IdpWorld) {
  return async () => world.userinfo
}
