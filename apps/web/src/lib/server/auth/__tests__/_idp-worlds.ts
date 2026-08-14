/**
 * Mock IdP shapes for every identity-resolution outcome.
 *
 * A provider's "world" is decided by two independent settings: which scope
 * gates each claim, and whether the claim rides in the ID token or only at
 * userinfo. Every shape here was observed on a real OpenID Connect provider.
 */

/** Unsigned JWT. Nothing in the resolution path verifies signatures. */
export function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64(payload)}.signature`
}

export interface IdpWorld {
  name: string
  tokens: { idToken?: string; accessToken?: string }
  userinfo: Record<string, unknown> | null
  expect: {
    id: string | null
    email: string | null
    name: string | null
    sources?: Partial<Record<'id' | 'email' | 'name', string>>
    failure?: 'subject_mismatch' | 'no_identity'
  }
}

const SUB = 'idp-subject-123'
const EXP = Math.floor(Date.now() / 1000) + 3600

/** Everything in the ID token. The compliant case. */
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

/** Subject in the ID token, everything else only at userinfo. */
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
 * Access-token-only IdP: no ID token; identity lives in a JWT access token
 * under PascalCase claim names, with no email anywhere.
 */
export const WORLD_NO_ID_TOKEN: IdpWorld = {
  name: 'Access-token-only IdP — identity in the access token',
  tokens: {
    accessToken: fakeJwt({
      sub: 'ACCOUNT:REGION:2119123456',
      name: 'Structured Subject',
      owner: 'jFj9dK2mQ0xR',
      exp: EXP,
    }),
  },
  userinfo: { AccountID: 2119123456, AccountName: 'Structured Subject' },
  expect: {
    id: 'ACCOUNT:REGION:2119123456',
    email: null,
    name: 'Structured Subject',
    sources: { id: 'accessTokenJwt', name: 'accessTokenJwt' },
  },
}

/** Userinfo reports a DIFFERENT subject from the ID token. */
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

export function userinfoFetcherFor(world: IdpWorld) {
  return async () => world.userinfo
}
