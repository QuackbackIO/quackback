/**
 * Renders the structured `AuditDiff` JSON in three optional panels
 * (Before / After / Context) plus a small IP / UA metadata grid.
 */
interface Props {
  diff: unknown
  ipAddress: string | null
  userAgent: string | null
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function Section({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <pre className="text-[11px] bg-muted/40 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}

export function AuditDiffViewer({ diff, ipAddress, userAgent }: Props) {
  const obj = isObject(diff) ? diff : null
  const before = obj && 'before' in obj ? obj.before : undefined
  const after = obj && 'after' in obj ? obj.after : undefined
  const context = obj && 'context' in obj ? obj.context : undefined
  const hasAnyDiffSection = before !== undefined || after !== undefined || context !== undefined
  const hasMeta = Boolean(ipAddress || userAgent)

  if (!hasAnyDiffSection && !hasMeta) {
    // Render the raw diff if it's a non-empty primitive/array, otherwise
    // a small placeholder.
    if (obj && Object.keys(obj).length > 0) {
      return (
        <div className="space-y-3">
          <Section label="Diff" value={obj} />
        </div>
      )
    }
    return <div className="text-xs text-muted-foreground italic">No change details recorded.</div>
  }

  return (
    <div className="space-y-3">
      {before !== undefined && <Section label="Before" value={before} />}
      {after !== undefined && <Section label="After" value={after} />}
      {context !== undefined && <Section label="Context" value={context} />}
      {hasMeta && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
          {ipAddress && (
            <div>
              <span className="font-semibold uppercase text-muted-foreground">IP:</span>{' '}
              <span className="font-mono">{ipAddress}</span>
            </div>
          )}
          {userAgent && (
            <div className="truncate" title={userAgent}>
              <span className="font-semibold uppercase text-muted-foreground">UA:</span>{' '}
              <span className="font-mono">{userAgent}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
