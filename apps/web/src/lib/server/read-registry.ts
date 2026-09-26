/**
 * The reads a route loader may ask for together
 * (`lib/client/queries/read-batch.ts`), known by their query keys.
 *
 * `readTogetherFn` runs a read by calling its query's own function, as a
 * document request's loader does, so everything here must be a query without
 * arguments whose function calls server functions only, and whose key is a
 * list of strings.
 */
import type { FetchQueryOptions } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { changelogCategoryQueries, changelogSettingsQueries } from '@/lib/client/queries/changelog'
import { channelSettingsQueries } from '@/lib/client/queries/channel-settings'
import { emailChannelConfigQuery } from '@/lib/client/queries/channel-accounts'
import { portalQueries } from '@/lib/client/queries/portal'
import { settingsQueries } from '@/lib/client/queries/settings'
import { githubChannelStatusQuery } from '@/integrations/github/ui/github-channel-status-query'

/** A query factory, whatever its data type (the server only fetches it and ships the result). */
type BatchedRead = () => Pick<FetchQueryOptions, 'queryKey'>

export const BATCHED_READS: readonly BatchedRead[] = [
  settingsQueries.authConfig,
  settingsQueries.branding,
  settingsQueries.customCss,
  settingsQueries.developerConfig,
  settingsQueries.exportRuns,
  settingsQueries.identityProviders,
  settingsQueries.importRuns,
  settingsQueries.logo,
  settingsQueries.portalConfig,
  settingsQueries.roles,
  settingsQueries.spamFilterConfig,
  settingsQueries.teamMembersAndInvitations,
  settingsQueries.teams,
  settingsQueries.verifiedDomains,
  settingsQueries.widgetConfig,
  settingsQueries.widgetSecret,
  adminQueries.apiKeys,
  adminQueries.authProviderStatus,
  // Also the key adminQueries.boards reads, with the same function.
  adminQueries.boardsForSettings,
  adminQueries.integrationCatalog,
  adminQueries.integrations,
  adminQueries.onboardingStatus,
  adminQueries.recoveryCodes,
  // Also the key changelogCategoryQueries.segments reads, with the same function.
  adminQueries.segments,
  adminQueries.statuses,
  adminQueries.tags,
  adminQueries.webhooks,
  changelogCategoryQueries.list,
  changelogSettingsQueries.get,
  channelSettingsQueries.emailActivity,
  channelSettingsQueries.emailAutoAck,
  channelSettingsQueries.emailStatus,
  channelSettingsQueries.routing,
  emailChannelConfigQuery,
  githubChannelStatusQuery,
  // The public roadmap page's shell.
  portalQueries.roadmaps,
  portalQueries.statuses,
  portalQueries.boards,
  portalQueries.tags,
]
