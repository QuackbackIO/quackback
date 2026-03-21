import { useState, useEffect, useRef } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { PlusIcon, MagnifyingGlassIcon, ArrowLeftIcon } from '@heroicons/react/24/outline'
import { toast } from 'sonner'
import { Avatar } from '@/components/ui/avatar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { VotersModal } from '@/components/admin/feedback/voters-modal'
import { adminQueries } from '@/lib/client/queries/admin'
import { useProxyVote } from '@/lib/client/mutations/posts'
import { useCreatePortalUser } from '@/lib/client/mutations/users'
import { cn } from '@/lib/shared/utils'
import type { PostId, PrincipalId } from '@quackback/ids'

interface VotersAvatarStackProps {
  postId: PostId
  voteCount: number
  votersAdditionalPostIds?: PostId[]
  votersReadonly?: boolean
}

export function VotersAvatarStack({
  postId,
  voteCount,
  votersAdditionalPostIds,
  votersReadonly = false,
}: VotersAvatarStackProps) {
  const [votersOpen, setVotersOpen] = useState(false)
  const [addVoterOpen, setAddVoterOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [mode, setMode] = useState<'list' | 'create'>('list')
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  const { data: voters } = useQuery({
    ...adminQueries.postVoters(postId),
  })

  const proxyVote = useProxyVote(postId)
  const createUser = useCreatePortalUser()

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  // Focus input when popover opens or mode changes
  useEffect(() => {
    if (addVoterOpen) {
      if (mode === 'list') {
        setTimeout(() => inputRef.current?.focus(), 0)
      } else {
        setTimeout(() => nameInputRef.current?.focus(), 0)
      }
    } else {
      setSearch('')
      setDebouncedSearch('')
      setMode('list')
      setNewName('')
      setNewEmail('')
      setFormError(null)
    }
  }, [addVoterOpen, mode])

  const { data: searchResults = [] } = useQuery({
    ...adminQueries.searchMembers({ search: debouncedSearch || undefined, limit: 20 }),
    placeholderData: keepPreviousData,
    enabled: addVoterOpen,
  })

  const displayVoters = voters?.slice(0, 5) ?? []
  const remainingCount = Math.max(0, (voters?.length ?? voteCount) - 5)

  // Exclude existing voters from the add-voter member list
  const voterPrincipalIds = new Set(voters?.map((v) => v.principalId))
  const filteredSearchResults = searchResults.filter((m) => !voterPrincipalIds.has(m.id))

  function handleProxyVote(principalId: string) {
    if (voters?.some((v) => v.principalId === principalId)) {
      toast.info('This user has already voted')
      setAddVoterOpen(false)
      return
    }
    proxyVote.mutate(principalId as PrincipalId, {
      onSuccess: (data) => {
        if (!data.voted) {
          toast.info('This user has already voted')
        }
        setAddVoterOpen(false)
      },
    })
  }

  async function handleCreateAndVote() {
    if (!newName.trim()) return
    const trimmedEmail = newEmail.trim()
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setFormError('Invalid email address')
      return
    }
    setFormError(null)
    try {
      const result = await createUser.mutateAsync({
        name: newName.trim(),
        email: trimmedEmail || undefined,
      })
      handleProxyVote(result.principalId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create user'
      setFormError(msg)
    }
  }

  return (
    <div className="flex items-center justify-between">
      {displayVoters.length > 0 ? (
        <button
          type="button"
          onClick={() => setVotersOpen(true)}
          className="flex items-center -space-x-2 hover:opacity-80 transition-opacity"
        >
          {displayVoters.map((voter, i) => (
            <Avatar
              key={voter.principalId}
              src={voter.avatarUrl}
              name={voter.displayName}
              className="h-6 w-6 text-[9px] ring-2 ring-background"
              style={{ zIndex: i + 1 }}
            />
          ))}
          {remainingCount > 0 && (
            <span
              className="relative flex items-center justify-center h-6 min-w-6 px-1 rounded-full bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-background"
              style={{ zIndex: displayVoters.length + 1 }}
            >
              +{remainingCount}
            </span>
          )}
        </button>
      ) : (
        <span className="text-xs text-muted-foreground/50 italic">No voters yet</span>
      )}

      <VotersModal
        postId={postId}
        voteCount={voteCount}
        open={votersOpen}
        onOpenChange={setVotersOpen}
        additionalPostIds={votersAdditionalPostIds}
        readonly={votersReadonly}
      />

      <Popover open={addVoterOpen} onOpenChange={setAddVoterOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-1 text-xs',
              'text-muted-foreground/60 hover:text-muted-foreground',
              'transition-colors duration-150'
            )}
          >
            <PlusIcon className="h-3 w-3" />
            <span>Add voter</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="end" sideOffset={4}>
          {mode === 'list' ? (
            <>
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30">
                <MagnifyingGlassIcon className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                <input
                  ref={inputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search members..."
                  className="flex-1 text-xs bg-transparent border-0 outline-none placeholder:text-muted-foreground/50"
                />
              </div>
              <div
                className="max-h-56 overflow-y-auto p-1 scrollbar-thin"
                onWheel={(e) => e.stopPropagation()}
              >
                {filteredSearchResults.length === 0 ? (
                  <p className="text-xs text-muted-foreground/60 text-center py-4">
                    No members found
                  </p>
                ) : (
                  filteredSearchResults.map((member) => (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => handleProxyVote(member.id)}
                      disabled={proxyVote.isPending}
                      className={cn(
                        'w-full flex items-center gap-2 px-2 py-1.5 rounded-md',
                        'text-xs text-foreground/80 hover:bg-muted/60 hover:text-foreground',
                        'transition-colors duration-100 text-left',
                        'disabled:opacity-50'
                      )}
                    >
                      <Avatar
                        src={member.image}
                        name={member.name}
                        className="h-5 w-5 text-[9px] shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{member.name || 'Unnamed'}</div>
                        {member.email && (
                          <div className="text-muted-foreground/60 truncate">{member.email}</div>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
              <div className="border-t border-border/30 p-1">
                <button
                  type="button"
                  onClick={() => setMode('create')}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  Create new user
                </button>
              </div>
            </>
          ) : (
            <div className="p-3 space-y-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setMode('list')
                    setFormError(null)
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeftIcon className="h-3.5 w-3.5" />
                </button>
                <span className="text-xs font-medium">New user</span>
              </div>
              <div className="space-y-2">
                <input
                  ref={nameInputRef}
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Name"
                  className="w-full text-xs px-2.5 py-1.5 rounded-md border border-border/50 bg-transparent outline-none placeholder:text-muted-foreground/50 focus:border-border"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleCreateAndVote()
                    }
                  }}
                />
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="Email (optional)"
                  className="w-full text-xs px-2.5 py-1.5 rounded-md border border-border/50 bg-transparent outline-none placeholder:text-muted-foreground/50 focus:border-border"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleCreateAndVote()
                    }
                  }}
                />
              </div>
              {formError && <p className="text-[11px] text-destructive">{formError}</p>}
              <button
                type="button"
                onClick={handleCreateAndVote}
                disabled={!newName.trim() || createUser.isPending || proxyVote.isPending}
                className={cn(
                  'w-full text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors',
                  'bg-primary text-primary-foreground hover:bg-primary/90',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                {createUser.isPending ? 'Creating...' : 'Create & add vote'}
              </button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
