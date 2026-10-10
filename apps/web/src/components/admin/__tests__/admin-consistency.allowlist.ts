import type { RuleName } from './admin-consistency.rules'

/**
 * Files (or, for registry-pages, registry paths) that do not comply with a
 * rule. Every entry is a deliberate exception with its reason above it. The
 * guard fails on an offender that is not listed and on a listed entry that no
 * longer offends, so entries are only ever removed.
 */
export const ALLOWLIST: Record<RuleName, string[]> = {
  'page-shell': [],
  'page-width': [],
  'registry-pages': [
    // A module label with no page of its own: its URL redirects to the first page of the module.
    '/admin/settings/feedback',
    // A module label with no page of its own: its URL redirects to the first page of the module.
    '/admin/settings/support',
  ],
  'create-labels': [],
  'no-dashes': [],
  'tab-icons': [],
  'toggle-rows': [
    // A switch on a provider tile in a card grid, not a setting row.
    'components/admin/settings/auth-shared/oauth-provider-grid.tsx',
    // A switch inside a dense draggable row of the portal tab list.
    'components/admin/settings/branding/portal-nav-editor.tsx',
    // The Enabled switch sits in the page header actions, not in a setting row.
    'components/admin/settings/security/identity-providers/provider-detail-page.tsx',
    // A switch inside a provider list row, not a setting row.
    'components/admin/settings/security/identity-providers/provider-list.tsx',
    // A switch inside a dense draggable row.
    'components/admin/settings/statuses/status-list.tsx',
    // A per-field Visible switch inside a dense draggable row.
    'components/admin/settings/tickets/fields-editor.tsx',
  ],
  palette: [
    // Avatar hues picked from the connector's name, so each connector keeps its own colour.
    'components/admin/automation/connectors/connector-mark.tsx',
    // The step kind colours that colour-code the workflow builder (trigger, branch, action, wait).
    'components/admin/automation/workflow-builder/step-visuals.tsx',
    // One icon tint per template category.
    'components/admin/automation/workflow-templates.ts',
    // Per-provider brand tints for integration badges.
    'components/admin/settings/integrations/integration-ui.tsx',
  ],
}
