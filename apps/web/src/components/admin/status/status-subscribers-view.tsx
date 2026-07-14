import { useRef, useState } from 'react'
import { useQuery, useInfiniteQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowUpTrayIcon,
  DocumentTextIcon,
  ExclamationCircleIcon,
  PlusIcon,
  UsersIcon,
} from '@heroicons/react/24/outline'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/shared/spinner'
import { EmptyState } from '@/components/shared/empty-state'
import { TimeAgo } from '@/components/ui/time-ago'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useInfiniteScroll } from '@/lib/client/hooks/use-infinite-scroll'
import { useDebouncedSearch } from '@/lib/client/hooks/use-debounced-search'
import { statusSubscriberQueries } from '@/lib/client/queries/status'
import { useAddStatusSubscriber, useImportStatusSubscribers } from '@/lib/client/mutations/status'
import { exportStatusSubscribersAdminFn } from '@/lib/server/functions/status'

/** Extract the "Email" column from a CSV file; falls back to treating every
 *  non-empty line as an email if no header row matches. (Kept local — the
 *  changelog import uses the same shape; a tiny parser isn't worth a shared
 *  cross-feature import.) */
function parseEmailsFromCsv(text: string): string[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length === 0) return []

  const header = lines[0].split(',').map((cell) => cell.trim().toLowerCase())
  const emailColumn = header.indexOf('email')

  if (emailColumn === -1) {
    return lines.map((line) => line.split(',')[0]?.trim()).filter(Boolean)
  }

  return lines
    .slice(1)
    .map((line) => line.split(',')[emailColumn]?.trim())
    .filter((email): email is string => !!email)
}

/** RFC-4180 field escape (mirrors the audit-log export). */
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

type ExportRow = Awaited<ReturnType<typeof exportStatusSubscribersAdminFn>>[number]

function rowsToCsv(rows: ExportRow[]): string {
  const headers = [
    'name',
    'email',
    'scope',
    'services',
    'source',
    'subscribed_at',
    'unsubscribed_at',
  ]
  const lines = [
    headers.join(','),
    ...rows.map((r) =>
      [
        r.displayName ?? '',
        r.email ?? '',
        r.scope,
        r.componentCount,
        r.source,
        r.createdAt,
        r.unsubscribedAt ?? '',
      ]
        .map(csvEscape)
        .join(',')
    ),
  ]
  return lines.join('\n')
}

function downloadCsv(rows: ExportRow[]): void {
  const blob = new Blob([rowsToCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `status-subscribers-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function CountTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex-1 rounded-xl border border-border/50 bg-card px-4 py-3">
      <div className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

export function StatusSubscribersView() {
  const [debouncedSearch, setDebouncedSearch] = useState<string | undefined>(undefined)
  const { value: searchValue, setValue: setSearchValue } = useDebouncedSearch({
    externalValue: debouncedSearch,
    onChange: setDebouncedSearch,
  })
  const [exporting, setExporting] = useState(false)

  const countsQuery = useQuery(statusSubscriberQueries.counts())
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery(
    statusSubscriberQueries.list(debouncedSearch)
  )

  const loadMoreRef = useInfiniteScroll({
    hasMore: !!hasNextPage,
    isFetching: isLoading || isFetchingNextPage,
    onLoadMore: fetchNextPage,
    rootMargin: '0px',
    threshold: 0.1,
  })

  const items = data?.pages.flatMap((page) => page.items) ?? []

  async function handleExport() {
    setExporting(true)
    try {
      const rows = await exportStatusSubscribersAdminFn()
      if (rows.length === 0) {
        toast.info('No subscribers to export yet.')
        return
      }
      downloadCsv(rows)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to export subscribers')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto w-full flex flex-col flex-1 min-h-0">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm px-3 py-2.5 flex items-center gap-2 border-b border-border/40">
        <h2 className="text-sm font-semibold px-1">Subscribers</h2>
        <Input
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          placeholder="Search by name or email…"
          className="h-8 w-56 text-sm bg-muted/30 border-border/50"
        />
        <div className="flex items-center gap-2 ml-auto">
          <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
            <ArrowUpTrayIcon className="h-4 w-4 mr-1.5" />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
          <AddSubscribersDialog />
        </div>
      </div>

      <div className="p-4 space-y-4">
        <div className="flex gap-3">
          <CountTile label="Total subscribers" value={countsQuery.data?.total ?? 0} />
          <CountTile label="Active" value={countsQuery.data?.active ?? 0} />
          <CountTile label="Unsubscribed" value={countsQuery.data?.unsubscribed ?? 0} />
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={UsersIcon}
            title={searchValue ? 'No subscribers match your search' : 'No subscribers yet'}
            className="h-48"
          />
        ) : (
          <div className="rounded-xl overflow-hidden border border-border/50 bg-card shadow-sm divide-y divide-border/50">
            {items.map((sub) => (
              <div key={sub.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">
                    {sub.displayName ?? sub.email ?? 'Unknown'}
                  </div>
                  {sub.email && sub.displayName && (
                    <div className="text-xs text-muted-foreground truncate">{sub.email}</div>
                  )}
                </div>
                <Badge variant="outline" size="sm" className="capitalize">
                  {sub.scope === 'components'
                    ? `${sub.componentIds.length} service${sub.componentIds.length === 1 ? '' : 's'}`
                    : 'Whole page'}
                </Badge>
                <Badge variant="outline" size="sm" className="capitalize">
                  {sub.source.replace('_', ' ')}
                </Badge>
                <div className="text-xs text-muted-foreground w-32 text-right shrink-0">
                  {sub.unsubscribedAt ? (
                    <span>
                      Unsubscribed <TimeAgo date={sub.unsubscribedAt} />
                    </span>
                  ) : (
                    <span>
                      Subscribed <TimeAgo date={sub.createdAt} />
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {hasNextPage && (
          <div ref={loadMoreRef} className="flex justify-center py-2">
            {isFetchingNextPage ? (
              <Spinner />
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fetchNextPage()}
                className="text-muted-foreground"
              >
                Load more
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function AddSubscribersDialog() {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={(o) => setOpen(o)}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusIcon className="h-4 w-4 mr-1.5" />
          Add subscribers
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add subscribers</DialogTitle>
          <DialogDescription>
            Subscribe existing accounts to status updates. Emails without a matching account are
            skipped; no new accounts are created.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="email">
          <TabsList>
            <TabsTrigger value="email">By email</TabsTrigger>
            <TabsTrigger value="csv">CSV import</TabsTrigger>
          </TabsList>
          <TabsContent value="email" className="pt-1">
            <AddByEmailTab onDone={() => setOpen(false)} />
          </TabsContent>
          <TabsContent value="csv" className="pt-1">
            <CsvImportTab onDone={() => setOpen(false)} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

function AddByEmailTab({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('')
  const addMutation = useAddStatusSubscriber()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = email.trim()
    if (!trimmed) return
    try {
      await addMutation.mutateAsync(trimmed)
      toast.success(`Subscribed ${trimmed}.`)
      setEmail('')
      onDone()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No matching user for that email')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="add-subscriber-email">Email address</Label>
        <Input
          id="add-subscriber-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="person@example.com"
          autoFocus
          required
        />
        <p className="text-xs text-muted-foreground">
          The email must belong to an existing account. This subscribes them to the whole page.
        </p>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!email.trim() || addMutation.isPending}>
          {addMutation.isPending ? 'Adding…' : 'Add subscriber'}
        </Button>
      </DialogFooter>
    </form>
  )
}

function CsvImportTab({ onDone }: { onDone: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [emails, setEmails] = useState<string[]>([])
  const [consentChecked, setConsentChecked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const importMutation = useImportStatusSubscribers()

  function handleFile(file: File) {
    setError(null)
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      const parsed = parseEmailsFromCsv(text)
      setEmails(parsed)
      if (parsed.length === 0) {
        setError('No emails found. Make sure the file has an "Email" column.')
      }
    }
    reader.readAsText(file)
  }

  async function handleImport() {
    if (emails.length === 0 || !consentChecked) return
    try {
      const result = await importMutation.mutateAsync(emails)
      toast.success(
        `Imported ${result.imported}.` +
          (result.skipped > 0 ? ` Skipped ${result.skipped} without a matching account.` : '')
      )
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed')
    }
  }

  return (
    <div className="space-y-4">
      <div
        className="border-2 border-dashed border-border/50 rounded-lg p-4 text-center hover:border-primary/50 transition-colors cursor-pointer"
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        {fileName ? (
          <div className="flex items-center justify-center gap-2 text-sm">
            <DocumentTextIcon className="h-4 w-4 text-primary" />
            <span className="font-medium">{fileName}</span>
            <span className="text-muted-foreground">({emails.length} emails found)</span>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <ArrowUpTrayIcon className="h-4 w-4" />
            Click to choose a CSV file with an "Email" column
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-2.5 text-xs text-destructive">
          <ExclamationCircleIcon className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {emails.length > 0 && (
        <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
          <Checkbox
            checked={consentChecked}
            onCheckedChange={(checked) => setConsentChecked(checked === true)}
            className="mt-0.5"
          />
          <span>
            I confirm every person on this list has agreed to receive email from us, and I am not
            importing a purchased or scraped list.
          </span>
        </label>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleImport}
          disabled={emails.length === 0 || !consentChecked || importMutation.isPending}
        >
          {importMutation.isPending ? 'Importing…' : `Subscribe ${emails.length} emails`}
        </Button>
      </DialogFooter>
    </div>
  )
}
