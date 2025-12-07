/**
 * @quackback/ee/scim - Enterprise SCIM User Provisioning
 *
 * This package provides SCIM 2.0 user provisioning for Quackback Enterprise.
 * Available on Team tier and above.
 */

// TODO: Implement SCIM 2.0 endpoints
// - /Users - User CRUD operations
// - /Groups - Group management
// - /Schemas - Schema discovery
// - /ServiceProviderConfig - Configuration endpoint

export interface SCIMUser {
  id: string
  externalId?: string
  userName: string
  name?: {
    formatted?: string
    familyName?: string
    givenName?: string
  }
  emails?: Array<{
    value: string
    primary?: boolean
    type?: string
  }>
  active: boolean
  meta: {
    resourceType: 'User'
    created: string
    lastModified: string
  }
}

export interface SCIMGroup {
  id: string
  displayName: string
  members?: Array<{
    value: string
    display?: string
  }>
  meta: {
    resourceType: 'Group'
    created: string
    lastModified: string
  }
}

/**
 * Placeholder SCIM Service - To be implemented
 */
export class SCIMService {
  async listUsers(
    _organizationId: string
  ): Promise<{ Resources: SCIMUser[]; totalResults: number }> {
    throw new Error('SCIM not yet implemented')
  }

  async getUser(_organizationId: string, _userId: string): Promise<SCIMUser> {
    throw new Error('SCIM not yet implemented')
  }

  async createUser(_organizationId: string, _user: Partial<SCIMUser>): Promise<SCIMUser> {
    throw new Error('SCIM not yet implemented')
  }

  async updateUser(
    _organizationId: string,
    _userId: string,
    _updates: Partial<SCIMUser>
  ): Promise<SCIMUser> {
    throw new Error('SCIM not yet implemented')
  }

  async deleteUser(_organizationId: string, _userId: string): Promise<void> {
    throw new Error('SCIM not yet implemented')
  }
}
