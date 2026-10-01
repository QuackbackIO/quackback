/**
 * Zip listings: the archive's index as a tree, folders first, sizes on the
 * right. Only the central directory is read (the filter declines every entry,
 * so nothing is inflated), and nothing is ever extracted. A zip that unpacks
 * to far more than its own size is flagged in the note.
 */
import { useEffect, useMemo } from 'react'
import { unzipSync } from 'fflate'
import { DocumentIcon, FolderIcon } from '@heroicons/react/24/outline'
import { formatBytes } from '@/lib/shared/files/file-types'
import type { ViewerEngineProps } from '../types'

/** Entries read from the index before the listing stops counting. */
const MAX_SCANNED = 50_000
/** Rows drawn; the rest are summarized in one row. */
const MAX_ROWS = 5_000
const SUSPICIOUS_RATIO = 100
const SUSPICIOUS_UNPACKED = 1024 * 1024 * 1024
/** Below this, a high ratio is just a small file of repeated bytes. */
const RATIO_FLOOR = 1024 * 1024

const count = new Intl.NumberFormat('en-US')

interface TreeNode {
  name: string
  dir: boolean
  size: number
  children: Map<string, TreeNode>
}

interface Row {
  name: string
  dir: boolean
  size: number
  depth: number
}

interface Listing {
  rows: Row[]
  hidden: number
  files: number
  unpacked: number
  /** The index had more entries than were read. */
  more: boolean
}

const STOP = Symbol('stop')

function readListing(bytes: Uint8Array): Listing {
  const root: TreeNode = { name: '', dir: true, size: 0, children: new Map() }
  let scanned = 0
  let files = 0
  let unpacked = 0
  let more = false

  const folder = (parent: TreeNode, name: string): TreeNode => {
    let node = parent.children.get(`d:${name}`)
    if (!node) {
      node = { name, dir: true, size: 0, children: new Map() }
      parent.children.set(`d:${name}`, node)
    }
    return node
  }

  try {
    unzipSync(bytes, {
      filter: (entry) => {
        if (scanned >= MAX_SCANNED) {
          more = true
          throw STOP
        }
        scanned++
        const parts = entry.name.split('/').filter((p) => p && p !== '.')
        const isDir = entry.name.endsWith('/')
        if (parts.length === 0) return false
        let parent = root
        for (const part of isDir ? parts : parts.slice(0, -1)) parent = folder(parent, part)
        if (!isDir) {
          const name = parts[parts.length - 1]!
          const size = Number.isFinite(entry.originalSize) ? entry.originalSize : 0
          parent.children.set(`f:${name}:${scanned}`, {
            name,
            dir: false,
            size,
            children: new Map(),
          })
          files++
          unpacked += size
        }
        return false
      },
    })
  } catch (error) {
    if (error !== STOP) throw error
  }

  const rows: Row[] = []
  let total = 0
  const order = (a: TreeNode, b: TreeNode) =>
    a.dir !== b.dir
      ? a.dir
        ? -1
        : 1
      : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  const walk = (node: TreeNode, depth: number) => {
    for (const child of [...node.children.values()].sort(order)) {
      total++
      if (rows.length < MAX_ROWS) {
        rows.push({ name: child.name, dir: child.dir, size: child.size, depth })
      }
      if (child.dir) walk(child, depth + 1)
    }
  }
  walk(root, 0)
  return { rows, hidden: total - rows.length, files, unpacked, more }
}

function noteFor(listing: Listing, packedBytes: number): string {
  const files = `${count.format(listing.files)}${listing.more ? '+' : ''} ${listing.files === 1 && !listing.more ? 'file' : 'files'}`
  const parts = [files, `${formatBytes(listing.unpacked)} unpacked`]
  const ratio = packedBytes > 0 ? listing.unpacked / packedBytes : 0
  if (
    listing.unpacked > SUSPICIOUS_UNPACKED ||
    (listing.unpacked >= RATIO_FLOOR && ratio > SUSPICIOUS_RATIO)
  ) {
    parts.push('Unusually large when unpacked')
  }
  return parts.join(' · ')
}

export default function ArchiveEngine({ data, onToolbar, onError }: ViewerEngineProps) {
  const result = useMemo(() => {
    if (!data) return null
    try {
      const bytes = new Uint8Array(data)
      const listing = readListing(bytes)
      return { listing, note: noteFor(listing, bytes.byteLength) }
    } catch {
      return null
    }
  }, [data])

  useEffect(() => {
    if (result) onToolbar({ note: result.note })
    else onError('corrupt')
  }, [result, onToolbar, onError])

  if (!result) return null
  const { listing } = result

  return (
    <div className="min-w-0 flex-1 overflow-auto bg-background">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <th className="sticky top-0 border-b border-border bg-background px-3.5 py-2 text-left text-[11.5px] font-medium text-muted-foreground">
              Name
            </th>
            <th className="sticky top-0 border-b border-border bg-background px-3.5 py-2 text-right text-[11.5px] font-medium text-muted-foreground">
              Size
            </th>
          </tr>
        </thead>
        <tbody>
          {listing.rows.map((row, i) => (
            <tr key={i} className="border-b border-border/60">
              <td className="max-w-0 px-3.5 py-1.5">
                <span
                  className="flex min-w-0 items-center gap-2"
                  style={{ paddingLeft: row.depth * 18 }}
                >
                  {row.dir ? (
                    <FolderIcon className="size-4 shrink-0 text-amber-600" aria-hidden="true" />
                  ) : (
                    <DocumentIcon
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                  <span
                    data-entry-name=""
                    data-depth={row.depth}
                    className={row.dir ? 'truncate font-semibold' : 'truncate'}
                  >
                    {row.name}
                  </span>
                </span>
              </td>
              <td className="w-28 px-3.5 py-1.5 text-right whitespace-nowrap text-muted-foreground tabular-nums">
                {row.dir ? '' : formatBytes(row.size)}
              </td>
            </tr>
          ))}
          {(listing.hidden > 0 || listing.more) && (
            <tr>
              <td colSpan={2} className="px-3.5 py-2.5 text-xs text-muted-foreground">
                {listing.more
                  ? `and ${count.format(listing.hidden)}+ more`
                  : `and ${count.format(listing.hidden)} more`}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
