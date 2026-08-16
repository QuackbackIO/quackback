import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { PlusIcon } from '@heroicons/react/24/outline'
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
    <div className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">
            {intl.formatMessage({ id: 'automation.skills.title', defaultMessage: 'Skills' })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {intl.formatMessage({
              id: 'automation.skills.description',
              defaultMessage:
                'Packaged procedures the agents pull on demand. Skills teach; they do not grant tools.',
            })}
          </p>
        </div>
        <Button size="sm" onClick={openNew}>
          <PlusIcon className="size-4" />
          {intl.formatMessage({ id: 'automation.skills.add', defaultMessage: 'Add skill' })}
        </Button>
      </div>

      <SettingsCard>
        {skills.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {intl.formatMessage({
              id: 'automation.skills.empty',
              defaultMessage: 'No skills yet. Add a procedure the agents can follow.',
            })}
          </p>
        ) : (
          skills.map((skill) => (
            <button
              key={skill.id}
              type="button"
              onClick={() => openEdit(skill)}
              className="flex w-full items-start justify-between gap-3 border-b border-border/60 py-3 text-left last:border-0"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{skill.name}</span>
                  {!skill.enabled && <Badge size="sm">Off</Badge>}
                </div>
                <p className="truncate text-xs text-muted-foreground">{skill.whenToUse}</p>
              </div>
              <div className="flex gap-1">
                {skill.assignments.agent && <Badge size="sm">Agent</Badge>}
                {skill.assignments.copilot && <Badge size="sm">Copilot</Badge>}
              </div>
            </button>
          ))
        )}
      </SettingsCard>

      <Dialog open={editor !== null} onOpenChange={(open) => !open && setEditor(null)}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editor === 'new' ? 'Add skill' : 'Edit skill'}</DialogTitle>
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
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="skill-body">Instructions</Label>
              <Textarea
                id="skill-body"
                rows={10}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[13px]">Available to Agent</span>
              <Switch checked={agent} onCheckedChange={setAgent} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[13px]">Available to Copilot</span>
              <Switch checked={copilot} onCheckedChange={setCopilot} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[13px]">Enabled</span>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            {editor && editor !== 'new' && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleting(editor as SkillDTO)}
              >
                Delete
              </Button>
            )}
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
