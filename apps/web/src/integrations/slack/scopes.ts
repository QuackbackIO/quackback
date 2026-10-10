/** Shared with the settings UI; no Slack SDK or server imports. */
export const SLACK_REQUIRED_SCOPES = [
  'channels:read',
  'groups:read',
  'channels:join',
  'channels:history',
  'groups:history',
  'chat:write',
  'assistant:write',
  'team:read',
  'commands',
  'app_mentions:read',
  'im:history',
  'im:read',
  'im:write',
  'mpim:history',
  'mpim:read',
  'users:read',
  'users:read.email',
  'reactions:read',
] as const
export function missingSlackScopes(grantedCsv?: string): string[] {
  const granted = new Set((grantedCsv ?? '').split(',').map((scope) => scope.trim()))
  return SLACK_REQUIRED_SCOPES.filter((scope) => !granted.has(scope))
}
