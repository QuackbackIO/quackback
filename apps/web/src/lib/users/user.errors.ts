/**
 * User domain errors
 */

export type UserErrorCode =
  | 'USER_NOT_FOUND'
  | 'MEMBER_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'CANNOT_REMOVE_OWNER'
  | 'CANNOT_CHANGE_OWN_ROLE'
  | 'INVALID_ROLE'
  | 'DATABASE_ERROR'

export interface UserError {
  code: UserErrorCode
  message: string
}

export const UserError = {
  notFound: (id: string): UserError => ({
    code: 'USER_NOT_FOUND',
    message: `User not found: ${id}`,
  }),

  memberNotFound: (id: string): UserError => ({
    code: 'MEMBER_NOT_FOUND',
    message: `Member not found: ${id}`,
  }),

  unauthorized: (action: string): UserError => ({
    code: 'UNAUTHORIZED',
    message: `Not authorized to ${action}`,
  }),

  cannotRemoveOwner: (): UserError => ({
    code: 'CANNOT_REMOVE_OWNER',
    message: 'Cannot remove organization owner',
  }),

  cannotChangeOwnRole: (): UserError => ({
    code: 'CANNOT_CHANGE_OWN_ROLE',
    message: 'Cannot change your own role',
  }),

  invalidRole: (role: string): UserError => ({
    code: 'INVALID_ROLE',
    message: `Invalid role: ${role}`,
  }),

  databaseError: (message: string): UserError => ({
    code: 'DATABASE_ERROR',
    message,
  }),
}
