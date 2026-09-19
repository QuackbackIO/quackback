import { QuinnReviewQueue } from '@/components/admin/automation/quinn-review-queue'
import { QuinnUnconfirmedSignal } from '@/components/admin/automation/quinn-unconfirmed-signal'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { BookOpenIcon, ChatBubbleLeftRightIcon, LinkIcon } from '@heroicons/react/24/solid'
import { AutomationNav } from '@/components/admin/automation/automation-nav'
import { assistantQueries } from '@/lib/client/queries/assistant'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { Badge } from '@/components/ui/badge'

export const Route = createFileRoute('/admin/automation/')({ component: OverviewPage })
function OverviewPage() {
  const { permissions } = Route.useRouteContext()
  if (!(permissions ?? []).includes(PERMISSIONS.ASSISTANT_MANAGE)) return <AutomationNav />
  return <QuinnOverview />
}
function QuinnOverview() {
  const { settings, permissions } = Route.useRouteContext()
  const assistant = useQuery(assistantQueries.settings())
  const deployment = settings?.publicWidgetConfig?.messenger?.assistant
  const customerOn =
    settings?.featureFlags?.supportInbox &&
    deployment?.enabled !== false &&
    deployment?.respond !== false
  const teamOn = assistant.data?.config.agents.copilot.capabilities.qa
  const availability = assistant.isError
    ? 'Unavailable'
    : assistant.isPending
      ? 'Loading…'
      : !assistant.data.configured
        ? 'Setup required'
        : null
  return (
    <div className="max-w-4xl space-y-7">
      <div className="lg:hidden">
        <AutomationNav />
      </div>
      <header>
        <h1 className="text-lg font-semibold">Quinn</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Help customers resolve issues and support your teammates with approved knowledge, guidance
          and actions.
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        <UseCard
          title="Customer conversations"
          status={availability ?? (customerOn ? 'On in Messenger' : 'Paused')}
          description="Answer customers using your approved knowledge and permitted actions."
        />
        <UseCard
          title="Support teammates"
          inbox={(permissions ?? []).includes(PERMISSIONS.CONVERSATION_VIEW)}
          status={availability ?? (teamOn ? 'On in the inbox' : 'Off')}
          description="Private help and suggested replies alongside the conversation."
        />
      </div>
      {(permissions ?? []).includes(PERMISSIONS.CONVERSATION_VIEW) && (
        <>
          <QuinnUnconfirmedSignal />
          <QuinnReviewQueue title="Needs attention" limit={5} />
        </>
      )}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">What Quinn works from</h2>
        <div className="divide-y rounded-xl border border-border/50 bg-card">
          {[
            {
              title: 'Knowledge',
              to: '/admin/automation/knowledge',
              icon: BookOpenIcon,
              description: 'Choose which sources Quinn can use.',
            },
            {
              title: 'Guidance',
              to: '/admin/automation/guidance',
              icon: ChatBubbleLeftRightIcon,
              description:
                'Teach Quinn how to handle everyday conversations and specific situations.',
            },
            {
              title: 'Connections',
              to: '/admin/automation/connectors',
              icon: LinkIcon,
              description: 'Control access to connected services and built-in actions.',
            },
          ].map(({ title, to, icon: Icon, description }) => (
            <Link key={title} to={to} className="flex items-start gap-3 p-4 hover:bg-muted/30">
              <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <div>
                <h3 className="text-sm font-medium">{title}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{description}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
function UseCard({
  title,
  status,
  description,
  inbox = false,
}: {
  title: string
  status: string
  description: string
  inbox?: boolean
}) {
  return (
    <section className="rounded-xl border border-border/50 bg-card p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        <Badge variant="outline" size="sm">
          {status}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
      {inbox && (
        <Link to="/admin/inbox" className="me-4 inline-block text-sm font-medium text-primary">
          Open the inbox
        </Link>
      )}
      <Link to="/admin/automation/deploy" className="inline-block text-sm font-medium text-primary">
        Manage deployment
      </Link>
    </section>
  )
}
