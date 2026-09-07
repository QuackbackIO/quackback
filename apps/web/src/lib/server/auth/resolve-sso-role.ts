/**
 * Compatibility re-export. Production and preview must share one matcher so a
 * literal dotted claim key cannot resolve differently at sign-in than in the
 * mapping preview.
 */
export { getNestedClaim, resolveSsoRole, resolveSsoRoleMatch } from '@/lib/shared/resolve-sso-role'
