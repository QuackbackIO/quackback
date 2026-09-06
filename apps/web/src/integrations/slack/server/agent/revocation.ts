/** Slack token revocations list bot user IDs separately from user OAuth tokens. */
export function revokesSlackInstallation(
  event: { type?: string; tokens?: { bot?: unknown } } | undefined,
  botUserId: unknown
): boolean {
  return (
    event?.type === 'app_uninstalled' ||
    (event?.type === 'tokens_revoked' &&
      typeof botUserId === 'string' &&
      Array.isArray(event.tokens?.bot) &&
      event.tokens.bot.includes(botUserId))
  )
}
