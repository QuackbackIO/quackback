/**
 * Synthetic IdP worlds for production / test / preview parity.
 * These are fixtures, not certification of those services.
 */

import type { IdentityProviderClaimMapping } from '../../oidc-claim-mapping'
import type { UserAttributeType } from '../../db-types'

export type MappingWorld = {
  name: string
  mapping: IdentityProviderClaimMapping
  idToken: Record<string, unknown>
  userinfo: Record<string, unknown>
  definitions: Array<{ key: string; type: UserAttributeType; label: string }>
  expect: {
    id: string
    email: string
    name: string
    idSource: 'idToken' | 'userinfo'
    emailSource: 'idToken' | 'userinfo'
    emailPath: string
    role?: { role: 'admin' | 'member' | 'user'; ruleIndex: number }
    people?: Record<string, unknown>
  }
}

export const ENTRA_WORLD: MappingWorld = {
  name: 'Entra upn/oid',
  mapping: {
    profile: { claims: { id: 'oid', email: 'upn' } },
    role: {
      claimPath: 'groups',
      rules: [
        { whenContains: 'platform-admins', role: 'admin' },
        { whenContains: 'engineering', role: 'member' },
      ],
    },
    attributes: { map: [{ claimPath: 'department', attributeKey: 'department' }] },
  },
  idToken: {
    oid: 'entra-oid-1',
    upn: 'Jane@Contoso.Example',
    name: 'Jane Doe',
    groups: ['engineering'],
  },
  userinfo: { oid: 'entra-oid-1', department: 'Engineering' },
  definitions: [{ key: 'department', type: 'string', label: 'Department' }],
  expect: {
    id: 'entra-oid-1',
    email: 'jane@contoso.example',
    name: 'Jane Doe',
    idSource: 'idToken',
    emailSource: 'idToken',
    emailPath: 'upn',
    role: { role: 'member', ruleIndex: 1 },
    people: { department: 'Engineering' },
  },
}

export const OKTA_WORLD: MappingWorld = {
  name: 'Okta scalar/array groups',
  mapping: {
    role: {
      claimPath: 'groups',
      rules: [{ whenContains: 'Everyone', role: 'member' }],
    },
  },
  idToken: { sub: 'okta-1', email: 'okta@example.test', name: 'Okta User', groups: 'Everyone' },
  userinfo: { sub: 'okta-1', groups: ['Everyone', 'Sales'] },
  definitions: [],
  expect: {
    id: 'okta-1',
    email: 'okta@example.test',
    name: 'Okta User',
    idSource: 'idToken',
    emailSource: 'idToken',
    emailPath: 'email',
    role: { role: 'member', ruleIndex: 0 },
  },
}

export const AUTH0_WORLD: MappingWorld = {
  name: 'Auth0 URI keys',
  mapping: {
    profile: { claims: { email: 'https://acme.com/email' } },
    role: {
      claimPath: 'https://acme.com/roles',
      rules: [{ whenContains: 'staff', role: 'member' }],
    },
  },
  idToken: {
    sub: 'auth0|1',
    'https://acme.com/email': 'uri@example.test',
    name: 'Auth0 User',
    'https://acme.com/roles': ['staff'],
  },
  userinfo: { sub: 'auth0|1' },
  definitions: [],
  expect: {
    id: 'auth0|1',
    email: 'uri@example.test',
    name: 'Auth0 User',
    idSource: 'idToken',
    emailSource: 'idToken',
    emailPath: 'https://acme.com/email',
    role: { role: 'member', ruleIndex: 0 },
  },
}

export const KEYCLOAK_WORLD: MappingWorld = {
  name: 'Keycloak nested claims',
  mapping: {
    role: {
      claimPath: 'realm_access.roles',
      rules: [{ whenContains: 'offline_access', role: 'user' }],
    },
    attributes: { map: [{ claimPath: 'org.costCenter', attributeKey: 'cost_center' }] },
  },
  idToken: {
    sub: 'kc-1',
    email: 'kc@example.test',
    name: 'Keycloak User',
    realm_access: { roles: ['offline_access'] },
    org: { department: 'IT' },
  },
  userinfo: { sub: 'kc-1', org: { costCenter: 'cc-9', department: 'from-userinfo' } },
  definitions: [{ key: 'cost_center', type: 'string', label: 'Cost center' }],
  expect: {
    id: 'kc-1',
    email: 'kc@example.test',
    name: 'Keycloak User',
    idSource: 'idToken',
    emailSource: 'idToken',
    emailPath: 'email',
    role: { role: 'user', ruleIndex: 0 },
    people: { cost_center: 'cc-9' },
  },
}

export const GOOGLE_WORLD: MappingWorld = {
  name: 'Google-shaped OIDC',
  mapping: {},
  idToken: {
    sub: 'google-1',
    email: 'google@example.test',
    email_verified: true,
    name: 'Google User',
    picture: 'https://lh3.googleusercontent.com/a/x',
  },
  userinfo: { sub: 'google-1', email: 'google@example.test', name: 'Google User' },
  definitions: [],
  expect: {
    id: 'google-1',
    email: 'google@example.test',
    name: 'Google User',
    idSource: 'idToken',
    emailSource: 'idToken',
    emailPath: 'email',
  },
}

export const MAPPING_WORLDS = [ENTRA_WORLD, OKTA_WORLD, AUTH0_WORLD, KEYCLOAK_WORLD, GOOGLE_WORLD]
