/**
 * The launch plan's inputs, read once: what the workspace has done, what the
 * caller may do, and which modules are on. The admin status function and the
 * setup emails both build their steps from this, so a step an email links to
 * is the step the plan shows.
 */
import type { PrincipalId } from '@quackback/ids'
import {
  db,
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
  boards,
  changelogEntries,
  helpCenterArticles,
  integrations,
  invitation,
  principal,
  statusComponents,
} from '@/lib/server/db'
import { getWidgetConfig } from '@/lib/server/domains/settings/settings.widget'
import { getSetupState } from '@/lib/shared/db-types'
import { permissionsForLegacyRole } from '@/lib/server/policy/permissions'
import {
  resolveFeatureFlags,
  workspaceAllowsAnonymous,
} from '@/lib/server/domains/settings/settings.types'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { hasEntitlement } from '@/lib/server/domains/settings/cloud/entitlements'
import { isAssistantConfigured } from '@/lib/server/domains/assistant'
import { canTestCustomerPostIdea } from '@/lib/server/test-customer-feedback'
import { detectFirstWin, internalWinScope, winOutcome } from '@/lib/server/activation-wins'
import { isLaunchWindowOpen, launchWindowFor } from '@/lib/shared/launch-window'
import { CURRENT_WIDGET_SDK_VERSION, widgetSdkNeedsUpdate } from '@/lib/shared/widget/sdk-version'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import type { Role } from '@/lib/shared/roles'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'launch-status' })

export interface LaunchStatusCaller {
  principalId: PrincipalId
  role: Role
  /** The caller's effective permissions (gates the test-idea offer). */
  permissions: Iterable<PermissionKey>
}

export async function loadLaunchStatus(caller: LaunchStatusCaller) {
  const [
    orgBoards,
    humanMembers,
    orgSettings,
    widgetConfig,
    connectedIntegration,
    helpArticle,
    publishedChangelog,
    statusComponent,
    tierLimits,
    assistantEntitled,
  ] = await Promise.all([
    db.query.boards.findMany({
      columns: { id: true, slug: true, access: true },
      where: isNull(boards.deletedAt),
    }),
    // Teammates only (admin/member) — portal role=user must not complete "invite"
    db
      .select({
        id: principal.id,
        // Rides the same read: any team invitation sent, joined or not.
        teamInvited: sql<boolean>`exists (select 1 from ${invitation} where ${invitation.kind} = 'team')`,
      })
      .from(principal)
      .where(and(eq(principal.type, 'user'), inArray(principal.role, ['admin', 'member']))),
    db.query.settings.findFirst(),
    getWidgetConfig(),
    db.query.integrations.findFirst({
      columns: { id: true },
      where: eq(integrations.status, 'connected'),
    }),
    // The help center step is to publish: a draft does not complete it.
    db.query.helpCenterArticles.findFirst({
      columns: { id: true },
      where: and(isNull(helpCenterArticles.deletedAt), isNotNull(helpCenterArticles.publishedAt)),
    }),
    db.query.changelogEntries.findFirst({
      columns: { id: true },
      where: and(isNull(changelogEntries.deletedAt), isNotNull(changelogEntries.publishedAt)),
    }),
    db.query.statusComponents.findFirst({
      columns: { id: true },
      where: isNull(statusComponents.deletedAt),
    }),
    getTierLimits(),
    hasEntitlement('aiAssistant'),
  ])

  const setupState = getSetupState(orgSettings?.setupState ?? null)
  const firstWin = await detectFirstWin(setupState)
  const launchWindow = launchWindowFor({ setupState, workspaceCreatedAt: orgSettings?.createdAt })
  const flags = resolveFeatureFlags(orgSettings?.featureFlags)
  const permissions = permissionsForLegacyRole(caller.role)
  const hasBranding = Boolean(orgSettings?.logoKey)
  const hasWidgetEnabled = widgetConfig.enabled === true
  // Messenger is "live" when the widget is on and the Messages tab is shown.
  const hasMessengerEnabled = hasWidgetEnabled && (widgetConfig.tabs?.messenger ?? true)
  const hasIntegration = Boolean(connectedIntegration)
  // The Agent answers unless it is switched off or paused; both default to on.
  const assistantDeployment = widgetConfig.messenger?.assistant
  const hasAgentAnswering =
    (assistantDeployment?.enabled ?? true) && (assistantDeployment?.respond ?? true)
  const hasInternalBoard = orgBoards.some((board) => board.access.view === 'team')
  const publicBoard = orgBoards.find((board) => board.access.view === 'anonymous')
  const hasPublicBoard = Boolean(publicBoard)
  // A private team plan: the team board its win is judged on, whose access
  // settings decide who sees it.
  const teamScope =
    winOutcome(setupState) === 'internal' ? await internalWinScope(setupState) : null
  const teamBoard = teamScope
    ? orgBoards.find((board) => board.id === teamScope.boardId)
    : undefined

  log.debug(
    {
      has_boards: orgBoards.length > 0,
      member_count: humanMembers.length,
      has_branding: hasBranding,
      has_widget: hasWidgetEnabled,
      has_messenger: hasMessengerEnabled,
      has_help_article: Boolean(helpArticle),
      has_published_changelog: Boolean(publishedChangelog),
      has_status_component: Boolean(statusComponent),
      use_case: setupState?.useCase,
    },
    'fetch onboarding status'
  )
  return {
    hasBoards: orgBoards.length > 0,
    hasPublicBoard,
    publicBoardId: publicBoard?.id ?? null,
    publicBoardSlug: publicBoard?.slug ?? null,
    teamBoardSlug: teamBoard?.slug ?? null,
    publicBoardPath: publicBoard ? `/?board=${encodeURIComponent(publicBoard.slug)}` : null,
    publicBoardLinkCopiedAt: setupState?.activationMilestones?.publicBoardLinkCopiedAt ?? null,
    statusLinkCopiedAt: setupState?.activationMilestones?.statusLinkCopiedAt ?? null,
    hasInternalBoard,
    memberCount: humanMembers.length,
    hasTeamInvite: humanMembers.some((member) => member.teamInvited),
    hasBranding,
    hasWidgetInstalled: Boolean(orgSettings?.widgetInstalledFirstSeenAt),
    widgetOriginHost: orgSettings?.widgetInstalledOriginHost ?? null,
    widgetLastDetectedAt: orgSettings?.widgetInstalledLastSeenAt
      ? orgSettings.widgetInstalledLastSeenAt.toISOString()
      : null,
    widgetSdkVersion: orgSettings?.widgetInstalledSdkVersion ?? null,
    currentWidgetSdkVersion: CURRENT_WIDGET_SDK_VERSION,
    widgetSdkNeedsUpdate:
      Boolean(orgSettings?.widgetInstalledFirstSeenAt) &&
      widgetSdkNeedsUpdate(orgSettings?.widgetInstalledSdkVersion, CURRENT_WIDGET_SDK_VERSION),
    hasWidgetEnabled,
    hasMessengerEnabled,
    hasAgentAnswering,
    hasHelpArticle: Boolean(helpArticle),
    hasPublishedChangelog: Boolean(publishedChangelog),
    hasStatusComponent: Boolean(statusComponent),
    hasIntegration,
    hasFirstWin: firstWin.reached,
    firstWinAt: firstWin.reachedAt,
    // "Post an idea" as the caller's test customer is offered only where it can land.
    canPostTestIdea: canTestCustomerPostIdea(
      caller.principalId,
      new Set(caller.permissions),
      orgBoards,
      workspaceAllowsAnonymous(orgSettings?.portalConfig)
    ),
    launchWindow,
    inLaunchWindow: isLaunchWindowOpen(launchWindow),
    useCase: setupState?.goals?.[0] ?? setupState?.useCase ?? null,
    goals: setupState?.goals,
    feedbackPrivate: setupState?.feedbackPrivate,
    taskResolutions: setupState?.taskResolutions ?? {},
    boardCount: orgBoards.length,
    maxBoards: tierLimits.maxBoards,
    goalManaged: Boolean(
      orgSettings &&
      (orgSettings.managedFieldPaths as string[]).some(
        (path) => path === 'workspace.useCase' || path === 'workspace'
      )
    ),
    permissions: {
      settingsManage: permissions.has(PERMISSIONS.SETTINGS_MANAGE),
      boardManage: permissions.has(PERMISSIONS.BOARD_MANAGE),
      memberManage: permissions.has(PERMISSIONS.MEMBER_MANAGE),
      brandingManage: permissions.has(PERMISSIONS.SETTINGS_BRANDING),
      integrationManage: permissions.has(PERMISSIONS.INTEGRATION_MANAGE),
      helpCenterManage: permissions.has(PERMISSIONS.HELP_CENTER_MANAGE),
      assistantManage: permissions.has(PERMISSIONS.ASSISTANT_MANAGE),
    },
    features: {
      supportInbox: flags.supportInbox,
      helpCenter: flags.helpCenter,
      statusPage: flags.statusPage,
      changelog: flags.changelog,
      integrations: tierLimits.features.integrations,
      // Quinn can answer only on a plan that includes it and with a model configured.
      assistant: assistantEntitled && isAssistantConfigured(),
    },
  }
}
