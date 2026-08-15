/**
 * Server shim. Implementation lives in `@/lib/shared/resolve-sso-role`
 * so the editor's outcome preview can evaluate the same rules.
 */
export { getNestedClaim, resolveSsoRole, resolveSsoRoleMatch } from '@/lib/shared/resolve-sso-role'
