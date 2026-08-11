/**
 * Which workspace a sender is minting an inbound address for.
 *
 * `conversation.email-channel.ts` owns what a mail slug IS — the character set,
 * the length the local-part budget leaves it, and the refusal to mint an address
 * without one. This module owns the other half of the same question: where a
 * sender gets the slug from. That half, and only that half, depends on how the
 * process is deployed, which is why it is here and not in the grammar.
 *
 * ## Pooled: the slug is a registry field
 *
 * One always-warm fleet serves every workspace behind one shared inbound domain,
 * so an address has to name its workspace before anything can begin resolving
 * it. The control plane mints the slug once at registration and the record
 * carries it, so a sender reads the workspace it is already scoped to rather
 * than deriving anything. `getCurrentWorkspace()` is synchronous and
 * AsyncLocalStorage-backed, so this costs a sender nothing and cannot answer for
 * a workspace other than the one whose database the same code is writing to.
 *
 * ## Self-hosted: there is no registry, so there is nothing to look up
 *
 * The registry is a fleet construct. A self-hosted install has no row in it, no
 * control plane to mint from, and — decisively — no second workspace to be
 * confused with: one install owns its whole inbound domain, so the label in a
 * local part distinguishes nothing and only has to be a label its own mail
 * routing already delivers. {@link SELF_HOSTED_MAIL_SLUG} is that label.
 */
import { isPooledTenancy } from '@/lib/server/workspaces/mode'
import { getCurrentWorkspace } from '@/lib/server/workspaces/workspace-context'

/**
 * The label a self-hosted install mints under.
 *
 * `reply` rather than a configurable value, because it is the label the grammar
 * hard-coded into every address it minted before a fleet existed: an install's
 * MX rule, forwarding address or polled mailbox is already the one that receives
 * `reply@<inbound domain>`, and sub-addressed mail for `reply+…@` lands in the
 * same place. Any other constant would silently stop reply-by-email working on
 * installs that changed nothing, and a config key would hand every self-hoster a
 * decision they have never had to make in order to keep what they already have.
 *
 * It is a legal slug under the shared grammar (lower-case, five characters), so
 * an address minted here parses and verifies through exactly the same path as a
 * fleet one. See the parity assertion in this module's tests.
 */
export const SELF_HOSTED_MAIL_SLUG = 'reply'

/**
 * The mail slug to mint under, or null when there is none to mint under.
 *
 * Null is reachable only on a pooled process with no workspace scope, and it is
 * a deliberate refusal rather than a gap. On a shared inbound domain a local
 * part whose label names no workspace is one the front door is entitled to
 * reject, so minting under a fallback there would produce mail that goes out
 * carrying a route home that does not exist. Declining instead sends with no
 * Reply-To and a footer pointing at the portal thread, which is the same
 * degradation an install with inbound email unconfigured already has.
 *
 * Both senders reach this from inside a scope in practice, because both touch
 * `db` and the pooled `db` proxy refuses a call with no workspace resolved. The
 * branch is here so the outcome is decided once, in the open, rather than left
 * to whichever caller happens to hit it first.
 */
export function currentMailSlug(): string | null {
  const workspace = getCurrentWorkspace()
  if (workspace) return workspace.email.mailSlug
  return isPooledTenancy() ? null : SELF_HOSTED_MAIL_SLUG
}
