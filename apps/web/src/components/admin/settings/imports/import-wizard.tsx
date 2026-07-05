import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowUpTrayIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { adminQueries } from '@/lib/client/queries/admin'
import { createBoardFn } from '@/lib/server/functions/boards'
import { createStatusFn } from '@/lib/server/functions/statuses'
import { CSV_TEMPLATE } from '@/lib/shared/schemas/import'
import {
  CANONICAL_FIELDS,
  autoMapFields,
  ignoredColumns,
  distinctColumnValues,
  buildRemappedCsv,
  parseCsvFile,
  type FieldMapping,
  type ValueMapping,
} from './import-wizard-csv'
import type { ImportRunListItem } from './import-history-list'

type Step = 'upload' | 'mapping' | 'value-mapping' | 'dry-run' | 'committing' | 'done' | 'failed'
type Source = 'csv' | 'uservoice' | 'canny'

interface ImportVoterRecord {
  email: string
  name?: string | null
  createdAt?: string
}

const CREATE_NEW = '__create_new__'
const IN_FLIGHT_RUN_STATUSES = new Set(['pending', 'dry_run', 'running'])

interface ImportPreview {
  totalRows: number
  counts: { byBoard: Record<string, number>; byStatus: Record<string, number>; byAuthor: Record<string, number> }
  sample: {
    row: number
    title: string
    board: string | null
    status: string | null
    author: string
    isNewAuthor: boolean
    voteCount: number
    action: 'create' | 'update'
  }[]
  errors: { row: number; message: string; field?: string }[]
  updatedCount: number
}

/**
 * The mapping + dry-run wizard (§I2): upload -> field mapping -> status/board
 * value mapping (create-inline) -> dry run -> commit. Field/status/board
 * mapping happens client-side by rewriting the CSV onto the canonical
 * headers/values the server pipeline already understands, so the server
 * contract stays the single-file upload + dry_run|commit mode from §I1.
 */
export function ImportWizard() {
  const queryClient = useQueryClient()
  const boardsQuery = useQuery(adminQueries.boardsForSettings())
  const statusesQuery = useQuery(adminQueries.statuses())

  const [step, setStep] = useState<Step>('upload')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [source, setSource] = useState<Source>('csv')
  const [cannyApiKey, setCannyApiKey] = useState('')
  const [caveats, setCaveats] = useState<string[]>([])
  const [voters, setVoters] = useState<Record<string, ImportVoterRecord[]>>({})

  const [fileName, setFileName] = useState<string | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [fieldMapping, setFieldMapping] = useState<FieldMapping | null>(null)
  const [defaultBoardId, setDefaultBoardId] = useState('')

  const [statusValues, setStatusValues] = useState<string[]>([])
  const [boardValues, setBoardValues] = useState<string[]>([])
  const [statusValueMapping, setStatusValueMapping] = useState<ValueMapping>({})
  const [boardValueMapping, setBoardValueMapping] = useState<ValueMapping>({})

  const [remappedCsv, setRemappedCsv] = useState<string | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [runId, setRunId] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const runQuery = useQuery({
    queryKey: ['import-run', runId],
    queryFn: async () => {
      const res = await fetch(`/api/import/runs/${runId}`)
      if (!res.ok) throw new Error('Failed to load import status')
      const body = (await res.json()) as { run: ImportRunListItem }
      return body.run
    },
    enabled: !!runId && step === 'committing',
    refetchInterval: (query) =>
      query.state.data && IN_FLIGHT_RUN_STATUSES.has(query.state.data.status) ? 1500 : false,
  })

  const run = runQuery.data
  if (run && step === 'committing' && !IN_FLIGHT_RUN_STATUSES.has(run.status)) {
    setStep(run.status === 'failed' ? 'failed' : 'done')
    void queryClient.invalidateQueries({ queryKey: ['import-runs'] })
  }

  function reset() {
    setStep('upload')
    setError(null)
    setSource('csv')
    setCannyApiKey('')
    setCaveats([])
    setVoters({})
    setFileName(null)
    setHeaders([])
    setRows([])
    setFieldMapping(null)
    setStatusValues([])
    setBoardValues([])
    setStatusValueMapping({})
    setBoardValueMapping({})
    setRemappedCsv(null)
    setPreview(null)
    setRunId(null)
  }

  /** Loads a canonical CSV (from a plain upload or a detect() response) into the mapping step. */
  function loadCanonicalCsv(csvText: string, name: string) {
    const { headers: parsedHeaders, rows: parsedRows } = parseCsvFile(csvText)
    if (parsedRows.length === 0) {
      setError('No rows found')
      return
    }
    setFileName(name)
    setHeaders(parsedHeaders)
    setRows(parsedRows)
    setFieldMapping(autoMapFields(parsedHeaders))
    setStep('mapping')
  }

  async function handleFileSelect(file: File) {
    setError(null)
    if (!file.type.includes('csv') && !file.name.endsWith('.csv')) {
      setError('Please select a CSV file')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('File size must be less than 10MB')
      return
    }

    if (source === 'uservoice') {
      await runDetect(() => {
        const formData = new FormData()
        formData.append('source', 'uservoice')
        formData.append('file', file)
        return formData
      }, file.name)
      return
    }

    const text = await file.text()
    loadCanonicalCsv(text, file.name)
  }

  /** Calls /api/import/detect and loads the returned canonical CSV + voters/caveats. */
  async function runDetect(buildFormData: () => FormData, name: string) {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/import/detect', { method: 'POST', body: buildFormData() })
      const data = (await response.json()) as {
        csv?: string
        voters?: Record<string, ImportVoterRecord[]>
        caveats?: string[]
        error?: string
      }
      if (!response.ok || !data.csv) {
        throw new Error(data.error || 'Failed to read the export')
      }
      setVoters(data.voters ?? {})
      setCaveats(data.caveats ?? [])
      loadCanonicalCsv(data.csv, name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read the export')
    } finally {
      setBusy(false)
    }
  }

  function handleFetchCanny() {
    if (!cannyApiKey.trim()) {
      setError('A Canny API key is required')
      return
    }
    void runDetect(() => {
      const formData = new FormData()
      formData.append('source', 'canny')
      formData.append('apiKey', cannyApiKey.trim())
      return formData
    }, 'canny-export.csv')
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) void handleFileSelect(file)
  }

  function continueFromMapping() {
    if (!fieldMapping) return
    const statusColumn = fieldMapping.status
    const boardColumn = fieldMapping.board
    const distinctStatuses = distinctColumnValues(rows, statusColumn)
    const distinctBoards = distinctColumnValues(rows, boardColumn)

    if (distinctStatuses.length === 0 && distinctBoards.length === 0) {
      void runDryRun({}, {})
      return
    }

    setStatusValues(distinctStatuses)
    setBoardValues(distinctBoards)
    setStatusValueMapping(Object.fromEntries(distinctStatuses.map((v) => [v, autoMatch(v, statusesQuery.data)])))
    setBoardValueMapping(Object.fromEntries(distinctBoards.map((v) => [v, autoMatch(v, boardsQuery.data)])))
    setStep('value-mapping')
  }

  function autoMatch(value: string, options: { slug: string; name: string }[] | undefined): string {
    const match = options?.find((o) => o.name.toLowerCase() === value.toLowerCase())
    return match?.slug ?? CREATE_NEW
  }

  async function resolveCreateNew(
    mapping: ValueMapping,
    kind: 'status' | 'board'
  ): Promise<ValueMapping> {
    const resolved = { ...mapping }
    for (const [value, target] of Object.entries(mapping)) {
      if (target !== CREATE_NEW) continue
      if (kind === 'status') {
        const slug = value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '')
          .slice(0, 50) || 'status'
        const created = await createStatusFn({
          data: { name: value, slug, color: '#6b7280', category: 'active' },
        })
        resolved[value] = created.slug
      } else {
        const created = await createBoardFn({ data: { name: value, preset: 'public' } })
        resolved[value] = created.slug
      }
    }
    return resolved
  }

  async function continueFromValueMapping() {
    setBusy(true)
    setError(null)
    try {
      const resolvedStatus = await resolveCreateNew(statusValueMapping, 'status')
      const resolvedBoard = await resolveCreateNew(boardValueMapping, 'board')
      setStatusValueMapping(resolvedStatus)
      setBoardValueMapping(resolvedBoard)
      await queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'boards'] })
      await queryClient.invalidateQueries({ queryKey: ['admin', 'statuses'] })
      await runDryRun(resolvedStatus, resolvedBoard)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create new statuses/boards')
    } finally {
      setBusy(false)
    }
  }

  /** Shared upload fields both dry-run and commit send: the file, target board, source, and real voters. */
  function buildImportFormData(csv: string, mode: 'dry_run' | 'commit'): FormData {
    const formData = new FormData()
    formData.append('file', new File([csv], fileName ?? 'import.csv', { type: 'text/csv' }))
    if (defaultBoardId) formData.append('boardId', defaultBoardId)
    formData.append('mode', mode)
    formData.append('source', source)
    if (Object.keys(voters).length > 0) {
      formData.append('votersJson', JSON.stringify(voters))
    }
    return formData
  }

  async function runDryRun(resolvedStatus: ValueMapping, resolvedBoard: ValueMapping) {
    if (!fieldMapping) return
    setBusy(true)
    setError(null)
    try {
      const csv = buildRemappedCsv(rows, fieldMapping, resolvedStatus, resolvedBoard)
      const formData = buildImportFormData(csv, 'dry_run')

      const response = await fetch('/api/import', { method: 'POST', body: formData })
      const data = (await response.json()) as ImportPreview & { error?: string }
      if (!response.ok) throw new Error(data.error || 'Dry run failed')

      setRemappedCsv(csv)
      setPreview(data)
      setStep('dry-run')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dry run failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleCommit() {
    if (!remappedCsv) return
    setBusy(true)
    setError(null)
    try {
      const formData = buildImportFormData(remappedCsv, 'commit')

      const response = await fetch('/api/import', { method: 'POST', body: formData })
      const data = (await response.json()) as { runId?: string; error?: string }
      if (!response.ok || !data.runId) throw new Error(data.error || 'Import failed to start')

      setRunId(data.runId)
      setStep('committing')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed to start')
      setBusy(false)
    }
  }

  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'import-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (step === 'upload') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground shrink-0">Source</span>
          <Select value={source} onValueChange={(value) => setSource(value as Source)}>
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="csv">CSV file</SelectItem>
              <SelectItem value="uservoice">UserVoice export</SelectItem>
              <SelectItem value="canny">Canny (API key)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {source === 'canny' ? (
          <div className="space-y-2">
            <input
              type="password"
              value={cannyApiKey}
              onChange={(e) => setCannyApiKey(e.target.value)}
              placeholder="Canny API key"
              className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm"
            />
            <Button onClick={handleFetchCanny} disabled={busy}>
              {busy && <ArrowPathIcon className="size-4 animate-spin" />}
              Fetch from Canny
            </Button>
          </div>
        ) : (
          <div
            className="border-2 border-dashed border-border/50 rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer"
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && void handleFileSelect(e.target.files[0])}
            />
            {busy ? (
              <ArrowPathIcon className="h-10 w-10 text-muted-foreground mx-auto mb-3 animate-spin" />
            ) : (
              <ArrowUpTrayIcon className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            )}
            <p className="text-sm text-muted-foreground">
              {source === 'uservoice'
                ? 'Drop the UserVoice full suggestions export here, or click to browse'
                : 'Drop a CSV file here or click to browse'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Maximum 10MB, up to 10,000 rows</p>
          </div>
        )}

        {boardsQuery.data && boardsQuery.data.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground shrink-0">Default board</span>
            <Select value={defaultBoardId} onValueChange={setDefaultBoardId}>
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue placeholder="First board (default)" />
              </SelectTrigger>
              <SelectContent>
                {boardsQuery.data.map((board) => (
                  <SelectItem key={board.id} value={board.id}>
                    {board.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {error && (
          <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-lg flex items-center gap-2">
            <ExclamationCircleIcon className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {source === 'csv' && (
          <Button variant="outline" onClick={downloadTemplate}>
            <ArrowDownTrayIcon className="size-4" />
            Download template
          </Button>
        )}
      </div>
    )
  }

  if (step === 'mapping' && fieldMapping) {
    const ignored = ignoredColumns(headers, fieldMapping)
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {fileName}: matched known columns automatically. Adjust any that look wrong.
        </p>
        {caveats.length > 0 && (
          <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
            {caveats.map((c, i) => (
              <p key={i}>{c}</p>
            ))}
          </div>
        )}
        <div className="space-y-2">
          {CANONICAL_FIELDS.map((field) => (
            <div key={field.key} className="flex items-center gap-3">
              <span className="w-32 shrink-0 text-sm font-medium">
                {field.label}
                {field.required && <span className="text-destructive">*</span>}
              </span>
              <Select
                value={fieldMapping[field.key] ?? 'none'}
                onValueChange={(value) =>
                  setFieldMapping((prev) =>
                    prev ? { ...prev, [field.key]: value === 'none' ? null : value } : prev
                  )
                }
              >
                <SelectTrigger className="w-full sm:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Don&apos;t import</SelectItem>
                  {headers.map((h) => (
                    <SelectItem key={h} value={h}>
                      {h}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>

        {ignored.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Ignored columns (not imported): {ignored.join(', ')}
          </p>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2">
          <Button variant="outline" onClick={reset}>
            Start over
          </Button>
          <Button
            onClick={continueFromMapping}
            disabled={!fieldMapping.title || !fieldMapping.content || busy}
          >
            {busy && <ArrowPathIcon className="size-4 animate-spin" />}
            Continue
          </Button>
        </div>
      </div>
    )
  }

  if (step === 'value-mapping') {
    return (
      <div className="space-y-6">
        {statusValues.length > 0 && (
          <ValueMappingSection
            title="Map statuses"
            values={statusValues}
            mapping={statusValueMapping}
            onChange={setStatusValueMapping}
            options={(statusesQuery.data ?? []).map((s) => ({ slug: s.slug, name: s.name }))}
          />
        )}
        {boardValues.length > 0 && (
          <ValueMappingSection
            title="Map boards"
            values={boardValues}
            mapping={boardValueMapping}
            onChange={setBoardValueMapping}
            options={(boardsQuery.data ?? []).map((b) => ({ slug: b.slug, name: b.name }))}
          />
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setStep('mapping')} disabled={busy}>
            Back
          </Button>
          <Button onClick={continueFromValueMapping} disabled={busy}>
            {busy && <ArrowPathIcon className="size-4 animate-spin" />}
            Continue to dry run
          </Button>
        </div>
      </div>
    )
  }

  if (step === 'dry-run' && preview) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3 text-sm">
          <SummaryStat label="Rows" value={preview.totalRows} />
          <SummaryStat label="Will create" value={preview.totalRows - preview.updatedCount - preview.errors.length} />
          <SummaryStat label="Will update" value={preview.updatedCount} />
        </div>

        {preview.errors.length > 0 && (
          <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            <p className="font-medium">{preview.errors.length} row(s) have errors and will be skipped</p>
            <ul className="mt-1 list-disc pl-5">
              {preview.errors.slice(0, 5).map((e, i) => (
                <li key={i}>
                  Row {e.row}: {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Row</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Board</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Author</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.sample.map((row) => (
                <TableRow key={row.row}>
                  <TableCell>{row.row}</TableCell>
                  <TableCell className="max-w-[200px] truncate">{row.title}</TableCell>
                  <TableCell>{row.board ?? '—'}</TableCell>
                  <TableCell>{row.status ?? '—'}</TableCell>
                  <TableCell>
                    {row.author}
                    {row.isNewAuthor && (
                      <Badge variant="secondary" className="ml-1">
                        new
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.action === 'update' ? 'outline' : 'default'}>
                      {row.action}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2">
          <Button variant="outline" onClick={reset} disabled={busy}>
            Start over
          </Button>
          <Button onClick={handleCommit} disabled={busy}>
            {busy && <ArrowPathIcon className="size-4 animate-spin" />}
            Commit import
          </Button>
        </div>
      </div>
    )
  }

  if (step === 'committing') {
    return (
      <div className="flex items-center gap-3">
        <ArrowPathIcon className="h-5 w-5 animate-spin text-primary" />
        <span className="text-sm font-medium">
          {run?.status === 'running' ? 'Importing...' : 'Queued...'}
        </span>
      </div>
    )
  }

  if (step === 'done' && run) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 text-primary">
          <CheckCircleIcon className="h-5 w-5" />
          <span className="font-medium">Import complete</span>
        </div>
        <div className="bg-muted/50 rounded-lg p-4 space-y-1 text-sm">
          <p>
            <span className="font-medium">{run.totals?.created ?? 0}</span> posts created
          </p>
          {(run.totals?.updated ?? 0) > 0 && (
            <p>
              <span className="font-medium">{run.totals?.updated}</span> posts updated
            </p>
          )}
          {(run.totals?.skipped ?? 0) > 0 && (
            <p className="text-muted-foreground">
              <span className="font-medium">{run.totals?.skipped}</span> rows skipped
            </p>
          )}
        </div>
        <Button onClick={reset}>Import more</Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-destructive">
        <ExclamationCircleIcon className="h-5 w-5" />
        <span className="font-medium">Import failed</span>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={reset} variant="outline">
        Try again
      </Button>
    </div>
  )
}

interface ValueMappingSectionProps {
  title: string
  values: string[]
  mapping: ValueMapping
  onChange: (mapping: ValueMapping) => void
  options: { slug: string; name: string }[]
}

function ValueMappingSection({ title, values, mapping, onChange, options }: ValueMappingSectionProps) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{title}</p>
      {values.map((value) => (
        <div key={value} className="flex items-center gap-3">
          <span className="w-40 shrink-0 truncate text-sm text-muted-foreground" title={value}>
            {value}
          </span>
          <Select
            value={mapping[value] ?? CREATE_NEW}
            onValueChange={(target) => onChange({ ...mapping, [value]: target })}
          >
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={CREATE_NEW}>Create &quot;{value}&quot;</SelectItem>
              {options.map((o) => (
                <SelectItem key={o.slug} value={o.slug}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
    </div>
  )
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/50 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  )
}
