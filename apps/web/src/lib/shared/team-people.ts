/**
 * Client-safe constants shared by the add-people and change-role server
 * functions and the dialogs that read their results.
 */

/** Codes addTeamMembersFn returns as `{ ok: false, code }` instead of throwing. */
export const ADD_REFUSAL_CODES = [
  'SEAT_LIMIT',
  'GRANT_CEILING',
  'ALREADY_MEMBER',
  'INVITE_PENDING',
  'NOT_ELIGIBLE',
  'VALIDATION_ERROR',
] as const
export type AddRefusalCode = (typeof ADD_REFUSAL_CODES)[number]

/** Codes changeTeamRoleFn returns as `{ ok: false, code }` instead of throwing. */
export const CHANGE_ROLE_REFUSAL_CODES = [
  'GRANT_CEILING',
  'LAST_ADMIN',
  'CANNOT_MODIFY_SELF',
  'SEAT_LIMIT',
  'NOT_ELIGIBLE',
  'NOT_FOUND',
] as const
export type ChangeRoleRefusalCode = (typeof CHANGE_ROLE_REFUSAL_CODES)[number]

/** How long a team invitation (and its emailed sign-in link) stays valid. */
export const TEAM_INVITATION_VALID_DAYS = 30
