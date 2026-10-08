import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import { BookOpenIcon } from '@heroicons/react/24/outline'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { EmptyState } from '@/components/shared/empty-state'
import { NewButton } from '@/components/shared/new-button'
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
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertRoutePermission } from '@/lib/shared/route-permission'
import { adminPageHead } from '@/lib/client/admin-head'

export const Route = createFileRoute('/admin/settings/skills')({
  head: adminPageHead('Skills settings'),
  beforeLoad: ({ context }) => {
    assertRoutePermission(context.permissions, PERMISSIONS.ASSISTANT_MANAGE)
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
  const toggle = useUpdateSkill({ autosave: true })
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

  const newButton = (
    <NewButton noun="skill" onClick={openNew}>
      {intl.formatMessage({ id: 'automation.skills.add', defaultMessage: 'New skill' })}
    </NewButton>
  )

  return (
    <SettingsPage
      page="/admin/settings/skills"
      description={intl.formatMessage({
        id: 'automation.skills.description',
        defaultMessage: 'Procedures Quinn follows for specific situations.',
      })}
      actions={newButton}
    >
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
        <SettingsCard flush={skills.length === 0}>
          {skills.length === 0 ? (
            <EmptyState
              size="compact"
              icon={BookOpenIcon}
              title={intl.formatMessage({
                id: 'automation.skills.empty.title',
                defaultMessage: 'No skills yet',
              })}
              description={intl.formatMessage({
                id: 'automation.skills.empty',
                defaultMessage: 'Add a procedure the agents can follow.',
              })}
            />
          ) : (
            <SettingRows>
              {skills.map((skill) => (
                <SettingRow
                  key={skill.id}
                  label={skill.name}
                  description={skill.whenToUse}
                  htmlFor={`skill-enabled-${skill.id}`}
                  control={
                    <>
                      {skill.assignments.agent && <Badge size="sm">Agent</Badge>}
                      {skill.assignments.copilot && <Badge size="sm">Copilot</Badge>}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => openEdit(skill)}
                      >
                        {intl.formatMessage({
                          id: 'automation.skills.edit',
                          defaultMessage: 'Edit',
                        })}
                      </Button>
                      <Switch
                        id={`skill-enabled-${skill.id}`}
                        checked={skill.enabled}
                        onCheckedChange={(checked) =>
                          toggle.mutate({
                            id: skill.id,
                            name: skill.name,
                            whenToUse: skill.whenToUse,
                            instructions: skill.instructions,
                            assignments: skill.assignments,
                            enabled: checked,
                          })
                        }
                      />
                    </>
                  }
                />
              ))}
            </SettingRows>
          )}
        </SettingsCard>
      )}

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
                Delete skill
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => setEditor(null)}>
              {intl.formatMessage({ id: 'common.cancel', defaultMessage: 'Cancel' })}
            </Button>
            <Button type="button" onClick={save}>
              {editor === 'new' ? 'Create skill' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete skill?"
        description="The agents will stop seeing it in the catalogue."
        confirmLabel="Delete skill"
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
    </SettingsPage>
  )
}
