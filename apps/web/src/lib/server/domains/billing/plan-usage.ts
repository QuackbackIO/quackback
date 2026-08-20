export type PlanUsageLine = {
  key: string
  label: string
  used: number
  limit: number | null
}

export function formatUsageLine(line: PlanUsageLine): string {
  if (line.limit == null) return `${line.used} ${line.label}`
  return `${line.used} of ${line.limit} ${line.label}`
}

export function finiteUsageLines(lines: PlanUsageLine[]): PlanUsageLine[] {
  return lines.filter((line) => line.limit != null)
}
