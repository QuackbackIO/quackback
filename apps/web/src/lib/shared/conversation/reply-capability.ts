/**
 * Whether the team can actually email a reply to this visitor — drives the
 * widget's offline copy so it never promises "we'll get back to you by email"
 * when it structurally can't. True only when email transport is configured AND
 * an address is already on file for this visitor (a verified identity's email,
 * or one an agent captured on the conversation). The widget itself never
 * collects emails inline (see GH issue #300).
 */
export function canEmailVisitor(args: {
  emailConfigured: boolean
  visitorHasEmail: boolean
}): boolean {
  return args.emailConfigured && args.visitorHasEmail
}
