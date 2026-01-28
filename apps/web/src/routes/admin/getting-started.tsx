import { createFileRoute, Link } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/queries/admin'
import {
  ChatBubbleLeftIcon,
  UsersIcon,
  SwatchIcon,
  PuzzlePieceIcon,
  CheckIcon,
  ArrowRightIcon,
} from '@heroicons/react/24/solid'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export interface OnboardingTask {
  id: string
  title: string
  description: string
  isCompleted: boolean
  href: '/admin/settings/boards' | '/admin/settings/team' | '/admin/settings'
  actionLabel: string
  completedLabel: string
}

// Icon mapping - kept in component since React components aren't serializable
const taskIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  'create-board': ChatBubbleLeftIcon,
  'invite-team': UsersIcon,
  'customize-branding': SwatchIcon,
  'connect-integrations': PuzzlePieceIcon,
}

export const Route = createFileRoute('/admin/getting-started')({
  loader: async ({ context }) => {
    // User, member, and settings are validated in parent /admin layout
    const { settings, queryClient } = context

    // Pre-fetch onboarding status using React Query
    await queryClient.ensureQueryData(adminQueries.onboardingStatus())

    return { settings }
  },
  component: GettingStartedPage,
})

function GettingStartedPage() {
  const { settings } = Route.useLoaderData()

  // Read pre-fetched data from React Query cache
  const statusQuery = useSuspenseQuery(adminQueries.onboardingStatus())
  const status = statusQuery.data

  const tasks: OnboardingTask[] = [
    {
      id: 'create-board',
      title: 'Create your first board',
      description: 'Set up a feedback board where users can submit and vote on ideas',
      isCompleted: status.hasBoards,
      href: '/admin/settings/boards',
      actionLabel: 'Create Board',
      completedLabel: 'View Boards',
    },
    {
      id: 'invite-team',
      title: 'Invite team members',
      description: 'Add your team to collaborate on feedback management',
      isCompleted: status.memberCount > 1,
      href: '/admin/settings/team',
      actionLabel: 'Invite Members',
      completedLabel: 'Manage Team',
    },
    {
      id: 'customize-branding',
      title: 'Customize branding',
      description: 'Add your logo and brand colors to match your product',
      isCompleted: false,
      href: '/admin/settings',
      actionLabel: 'Customize',
      completedLabel: 'Edit Branding',
    },
    {
      id: 'connect-integrations',
      title: 'Connect integrations',
      description: 'Connect GitHub, Slack, or Discord to streamline your workflow',
      isCompleted: false,
      href: '/admin/settings',
      actionLabel: 'Connect',
      completedLabel: 'Manage Integrations',
    },
  ]

  const completedCount = tasks.filter((t) => t.isCompleted).length

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-foreground">Getting Started</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Complete these steps to set up {settings!.name}
        </p>
        <div className="mt-4 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${(completedCount / tasks.length) * 100}%` }}
            />
          </div>
          <span className="text-sm font-medium text-muted-foreground">
            {completedCount}/{tasks.length}
          </span>
        </div>
      </div>

      <div className="space-y-3">
        {tasks.map((task: OnboardingTask, index: number) => {
          const Icon = taskIcons[task.id]
          return (
            <Card
              key={task.id}
              className={`transition-colors ${task.isCompleted ? 'bg-muted/30' : 'hover:bg-muted/50'}`}
            >
              <CardContent className="py-4">
                <div className="flex gap-3">
                  <div
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                      task.isCompleted
                        ? 'bg-primary text-primary-foreground'
                        : 'border-2 border-muted-foreground/25 text-muted-foreground'
                    }`}
                  >
                    {task.isCompleted ? (
                      <CheckIcon className="h-3.5 w-3.5" />
                    ) : (
                      <span className="text-xs font-medium">{index + 1}</span>
                    )}
                  </div>

                  <div className="flex-1 space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3
                          className={`font-medium ${task.isCompleted ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                        >
                          {task.title}
                        </h3>
                        <p className="mt-1 text-sm text-muted-foreground">{task.description}</p>
                      </div>
                      <Icon
                        className={`h-5 w-5 shrink-0 ${task.isCompleted ? 'text-muted-foreground/50' : 'text-muted-foreground'}`}
                      />
                    </div>

                    <Button variant={task.isCompleted ? 'ghost' : 'default'} size="sm" asChild>
                      <Link to={task.href}>
                        {task.isCompleted ? task.completedLabel : task.actionLabel}
                        <ArrowRightIcon className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </main>
  )
}
