import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { toast } from 'sonner'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/solid'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { SearchInput } from '@/components/shared/search-input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { assistantQueries } from '@/lib/client/queries/assistant'
import {
  type GuidanceRuleInput,
  useCreateGuidanceRule,
  useDeleteGuidanceRule,
  useReorderGuidanceRules,
  useUpdateGuidanceRule,
} from '@/lib/client/mutations/assistant'
import { type AssistantAgentKind } from '@/lib/shared/assistant/config'
import {
  ASSISTANT_GUIDANCE_APPLIES_WHEN_MAX_LENGTH,
  ASSISTANT_GUIDANCE_INSTRUCTION_MAX_LENGTH,
  ASSISTANT_GUIDANCE_NAME_MAX_LENGTH,
  DEFAULT_ASSISTANT_GUIDANCE_AGENT,
} from '@/lib/shared/assistant/guidance'
import type { AssistantGuidanceRule } from '@/lib/server/domains/assistant/guidance.service'
import { useUnsavedChanges } from './assistant-form'

const FALLBACK_CHAR_BUDGET = 4_000

type GuidanceSearchRule = Pick<AssistantGuidanceRule, 'name' | 'appliesWhen' | 'instruction'>

export function guidanceRuleMatchesQuery(rule: GuidanceSearchRule, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return true
  return [rule.name, rule.appliesWhen ?? '', rule.instruction].some((value) =>
    value.toLocaleLowerCase().includes(normalizedQuery)
  )
}

function ruleInput(rule: AssistantGuidanceRule): GuidanceRuleInput {
  return {
    name: rule.name,
    appliesWhen: rule.appliesWhen,
    instruction: rule.instruction,
    agent: rule.agent as AssistantAgentKind,
    enabled: rule.enabled,
    priority: rule.priority,
  }
}

export function GuidanceRulesCard() {
  const intl = useIntl()
  const rulesQuery = useQuery(assistantQueries.guidanceRules())
  const statsQuery = useQuery(assistantQueries.guidanceRuleStats())
  const createRule = useCreateGuidanceRule()
  const updateRule = useUpdateGuidanceRule()
  const deleteRule = useDeleteGuidanceRule()
  const reorderRules = useReorderGuidanceRules()
  const [rules, setRules] = useState<AssistantGuidanceRule[]>([])
  const [query, setQuery] = useState('')
  const [editingRule, setEditingRule] = useState<AssistantGuidanceRule | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deletingRule, setDeletingRule] = useState<AssistantGuidanceRule | null>(null)
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    if (rulesQuery.data) setRules(rulesQuery.data.rules)
  }, [rulesQuery.data])

  if (rulesQuery.isError) {
    return (
      <SettingsCard
        title={intl.formatMessage({
          id: 'automation.agent.guidance.title',
          defaultMessage: 'Situational guidance',
        })}
      >
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-sm text-destructive">
            {intl.formatMessage({
              id: 'automation.agent.guidance.loadError',
              defaultMessage: 'Guidance could not be loaded.',
            })}
          </p>
          <Button variant="outline" size="sm" onClick={() => void rulesQuery.refetch()}>
            {intl.formatMessage({ id: 'automation.agent.retry', defaultMessage: 'Try again' })}
          </Button>
        </div>
      </SettingsCard>
    )
  }

  if (rulesQuery.isPending) {
    return (
      <SettingsCard
        title={intl.formatMessage({
          id: 'automation.agent.guidance.title',
          defaultMessage: 'Situational guidance',
        })}
      >
        <p role="status" className="text-sm text-muted-foreground">
          {intl.formatMessage({
            id: 'automation.agent.guidance.loading',
            defaultMessage: 'Loading guidance…',
          })}
        </p>
      </SettingsCard>
    )
  }

  const filteredRules = rules.filter((rule) => guidanceRuleMatchesQuery(rule, query))
  const charBudget = rulesQuery.data.charBudget ?? FALLBACK_CHAR_BUDGET
  const enabledChars = rules
    .filter((rule) => rule.enabled)
    .reduce((sum, rule) => sum + rule.instruction.length, 0)

  const agentLabel = (agent: AssistantAgentKind) =>
    agent === 'copilot'
      ? intl.formatMessage({
          id: 'automation.agent.guidance.agent.copilot',
          defaultMessage: 'Copilot',
        })
      : intl.formatMessage({
          id: 'automation.agent.guidance.agent.agent',
          defaultMessage: 'Agent',
        })

  async function toggleEnabled(rule: AssistantGuidanceRule) {
    const next = { ...ruleInput(rule), enabled: !rule.enabled }
    setRules((current) =>
      current.map((candidate) =>
        candidate.id === rule.id ? { ...candidate, enabled: next.enabled } : candidate
      )
    )
    try {
      await updateRule.mutateAsync({ id: rule.id, ...next })
    } catch {
      setRules((current) =>
        current.map((candidate) =>
          candidate.id === rule.id ? { ...candidate, enabled: rule.enabled } : candidate
        )
      )
      toast.error(
        intl.formatMessage({
          id: 'automation.agent.guidance.updateError',
          defaultMessage: 'Guidance could not be updated.',
        })
      )
    }
  }

  async function move(rule: AssistantGuidanceRule, direction: -1 | 1) {
    const index = rules.findIndex((candidate) => candidate.id === rule.id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= rules.length) return
    const previous = rules
    const next = [...rules]
    ;[next[index], next[target]] = [next[target], next[index]]
    setRules(next)
    try {
      await reorderRules.mutateAsync(next.map((candidate) => candidate.id))
      setAnnouncement(
        intl.formatMessage(
          {
            id: 'automation.agent.guidance.moved',
            defaultMessage: '{name} moved to position {position}.',
          },
          { name: rule.name, position: target + 1 }
        )
      )
    } catch {
      setRules(previous)
      toast.error(
        intl.formatMessage({
          id: 'automation.agent.guidance.reorderError',
          defaultMessage: 'Guidance could not be reordered.',
        })
      )
    }
  }

  async function saveRule(input: GuidanceRuleInput) {
    if (editingRule) {
      const savedRule = await updateRule.mutateAsync({ id: editingRule.id, ...input })
      if (savedRule) {
        setRules((current) =>
          current.map((candidate) => (candidate.id === editingRule.id ? savedRule : candidate))
        )
      }
    } else {
      const savedRule = await createRule.mutateAsync(input)
      setRules((current) => [...current, savedRule])
    }
  }

  async function confirmDelete() {
    if (!deletingRule) return
    try {
      await deleteRule.mutateAsync(deletingRule.id)
      setRules((current) => current.filter((rule) => rule.id !== deletingRule.id))
      setDeletingRule(null)
    } catch {
      toast.error(
        intl.formatMessage({
          id: 'automation.agent.guidance.deleteError',
          defaultMessage: 'Guidance could not be deleted.',
        })
      )
    }
  }

  return (
    <>
      <SettingsCard
        title={intl.formatMessage({
          id: 'automation.agent.guidance.title',
          defaultMessage: 'Situational guidance',
        })}
        description={intl.formatMessage({
          id: 'automation.agent.guidance.description',
          defaultMessage: 'Tell the AI agent what to do when a conversation matches a situation.',
        })}
        action={
          <Button
            type="button"
            size="sm"
            className="min-h-11 sm:min-h-8"
            onClick={() => {
              setEditingRule(null)
              setDialogOpen(true)
            }}
          >
            <PlusIcon className="size-4" />
            {intl.formatMessage({
              id: 'automation.agent.guidance.add',
              defaultMessage: 'Add guidance',
            })}
          </Button>
        }
      >
        <div className="space-y-4">
          {rules.length > 0 && (
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder={intl.formatMessage({
                id: 'automation.agent.guidance.search',
                defaultMessage: 'Search guidance',
              })}
            />
          )}

          {rules.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 p-5">
              <p className="text-sm font-medium">
                {intl.formatMessage({
                  id: 'automation.agent.guidance.emptyTitle',
                  defaultMessage: 'Add guidance for a specific situation',
                })}
              </p>
              <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                {intl.formatMessage({
                  id: 'automation.agent.guidance.emptyDescription',
                  defaultMessage:
                    'For example, when a customer asks about refunds, explain the 30-day policy before sharing the relevant Help Center article.',
                })}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4 min-h-11 sm:min-h-8"
                onClick={() => {
                  setEditingRule(null)
                  setDialogOpen(true)
                }}
              >
                {intl.formatMessage({
                  id: 'automation.agent.guidance.add',
                  defaultMessage: 'Add guidance',
                })}
              </Button>
            </div>
          ) : filteredRules.length === 0 ? (
            <p className="py-5 text-center text-sm text-muted-foreground">
              {intl.formatMessage(
                {
                  id: 'automation.agent.guidance.noResults',
                  defaultMessage: 'No guidance matches “{query}”.',
                },
                { query: query.trim() }
              )}
            </p>
          ) : (
            <div className="divide-y divide-border/60">
              {filteredRules.map((rule) => {
                const index = rules.findIndex((candidate) => candidate.id === rule.id)
                const stat = statsQuery.data?.[rule.id]
                return (
                  <article key={rule.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
                    <div className="flex items-start gap-3">
                      <Switch
                        checked={rule.enabled}
                        onCheckedChange={() => void toggleEnabled(rule)}
                        aria-label={intl.formatMessage(
                          {
                            id: 'automation.agent.guidance.enableAria',
                            defaultMessage: 'Enable {name}',
                          },
                          { name: rule.name }
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-medium">{rule.name}</h3>
                          <Badge variant="outline" size="sm">
                            {rule.appliesWhen
                              ? intl.formatMessage({
                                  id: 'automation.agent.guidance.conditional',
                                  defaultMessage: 'Conditional',
                                })
                              : intl.formatMessage({
                                  id: 'automation.agent.guidance.alwaysOn',
                                  defaultMessage: 'Always on',
                                })}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {rule.appliesWhen ??
                            intl.formatMessage({
                              id: 'automation.agent.guidance.everyConversation',
                              defaultMessage: 'Applies to every eligible customer conversation.',
                            })}
                        </p>
                        <p className="mt-2 line-clamp-2 text-sm">{rule.instruction}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <Badge variant="outline" size="sm">
                            {agentLabel(rule.agent as AssistantAgentKind)}
                          </Badge>
                          <span>
                            {intl.formatMessage(
                              {
                                id: 'automation.agent.guidance.applied',
                                defaultMessage: 'Applied {count} times',
                              },
                              { count: stat?.applied ?? 0 }
                            )}
                          </span>
                          <span>
                            {stat?.lastAppliedAt
                              ? intl.formatMessage(
                                  {
                                    id: 'automation.agent.guidance.lastApplied',
                                    defaultMessage: 'Last applied {date}',
                                  },
                                  {
                                    date: intl.formatDate(stat.lastAppliedAt, {
                                      dateStyle: 'medium',
                                      timeStyle: 'short',
                                    }),
                                  }
                                )
                              : intl.formatMessage({
                                  id: 'automation.agent.guidance.neverApplied',
                                  defaultMessage: 'Not applied yet',
                                })}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11 sm:size-8"
                        disabled={index === 0 || reorderRules.isPending || Boolean(query.trim())}
                        aria-label={intl.formatMessage(
                          {
                            id: 'automation.agent.guidance.moveUp',
                            defaultMessage: 'Move {name} up',
                          },
                          { name: rule.name }
                        )}
                        onClick={() => void move(rule, -1)}
                      >
                        <ArrowUpIcon className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11 sm:size-8"
                        disabled={
                          index === rules.length - 1 ||
                          reorderRules.isPending ||
                          Boolean(query.trim())
                        }
                        aria-label={intl.formatMessage(
                          {
                            id: 'automation.agent.guidance.moveDown',
                            defaultMessage: 'Move {name} down',
                          },
                          { name: rule.name }
                        )}
                        onClick={() => void move(rule, 1)}
                      >
                        <ArrowDownIcon className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11 sm:size-8"
                        aria-label={intl.formatMessage(
                          {
                            id: 'automation.agent.guidance.editAria',
                            defaultMessage: 'Edit {name}',
                          },
                          { name: rule.name }
                        )}
                        onClick={() => {
                          setEditingRule(rule)
                          setDialogOpen(true)
                        }}
                      >
                        <PencilSquareIcon className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11 text-muted-foreground hover:text-destructive sm:size-8"
                        aria-label={intl.formatMessage(
                          {
                            id: 'automation.agent.guidance.deleteAria',
                            defaultMessage: 'Delete {name}',
                          },
                          { name: rule.name }
                        )}
                        onClick={() => setDeletingRule(rule)}
                      >
                        <TrashIcon className="size-4" />
                      </Button>
                    </div>
                  </article>
                )
              })}
            </div>
          )}

          <div className="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              {intl.formatMessage(
                {
                  id: 'automation.agent.guidance.budget',
                  defaultMessage: '{used} of {total} characters across enabled guidance',
                },
                { used: enabledChars, total: charBudget }
              )}
            </span>
            {query.trim() && (
              <span>
                {intl.formatMessage({
                  id: 'automation.agent.guidance.reorderSearch',
                  defaultMessage: 'Clear search to change the order.',
                })}
              </span>
            )}
          </div>
          {statsQuery.isError && (
            <div className="flex items-center justify-between gap-3">
              <p role="alert" className="text-xs text-muted-foreground">
                {intl.formatMessage({
                  id: 'automation.agent.guidance.statsError',
                  defaultMessage: 'Application history could not be loaded.',
                })}
              </p>
              <Button variant="ghost" size="sm" onClick={() => void statsQuery.refetch()}>
                {intl.formatMessage({ id: 'automation.agent.retry', defaultMessage: 'Try again' })}
              </Button>
            </div>
          )}
          <p className="sr-only" role="status" aria-live="polite">
            {announcement}
          </p>
        </div>
      </SettingsCard>

      <GuidanceRuleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        rule={editingRule}
        defaultPriority={rules.length}
        enabledCharsExcludingSelf={
          enabledChars - (editingRule?.enabled ? editingRule.instruction.length : 0)
        }
        charBudget={charBudget}
        onSave={saveRule}
      />

      <ConfirmDialog
        open={Boolean(deletingRule)}
        onOpenChange={(open) => {
          if (!open) setDeletingRule(null)
        }}
        title={intl.formatMessage({
          id: 'automation.agent.guidance.deleteTitle',
          defaultMessage: 'Delete guidance?',
        })}
        description={intl.formatMessage(
          {
            id: 'automation.agent.guidance.deleteDescription',
            defaultMessage:
              '“{name}” will no longer be available to the AI agent. This cannot be undone.',
          },
          { name: deletingRule?.name ?? '' }
        )}
        confirmLabel={intl.formatMessage({
          id: 'automation.agent.guidance.deleteConfirm',
          defaultMessage: 'Delete guidance',
        })}
        cancelLabel={intl.formatMessage({
          id: 'automation.common.cancel',
          defaultMessage: 'Cancel',
        })}
        variant="destructive"
        isPending={deleteRule.isPending}
        onConfirm={confirmDelete}
      />
    </>
  )
}

function GuidanceRuleDialog({
  open,
  onOpenChange,
  rule,
  defaultPriority,
  enabledCharsExcludingSelf,
  charBudget,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  rule: AssistantGuidanceRule | null
  defaultPriority: number
  enabledCharsExcludingSelf: number
  charBudget: number
  onSave: (input: GuidanceRuleInput) => Promise<void>
}) {
  const intl = useIntl()
  const errorSummaryRef = useRef<HTMLDivElement>(null)
  const [name, setName] = useState('')
  const [conditionMode, setConditionMode] = useState<'always' | 'conditional'>('always')
  const [appliesWhen, setAppliesWhen] = useState('')
  const [instruction, setInstruction] = useState('')
  // The "Applies to" picker below owns which peer agent a rule targets. New rules
  // default to the Agent; editing initializes to (and can change) the rule's own
  // agent — this card lists both agents' rules, so keeping the picker editable on
  // edit lets a rule be reassigned rather than stranding it. (Chosen over a
  // disabled-on-edit picker; Phase 2's Copilot page will add a per-agent surface.)
  const [agent, setAgent] = useState<AssistantAgentKind>(DEFAULT_ASSISTANT_GUIDANCE_AGENT)
  const [enabled, setEnabled] = useState(true)
  const [priority, setPriority] = useState(0)
  const [error, setError] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(rule?.name ?? '')
    setConditionMode(rule?.appliesWhen ? 'conditional' : 'always')
    setAppliesWhen(rule?.appliesWhen ?? '')
    setInstruction(rule?.instruction ?? '')
    setAgent((rule?.agent as AssistantAgentKind | undefined) ?? DEFAULT_ASSISTANT_GUIDANCE_AGENT)
    setEnabled(rule?.enabled ?? true)
    setPriority(rule?.priority ?? defaultPriority)
    setError('')
    setErrors({})
  }, [open, rule, defaultPriority])

  const initial: GuidanceRuleInput = rule
    ? ruleInput(rule)
    : {
        name: '',
        appliesWhen: null,
        instruction: '',
        agent: DEFAULT_ASSISTANT_GUIDANCE_AGENT,
        enabled: true,
        priority: defaultPriority,
      }
  const current: GuidanceRuleInput = {
    name,
    appliesWhen: conditionMode === 'conditional' ? appliesWhen : null,
    instruction,
    agent,
    enabled,
    priority,
  }
  const dirty = open && JSON.stringify(current) !== JSON.stringify(initial)
  useUnsavedChanges(dirty, 'guidance')

  const liveTotal = enabledCharsExcludingSelf + (enabled ? instruction.length : 0)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const nextErrors: Record<string, string> = {}
    if (!name.trim()) {
      nextErrors.name = intl.formatMessage({
        id: 'automation.agent.guidance.nameRequired',
        defaultMessage: 'Enter a name for this guidance.',
      })
    } else if (name.length > ASSISTANT_GUIDANCE_NAME_MAX_LENGTH) {
      nextErrors.name = intl.formatMessage({
        id: 'automation.agent.guidance.nameTooLong',
        defaultMessage: 'Use 80 characters or fewer.',
      })
    }
    if (conditionMode === 'conditional' && !appliesWhen.trim()) {
      nextErrors.appliesWhen = intl.formatMessage({
        id: 'automation.agent.guidance.conditionRequired',
        defaultMessage: 'Describe when this guidance should apply.',
      })
    } else if (appliesWhen.length > ASSISTANT_GUIDANCE_APPLIES_WHEN_MAX_LENGTH) {
      nextErrors.appliesWhen = intl.formatMessage({
        id: 'automation.agent.guidance.conditionTooLong',
        defaultMessage: 'Use 500 characters or fewer.',
      })
    }
    if (!instruction.trim()) {
      nextErrors.instruction = intl.formatMessage({
        id: 'automation.agent.guidance.instructionRequired',
        defaultMessage: 'Describe what the AI agent should do.',
      })
    } else if (instruction.length > ASSISTANT_GUIDANCE_INSTRUCTION_MAX_LENGTH) {
      nextErrors.instruction = intl.formatMessage({
        id: 'automation.agent.guidance.instructionTooLong',
        defaultMessage: 'Use 1,000 characters or fewer.',
      })
    }
    if (liveTotal > charBudget) {
      nextErrors.budget = intl.formatMessage({
        id: 'automation.agent.guidance.budgetExceeded',
        defaultMessage: 'Shorten or disable guidance before saving to stay within the budget.',
      })
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      requestAnimationFrame(() => errorSummaryRef.current?.focus())
      return
    }

    setSaving(true)
    setError('')
    try {
      await onSave({
        ...current,
        name: name.trim(),
        appliesWhen: conditionMode === 'conditional' ? appliesWhen.trim() : null,
        instruction: instruction.trim(),
      })
      onOpenChange(false)
    } catch {
      setError(
        intl.formatMessage({
          id: 'automation.agent.guidance.saveError',
          defaultMessage: 'Guidance could not be saved. Your draft is still here.',
        })
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {rule
              ? intl.formatMessage({
                  id: 'automation.agent.guidance.editTitle',
                  defaultMessage: 'Edit guidance',
                })
              : intl.formatMessage({
                  id: 'automation.agent.guidance.addTitle',
                  defaultMessage: 'Add guidance',
                })}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          {Object.keys(errors).length > 1 && (
            <div
              ref={errorSummaryRef}
              tabIndex={-1}
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {intl.formatMessage({
                id: 'automation.agent.guidance.validationSummary',
                defaultMessage: 'Review the highlighted fields before saving.',
              })}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="guidance-name">
              {intl.formatMessage({
                id: 'automation.agent.guidance.nameLabel',
                defaultMessage: 'Name this guidance',
              })}
            </Label>
            <Input
              id="guidance-name"
              value={name}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'guidance-name-error' : undefined}
              onChange={(event) => setName(event.target.value)}
            />
            {errors.name && (
              <p id="guidance-name-error" className="text-xs text-destructive">
                {errors.name}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="guidance-agent">
              {intl.formatMessage({
                id: 'automation.agent.guidance.appliesToLabel',
                defaultMessage: 'Applies to',
              })}
            </Label>
            <Select value={agent} onValueChange={(value) => setAgent(value as AssistantAgentKind)}>
              <SelectTrigger id="guidance-agent" size="sm" className="w-full sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="agent">
                  {intl.formatMessage({
                    id: 'automation.agent.guidance.agent.agent',
                    defaultMessage: 'Agent',
                  })}
                </SelectItem>
                <SelectItem value="copilot">
                  {intl.formatMessage({
                    id: 'automation.agent.guidance.agent.copilot',
                    defaultMessage: 'Copilot',
                  })}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">
              {intl.formatMessage({
                id: 'automation.agent.guidance.conditionLabel',
                defaultMessage: 'When should this apply?',
              })}
            </legend>
            <RadioGroup
              value={conditionMode}
              onValueChange={(value) => setConditionMode(value as 'always' | 'conditional')}
              className="gap-2"
            >
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border p-3">
                <RadioGroupItem value="always" />
                <span className="text-sm">
                  {intl.formatMessage({
                    id: 'automation.agent.guidance.alwaysOption',
                    defaultMessage: 'Apply to every customer conversation',
                  })}
                </span>
              </label>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border p-3">
                <RadioGroupItem value="conditional" />
                <span className="text-sm">
                  {intl.formatMessage({
                    id: 'automation.agent.guidance.conditionalOption',
                    defaultMessage: 'Apply only in a described situation',
                  })}
                </span>
              </label>
            </RadioGroup>
            {conditionMode === 'conditional' && (
              <div className="space-y-2">
                <Textarea
                  id="guidance-condition"
                  value={appliesWhen}
                  rows={3}
                  aria-label={intl.formatMessage({
                    id: 'automation.agent.guidance.conditionLabel',
                    defaultMessage: 'When should this apply?',
                  })}
                  aria-invalid={Boolean(errors.appliesWhen)}
                  aria-describedby="guidance-condition-count guidance-condition-help"
                  placeholder={intl.formatMessage({
                    id: 'automation.agent.guidance.conditionPlaceholder',
                    defaultMessage:
                      'For example: When a customer asks about refunds or cancelling a paid plan.',
                  })}
                  onChange={(event) => setAppliesWhen(event.target.value)}
                />
                <div className="flex items-start justify-between gap-3">
                  <p id="guidance-condition-help" className="text-xs text-muted-foreground">
                    {intl.formatMessage({
                      id: 'automation.agent.guidance.conditionHelp',
                      defaultMessage:
                        'Conditions are interpreted from the conversation. Use Test agent to verify realistic examples.',
                    })}
                  </p>
                  <span
                    id="guidance-condition-count"
                    className="shrink-0 text-xs tabular-nums text-muted-foreground"
                  >
                    {appliesWhen.length} / {ASSISTANT_GUIDANCE_APPLIES_WHEN_MAX_LENGTH}
                  </span>
                </div>
                {errors.appliesWhen && (
                  <p className="text-xs text-destructive">{errors.appliesWhen}</p>
                )}
              </div>
            )}
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="guidance-instruction">
              {intl.formatMessage({
                id: 'automation.agent.guidance.instructionLabel',
                defaultMessage: 'What should the AI agent do?',
              })}
            </Label>
            <Textarea
              id="guidance-instruction"
              value={instruction}
              rows={5}
              aria-invalid={Boolean(errors.instruction)}
              aria-describedby="guidance-instruction-count"
              placeholder={intl.formatMessage({
                id: 'automation.agent.guidance.instructionPlaceholder',
                defaultMessage:
                  'For example: Explain the 30-day refund policy before sharing the relevant Help Center article.',
              })}
              onChange={(event) => setInstruction(event.target.value)}
            />
            <p
              id="guidance-instruction-count"
              className="text-end text-xs tabular-nums text-muted-foreground"
            >
              {instruction.length} / {ASSISTANT_GUIDANCE_INSTRUCTION_MAX_LENGTH}
            </p>
            {errors.instruction && <p className="text-xs text-destructive">{errors.instruction}</p>}
            <p
              className={
                liveTotal > charBudget
                  ? 'text-xs text-destructive'
                  : 'text-xs text-muted-foreground'
              }
            >
              {intl.formatMessage(
                {
                  id: 'automation.agent.guidance.budget',
                  defaultMessage: '{used} of {total} characters across enabled guidance',
                },
                { used: liveTotal, total: charBudget }
              )}
            </p>
            {errors.budget && (
              <p role="alert" className="text-xs text-destructive">
                {errors.budget}
              </p>
            )}
          </div>

          <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border p-3">
            <div>
              <Label htmlFor="guidance-enabled" className="cursor-pointer">
                {intl.formatMessage({
                  id: 'automation.agent.guidance.enabledLabel',
                  defaultMessage: 'Enabled',
                })}
              </Label>
              <p className="text-xs text-muted-foreground">
                {intl.formatMessage({
                  id: 'automation.agent.guidance.enabledHelp',
                  defaultMessage: 'Disabled guidance remains saved but is not applied.',
                })}
              </p>
            </div>
            <Switch id="guidance-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {intl.formatMessage({ id: 'automation.common.cancel', defaultMessage: 'Cancel' })}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving
                ? intl.formatMessage({
                    id: 'automation.agent.save.savingButton',
                    defaultMessage: 'Saving…',
                  })
                : rule
                  ? intl.formatMessage({
                      id: 'automation.agent.save.button',
                      defaultMessage: 'Save changes',
                    })
                  : intl.formatMessage({
                      id: 'automation.agent.guidance.addConfirm',
                      defaultMessage: 'Add guidance',
                    })}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
