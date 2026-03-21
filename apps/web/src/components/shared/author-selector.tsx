import { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import {
  ChevronUpDownIcon,
  CheckIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  ArrowLeftIcon,
  PencilIcon,
} from '@heroicons/react/24/outline'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Badge } from '@/components/ui/badge'
import { cn, getInitials } from '@/lib/shared/utils'
import { adminQueries } from '@/lib/client/queries/admin'
import type { TeamMember } from '@/lib/server/domains/principals'

/** Extract a user-friendly message from server errors (Zod validation returns raw JSON) */
function parseErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback
  const msg = err.message
  // TanStack Start validation errors may be JSON arrays
  try {
    const parsed = JSON.parse(msg)
    if (Array.isArray(parsed) && parsed[0]?.message) {
      return parsed[0].message
    }
  } catch {
    // not JSON, use as-is
  }
  return msg || fallback
}

/** A user created or pre-populated inline */
export interface NewAuthor {
  principalId: string
  name: string
  email: string | null
}

interface AuthorSelectorProps {
  value: string
  onChange: (principalId: string) => void
  /** Display name when no member is selected */
  fallbackName?: string | null
  /** Pre-populated authors not in search results (e.g. external feedback authors). Shown with "New" badge. */
  initialNewUsers?: NewAuthor[]
  /** Callback to create a new user. When provided, shows "Create new user" option. */
  onCreateUser?: (data: { name: string; email?: string }) => Promise<NewAuthor>
  /** Callback to edit a user created this session. When provided, shows edit icon on "New" rows. */
  onEditUser?: (data: { principalId: string; name: string; email?: string }) => Promise<NewAuthor>
  /** Whether a create/edit mutation is currently in progress */
  isCreating?: boolean
}

export function AuthorSelector({
  value,
  onChange,
  fallbackName,
  initialNewUsers,
  onCreateUser,
  onEditUser,
  isCreating,
}: AuthorSelectorProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [mode, setMode] = useState<'list' | 'create' | 'edit'>('list')
  const [editingPrincipalId, setEditingPrincipalId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  // Track users shown with "New" badge (created this session + pre-populated)
  const [createdIds, setCreatedIds] = useState<Set<string>>(
    () => new Set(initialNewUsers?.map((u) => u.principalId))
  )
  // Track locally added users that might not be in search results
  const [localUsers, setLocalUsers] = useState<NewAuthor[]>(() => initialNewUsers ?? [])
  const inputRef = useRef<HTMLInputElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Debounce search input for server query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  // Server-side member search (only when popover is open)
  const { data: searchResults = [] } = useQuery({
    ...adminQueries.searchMembers({ search: debouncedSearch || undefined, limit: 20 }),
    placeholderData: keepPreviousData, // Keep previous results visible while loading new search
    enabled: open,
  })

  // Sync initialNewUsers into state when prop changes (handles late-arriving data)
  useEffect(() => {
    if (!initialNewUsers?.length) return
    setCreatedIds((prev) => {
      const next = new Set(prev)
      for (const u of initialNewUsers) next.add(u.principalId)
      return next
    })
    setLocalUsers((prev) => {
      const existingIds = new Set(prev.map((u) => u.principalId))
      const added = initialNewUsers.filter((u) => !existingIds.has(u.principalId))
      return added.length > 0 ? [...prev, ...added] : prev
    })
  }, [initialNewUsers])

  useEffect(() => {
    if (open) {
      if (mode === 'list') {
        setTimeout(() => inputRef.current?.focus(), 0)
      } else {
        setTimeout(() => nameInputRef.current?.focus(), 0)
      }
    } else {
      setSearch('')
      setDebouncedSearch('')
      setMode('list')
      setEditingPrincipalId(null)
      setNewName('')
      setNewEmail('')
      setFormError(null)
    }
  }, [open, mode])

  // Merge local users with search results (local users on top, deduped)
  const allMembers = useMemo(() => {
    const resultIds = new Set(searchResults.map((m) => m.id))
    const q = search.trim().toLowerCase()
    // Filter local users by search term (client-side since they're not in the server query)
    const extras = localUsers
      .filter((u) => !resultIds.has(u.principalId as never))
      .filter((u) => !q || u.name.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q))
      .map(
        (u) =>
          ({
            id: u.principalId,
            name: u.name,
            email: u.email,
            image: null,
            role: 'user',
          }) as unknown as TeamMember
      )
    return [...extras, ...searchResults]
  }, [searchResults, localUsers, search])

  // For the trigger display, find selected member from local users or search results
  const selectedLocal = localUsers.find((u) => u.principalId === value)
  const selectedFromResults = searchResults.find((m) => m.id === value)
  const displayName =
    selectedLocal?.name ||
    selectedLocal?.email ||
    selectedFromResults?.name ||
    selectedFromResults?.email ||
    fallbackName ||
    'Select author'
  const selectedMember = allMembers.find((m) => m.id === value)
  const isNew = createdIds.has(value)

  const validateEmail = (email: string): boolean => {
    if (!email) return true // empty is fine (optional)
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  }

  const handleCreate = async () => {
    if (!onCreateUser || !newName.trim()) return
    const trimmedEmail = newEmail.trim()
    if (trimmedEmail && !validateEmail(trimmedEmail)) {
      setFormError('Invalid email address')
      return
    }
    setFormError(null)
    try {
      const result = await onCreateUser({
        name: newName.trim(),
        email: trimmedEmail || undefined,
      })
      setCreatedIds((prev) => new Set(prev).add(result.principalId))
      setLocalUsers((prev) => [...prev, result])
      onChange(result.principalId)
      setOpen(false)
    } catch (err) {
      setFormError(parseErrorMessage(err, 'Failed to create user'))
    }
  }

  const handleEdit = async () => {
    if (!onEditUser || !editingPrincipalId || !newName.trim()) return
    const trimmedEmail = newEmail.trim()
    if (trimmedEmail && !validateEmail(trimmedEmail)) {
      setFormError('Invalid email address')
      return
    }
    setFormError(null)
    try {
      const result = await onEditUser({
        principalId: editingPrincipalId,
        name: newName.trim(),
        email: trimmedEmail || undefined,
      })
      setLocalUsers((prev) => prev.map((u) => (u.principalId === editingPrincipalId ? result : u)))
      setMode('list')
      setEditingPrincipalId(null)
    } catch (err) {
      setFormError(parseErrorMessage(err, 'Failed to update user'))
    }
  }

  const startEdit = (member: TeamMember) => {
    setEditingPrincipalId(member.id as string)
    setNewName(member.name || '')
    setNewEmail(member.email || '')
    setFormError(null)
    setMode('edit')
  }

  const handleFormSubmit = mode === 'edit' ? handleEdit : handleCreate
  const formTitle = mode === 'edit' ? 'Edit user' : 'New user'
  const formButton =
    mode === 'edit'
      ? isCreating
        ? 'Saving...'
        : 'Save'
      : isCreating
        ? 'Creating...'
        : 'Create & select'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left',
            'border border-border/50 hover:border-border hover:bg-muted/40',
            'transition-all duration-150 text-xs'
          )}
        >
          <Avatar className="h-5 w-5 shrink-0">
            {selectedMember?.image && (
              <AvatarImage src={selectedMember.image} alt={displayName || ''} />
            )}
            <AvatarFallback className="text-[9px]">{getInitials(displayName)}</AvatarFallback>
          </Avatar>
          <span className="truncate font-medium text-foreground">{displayName}</span>
          {isNew && (
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0 bg-emerald-500/10 text-emerald-600 border-emerald-500/30 shrink-0"
            >
              New
            </Badge>
          )}
          <ChevronUpDownIcon className="h-3.5 w-3.5 text-muted-foreground/60 ml-auto shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start" sideOffset={4}>
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
              {allMembers.length === 0 ? (
                <p className="text-xs text-muted-foreground/60 text-center py-4">
                  No members found
                </p>
              ) : (
                allMembers.map((member) => {
                  const isSelected = member.id === value
                  const memberIsNew = createdIds.has(member.id as string)
                  return (
                    <div
                      key={member.id}
                      className={cn(
                        'flex items-center gap-2 px-2 py-1.5 rounded-md',
                        'text-xs transition-colors duration-100',
                        isSelected
                          ? 'bg-primary/10 text-foreground'
                          : 'text-foreground/80 hover:bg-muted/60'
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onChange(member.id)
                          setOpen(false)
                        }}
                        className="flex items-center gap-2 min-w-0 flex-1 text-left"
                      >
                        <Avatar className="h-5 w-5 shrink-0">
                          {member.image && (
                            <AvatarImage src={member.image} alt={member.name || ''} />
                          )}
                          <AvatarFallback className="text-[9px]">
                            {getInitials(member.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate flex items-center gap-1.5">
                            {member.name || 'Unnamed'}
                            {memberIsNew && (
                              <Badge
                                variant="outline"
                                className="text-[9px] px-1 py-0 bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                              >
                                New
                              </Badge>
                            )}
                          </div>
                          {member.email && (
                            <div className="text-muted-foreground/60 truncate">{member.email}</div>
                          )}
                        </div>
                      </button>
                      {memberIsNew && onEditUser ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            startEdit(member)
                          }}
                          className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
                          title="Edit user"
                        >
                          <PencilIcon className="h-3.5 w-3.5" />
                        </button>
                      ) : isSelected ? (
                        <CheckIcon className="h-3.5 w-3.5 text-primary shrink-0" />
                      ) : null}
                    </div>
                  )
                })
              )}
            </div>
            {onCreateUser && (
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
            )}
          </>
        ) : (
          <div className="p-3 space-y-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setMode('list')
                  setEditingPrincipalId(null)
                  setFormError(null)
                }}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeftIcon className="h-3.5 w-3.5" />
              </button>
              <span className="text-xs font-medium">{formTitle}</span>
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
                    handleFormSubmit()
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
                    handleFormSubmit()
                  }
                }}
              />
            </div>
            {formError && <p className="text-[11px] text-destructive">{formError}</p>}
            <button
              type="button"
              onClick={handleFormSubmit}
              disabled={!newName.trim() || isCreating}
              className={cn(
                'w-full text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors',
                'bg-primary text-primary-foreground hover:bg-primary/90',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {formButton}
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
