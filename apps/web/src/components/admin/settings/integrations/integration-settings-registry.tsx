/**
 * Integration settings registry (IF WO-6). ONE entry per provider drives the
 * single dynamic `$type` settings route, replacing 25 near-identical route
 * files. Each entry supplies only what varies per provider: catalog metadata,
 * brand icon, connect/disconnect actions, the not-connected setup copy, and
 * (when connected) either a config panel or an enrichment banner. Everything
 * shared — the header, platform-credentials dialog, health panel, and setup
 * card chrome — lives in the route itself.
 *
 * Config panels and connection actions are `React.lazy` so opening one
 * provider's settings page never pulls the other 24 providers' panels into the
 * bundle. (Per-provider colocation of these entries into `<provider>/` happens
 * in WO-11.)
 */
import { lazy, type ComponentType, type ReactNode } from 'react'
import { CheckCircleIcon } from '@heroicons/react/24/solid'
import type { IntegrationCatalogEntry } from '@/lib/shared/integration-types'
import type { NotificationChannel } from '@/components/admin/settings/integrations/shared/notification-channel-router'
import type { IntegrationHealth } from './integration-health-panel'
import { getIntegrationIcon } from './integration-ui'

// Catalogs (metadata: name/description/iconBg/docsUrl/platformCredentialFields/settingsPath).
import * as catalogs from '@/lib/shared/integration-catalog'

/** The `integration` object returned by `fetchIntegrationByType`. */
export interface IntegrationSettingsData {
  id: string
  status: 'active' | 'paused' | 'pending' | null
  workspaceName?: string | null
  config: Record<string, string | number | boolean | null>
  eventMappings: { id: string; eventType: string; enabled: boolean }[]
  notificationChannels?: NotificationChannel[]
  health?: IntegrationHealth
}

/** Uniform call shape for every `<Provider>ConnectionActions` component. */
export type ConnectionActionsComponent = ComponentType<{
  integrationId?: string
  isConnected: boolean
}>

export interface IntegrationSettingsEntry {
  /** Registry/type id (underscore form, e.g. `azure_devops`). */
  type: string
  /** Catalog metadata. */
  catalog: IntegrationCatalogEntry
  /** Brand icon. */
  Icon: ComponentType<{ className?: string }>
  /** Connect / disconnect (or webhook / key) actions. */
  ConnectionActions: ConnectionActionsComponent
  /** Setup card copy shown when not connected. */
  setup: { title: string; description: string; steps: ReactNode[] }
  /**
   * Connected-state config panel. Omit for enrichment-only providers that show
   * `connectedBanner` instead.
   */
  renderConfig?: (ctx: { integration: IntegrationSettingsData; isConnected: boolean }) => ReactNode
  /** Connected-state banner for providers with no config panel (enrichment CRMs). */
  connectedBanner?: ReactNode
  /** Override the "Connected to X" workspace label (e.g. azure_devops → organizationName). */
  getWorkspaceName?: (integration: IntegrationSettingsData) => string | null | undefined
}

// ── lazy per-provider components ────────────────────────────────────────────
// Config panels (connected state). Prop shapes differ per provider, so each is
// wired through its entry's renderConfig; the route wraps them in one Suspense.

const AsanaConfig = lazy(() =>
  import('@/integrations/asana/ui/asana-config').then((m) => ({ default: m.AsanaConfig }))
)
const AzureDevOpsConfig = lazy(() =>
  import('@/integrations/azure-devops/ui/azure-devops-config').then((m) => ({
    default: m.AzureDevOpsConfig,
  }))
)
const ClickUpConfig = lazy(() =>
  import('@/integrations/clickup/ui/clickup-config').then((m) => ({ default: m.ClickUpConfig }))
)
const DiscordConfig = lazy(() =>
  import('@/integrations/discord/ui/discord-config').then((m) => ({ default: m.DiscordConfig }))
)
const FreshdeskConfig = lazy(() =>
  import('@/integrations/freshdesk/ui/freshdesk-config').then((m) => ({
    default: m.FreshdeskConfig,
  }))
)
const GitHubConfig = lazy(() =>
  import('@/integrations/github/ui/github-config').then((m) => ({ default: m.GitHubConfig }))
)
const GitLabConfig = lazy(() =>
  import('@/integrations/gitlab/ui/gitlab-config').then((m) => ({ default: m.GitLabConfig }))
)
const JiraConfig = lazy(() =>
  import('@/integrations/jira/ui/jira-config').then((m) => ({ default: m.JiraConfig }))
)
const LinearConfig = lazy(() =>
  import('@/integrations/linear/ui/linear-config').then((m) => ({ default: m.LinearConfig }))
)
const MakeConfig = lazy(() =>
  import('@/integrations/make/ui/make-config').then((m) => ({ default: m.MakeConfig }))
)
const MondayConfig = lazy(() =>
  import('@/integrations/monday/ui/monday-config').then((m) => ({ default: m.MondayConfig }))
)
const N8nConfig = lazy(() =>
  import('@/integrations/n8n/ui/n8n-config').then((m) => ({ default: m.N8nConfig }))
)
const NotionConfig = lazy(() =>
  import('@/integrations/notion/ui/notion-config').then((m) => ({ default: m.NotionConfig }))
)
const NtfyConfig = lazy(() =>
  import('@/integrations/ntfy/ui/ntfy-config').then((m) => ({ default: m.NtfyConfig }))
)
const SalesforceConfig = lazy(() =>
  import('@/integrations/salesforce/ui/salesforce-config').then((m) => ({
    default: m.SalesforceConfig,
  }))
)
const ShortcutConfig = lazy(() =>
  import('@/integrations/shortcut/ui/shortcut-config').then((m) => ({ default: m.ShortcutConfig }))
)
const SlackConfig = lazy(() =>
  import('@/integrations/slack/ui/slack-config').then((m) => ({ default: m.SlackConfig }))
)
const StripeConfig = lazy(() =>
  import('@/integrations/stripe/ui/stripe-config').then((m) => ({ default: m.StripeConfig }))
)
const TeamsConfig = lazy(() =>
  import('@/integrations/teams/ui/teams-config').then((m) => ({ default: m.TeamsConfig }))
)
const TrelloConfig = lazy(() =>
  import('@/integrations/trello/ui/trello-config').then((m) => ({ default: m.TrelloConfig }))
)
const ZapierConfig = lazy(() =>
  import('@/integrations/zapier/ui/zapier-config').then((m) => ({ default: m.ZapierConfig }))
)

// Connection-actions (uniform {integrationId?, isConnected} shape).
const AsanaConnectionActions = lazy(() =>
  import('@/integrations/asana/ui/asana-connection-actions').then((m) => ({
    default: m.AsanaConnectionActions,
  }))
)
const AzureDevOpsConnectionActions = lazy(() =>
  import('@/integrations/azure-devops/ui/azure-devops-connection-actions').then((m) => ({
    default: m.AzureDevOpsConnectionActions,
  }))
)
const ClickUpConnectionActions = lazy(() =>
  import('@/integrations/clickup/ui/clickup-connection-actions').then((m) => ({
    default: m.ClickUpConnectionActions,
  }))
)
const DiscordConnectionActions = lazy(() =>
  import('@/integrations/discord/ui/discord-connection-actions').then((m) => ({
    default: m.DiscordConnectionActions,
  }))
)
const FreshdeskConnectionActions = lazy(() =>
  import('@/integrations/freshdesk/ui/freshdesk-connection-actions').then((m) => ({
    default: m.FreshdeskConnectionActions,
  }))
)
const GitHubConnectionActions = lazy(() =>
  import('@/integrations/github/ui/github-connection-actions').then((m) => ({
    default: m.GitHubConnectionActions,
  }))
)
const GitLabConnectionActions = lazy(() =>
  import('@/integrations/gitlab/ui/gitlab-connection-actions').then((m) => ({
    default: m.GitLabConnectionActions,
  }))
)
const HubSpotConnectionActions = lazy(() =>
  import('@/integrations/hubspot/ui/hubspot-connection-actions').then((m) => ({
    default: m.HubSpotConnectionActions,
  }))
)
const IntercomConnectionActions = lazy(() =>
  import('@/integrations/intercom/ui/intercom-connection-actions').then((m) => ({
    default: m.IntercomConnectionActions,
  }))
)
const JiraConnectionActions = lazy(() =>
  import('@/integrations/jira/ui/jira-connection-actions').then((m) => ({
    default: m.JiraConnectionActions,
  }))
)
const LinearConnectionActions = lazy(() =>
  import('@/integrations/linear/ui/linear-connection-actions').then((m) => ({
    default: m.LinearConnectionActions,
  }))
)
const MakeConnectionActions = lazy(() =>
  import('@/integrations/make/ui/make-connection-actions').then((m) => ({
    default: m.MakeConnectionActions,
  }))
)
const MondayConnectionActions = lazy(() =>
  import('@/integrations/monday/ui/monday-connection-actions').then((m) => ({
    default: m.MondayConnectionActions,
  }))
)
const N8nConnectionActions = lazy(() =>
  import('@/integrations/n8n/ui/n8n-connection-actions').then((m) => ({
    default: m.N8nConnectionActions,
  }))
)
const NotionConnectionActions = lazy(() =>
  import('@/integrations/notion/ui/notion-connection-actions').then((m) => ({
    default: m.NotionConnectionActions,
  }))
)
const NtfyConnectionActions = lazy(() =>
  import('@/integrations/ntfy/ui/ntfy-connection-actions').then((m) => ({
    default: m.NtfyConnectionActions,
  }))
)
const SalesforceConnectionActions = lazy(() =>
  import('@/integrations/salesforce/ui/salesforce-connection-actions').then((m) => ({
    default: m.SalesforceConnectionActions,
  }))
)
const SegmentConnectionActions = lazy(() =>
  import('@/integrations/segment/ui/segment-connection-actions').then((m) => ({
    default: m.SegmentConnectionActions,
  }))
)
const ShortcutConnectionActions = lazy(() =>
  import('@/integrations/shortcut/ui/shortcut-connection-actions').then((m) => ({
    default: m.ShortcutConnectionActions,
  }))
)
const SlackConnectionActions = lazy(() =>
  import('@/integrations/slack/ui/slack-connection-actions').then((m) => ({
    default: m.SlackConnectionActions,
  }))
)
const StripeConnectionActions = lazy(() =>
  import('@/integrations/stripe/ui/stripe-connection-actions').then((m) => ({
    default: m.StripeConnectionActions,
  }))
)
const TeamsConnectionActions = lazy(() =>
  import('@/integrations/teams/ui/teams-connection-actions').then((m) => ({
    default: m.TeamsConnectionActions,
  }))
)
const TrelloConnectionActions = lazy(() =>
  import('@/integrations/trello/ui/trello-connection-actions').then((m) => ({
    default: m.TrelloConnectionActions,
  }))
)
const ZapierConnectionActions = lazy(() =>
  import('@/integrations/zapier/ui/zapier-connection-actions').then((m) => ({
    default: m.ZapierConnectionActions,
  }))
)
const ZendeskConnectionActions = lazy(() =>
  import('@/integrations/zendesk/ui/zendesk-connection-actions').then((m) => ({
    default: m.ZendeskConnectionActions,
  }))
)

/** Segment has no icon registered in `INTEGRATION_UI` (it isn't a tracker or a
 * feedback source badge) — its route renders an inline "S" glyph instead of a
 * brand icon component. We keep that glyph here as a component so it fits the
 * `Icon: ComponentType<{ className?: string }>` shape the rest of the registry
 * expects. */
function SegmentIcon({ className }: { className?: string }) {
  return (
    <span className={className} aria-hidden="true">
      S
    </span>
  )
}

/** The registry, keyed by integration type (underscore form). */
export const INTEGRATION_SETTINGS: Record<string, IntegrationSettingsEntry> = {
  asana: {
    type: 'asana',
    catalog: catalogs.asanaCatalog,
    Icon: getIntegrationIcon('asana')!,
    ConnectionActions: AsanaConnectionActions,
    setup: {
      title: 'Connect your Asana workspace',
      description:
        'Connect Asana to automatically create tasks from feedback and keep statuses in sync across both platforms.',
      steps: [
        <p key="1">
          Click <span className="font-medium text-foreground">Connect</span> to authorize Quackback
          to create tasks in your Asana workspace.
        </p>,
        <p key="2">Select which project new feedback tasks should be created in.</p>,
        <p key="3">
          Choose which events trigger task creation. You can change these settings at any time.
        </p>,
      ],
    },
    renderConfig: ({ integration, isConnected }) => (
      <AsanaConfig
        integrationId={integration.id}
        initialConfig={integration.config}
        initialEventMappings={integration.eventMappings}
        enabled={isConnected}
      />
    ),
  },

  azure_devops: {
    type: 'azure_devops',
    catalog: catalogs.azureDevOpsCatalog,
    Icon: getIntegrationIcon('azure_devops')!,
    ConnectionActions: AzureDevOpsConnectionActions,
    setup: {
      title: 'Connect Azure DevOps',
      description:
        "Connect Azure DevOps to automatically create work items from feedback posts, keeping your team's workflow in sync.",
      steps: [
        <p key="1">
          Create a{' '}
          <a
            href="https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary underline underline-offset-2"
          >
            Personal Access Token
          </a>{' '}
          in Azure DevOps with{' '}
          <span className="font-medium text-foreground">Work Items (Read & Write)</span> scope.
        </p>,
        <p key="2">
          Enter your organization URL and PAT below, then click{' '}
          <span className="font-medium text-foreground">Connect</span>. Quackback will verify access
          to your organization.
        </p>,
        <p key="3">
          Select which project and work item type to use, then enable the events that should trigger
          work item creation.
        </p>,
      ],
    },
    renderConfig: ({ integration, isConnected }) => (
      <AzureDevOpsConfig
        integrationId={integration.id}
        initialConfig={integration.config}
        initialEventMappings={integration.eventMappings}
        enabled={isConnected}
      />
    ),
    getWorkspaceName: (integration) =>
      (integration.config.organizationName as string | undefined) ?? undefined,
  },

  clickup: {
    type: 'clickup',
    catalog: catalogs.clickupCatalog,
    Icon: getIntegrationIcon('clickup')!,
    ConnectionActions: ClickUpConnectionActions,
    setup: {
      title: 'Connect your ClickUp workspace',
      description:
        'Connect ClickUp to turn feedback into tasks and track progress directly from your workspace.',
      steps: [
        <p key="1">
          Click <span className="font-medium text-foreground">Connect</span> to authorize Quackback
          to create tasks in your ClickUp workspace.
        </p>,
        <p key="2">Select a space and list where new feedback tasks should be created.</p>,
        <p key="3">
          Choose which events trigger task creation. You can change these settings at any time.
        </p>,
      ],
    },
    renderConfig: ({ integration, isConnected }) => (
      <ClickUpConfig
        integrationId={integration.id}
        initialConfig={integration.config}
        initialEventMappings={integration.eventMappings}
        enabled={isConnected}
      />
    ),
  },

  discord: {
    type: 'discord',
    catalog: catalogs.discordCatalog,
    Icon: getIntegrationIcon('discord')!,
    ConnectionActions: DiscordConnectionActions,
    setup: {
      title: 'Connect your Discord server',
      description:
        'Connect Discord to receive notifications when users submit feedback, when statuses change, and when comments are added.',
      steps: [
        <p key="1">
          Click <span className="font-medium text-foreground">Connect</span> to add the Quackback
          bot to your Discord server.
        </p>,
        <p key="2">
          Select which text channel notifications should be posted to. The bot needs access to the
          channel.
        </p>,
        <p key="3">
          Choose which events trigger notifications. You can enable or disable individual event
          types at any time.
        </p>,
      ],
    },
    renderConfig: ({ integration, isConnected }) => (
      <DiscordConfig
        integrationId={integration.id}
        initialConfig={integration.config}
        initialEventMappings={integration.eventMappings}
        notificationChannels={integration.notificationChannels}
        enabled={isConnected}
      />
    ),
  },

  freshdesk: {
    type: 'freshdesk',
    catalog: catalogs.freshdeskCatalog,
    Icon: getIntegrationIcon('freshdesk')!,
    ConnectionActions: FreshdeskConnectionActions,
    setup: {
      title: 'Connect Freshdesk',
      description:
        'Connect Freshdesk to enrich feedback with support ticket data. See open tickets, satisfaction scores, and contact details alongside each submission.',
      steps: [
        <p key="1">
          Find your <span className="font-medium text-foreground">API key</span> in your Freshdesk
          profile settings.
        </p>,
        <p key="2">
          Enter your Freshdesk subdomain and API key below, then click{' '}
          <span className="font-medium text-foreground">Save</span>. Quackback will verify the
          connection.
        </p>,
        <p key="3">
          Contact data will be automatically looked up by email when new feedback is submitted.
        </p>,
      ],
    },
    renderConfig: ({ integration, isConnected }) => (
      <FreshdeskConfig
        integrationId={integration.id}
        initialEventMappings={integration.eventMappings}
        enabled={isConnected}
      />
    ),
  },

  github: {
    type: 'github',
    catalog: catalogs.githubCatalog,
    Icon: getIntegrationIcon('github')!,
    ConnectionActions: GitHubConnectionActions,
    setup: {
      title: 'Connect your GitHub account',
      description:
        'Connect GitHub to automatically create issues from user feedback and sync statuses when issues are closed or reopened.',
      steps: [
        <p key="1">
          Click <span className="font-medium text-foreground">Connect</span> to authorize Quackback
          to create issues in your GitHub repositories.
        </p>,
        <p key="2">Select which repository new feedback issues should be created in.</p>,
        <p key="3">
          Choose which events trigger issue creation. You can change these settings at any time.
        </p>,
      ],
    },
    renderConfig: ({ integration, isConnected }) => (
      <GitHubConfig
        integrationId={integration.id}
        initialConfig={integration.config}
        initialEventMappings={integration.eventMappings}
        enabled={isConnected}
      />
    ),
  },

  gitlab: {
    type: 'gitlab',
    catalog: catalogs.gitlabCatalog,
    Icon: getIntegrationIcon('gitlab')!,
    ConnectionActions: GitLabConnectionActions,
    setup: {
      title: 'Connect GitLab',
      description:
        'Connect GitLab to automatically create issues from feedback and sync statuses between platforms.',
      steps: [
        <p key="1">
          Configure your GitLab{' '}
          <span className="font-medium text-foreground">OAuth application credentials</span> in the
          platform settings.
        </p>,
        <p key="2">
          Click <span className="font-medium text-foreground">Connect</span> to authorize Quackback
          with your GitLab account.
        </p>,
        <p key="3">
          Select a project to create issues in, then choose which events should trigger new issues.
        </p>,
      ],
    },
    renderConfig: ({ integration, isConnected }) => (
      <GitLabConfig
        integrationId={integration.id}
        initialConfig={(integration.config ?? {}) as { channelId?: string }}
        initialEventMappings={integration.eventMappings}
        enabled={isConnected}
      />
    ),
  },

  hubspot: {
    type: 'hubspot',
    catalog: catalogs.hubspotCatalog,
    Icon: getIntegrationIcon('hubspot')!,
    ConnectionActions: HubSpotConnectionActions,
    setup: {
      title: 'Connect your HubSpot account',
      description:
        'Connect HubSpot to enrich feedback with CRM context like company, deal value, and lifecycle stage.',
      steps: [
        <p key="1">
          Connect your HubSpot account to authorize read-only access to contact and deal data.
        </p>,
        <p key="2">
          When feedback is submitted by a known email, Quackback looks up their HubSpot profile.
        </p>,
        <p key="3">
          CRM context (company, deal value, lifecycle stage) appears alongside their feedback to
          help you prioritize by revenue impact.
        </p>,
      ],
    },
    connectedBanner: (
      <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-green-500" />
          <p className="text-sm text-foreground">
            HubSpot enrichment is active. CRM data will automatically appear alongside feedback from
            known contacts.
          </p>
        </div>
      </div>
    ),
  },

  intercom: {
    type: 'intercom',
    catalog: catalogs.intercomCatalog,
    Icon: getIntegrationIcon('intercom')!,
    ConnectionActions: IntercomConnectionActions,
    setup: {
      title: 'Connect your Intercom account',
      description:
        'Connect Intercom to enrich feedback with customer context like company, plan, and conversation history.',
      steps: [
        <p key="1">Connect your Intercom account to authorize read-only access to contact data.</p>,
        <p key="2">
          When feedback is submitted by a known email, Quackback automatically looks up their
          Intercom profile.
        </p>,
        <p key="3">
          Customer context (company, plan, tags) appears alongside their feedback to help you
          prioritize.
        </p>,
      ],
    },
    connectedBanner: (
      <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-green-500" />
          <p className="text-sm text-foreground">
            Intercom enrichment is active. Customer data from Intercom will automatically appear
            alongside feedback from known contacts.
          </p>
        </div>
      </div>
    ),
  },

  jira: {
    type: 'jira',
    catalog: catalogs.jiraCatalog,
    Icon: getIntegrationIcon('jira')!,
    ConnectionActions: JiraConnectionActions,
    setup: {
      title: 'Connect your Jira instance',
      description:
        "Connect Jira to automatically create and sync issues from feedback posts, keeping your team's workflow in sync.",
      steps: [
        <p key="1">
          Click <span className="font-medium text-foreground">Connect</span> to authorize Quackback
          to create issues in your Jira instance.
        </p>,
        <p key="2">Select which project and issue type to use for new feedback issues.</p>,
        <p key="3">
          Choose which events trigger issue creation. You can change these settings at any time.
        </p>,
      ],
    },
    renderConfig: ({ integration, isConnected }) => (
      <JiraConfig
        integrationId={integration.id}
        initialConfig={integration.config}
        initialEventMappings={integration.eventMappings}
        enabled={isConnected}
      />
    ),
  },

  linear: {
    type: 'linear',
    catalog: catalogs.linearCatalog,
    Icon: getIntegrationIcon('linear')!,
    ConnectionActions: LinearConnectionActions,
    setup: {
      title: 'Connect your Linear workspace',
      description:
        'Connect Linear to automatically create issues from user feedback and keep statuses in sync across both platforms.',
      steps: [
        <p key="1">
          Click <span className="font-medium text-foreground">Connect</span> to authorize Quackback
          to create issues in your Linear workspace.
        </p>,
        <p key="2">Select which team new feedback issues should be created in.</p>,
        <p key="3">
          Choose which events trigger issue creation. You can change these settings at any time.
        </p>,
      ],
    },
    renderConfig: ({ integration, isConnected }) => (
      <LinearConfig
        integrationId={integration.id}
        initialConfig={integration.config}
        initialEventMappings={integration.eventMappings}
        enabled={isConnected}
      />
    ),
  },

  make: {
    type: 'make',
    catalog: catalogs.makeCatalog,
    Icon: getIntegrationIcon('make')!,
    ConnectionActions: MakeConnectionActions,
    setup: {
      title: 'Connect Make',
      description:
        'Connect Make (formerly Integromat) to trigger automation scenarios when users submit feedback, when statuses change, and when comments are added.',
      steps: [
        <p key="1">
          Create a new scenario in Make and add a{' '}
          <span className="font-medium text-foreground">Webhooks</span> module as the trigger.
        </p>,
        <p key="2">
          Copy the webhook URL and paste it below, then click{' '}
          <span className="font-medium text-foreground">Save</span>. Quackback will send a test
          payload.
        </p>,
        <p key="3">
          Choose which events should trigger your scenario, then continue building in Make.
        </p>,
      ],
    },
    renderConfig: ({ integration, isConnected }) => (
      <MakeConfig
        integrationId={integration.id}
        initialEventMappings={integration.eventMappings}
        enabled={isConnected}
      />
    ),
  },

  monday: {
    type: 'monday',
    catalog: catalogs.mondayCatalog,
    Icon: getIntegrationIcon('monday')!,
    ConnectionActions: MondayConnectionActions,
    setup: {
      title: 'Connect Monday.com',
      description:
        'Connect Monday.com to automatically create items from feedback and sync statuses between platforms.',
      steps: [
        <p key="1">
          Configure your Monday.com{' '}
          <span className="font-medium text-foreground">OAuth credentials</span> in the platform
          settings.
        </p>,
        <p key="2">
          Click <span className="font-medium text-foreground">Connect</span> to authorize Quackback
          with your Monday.com workspace.
        </p>,
        <p key="3">
          Select a board to create items in, then choose which events should trigger new items.
        </p>,
      ],
    },
    renderConfig: ({ integration, isConnected }) => (
      <MondayConfig
        integrationId={integration.id}
        initialConfig={(integration.config ?? {}) as { boardId?: string }}
        initialEventMappings={integration.eventMappings}
        enabled={isConnected}
      />
    ),
  },

  n8n: {
    type: 'n8n',
    catalog: catalogs.n8nCatalog,
    Icon: getIntegrationIcon('n8n')!,
    ConnectionActions: N8nConnectionActions,
    setup: {
      title: 'Connect n8n',
      description:
        'Connect n8n to trigger automated workflows when users submit feedback, when statuses change, and when comments are added.',
      steps: [
        <p key="1">
          Create a new workflow in n8n and add a{' '}
          <span className="font-medium text-foreground">Webhook</span> trigger node.
        </p>,
        <p key="2">
          Copy the production webhook URL and paste it below, then click{' '}
          <span className="font-medium text-foreground">Save</span>. Quackback will send a test
          payload.
        </p>,
        <p key="3">
          Choose which events should trigger your workflow, then continue building in n8n.
        </p>,
      ],
    },
    renderConfig: ({ integration, isConnected }) => (
      <N8nConfig
        integrationId={integration.id}
        initialEventMappings={integration.eventMappings}
        enabled={isConnected}
      />
    ),
  },

  notion: {
    type: 'notion',
    catalog: catalogs.notionCatalog,
    Icon: getIntegrationIcon('notion')!,
    ConnectionActions: NotionConnectionActions,
    setup: {
      title: 'Connect your Notion workspace',
      description:
        'Connect Notion to automatically create database items when users submit feedback. Link feedback to your product roadmap in Notion.',
      steps: [
        <p key="1">
          Click <span className="font-medium text-foreground">Connect</span> to authorize Quackback
          with your Notion workspace.
        </p>,
        <p key="2">
          Select which database new feedback items should be created in. The database must have a
          Title property.
        </p>,
        <p key="3">
          Choose which events trigger new database items. You can change this at any time.
        </p>,
      ],
    },
    renderConfig: ({ integration, isConnected }) => (
      <NotionConfig
        integrationId={integration.id}
        initialConfig={integration.config}
        initialEventMappings={integration.eventMappings}
        enabled={isConnected}
      />
    ),
  },

  ntfy: {
    type: 'ntfy',
    catalog: catalogs.ntfyCatalog,
    Icon: getIntegrationIcon('ntfy')!,
    ConnectionActions: NtfyConnectionActions,
    setup: {
      title: 'Connect ntfy',
      description:
        'Connect ntfy to receive instant push notifications when users submit feedback, statuses change, and comments are added.',
      steps: [
        <p key="1">
          Create a topic on <span className="font-medium text-foreground">ntfy.sh</span> or your
          self-hosted ntfy server. Copy the full topic URL (e.g.{' '}
          <code className="text-xs">https://ntfy.sh/my-alerts</code>).
        </p>,
        <p key="2">
          Paste the topic URL below. If your topic is protected, add an access token too. Click{' '}
          <span className="font-medium text-foreground">Save</span> — Quackback will send a test
          notification to verify the channel.
        </p>,
        <p key="3">
          Choose which events should trigger notifications, then install the ntfy app on your
          devices and subscribe to your topic.
        </p>,
      ],
    },
    renderConfig: ({ integration, isConnected }) => (
      <NtfyConfig
        integrationId={integration.id}
        initialEventMappings={integration.eventMappings}
        enabled={isConnected}
      />
    ),
  },

  salesforce: {
    type: 'salesforce',
    catalog: catalogs.salesforceCatalog,
    Icon: getIntegrationIcon('salesforce')!,
    ConnectionActions: SalesforceConnectionActions,
    setup: {
      title: 'Connect Salesforce',
      description:
        'Connect Salesforce to enrich feedback with CRM data. See account details, opportunity stage, and deal value alongside each feedback submission.',
      steps: [
        <p key="1">
          Configure your Salesforce{' '}
          <span className="font-medium text-foreground">Connected App credentials</span> in the
          platform settings.
        </p>,
        <p key="2">
          Click <span className="font-medium text-foreground">Connect</span> to authorize Quackback
          with your Salesforce org.
        </p>,
        <p key="3">
          Contact data will be automatically looked up by email when new feedback is submitted.
        </p>,
      ],
    },
    renderConfig: ({ integration, isConnected }) => (
      <SalesforceConfig
        integrationId={integration.id}
        initialEventMappings={integration.eventMappings}
        enabled={isConnected}
      />
    ),
  },

  // NOTE: segment's route diverges from the standard shape in three ways,
  // preserved here: (1) no `getIntegrationIcon` entry exists for segment (it's
  // neither a tracker nor a feedback-source badge in integration-ui.tsx), so
  // its route renders an inline "S" glyph rather than a brand icon — wrapped
  // in `SegmentIcon` above to fit the `Icon` contract; (2) it has no config
  // panel and no `PlatformCredentialsDialog`/credentials button at all, just
  // connect/disconnect actions; (3) "connected" for segment covers both
  // `active` and `paused` status (same as the header's own isConnected/isPaused
  // union elsewhere, so no divergence in the shared route's rendering).
  segment: {
    type: 'segment',
    catalog: catalogs.segmentCatalog,
    Icon: SegmentIcon,
    ConnectionActions: SegmentConnectionActions,
    setup: {
      title: 'Connect Segment',
      description:
        'Verify signed identify events and optionally publish segment membership changes.',
      steps: [
        <p key="secret">Copy the signing secret from your Segment source or destination.</p>,
        <p key="endpoint">
          Send identify events to <code>/api/integrations/segment/identify</code>.
        </p>,
        <p key="rotate">Reconnect here whenever you rotate either secret.</p>,
      ],
    },
  },

  shortcut: {
    type: 'shortcut',
    catalog: catalogs.shortcutCatalog,
    Icon: getIntegrationIcon('shortcut')!,
    ConnectionActions: ShortcutConnectionActions,
    setup: {
      title: 'Connect your Shortcut workspace',
      description:
        'Connect Shortcut to automatically create stories from feedback and keep statuses in sync across both platforms.',
      steps: [
        <p key="1">
          Generate an API token from your Shortcut account settings and paste it below.
        </p>,
        <p key="2">Select which project new feedback stories should be created in.</p>,
        <p key="3">
          Choose which events trigger story creation. You can change these settings at any time.
        </p>,
      ],
    },
    renderConfig: ({ integration, isConnected }) => (
      <ShortcutConfig
        integrationId={integration.id}
        initialConfig={integration.config}
        initialEventMappings={integration.eventMappings}
        enabled={isConnected}
      />
    ),
  },

  slack: {
    type: 'slack',
    catalog: catalogs.slackCatalog,
    Icon: getIntegrationIcon('slack')!,
    ConnectionActions: SlackConnectionActions,
    setup: {
      title: 'Connect your Slack workspace',
      description:
        'Connect Slack to receive notifications when users submit feedback, when statuses change, and when comments are added.',
      steps: [
        <p key="1">
          Click <span className="font-medium text-foreground">Connect</span> to authorize Quackback
          to post messages to your Slack workspace.
        </p>,
        <p key="2">
          Select which channel notifications should be posted to. The bot must be added to private
          channels before they appear in the list.
        </p>,
        <p key="3">
          Choose which events trigger notifications. You can enable or disable individual event
          types at any time.
        </p>,
      ],
    },
    renderConfig: ({ integration, isConnected }) => (
      <SlackConfig
        integrationId={integration.id}
        initialConfig={integration.config}
        initialEventMappings={integration.eventMappings}
        notificationChannels={integration.notificationChannels}
        enabled={isConnected}
      />
    ),
  },

  stripe: {
    type: 'stripe',
    catalog: catalogs.stripeCatalog,
    Icon: getIntegrationIcon('stripe')!,
    ConnectionActions: StripeConnectionActions,
    setup: {
      title: 'Connect Stripe',
      description:
        'Connect Stripe to enrich feedback with customer revenue data. See MRR, plan tier, and billing status alongside each feedback submission.',
      steps: [
        <p key="1">
          Create a <span className="font-medium text-foreground">restricted API key</span> in your
          Stripe dashboard with read access to Customers.
        </p>,
        <p key="2">
          Paste the API key below and click{' '}
          <span className="font-medium text-foreground">Save</span>. Quackback will verify the
          connection.
        </p>,
        <p key="3">
          Customer data will be automatically looked up by email when new feedback is submitted.
        </p>,
      ],
    },
    renderConfig: ({ integration, isConnected }) => (
      <StripeConfig
        integrationId={integration.id}
        initialEventMappings={integration.eventMappings}
        enabled={isConnected}
      />
    ),
  },

  teams: {
    type: 'teams',
    catalog: catalogs.teamsCatalog,
    Icon: getIntegrationIcon('teams')!,
    ConnectionActions: TeamsConnectionActions,
    setup: {
      title: 'Connect Microsoft Teams',
      description:
        'Connect Microsoft Teams to receive notifications when users submit feedback, when statuses change, and when comments are added.',
      steps: [
        <p key="1">
          Register Quackback in your Azure AD tenant and add the Teams bot permissions.
        </p>,
        <p key="2">
          Click <span className="font-medium text-foreground">Connect</span> to authorize Quackback
          to post to your Teams channels.
        </p>,
        <p key="3">
          Select a team and channel for notifications, then choose which events trigger messages.
        </p>,
      ],
    },
    renderConfig: ({ integration, isConnected }) => (
      <TeamsConfig
        integrationId={integration.id}
        initialConfig={integration.config}
        initialEventMappings={integration.eventMappings}
        enabled={isConnected}
      />
    ),
  },

  trello: {
    type: 'trello',
    catalog: catalogs.trelloCatalog,
    Icon: getIntegrationIcon('trello')!,
    ConnectionActions: TrelloConnectionActions,
    setup: {
      title: 'Connect your Trello workspace',
      description:
        'Connect Trello to create cards from feedback and sync statuses between Trello lists and Quackback.',
      steps: [
        <p key="1">
          Create a Trello Power-Up in your workspace (optional, only needed for custom branding).
        </p>,
        <p key="2">
          Click <span className="font-medium text-foreground">Connect</span> to authorize Quackback
          to access your Trello workspace.
        </p>,
        <p key="3">Select which board and list new feedback cards should be created in.</p>,
        <p key="4">
          Choose which events trigger card creation. You can enable or disable individual event
          types at any time.
        </p>,
      ],
    },
    renderConfig: ({ integration, isConnected }) => (
      <TrelloConfig
        integrationId={integration.id}
        initialConfig={integration.config}
        initialEventMappings={integration.eventMappings}
        enabled={isConnected}
      />
    ),
  },

  zapier: {
    type: 'zapier',
    catalog: catalogs.zapierCatalog,
    Icon: getIntegrationIcon('zapier')!,
    ConnectionActions: ZapierConnectionActions,
    setup: {
      title: 'Connect Zapier',
      description:
        'Connect Zapier to trigger automated workflows when users submit feedback, when statuses change, and when comments are added.',
      steps: [
        <p key="1">
          Create a new Zap in Zapier and add a{' '}
          <span className="font-medium text-foreground">Webhooks by Zapier</span> trigger with{' '}
          <span className="font-medium text-foreground">Catch Hook</span>.
        </p>,
        <p key="2">
          Copy the webhook URL from Zapier and paste it below, then click{' '}
          <span className="font-medium text-foreground">Save</span>. Quackback will send a test
          payload.
        </p>,
        <p key="3">
          Choose which events should trigger your Zap, then continue building your workflow in
          Zapier.
        </p>,
      ],
    },
    renderConfig: ({ integration, isConnected }) => (
      <ZapierConfig
        integrationId={integration.id}
        initialEventMappings={integration.eventMappings}
        enabled={isConnected}
      />
    ),
  },

  zendesk: {
    type: 'zendesk',
    catalog: catalogs.zendeskCatalog,
    Icon: getIntegrationIcon('zendesk')!,
    ConnectionActions: ZendeskConnectionActions,
    setup: {
      title: 'Connect your Zendesk account',
      description:
        'Connect Zendesk to enrich feedback with support context like organization, tags, and ticket history.',
      steps: [
        <p key="1">
          Connect your Zendesk account to authorize read-only access to user and ticket data.
        </p>,
        <p key="2">
          When feedback is submitted by a known email, Quackback looks up their Zendesk profile.
        </p>,
        <p key="3">
          Support context (organization, ticket history) appears alongside their feedback.
        </p>,
      ],
    },
    connectedBanner: (
      <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-green-500" />
          <p className="text-sm text-foreground">
            Zendesk enrichment is active. Support ticket data will automatically appear alongside
            feedback from known contacts.
          </p>
        </div>
      </div>
    ),
  },
}

/** Look up a provider's settings entry by type (underscore form). */
export function getIntegrationSettingsEntry(type: string): IntegrationSettingsEntry | undefined {
  return INTEGRATION_SETTINGS[type]
}
