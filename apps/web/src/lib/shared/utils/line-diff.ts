/** One line of a line-by-line comparison. */
export interface DiffLine {
  kind: 'same' | 'added' | 'removed'
  text: string
}

/**
 * Line-by-line comparison of two texts (longest common subsequence), for
 * showing what changed between two versions of an article. Texts are short
 * enough for the quadratic table; very long ones fall back to "all removed,
 * all added".
 */
export function lineDiff(before: string, after: string, maxCells = 4_000_000): DiffLine[] {
  const a = before.split('\n')
  const b = after.split('\n')
  if (a.length * b.length > maxCells) {
    return [
      ...a.map((text) => ({ kind: 'removed' as const, text })),
      ...b.map((text) => ({ kind: 'added' as const, text })),
    ]
  }
  // lengths[i][j] = LCS length of a[i..] and b[j..]
  const lengths: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  )
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i][j] =
        a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] })
      i++
      j++
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      out.push({ kind: 'removed', text: a[i++] })
    } else {
      out.push({ kind: 'added', text: b[j++] })
    }
  }
  while (i < a.length) out.push({ kind: 'removed', text: a[i++] })
  while (j < b.length) out.push({ kind: 'added', text: b[j++] })
  return out
}
