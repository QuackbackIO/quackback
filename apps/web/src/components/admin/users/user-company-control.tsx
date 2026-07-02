import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BuildingOffice2Icon, CheckIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline'
import type { CompanyId, PrincipalId } from '@quackback/ids'
import {
  getCompanyForPrincipalFn,
  listCompaniesFn,
  createCompanyFn,
  attachPrincipalToCompanyFn,
  detachPrincipalFromCompanyFn,
} from '@/lib/server/functions/companies'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/shared/utils'

/**
 * Attach / edit the company a person belongs to, from the People profile. The
 * smallest sensible control: the current company with a popover to pick an
 * existing one, create a new one inline, or detach.
 */
export function UserCompanyControl({
  principalId,
  canManage,
}: {
  principalId: PrincipalId
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)

  const companyKey = ['admin', 'company', 'for-principal', principalId]
  const { data: current } = useQuery({
    queryKey: companyKey,
    queryFn: () => getCompanyForPrincipalFn({ data: { principalId } }),
    staleTime: 60_000,
  })
  const { data: companies = [] } = useQuery({
    queryKey: ['admin', 'companies'],
    queryFn: () => listCompaniesFn(),
    enabled: canManage && open,
    staleTime: 60_000,
  })

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: companyKey }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'companies'] }),
    ])
  }

  const attach = async (companyId: CompanyId) => {
    setBusy(true)
    try {
      await attachPrincipalToCompanyFn({ data: { companyId, principalId } })
      await refresh()
      setOpen(false)
      setFilter('')
    } finally {
      setBusy(false)
    }
  }

  const createAndAttach = async (name: string) => {
    setBusy(true)
    try {
      const company = await createCompanyFn({ data: { name } })
      await attachPrincipalToCompanyFn({
        data: { companyId: company.id as CompanyId, principalId },
      })
      await refresh()
      setOpen(false)
      setFilter('')
    } finally {
      setBusy(false)
    }
  }

  const detach = async () => {
    setBusy(true)
    try {
      await detachPrincipalFromCompanyFn({ data: { principalId } })
      await refresh()
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  const query = filter.trim().toLowerCase()
  const matches = companies.filter((c) => c.name.toLowerCase().includes(query))
  const exactMatch = companies.some((c) => c.name.toLowerCase() === query)

  if (!canManage) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <BuildingOffice2Icon className="h-4 w-4 text-muted-foreground" />
        <span className={cn(current ? 'text-foreground' : 'text-muted-foreground/70')}>
          {current?.name ?? 'No company'}
        </span>
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={busy}
          className={cn(
            'flex w-full items-center gap-2 rounded-md border border-border/60 px-2.5 py-1.5 text-sm',
            'hover:bg-muted/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
          )}
        >
          <BuildingOffice2Icon className="h-4 w-4 text-muted-foreground shrink-0" />
          <span
            className={cn('truncate', current ? 'text-foreground' : 'text-muted-foreground/70')}
          >
            {current?.name ?? 'Assign a company'}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start" sideOffset={4}>
        <input
          type="text"
          value={filter}
          disabled={busy}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search or create..."
          className="mb-2 w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
        />
        <div className="max-h-48 space-y-0.5 overflow-y-auto">
          {matches.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={busy}
              onClick={() => attach(c.id as CompanyId)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-xs font-medium text-foreground/80 hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
            >
              <span className="flex-1 truncate">{c.name}</span>
              {current?.id === c.id && <CheckIcon className="h-3.5 w-3.5 shrink-0 text-primary" />}
            </button>
          ))}
          {query && !exactMatch && (
            <button
              type="button"
              disabled={busy}
              onClick={() => createAndAttach(filter.trim())}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-xs font-medium text-primary hover:bg-muted/60 disabled:opacity-50"
            >
              <PlusIcon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Create &ldquo;{filter.trim()}&rdquo;</span>
            </button>
          )}
        </div>
        {current && (
          <button
            type="button"
            disabled={busy}
            onClick={detach}
            className="mt-2 flex w-full items-center gap-2 border-t border-border/40 px-2 pt-2 text-start text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <XMarkIcon className="h-3.5 w-3.5 shrink-0" />
            Remove from company
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}
