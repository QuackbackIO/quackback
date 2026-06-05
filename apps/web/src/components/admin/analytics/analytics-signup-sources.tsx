import { AnalyticsBarList } from './analytics-bar-list'
import { AnalyticsEmpty } from './analytics-empty'

interface SignupSourcesProps {
  sources: Array<{ source: string; count: number }>
}

/** Acquisition-channel breakdown of new signups in the period (Email, Google,
 *  SSO, …), as a proportional bar list. */
export function AnalyticsSignupSources({ sources }: SignupSourcesProps) {
  if (sources.length === 0) {
    return <AnalyticsEmpty message="No signups in this period" />
  }

  return (
    <AnalyticsBarList
      header={{ label: 'Source', value: 'Signups' }}
      rows={sources.map((s) => ({ key: s.source, label: s.source, value: s.count }))}
    />
  )
}
