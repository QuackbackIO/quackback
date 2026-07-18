import { useState } from 'react'
import {
  BuildingOffice2Icon,
  PlusIcon,
  ChevronRightIcon,
  ArrowDownTrayIcon,
  BanknotesIcon,
  TagIcon,
} from '@heroicons/react/24/solid'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { cn } from '@/lib/shared/utils'
import { EmptyState } from '@/components/shared/empty-state'
import { SearchInput } from '@/components/shared/search-input'
import { FilterChip } from '@/components/shared/filter-chip'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useDebouncedSearch } from '@/lib/client/hooks/use-debounced-search'
import { useCompanyAttributes } from '@/lib/client/hooks/use-company-attributes-queries'
import { buildCompaniesExportUrl } from '@/lib/shared/company-filters'
import { createCompanyFn, type CompanyWithMemberCountDTO } from '@/lib/server/functions/companies'

/** Render mrrCents as a whole-dollar currency amount, or a dash when unset. */
export function formatMonthlySpend(mrrCents: number | null): string {
  if (mrrCents == null) return '-'
  return (mrrCents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

/** Record-origin badge: 'api' (SDK/REST sync) vs 'manual' (agent qualification). */
export function SourceBadge({ source }: { source: 'api' | 'manual' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide',
        source === 'manual'
          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-500'
          : 'bg-muted text-muted-foreground'
      )}
    >
      {source}
    </span>
  )
}

const MRR_OPERATORS = [
  { value: 'gte', label: 'at least' },
  { value: 'gt', label: 'more than' },
  { value: 'lte', label: 'at most' },
  { value: 'lt', label: 'less than' },
  { value: 'eq', label: 'exactly' },
]

const OP_LABELS: Record<string, string> = {
  eq: 'equals',
  neq: 'not equals',
  contains: 'contains',
  is_set: 'is set',
  is_not_set: 'is not set',
  gt: 'more than',
  gte: 'at least',
  lt: 'less than',
  lte: 'at most',
}

/** Split the encoded companyAttrs param into its parts. */
function splitParts(encoded?: string): string[] {
  return (encoded ?? '').split(',').filter(Boolean)
}

const STRING_FIELD_OPERATORS = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'not equals' },
  { value: 'contains', label: 'contains' },
  { value: 'is_set', label: 'is set' },
  { value: 'is_not_set', label: 'is not set' },
]

/** One text/number/boolean predicate editor for a filter key. */
function FilterPredicateInput({
  attrKey,
  kind,
  onApply,
}: {
  attrKey: string
  kind: 'string' | 'number' | 'boolean'
  onApply: (encoded: string) => void
}) {
  const isNumeric = kind === 'number'
  const isBool = kind === 'boolean'
  const operators = isNumeric
    ? MRR_OPERATORS
    : isBool
      ? [{ value: 'eq', label: 'is' }]
      : STRING_FIELD_OPERATORS
  const [op, setOp] = useState(operators[0].value)
  const [value, setValue] = useState(isBool ? 'true' : '')
  const isPresenceOp = op === 'is_set' || op === 'is_not_set'
  const canApply = isPresenceOp || !!value.trim()

  const apply = () => {
    if (!canApply) return
    onApply(`${attrKey}:${op}:${isPresenceOp ? '' : value.trim()}`)
  }

  return (
    <div className="p-2 space-y-2">
      <Select value={op} onValueChange={setOp}>
        <SelectTrigger size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!isPresenceOp &&
        (isBool ? (
          <Select value={value} onValueChange={setValue}>
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">True</SelectItem>
              <SelectItem value="false">False</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <Input
            type={isNumeric ? 'number' : 'text'}
            className="h-7 text-xs"
            placeholder={isNumeric ? '0' : 'value'}
            value={value}
            autoFocus={!isNumeric}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') apply()
            }}
          />
        ))}
      <Button size="sm" className="w-full h-7 text-xs" disabled={!canApply} onClick={apply}>
        Apply
      </Button>
    </div>
  )
}

/** The standard-column filter categories (plan/mrr handled specially by kind). */
const STANDARD_FILTER_CATEGORIES: { key: string; label: string; kind: 'string' | 'number' }[] = [
  { key: 'plan', label: 'Plan', kind: 'string' },
  { key: 'mrr', label: 'Monthly spend', kind: 'number' },
  { key: 'size', label: 'Size', kind: 'string' },
  { key: 'industry', label: 'Industry', kind: 'string' },
]

function AddCompanyFilterButton({
  companyAttrs,
  onChange,
}: {
  companyAttrs?: string
  onChange: (encoded: string | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<{
    key: string
    label: string
    kind: 'string' | 'number' | 'boolean' | 'source'
  } | null>(null)
  const { data: companyAttributes } = useCompanyAttributes()

  const parts = splitParts(companyAttrs)
  const usedKeys = new Set(parts.map((p) => p.split(':')[0]))

  const close = () => {
    setOpen(false)
    setCategory(null)
  }

  const apply = (encoded: string) => {
    onChange([...parts, encoded].join(','))
    close()
  }

  const availableStandard = STANDARD_FILTER_CATEGORIES.filter((c) => !usedKeys.has(c.key))
  const sourceAvailable = !usedKeys.has('source')
  const availableCustom = (companyAttributes ?? []).filter((a) => !usedKeys.has(a.key))

  if (availableStandard.length === 0 && !sourceAvailable && availableCustom.length === 0) {
    return null
  }

  const attrKind = (type: string): 'string' | 'number' | 'boolean' =>
    type === 'number' || type === 'currency' || type === 'date'
      ? 'number'
      : type === 'boolean'
        ? 'boolean'
        : 'string'

  return (
    <Popover
      open={open}
      onOpenChange={(isOpen) => {
        setOpen(isOpen)
        if (!isOpen) setCategory(null)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs',
            'border border-dashed border-border/50 text-muted-foreground',
            'hover:text-foreground hover:border-border hover:bg-muted/30 transition-colors'
          )}
        >
          <PlusIcon className="h-3 w-3" />
          Add filter
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-0">
        {category === null ? (
          <div className="py-1 max-h-[350px] overflow-y-auto">
            {availableStandard.map((cat) => (
              <button
                key={cat.key}
                type="button"
                onClick={() => setCategory(cat)}
                className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-[13px] text-left hover:bg-muted/50 transition-colors"
              >
                <span className="flex items-center gap-2">
                  {cat.key === 'mrr' ? (
                    <BanknotesIcon className="size-4 text-muted-foreground" />
                  ) : (
                    <TagIcon className="size-4 text-muted-foreground" />
                  )}
                  {cat.label}
                </span>
                <ChevronRightIcon className="size-3.5 text-muted-foreground" />
              </button>
            ))}
            {sourceAvailable && (
              <button
                type="button"
                onClick={() => setCategory({ key: 'source', label: 'Source', kind: 'source' })}
                className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-[13px] text-left hover:bg-muted/50 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <TagIcon className="size-4 text-muted-foreground" />
                  Source
                </span>
                <ChevronRightIcon className="size-3.5 text-muted-foreground" />
              </button>
            )}
            {availableCustom.length > 0 && (
              <>
                <div className="border-b border-border/30 my-1" />
                <div className="px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Custom attributes
                </div>
                {availableCustom.map((attr) => (
                  <button
                    key={attr.key}
                    type="button"
                    onClick={() =>
                      setCategory({ key: attr.key, label: attr.label, kind: attrKind(attr.type) })
                    }
                    className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-[13px] text-left hover:bg-muted/50 transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <TagIcon className="size-4 text-muted-foreground" />
                      {attr.label}
                    </span>
                    <ChevronRightIcon className="size-3.5 text-muted-foreground" />
                  </button>
                ))}
              </>
            )}
          </div>
        ) : (
          <div>
            <button
              type="button"
              onClick={() => setCategory(null)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground border-b border-border/50"
            >
              <ChevronRightIcon className="h-2.5 w-2.5 rotate-180" />
              {category.label}
            </button>
            {category.kind === 'source' ? (
              <div className="py-1">
                {(['api', 'manual'] as const).map((source) => (
                  <button
                    key={source}
                    type="button"
                    onClick={() => apply(`source:eq:${source}`)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[13px] capitalize hover:bg-muted/50 transition-colors"
                  >
                    {source}
                  </button>
                ))}
              </div>
            ) : (
              <FilterPredicateInput attrKey={category.key} kind={category.kind} onApply={apply} />
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function CompanyFiltersBar({
  companyAttrs,
  onChange,
}: {
  companyAttrs?: string
  onChange: (encoded: string | undefined) => void
}) {
  const parts = splitParts(companyAttrs)

  const removePart = (part: string) => {
    const remaining = parts.filter((p) => p !== part)
    onChange(remaining.length > 0 ? remaining.join(',') : undefined)
  }

  return (
    <div className="flex flex-wrap gap-1 items-center">
      {parts.map((part) => {
        const [key, op, ...rest] = part.split(':')
        if (!key || !op) return null
        const value = rest.join(':')
        const opLabel = OP_LABELS[op] ?? op
        const label = key === 'mrr' ? 'Spend:' : key === 'plan' ? 'Plan:' : `${key}:`
        const display =
          op === 'is_set' || op === 'is_not_set'
            ? opLabel
            : key === 'plan' && op === 'eq'
              ? value
              : `${opLabel} ${value}`
        return (
          <FilterChip
            key={part}
            icon={key === 'mrr' ? BanknotesIcon : TagIcon}
            label={label}
            value={display}
            valueId={part}
            onRemove={() => removePart(part)}
          />
        )
      })}
      <AddCompanyFilterButton companyAttrs={companyAttrs} onChange={onChange} />
      {parts.length > 1 && (
        <button
          type="button"
          onClick={() => onChange(undefined)}
          className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted/50 transition-colors"
        >
          Clear all
        </button>
      )}
    </div>
  )
}

function NewCompanyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (id: string) => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')

  const create = useMutation({
    mutationFn: () =>
      createCompanyFn({ data: { name: name.trim(), domain: domain.trim() || null } }),
    onSuccess: async (company) => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'companies'] })
      onOpenChange(false)
      setName('')
      setDomain('')
      onCreated(company.id)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create company')
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New company</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) create.mutate()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="company-name">Name</Label>
            <Input
              id="company-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Inc"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="company-domain">
              Email domain <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Input
              id="company-domain"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="acme.com"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={create.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending ? 'Creating...' : 'Create company'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface CompaniesViewProps {
  companies: CompanyWithMemberCountDTO[] | undefined
  isLoading: boolean
  search?: string
  onSearchChange: (value: string | undefined) => void
  companyAttrs?: string
  onCompanyAttrsChange: (encoded: string | undefined) => void
  onSelectCompany: (id: string) => void
  canManage: boolean
}

export function CompaniesView({
  companies,
  isLoading,
  search,
  onSearchChange,
  companyAttrs,
  onCompanyAttrsChange,
  onSelectCompany,
  canManage,
}: CompaniesViewProps) {
  const [createOpen, setCreateOpen] = useState(false)
  const { value: searchValue, setValue: setSearchValue } = useDebouncedSearch({
    externalValue: search,
    onChange: (value) => onSearchChange(value),
  })

  const total = companies?.length ?? 0
  const hasActiveFilters = !!(search || companyAttrs)

  return (
    <div className="max-w-5xl w-full">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm px-3 py-2.5">
        <div className="flex items-center gap-2">
          <SearchInput
            value={searchValue}
            onChange={setSearchValue}
            placeholder="Search companies..."
            data-search-input
          />
          <div className="flex-1" />
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" asChild>
            <a href={buildCompaniesExportUrl(search, companyAttrs)} download>
              <ArrowDownTrayIcon className="h-3.5 w-3.5" />
              Export CSV
            </a>
          </Button>
          {canManage && (
            <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setCreateOpen(true)}>
              <PlusIcon className="h-3.5 w-3.5" />
              New company
            </Button>
          )}
        </div>

        <div className="mt-2">
          <CompanyFiltersBar companyAttrs={companyAttrs} onChange={onCompanyAttrsChange} />
        </div>

        <div className="mt-2 text-xs text-muted-foreground">
          {total} {total === 1 ? 'company' : 'companies'}
        </div>
      </div>

      <div className="p-3">
        {isLoading ? (
          <div className="rounded-xl overflow-hidden shadow-sm divide-y divide-border/50 bg-card border border-border/50">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3">
                <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-40 mb-1.5" />
                  <Skeleton className="h-3 w-28" />
                </div>
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        ) : !companies || companies.length === 0 ? (
          <div className="rounded-xl overflow-hidden shadow-sm bg-card border border-border/50">
            <EmptyState
              icon={BuildingOffice2Icon}
              title={hasActiveFilters ? 'No companies match your filters' : 'No companies yet'}
              description={
                hasActiveFilters
                  ? "Try adjusting your filters to find what you're looking for."
                  : 'Companies appear here when people are linked to one, via the API or an agent.'
              }
              action={
                hasActiveFilters ? (
                  <button
                    type="button"
                    onClick={() => {
                      onSearchChange(undefined)
                      onCompanyAttrsChange(undefined)
                    }}
                    className="text-sm text-primary hover:underline"
                  >
                    Clear filters
                  </button>
                ) : undefined
              }
              className="py-12"
            />
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden shadow-sm divide-y divide-border/50 bg-card border border-border/50">
            {/* Column header */}
            <div className="hidden sm:flex items-center gap-3 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30">
              <span className="flex-1 min-w-0">Company</span>
              <span className="w-24 text-left">Plan</span>
              <span className="w-24 text-right">Monthly spend</span>
              <span className="w-16 text-right">People</span>
              <span className="w-16 text-right">Source</span>
            </div>
            {companies.map((company) => (
              <button
                key={company.id}
                type="button"
                onClick={() => onSelectCompany(company.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/40 transition-colors"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <BuildingOffice2Icon className="h-4.5 w-4.5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{company.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {company.domain ?? 'No domain'}
                  </div>
                </div>
                <span className="w-24 shrink-0 hidden sm:block">
                  {company.plan ? (
                    <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                      {company.plan}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground/60">-</span>
                  )}
                </span>
                <span className="w-24 shrink-0 text-right text-xs tabular-nums text-foreground hidden sm:block">
                  {formatMonthlySpend(company.mrrCents)}
                </span>
                <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {company.memberCount}
                </span>
                <span className="w-16 shrink-0 text-right hidden sm:block">
                  <SourceBadge source={company.source} />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <NewCompanyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={onSelectCompany}
      />
    </div>
  )
}
