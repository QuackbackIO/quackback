import { createFileRoute, Link } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import {
  ChatBubbleLeftIcon,
  UsersIcon,
  SwatchIcon,
  PuzzlePieceIcon,
  CheckIcon,
  ArrowRightIcon,
  RocketLaunchIcon,
} from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shared/page-header'
import { cn } from '@/lib/shared/utils'

export interface OnboardingTask {
  id: string
  title: string
  description: string
  isCompleted: boolean
  href: '/admin/settings/boards' | '/admin/settings/team' | '/admin/settings'
  actionLabel: string
  completedLabel: string
}

const taskIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  'create-board': ChatBubbleLeftIcon,
  'invite-team': UsersIcon,
  'customize-branding': SwatchIcon,
  'connect-integrations': PuzzlePieceIcon,
}

export const Route = createFileRoute('/admin/getting-started')({
  loader: async ({ context }) => {
    const { settings, queryClient } = context
    await queryClient.ensureQueryData(adminQueries.onboardingStatus())
    return { settings }
  },
  component: GettingStartedPage,
})

function GettingStartedPage() {
  const { settings } = Route.useLoaderData()
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
  const allComplete = completedCount === tasks.length

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <PageHeader
        icon={RocketLaunchIcon}
        title="Getting Started"
        description={`Complete these steps to set up ${settings!.name}`}
        animate
      />

      {/* Segmented progress */}
      <div className="flex items-center gap-3">
        <div className="flex flex-1 gap-1.5">
          {tasks.map((task) => (
            <div
              key={task.id}
              className={cn(
                'h-1.5 flex-1 rounded-full transition-all duration-500',
                task.isCompleted ? 'bg-primary' : 'bg-border/60'
              )}
            />
          ))}
        </div>
        <span className="text-xs font-medium tabular-nums text-muted-foreground">
          {completedCount} of {tasks.length}
        </span>
      </div>

      {/* Unified task card */}
      <div className="overflow-hidden rounded-xl border border-border/50 bg-card shadow-sm divide-y divide-border/50">
        {tasks.map((task: OnboardingTask, index: number) => {
          const Icon = taskIcons[task.id]
          return (
            <div
              key={task.id}
              className={cn(
                'flex items-start gap-4 p-5 transition-colors animate-in fade-in fill-mode-backwards',
                !task.isCompleted && 'hover:bg-muted/30',
                task.isCompleted && 'bg-muted/20'
              )}
              style={{ animationDelay: `${index * 75}ms`, animationDuration: '300ms' }}
            >
              {/* Step indicator */}
              <div
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all',
                  task.isCompleted ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                )}
              >
                {task.isCompleted ? (
                  <CheckIcon className="h-4 w-4" />
                ) : (
                  <span className="text-sm font-semibold">{index + 1}</span>
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3
                      className={cn(
                        'text-sm font-medium',
                        task.isCompleted
                          ? 'text-muted-foreground line-through decoration-muted-foreground/40'
                          : 'text-foreground'
                      )}
                    >
                      {task.title}
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">{task.description}</p>
                  </div>
                  <Icon
                    className={cn(
                      'h-[18px] w-[18px] shrink-0 mt-0.5',
                      task.isCompleted ? 'text-primary/30' : 'text-muted-foreground/50'
                    )}
                  />
                </div>

                <div className="mt-3">
                  <Button
                    variant={task.isCompleted ? 'outline' : 'default'}
                    size="sm"
                    className="h-8"
                    asChild
                  >
                    <Link to={task.href}>
                      {task.isCompleted ? task.completedLabel : task.actionLabel}
                      <ArrowRightIcon className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Completion message */}
      {allComplete && (
        <div className="flex items-center justify-center gap-2 py-2 animate-in fade-in duration-300">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15">
            <CheckIcon className="h-3 w-3 text-primary" />
          </div>
          <p className="text-sm text-muted-foreground">
            Setup complete —{' '}
            <Link to="/admin/feedback" className="text-primary hover:underline underline-offset-2">
              go to your feedback inbox
            </Link>
          </p>
        </div>
      )}
    </div>
  )
}
