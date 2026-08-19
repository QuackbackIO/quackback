/**
 * _template — a worked, COMPILING example of a Quackback integration (IF WO-12).
 *
 * Copy this whole folder to `src/integrations/<your-id>/`, rename `template` →
 * `<your-id>` everywhere, delete the capabilities you don't need, and add one
 * line to the registry (`lib/server/integrations/index.ts`). The folder-
 * conformance test then keeps it honest.
 *
 * This file is a permanently checked-in fixture: it is typechecked and imported
 * by a conformance test every run, so it can never silently rot. It is NOT
 * registered as a live provider (its catalog is `available: false`).
 *
 * An integration is a single object satisfying `IntegrationDefinition`. Every
 * field beyond `id`, `catalog`, and `platformCredentials` is an OPTIONAL
 * capability — implement only what your provider does. The framework dispatches
 * to each capability by looking it up on this object; there are no switch
 * statements to edit elsewhere.
 */
import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { templateCatalog } from './catalog'

export const templateIntegration: IntegrationDefinition = {
  id: 'template',
  catalog: templateCatalog,

  // Platform-level credentials the operator configures once (OAuth client
  // id/secret, an API host, ...). `[]` if the provider needs none.
  platformCredentials: [],

  // ── OAuth (optional) ──────────────────────────────────────────────────────
  // Present when the provider connects via OAuth. `buildAuthUrl` starts the
  // dance; `exchangeCode` turns the callback code into tokens + the config keys
  // discovered at connect time (workspace id, subdomain, ...).
  oauth: {
    stateType: 'template_oauth',
    buildAuthUrl() {
      return '/oauth/template/connect'
    },
    async exchangeCode() {
      return { accessToken: 'stub', config: {} }
    },
  },

  // ── Outbound notifications (optional) ─────────────────────────────────────
  // A `hook` runs once per resolved target when a subscribed event fires
  // (post.created, comment.created, ...). Return the created external id/url so
  // the framework can cache and link it.
  hook: {
    async run() {
      return { success: true }
    },
  },

  // ── Routing destinations (optional, IF WO-7) ──────────────────────────────
  // Where created work lands. Keyed by `kind`; a dependent kind names its
  // parent via `childOf` and receives the parent's chosen id as `parentId`.
  destinations: {
    project: {
      label: 'Project',
      async list() {
        return [{ id: 'proj_1', name: 'Example project' }]
      },
    },
    'issue-type': {
      label: 'Issue type',
      childOf: 'project',
      async list({ parentId }) {
        return parentId ? [{ id: 'bug', name: 'Bug' }] : []
      },
    },
  },

  // ── Two-way status sync (optional, IF WO-15) ──────────────────────────────
  // `push` writes a Quackback status change out to the linked remote item. The
  // framework owns the trigger, loop-safety, and the pushStatusMappings lookup;
  // you only perform the remote write.
  remoteStatus: {
    async push() {
      return { success: true }
    },
  },

  // ── Link an existing item by title (optional, IF WO-15) ───────────────────
  // `search` powers type-a-title link-existing; the UI degrades to paste-a-URL
  // when it's absent.
  externalLinks: {
    async search({ query }) {
      return [{ externalId: 'ACME-1', title: `Result for "${query}"` }]
    },
  },

  // Other capabilities exist and follow the same shape — see the framework
  // contract in `lib/server/integrations/types.ts`:
  //   inbound            — receive + verify a webhook, parse a remote status change
  //   webhookRegistration— 'manual' or { register, unregister } for auto setup
  //   listExternalStatuses — the remote states shown in the status-mapping UI
  //   issues             — parse a pasted ref + create a remote issue
  //   archive            — close/archive the linked item on cascading post delete
  //   context            — customer-context enrichment card by email
  //   userSync           — sync members to the remote system
  //   refreshToken       — refresh an expired OAuth token
  //   onConnect / onDisconnect — provision / clean up on connect + delete
}
