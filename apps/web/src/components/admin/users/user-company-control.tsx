import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
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

function formatMrr(mrrCents: number): string {
  return (mrrCents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

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

  const mrr = current?.mrrCents != null ? formatMrr(current.mrrCents) : null
  const planLine = [current?.plan, mrr ? `${mrr}/mo` : null].filter(Boolean).join(' · ')

  const picker = (
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
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-[13px] font-medium text-foreground/80 hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
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
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-[13px] font-medium text-primary hover:bg-muted/60 disabled:opacity-50"
          >
            <PlusIcon className="size-4 shrink-0" />
            <span className="truncate">Create &ldquo;{filter.trim()}&rdquo;</span>
          </button>
        )}
      </div>
      {current && (
        <button
          type="button"
          disabled={busy}
          onClick={detach}
          className="mt-2 flex w-full items-center gap-2 border-t border-border/40 px-2 pt-2 text-start text-[13px] text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <XMarkIcon className="size-4 shrink-0" />
          Remove from company
        </button>
      )}
    </PopoverContent>
  )

  if (!current) {
    return (
      <div className="flex items-center gap-2">
        <BuildingOffice2Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm text-muted-foreground/70">No company</span>
        <span className="flex-1" />
        {canManage && (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={busy}
                className="inline-flex items-center rounded-full border border-dashed border-border/60 px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                + Add
              </button>
            </PopoverTrigger>
            {picker}
          </Popover>
        )}
      </div>
    )
  }

  return (
    <div>
      <Popover open={canManage ? open : false} onOpenChange={canManage ? setOpen : undefined}>
        <PopoverTrigger asChild disabled={!canManage || busy}>
          <button
            type="button"
            disabled={!canManage || busy}
            className={cn(
              'flex w-full items-center gap-2 text-start',
              canManage && 'rounded-md hover:bg-muted/40 disabled:opacity-50'
            )}
          >
            <BuildingOffice2Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium text-foreground">{current.name}</span>
          </button>
        </PopoverTrigger>
        {canManage && picker}
      </Popover>
      {planLine ? <p className="mt-1 ms-6 text-xs text-muted-foreground">{planLine}</p> : null}
      <Link
        to="/admin/users"
        search={{ lifecycle: 'companies', company: current.id }}
        className="mt-2 ms-6 inline-block text-xs font-medium text-primary hover:underline"
      >
        View company →
      </Link>
    </div>
  )
}
