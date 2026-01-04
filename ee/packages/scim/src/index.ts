/**
 * @quackback/ee-scim
 *
 * SCIM 2.0 User Provisioning for Quackback Enterprise.
 *
 * Enables automatic user provisioning and deprovisioning
 * from identity providers like Okta, Azure AD, etc.
 *
 * SCIM Endpoints:
 * - GET    /scim/v2/Users          - List users
 * - GET    /scim/v2/Users/:id      - Get user
 * - POST   /scim/v2/Users          - Create user
 * - PUT    /scim/v2/Users/:id      - Replace user
 * - PATCH  /scim/v2/Users/:id      - Update user
 * - DELETE /scim/v2/Users/:id      - Delete user
 * - GET    /scim/v2/Groups         - List groups
 * - GET    /scim/v2/Groups/:id     - Get group
 * - POST   /scim/v2/Groups         - Create group
 * - PUT    /scim/v2/Groups/:id     - Replace group
 * - PATCH  /scim/v2/Groups/:id     - Update group
 * - DELETE /scim/v2/Groups/:id     - Delete group
 *
 * @license Proprietary - See ee/LICENSE
 */

export { createSCIMHandlers, type SCIMConfig } from './handlers'
export { SCIMUserSchema, SCIMGroupSchema, type SCIMUser, type SCIMGroup } from './schemas'

/**
 * Check if SCIM module is available
 */
export const SCIM_AVAILABLE = true
