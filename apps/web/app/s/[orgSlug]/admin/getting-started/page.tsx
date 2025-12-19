import { requireTenantBySlug } from '@/lib/tenant'
import { db, boards, member, eq } from '@/lib/db'
import Link from 'next/link'
import { MessageSquare, Users, Palette, Plug, Check, ArrowRight } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface OnboardingTask {
  id: string
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  isCompleted: boolean
  href: string
  actionLabel: string
  completedLabel: string
}

export default async function GettingStartedPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const { workspace } = await requireTenantBySlug(orgSlug)

  const [orgBoards, members] = await Promise.all([
    db.query.boards.findMany({
      where: eq(boards.workspaceId, workspace.id),
      columns: { id: true },
    }),
    db.select({ id: member.id }).from(member).where(eq(member.workspaceId, workspace.id)),
  ])

  const tasks: OnboardingTask[] = [
    {
      id: 'create-board',
      title: 'Create your first board',
      description: 'Set up a feedback board where users can submit and vote on ideas',
      icon: MessageSquare,
      isCompleted: orgBoards.length > 0,
      href: '/admin/settings/boards',
      actionLabel: 'Create Board',
      completedLabel: 'View Boards',
    },
    {
      id: 'invite-team',
      title: 'Invite team members',
      description: 'Add your team to collaborate on feedback management',
      icon: Users,
      isCompleted: members.length > 1,
      href: '/admin/settings/team',
      actionLabel: 'Invite Members',
      completedLabel: 'Manage Team',
    },
    {
      id: 'customize-branding',
      title: 'Customize branding',
      description: 'Add your logo and brand colors to match your product',
      icon: Palette,
      isCompleted: false,
      href: '/admin/settings',
      actionLabel: 'Customize',
      completedLabel: 'Edit Branding',
    },
    {
      id: 'connect-integrations',
      title: 'Connect integrations',
      description: 'Connect GitHub, Slack, or Discord to streamline your workflow',
      icon: Plug,
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
          Complete these steps to set up {workspace.name}
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
        {tasks.map((task, index) => {
          const Icon = task.icon
          const isCompleted = task.isCompleted
          return (
            <Card
              key={task.id}
              className={`transition-colors ${isCompleted ? 'bg-muted/30' : 'hover:bg-muted/50'}`}
            >
              <CardContent className="py-4">
                <div className="flex gap-3">
                  <div
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                      isCompleted
                        ? 'bg-primary text-primary-foreground'
                        : 'border-2 border-muted-foreground/25 text-muted-foreground'
                    }`}
                  >
                    {isCompleted ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <span className="text-xs font-medium">{index + 1}</span>
                    )}
                  </div>

                  <div className="flex-1 space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3
                          className={`font-medium ${isCompleted ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                        >
                          {task.title}
                        </h3>
                        <p className="mt-1 text-sm text-muted-foreground">{task.description}</p>
                      </div>
                      <Icon
                        className={`h-5 w-5 shrink-0 ${isCompleted ? 'text-muted-foreground/50' : 'text-muted-foreground'}`}
                      />
                    </div>

                    <Button variant={isCompleted ? 'ghost' : 'default'} size="sm" asChild>
                      <Link href={task.href}>
                        {isCompleted ? task.completedLabel : task.actionLabel}
                        <ArrowRight className="h-4 w-4" />
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
