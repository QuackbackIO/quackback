import { useState } from 'react'
import { useForm } from 'react-hook-form'
import type { UseMutationResult } from '@tanstack/react-query'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { commentSchema, type CommentInput } from '@/lib/shared/schemas/comments'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { StatusBadge } from '@/components/ui/status-badge'
import { CheckIcon, LockClosedIcon } from '@heroicons/react/24/solid'
import { signOut } from '@/lib/server/auth/client'
import { useRouter, useRouteContext } from '@tanstack/react-router'
import { useAuthBroadcast } from '@/lib/client/hooks/use-auth-broadcast'
import { cn } from '@/lib/shared/utils'
import type { PostId, CommentId } from '@featurepool/ids'

export type CreateCommentMutation = UseMutationResult<
  unknown,
  Error,
  {
    content: string
    parentId?: string | null
    postId: string
    authorName?: string | null
    authorEmail?: string | null
    principalId?: string | null
    statusId?: string | null
    isPrivate?: boolean
  }
>

interface CommentFormProps {
  postId: PostId
  parentId?: CommentId
  onSuccess?: () => void
  onCancel?: () => void
  user?: { name: string | null; email: string; principalId?: string }
  /** React Query mutation for creating comments with optimistic updates */
  createComment?: CreateCommentMutation
  /** Available statuses for status change selector (admin only) */
  statuses?: Array<{ id: string; name: string; color: string }>
  /** Current post status ID */
  currentStatusId?: string | null
  /** Whether the current user is a team member (enables status selector and private toggle) */
  isTeamMember?: boolean
  /** Default the private toggle to on (e.g. replying to a private comment) */
  defaultPrivate?: boolean
}

export function CommentForm({
  postId,
  parentId,
  onSuccess,
  onCancel,
  user,
  createComment,
  statuses,
  currentStatusId,
  isTeamMember,
  defaultPrivate,
}: CommentFormProps) {
  const router = useRouter()
  const { session } = useRouteContext({ from: '__root__' })
  const [error, setError] = useState<string | null>(null)
  const [selectedStatusId, setSelectedStatusId] = useState<string | null>(null)
  const [statusPopoverOpen, setStatusPopoverOpen] = useState(false)
  const [isPrivate, setIsPrivate] = useState(defaultPrivate ?? false)

  // Get user from session
  // Note: principalId is only available from the server-provided `user` prop, not from client session
  const effectiveUser = session?.user
    ? { name: session.user.name, email: session.user.email, principalId: user?.principalId }
    : user

  // Listen for auth success to refetch session (no page reload)
  useAuthBroadcast({
    onSuccess: () => {
      router.invalidate()
    },
  })

  const form = useForm<CommentInput>({
    resolver: standardSchemaResolver(commentSchema),
    defaultValues: {
      content: '',
      parentId: parentId || undefined,
    },
  })

  const isSubmitting = createComment?.isPending ?? false
  const selectedStatus = statuses?.find((s) => s.id === selectedStatusId) ?? null
  const currentStatus = statuses?.find((s) => s.id === currentStatusId) ?? null
  const showStatusSelector = isTeamMember && !parentId && statuses && statuses.length > 0

  const isPrivateLocked = defaultPrivate === true

  function privateTooltipText(): string {
    if (isPrivateLocked) return 'Respostas a comentários privados são sempre privadas'
    if (isPrivate) return 'Visível apenas para membros da equipe'
    return 'Tornar este comentário privado (somente equipe)'
  }

  function onSubmit(data: CommentInput) {
    setError(null)

    if (!createComment) {
      setError('A funcionalidade de comentários não está disponível')
      return
    }

    createComment.mutate(
      {
        content: data.content.trim(),
        parentId: parentId || null,
        postId,
        authorName: effectiveUser?.name || null,
        authorEmail: effectiveUser?.email || null,
        principalId: effectiveUser?.principalId || null,
        statusId: selectedStatusId,
        isPrivate: isPrivate,
      },
      {
        onSuccess: () => {
          form.reset()
          setSelectedStatusId(null)
          onSuccess?.()
        },
        onError: (err) => {
          setError(err instanceof Error ? err.message : 'Não foi possível publicar o comentário')
        },
      }
    )
  }

  // If not authenticated and the form was rendered (allowCommenting=true from parent),
  // show the form for anonymous commenting. The anonymous session is created on submit.
  // Only show sign-in prompt if the parent explicitly didn't render a form (this code
  // path is reached only for edge cases — normally CommentThread handles the locked state).
  const isAnonymousCommenter = !effectiveUser || session?.user?.principalType === 'anonymous'

  // Team member composer: unified card with toolbar
  if (showStatusSelector) {
    return (
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <div className="rounded-lg border border-border/50 bg-background overflow-hidden focus-within:border-border focus-within:ring-1 focus-within:ring-ring/20 transition-colors">
            {/* Textarea area */}
            <FormField
              control={form.control}
              name="content"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="sr-only">Seu comentário</FormLabel>
                  <FormControl>
                    <textarea
                      placeholder="Escreva um comentário..."
                      rows={3}
                      disabled={isSubmitting}
                      className="w-full resize-none border-0 bg-transparent px-3 pt-3 pb-2 text-sm placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="px-3" />
                </FormItem>
              )}
            />

            {error && <p className="text-sm text-destructive px-3 pb-1">{error}</p>}

            {/* Toolbar footer */}
            <div className="flex items-center gap-2 border-t border-border/30 bg-muted/20 px-3 py-2">
              {/* Left: Identity */}
              <p className="text-xs text-muted-foreground mr-auto truncate">
                <span className="font-medium text-foreground">
                  {effectiveUser?.name || effectiveUser?.email || 'Anônimo'}
                </span>
              </p>

              {/* Status selector */}
              <Popover open={statusPopoverOpen} onOpenChange={setStatusPopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
                      'hover:bg-muted/80',
                      selectedStatus
                        ? 'bg-muted/60 border border-border/50'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {selectedStatus ? (
                      <>
                        <StatusBadge name={selectedStatus.name} color={selectedStatus.color} />
                        <button
                          type="button"
                          className="ml-0.5 text-muted-foreground hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedStatusId(null)
                          }}
                        >
                          &times;
                        </button>
                      </>
                    ) : (
                      <>
                        <span
                          className="size-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: currentStatus?.color ?? '#94a3b8' }}
                        />
                        <span>{currentStatus?.name ?? 'Sem status'}</span>
                      </>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-44 p-1" align="end">
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    Atualizar status
                  </div>
                  {statuses.map((status) => {
                    const isCurrent = status.id === currentStatusId
                    const isSelected = status.id === selectedStatusId
                    return (
                      <button
                        key={status.id}
                        type="button"
                        onClick={() => {
                          setSelectedStatusId(isCurrent ? null : status.id)
                          setStatusPopoverOpen(false)
                        }}
                        className={cn(
                          'w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-xs transition-colors',
                          'hover:bg-muted/50',
                          isSelected && 'bg-muted/40'
                        )}
                      >
                        <span
                          className="size-2 rounded-full shrink-0"
                          style={{ backgroundColor: status.color }}
                        />
                        <span className="flex-1 text-left">{status.name}</span>
                        {isCurrent && !isSelected && (
                          <span className="text-muted-foreground text-[10px]">atual</span>
                        )}
                        {isSelected && <CheckIcon className="size-3.5 text-primary shrink-0" />}
                      </button>
                    )
                  })}
                  {selectedStatusId && (
                    <>
                      <div className="my-1 border-t border-border/30" />
                      <button
                        type="button"
                        className="w-full text-left px-2 py-1.5 text-xs rounded-sm hover:bg-muted/50 transition-colors text-muted-foreground"
                        onClick={() => {
                          setSelectedStatusId(null)
                          setStatusPopoverOpen(false)
                        }}
                      >
                        Limpar alteração de status
                      </button>
                    </>
                  )}
                </PopoverContent>
              </Popover>

              {/* Private toggle */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setIsPrivate(!isPrivate)}
                      disabled={isPrivateLocked}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
                        isPrivate
                          ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted/80',
                        isPrivateLocked && 'opacity-70 cursor-not-allowed'
                      )}
                    >
                      <LockClosedIcon className="h-3 w-3" />
                      Privado
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{privateTooltipText()}</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {/* Submit */}
              {onCancel && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onCancel}
                  disabled={isSubmitting}
                  className="h-7 text-xs"
                >
                  Cancelar
                </Button>
              )}
              <Button type="submit" size="sm" disabled={isSubmitting} className="h-7 text-xs">
                {isSubmitting
                  ? 'Enviando...'
                  : selectedStatus
                    ? `Comentar e marcar ${selectedStatus.name}`
                    : 'Comentar'}
              </Button>
            </div>
          </div>
        </form>
      </Form>
    )
  }

  // Default composer for non-team-members / replies
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="content"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="sr-only">Seu comentário</FormLabel>
              <FormControl>
                <textarea
                  placeholder="Escreva um comentário..."
                  rows={3}
                  disabled={isSubmitting}
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex items-center justify-end gap-2">
          <p className="text-xs text-muted-foreground mr-auto">
            {isAnonymousCommenter ? (
              'Comentando anonimamente'
            ) : (
              <>
                Comentando como{' '}
                <span className="font-medium text-foreground">
                  {effectiveUser?.name || effectiveUser?.email}
                </span>
                {' ('}
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => {
                    signOut({
                      fetchOptions: {
                        onSuccess: () => {
                          router.invalidate()
                        },
                      },
                    })
                  }}
                >
                  sair
                </button>
                {')'}
              </>
            )}
          </p>
          {onCancel && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
          )}
          {/* Private toggle for team members */}
          {isTeamMember && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant={isPrivate ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setIsPrivate(!isPrivate)}
                    disabled={isPrivateLocked}
                    className={cn(
                      isPrivate
                        ? 'bg-amber-500 hover:bg-amber-600 text-white border-0 gap-1.5'
                        : 'text-muted-foreground gap-1.5',
                      isPrivateLocked && 'opacity-70 cursor-not-allowed'
                    )}
                  >
                    <LockClosedIcon className="h-3.5 w-3.5" />
                    Privado
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{privateTooltipText()}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <Button type="submit" size="sm" disabled={isSubmitting}>
            {isSubmitting ? 'Enviando...' : parentId ? 'Responder' : 'Comentar'}
          </Button>
        </div>
      </form>
    </Form>
  )
}
