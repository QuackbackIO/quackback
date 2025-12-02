/**
 * Core role hierarchy - shared across all domain permissions
 */
export const roleHierarchy = {
  owner: 3,
  admin: 2,
  member: 1,
} as const

export type Role = keyof typeof roleHierarchy

export function hasMinimumRole(userRole: Role, requiredRole: Role): boolean {
  return roleHierarchy[userRole] >= roleHierarchy[requiredRole]
}
