import { useRef, useState } from 'react'
import {
  ArrowUpTrayIcon,
  DocumentTextIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { importChangelogSubscribersFn } from '@/lib/server/functions/changelog-subscriptions'
import type { ChangelogCsvImportResult } from '@/lib/server/domains/changelog/changelog-subscription.types'

/** Extract the "Email" column from a CSV file; falls back to treating every
 *  non-empty line as an email if no header row matches. */
export function parseEmailsFromCsv(text: string): string[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length === 0) return []

  const header = lines[0].split(',').map((cell) => cell.trim().toLowerCase())
  const emailColumn = header.indexOf('email')

  if (emailColumn === -1) {
    // No header — every line is an email.
    return lines.map((line) => line.split(',')[0]?.trim()).filter(Boolean)
  }

  return lines
    .slice(1)
    .map((line) => line.split(',')[emailColumn]?.trim())
    .filter((email): email is string => !!email)
}

export function CsvImportSection() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [emails, setEmails] = useState<string[]>([])
  const [consentChecked, setConsentChecked] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [result, setResult] = useState<ChangelogCsvImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  function handleFile(file: File) {
    setError(null)
    setResult(null)
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
    setIsImporting(true)
    setError(null)
    try {
      const imported = await importChangelogSubscribersFn({ data: { emails } })
      setResult(imported)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setIsImporting(false)
    }
  }

  function reset() {
    setFileName(null)
    setEmails([])
    setConsentChecked(false)
    setResult(null)
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="border-t border-border/50 pt-5 space-y-3">
      <div>
        <p className="text-sm font-medium">Import subscribers</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Upload a CSV with an "Email" column to subscribe existing accounts to changelog emails.
          Rows that don't match an existing account are skipped.
        </p>
      </div>

      {result ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-primary">
            <CheckCircleIcon className="h-4 w-4" />
            <span className="text-sm font-medium">Import complete</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {result.imported} of {result.total} email{result.total === 1 ? '' : 's'} subscribed.
            {result.skipped > 0 && ` ${result.skipped} had no matching account.`}
          </p>
          <Button variant="outline" size="sm" onClick={reset}>
            Import another file
          </Button>
        </div>
      ) : (
        <>
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
                Click to choose a CSV file
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
            <>
              <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
                <Checkbox
                  checked={consentChecked}
                  onCheckedChange={(checked) => setConsentChecked(checked === true)}
                  className="mt-0.5"
                />
                <span>
                  I confirm every person on this list has agreed to receive email from us, and I am
                  not importing a purchased or scraped list.
                </span>
              </label>

              <Button
                size="sm"
                onClick={handleImport}
                disabled={!consentChecked || isImporting}
              >
                {isImporting ? 'Importing...' : `Subscribe ${emails.length} emails`}
              </Button>
            </>
          )}
        </>
      )}
    </div>
  )
}
