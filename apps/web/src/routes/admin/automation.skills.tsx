import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { BookOpenIcon, PlusIcon } from '@heroicons/react/24/outline'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { DefaultErrorPage } from '@/components/shared/error-page'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { skillQueries } from '@/lib/client/queries/assistant-skills'
import {
  useCreateSkill,
  useDeleteSkill,
  useUpdateSkill,
} from '@/lib/client/mutations/assistant-skills'
import { skillInputSchema, type SkillDTO } from '@/lib/shared/assistant/skills'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { BackLink } from '@/components/ui/back-link'

export const Route = createFileRoute('/admin/automation/skills')({
  beforeLoad: ({ context }) => {
    const permissions = (context as { permissions?: PermissionKey[] }).permissions ?? []
    if (!permissions.includes(PERMISSIONS.ASSISTANT_MANAGE)) {
      throw new Error('Access denied: requires assistant.manage')
    }
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(skillQueries.list())
  },
  errorComponent: ({ error, reset }) => (
    <DefaultErrorPage error={error} reset={reset} fullPage={false} />
  ),
  component: SkillsPage,
})

function SkillsPage() {
  const intl = useIntl()
  const list = useQuery(skillQueries.list())
  const create = useCreateSkill()
  const update = useUpdateSkill()
  const remove = useDeleteSkill()
  const [editor, setEditor] = useState<Partial<SkillDTO> | 'new' | null>(null)
  const [deleting, setDeleting] = useState<SkillDTO | null>(null)
  const [name, setName] = useState('')
  const [whenToUse, setWhenToUse] = useState('')
  const [instructions, setInstructions] = useState('')
  const [agent, setAgent] = useState(false)
  const [copilot, setCopilot] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const openNew = () => {
    setEditor('new')
    setName('')
    setWhenToUse('')
    setInstructions('')
    setAgent(false)
    setCopilot(false)
    setEnabled(true)
    setError(null)
  }

  const openEdit = (skill: SkillDTO) => {
    setEditor(skill)
    setName(skill.name)
    setWhenToUse(skill.whenToUse)
    setInstructions(skill.instructions)
    setAgent(skill.assignments.agent)
    setCopilot(skill.assignments.copilot)
    setEnabled(skill.enabled)
    setError(null)
  }

  const save = () => {
    const parsed = skillInputSchema.safeParse({
      name,
      whenToUse,
      instructions,
      assignments: { agent, copilot },
      enabled,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid skill')
      return
    }
    if (editor === 'new') {
      create.mutate(parsed.data, {
        onSuccess: () => {
          setEditor(null)
          toast.success('Skill added')
        },
        onError: (err) => setError(err instanceof Error ? err.message : 'Could not save'),
      })
      return
    }
    if (editor && editor.id) {
      update.mutate(
        { id: editor.id, ...parsed.data },
        {
          onSuccess: () => {
            setEditor(null)
            toast.success('Skill saved')
          },
          onError: (err) => setError(err instanceof Error ? err.message : 'Could not save'),
        }
      )
    }
  }

  const skills = list.data?.skills ?? []

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div className="lg:hidden">
        <BackLink to="/admin/automation">
          {intl.formatMessage({ id: 'automation.nav.label', defaultMessage: 'AI & Automation' })}
        </BackLink>
      </div>
      <div className="flex items-start justify-between gap-4">
        <div className="flex gap-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BookOpenIcon className="size-[18px]" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">
              {intl.formatMessage({ id: 'automation.skills.title', defaultMessage: 'Skills' })}
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {intl.formatMessage({
                id: 'automation.skills.description',
                defaultMessage:
                  'Procedures Quinn follows for specific situations. Loaded only when relevant.',
              })}
            </p>
          </div>
        </div>
        <Button size="sm" onClick={openNew}>
          <PlusIcon className="size-4" />
          {intl.formatMessage({ id: 'automation.skills.add', defaultMessage: 'New skill' })}
        </Button>
      </div>

      {list.isPending ? (
        <p className="text-sm text-muted-foreground">
          {intl.formatMessage({
            id: 'automation.skills.loading',
            defaultMessage: 'Loading skills…',
          })}
        </p>
      ) : list.isError ? (
        <p className="text-sm text-destructive">
          {intl.formatMessage({
            id: 'automation.skills.loadError',
            defaultMessage: 'Could not load skills.',
          })}
        </p>
      ) : (
        <SettingsCard contentClassName={skills.length === 0 ? undefined : 'p-0'}>
          {skills.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {intl.formatMessage({
                id: 'automation.skills.empty',
                defaultMessage: 'No skills yet. Add a procedure the agents can follow.',
              })}
            </p>
          ) : (
            skills.map((skill) => (
              <div
                key={skill.id}
                className="flex items-center gap-3 border-b border-border/60 px-4 py-3.5 last:border-0 sm:px-[18px]"
              >
                <Switch
                  checked={skill.enabled}
                  aria-label={skill.enabled ? 'Enabled' : 'Disabled'}
                  onCheckedChange={(checked) =>
                    update.mutate(
                      {
                        id: skill.id,
                        name: skill.name,
                        whenToUse: skill.whenToUse,
                        instructions: skill.instructions,
                        assignments: skill.assignments,
                        enabled: checked,
                      },
                      { onError: () => toast.error('Could not update skill') }
                    )
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold">{skill.name}</div>
                  <p className="truncate text-xs text-muted-foreground">{skill.whenToUse}</p>
                </div>
                {skill.assignments.agent && <Badge size="sm">Agent</Badge>}
                {skill.assignments.copilot && <Badge size="sm">Copilot</Badge>}
                <Button type="button" size="sm" variant="ghost" onClick={() => openEdit(skill)}>
                  {intl.formatMessage({ id: 'automation.skills.edit', defaultMessage: 'Edit' })}
                </Button>
              </div>
            ))
          )}
        </SettingsCard>
      )}
      <p className="text-xs text-muted-foreground">
        {intl.formatMessage({
          id: 'automation.skills.footer',
          defaultMessage:
            "Quinn always sees each skill's name and when to use it; the full instructions load only when a conversation calls for them.",
        })}
      </p>

      <Dialog open={editor !== null} onOpenChange={(open) => !open && setEditor(null)}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editor === 'new'
                ? intl.formatMessage({
                    id: 'automation.skills.editor.new',
                    defaultMessage: 'New skill',
                  })
                : intl.formatMessage({
                    id: 'automation.skills.editor.edit',
                    defaultMessage: 'Edit skill',
                  })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="skill-name">Name</Label>
              <Input id="skill-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="skill-when">When to use</Label>
              <Input
                id="skill-when"
                value={whenToUse}
                onChange={(e) => setWhenToUse(e.target.value)}
              />
              <p className="text-[11.5px] text-muted-foreground">
                {intl.formatMessage({
                  id: 'automation.skills.whenHint',
                  defaultMessage:
                    'Always visible to Quinn. Keep it to one line; it decides when the skill loads.',
                })}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="skill-body">Instructions</Label>
              <Textarea
                id="skill-body"
                className="font-mono text-xs leading-relaxed"
                rows={8}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
              <p className="text-[11.5px] text-muted-foreground">
                {intl.formatMessage({
                  id: 'automation.skills.instructionsHint',
                  defaultMessage: 'Markdown. You can mention connector or built-in tools by name.',
                })}
              </p>
            </div>
            <div className="flex gap-2.5">
              <div className="flex flex-1 items-center justify-between rounded-lg border border-border px-3 py-2">
                <span id="skill-assign-agent" className="text-[13px] font-semibold">
                  Agent
                </span>
                <Switch
                  aria-labelledby="skill-assign-agent"
                  checked={agent}
                  onCheckedChange={setAgent}
                />
              </div>
              <div className="flex flex-1 items-center justify-between rounded-lg border border-border px-3 py-2">
                <span id="skill-assign-copilot" className="text-[13px] font-semibold">
                  Copilot
                </span>
                <Switch
                  aria-labelledby="skill-assign-copilot"
                  checked={copilot}
                  onCheckedChange={setCopilot}
                />
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            {editor && editor !== 'new' && (
              <Button
                type="button"
                variant="outline"
                className="me-auto"
                onClick={() => setDeleting(editor as SkillDTO)}
              >
                Delete
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => setEditor(null)}>
              {intl.formatMessage({ id: 'common.cancel', defaultMessage: 'Cancel' })}
            </Button>
            <Button type="button" onClick={save}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this skill?"
        description="The agents will stop seeing it in the catalogue."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (!deleting) return
          remove.mutate(deleting.id, {
            onSuccess: () => {
              setDeleting(null)
              setEditor(null)
            },
            onError: () => toast.error('Could not delete'),
          })
        }}
      />
    </div>
  )
}
