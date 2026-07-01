import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AnalyticsBarList, type BarListRow } from './analytics-bar-list'
import { AnalyticsEmpty } from './analytics-empty'

type TopBreakdowns = Record<string, Array<{ label: string; count: number }>>

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })

function countryName(code: string): string {
  try {
    return regionNames.of(code) ?? code
  } catch {
    return code
  }
}

/** ISO-2 country code to its flag emoji (regional indicator pair). */
function countryFlag(code: string): string {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}

const PANELS: Array<{
  dimension: string
  title: string
  header: string
  format?: (label: string) => BarListRow['label']
}> = [
  { dimension: 'page', title: 'Top pages', header: 'Page' },
  { dimension: 'source', title: 'Sources', header: 'Source' },
  {
    dimension: 'country',
    title: 'Countries',
    header: 'Country',
    format: (code) => `${countryFlag(code)} ${countryName(code)}`,
  },
  { dimension: 'device', title: 'Devices', header: 'Device' },
  { dimension: 'browser', title: 'Browsers', header: 'Browser' },
  { dimension: 'os', title: 'Operating systems', header: 'OS' },
]

/** The breakdown grid: six visitor-ranked bar lists fed by the rollup
 *  snapshots (top 10 per dimension for the selected period + surface). */
export function AnalyticsVisitorPanels({ top }: { top: TopBreakdowns }) {
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:items-start">
      {PANELS.map(({ dimension, title, header, format }) => {
        const rows = top[dimension] ?? []
        return (
          <Card key={dimension}>
            <CardHeader>
              <CardTitle>{title}</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[320px] overflow-y-auto scrollbar-thin">
              {rows.length === 0 ? (
                <AnalyticsEmpty message="No data for this period" />
              ) : (
                <AnalyticsBarList
                  header={{ label: header, value: 'Visitors' }}
                  rows={rows.map((row) => ({
                    key: row.label,
                    label: format ? format(row.label) : row.label,
                    value: row.count,
                  }))}
                />
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
