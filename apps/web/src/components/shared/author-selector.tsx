import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronUpDownIcon, CheckIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn, getInitials } from '@/lib/shared/utils'
import type { TeamMember } from '@/lib/server/domains/principals'

interface AuthorSelectorProps {
  members: TeamMember[]
  value: string
  onChange: (principalId: string) => void
  /** Display name when no member is selected */
  fallbackName?: string | null
}

export function AuthorSelector({ members, value, onChange, fallbackName }: AuthorSelectorProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0)
    } else {
      setSearch('')
    }
  }, [open])

  const selectedMember = members.find((m) => m.id === value)
  const displayName = selectedMember?.name || fallbackName || 'Select author'

  const filtered = useMemo(() => {
    if (!search.trim()) return members
    const q = search.toLowerCase()
    return members.filter(
      (m) => m.name?.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
    )
  }, [members, search])

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
          <ChevronUpDownIcon className="h-3.5 w-3.5 text-muted-foreground/60 ml-auto shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start" sideOffset={4}>
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
        <div className="max-h-56 overflow-y-auto p-1 scrollbar-thin">
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground/60 text-center py-4">No members found</p>
          ) : (
            filtered.map((member) => {
              const isSelected = member.id === value
              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => {
                    onChange(member.id)
                    setOpen(false)
                  }}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left',
                    'text-xs transition-colors duration-100',
                    isSelected
                      ? 'bg-primary/10 text-foreground'
                      : 'text-foreground/80 hover:bg-muted/60'
                  )}
                >
                  <Avatar className="h-5 w-5 shrink-0">
                    {member.image && <AvatarImage src={member.image} alt={member.name || ''} />}
                    <AvatarFallback className="text-[9px]">
                      {getInitials(member.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{member.name || 'Unnamed'}</div>
                    <div className="text-muted-foreground/60 truncate">{member.email}</div>
                  </div>
                  {isSelected && <CheckIcon className="h-3.5 w-3.5 text-primary shrink-0" />}
                </button>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
