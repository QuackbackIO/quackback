const SUITES = [
  ['quackback_quinn_runs', 'assistant/assistant-run.durability.db.test.ts'],
  ['quackback_quinn_runs', 'conversation/conversation-request-receipt.db.test.ts'],
  ['quackback_quinn_s5', 'assistant/assistant-action.durability.db.test.ts'],
  ['quackback_quinn_s6', 'workflows/workflow-delegation.durability.db.test.ts'],
  ['quackback_quinn_lifecycle', 'conversation/conversation-inactivity.db.test.ts'],
] as const

export function quinnDbSuites(baseUrl: string) {
  return SUITES.map(([database, path]) => {
    const url = new URL(baseUrl)
    url.pathname = `/${database}`
    const [domain, file] = path.split('/')
    return {
      database,
      url: url.toString(),
      file: `apps/web/src/lib/server/domains/${domain}/__tests__/${file}`,
    }
  })
}

interface SuiteReport {
  testResults: Array<{ name: string; assertionResults: Array<{ status: string }> }>
}

export function assertSuitePassed(report: SuiteReport, file: string): number {
  const results = report.testResults.filter((result) => result.name.endsWith(`/${file}`))
  const assertions = results.flatMap((result) => result.assertionResults)
  if (
    results.length !== 1 ||
    assertions.length === 0 ||
    assertions.some((result) => result.status !== 'passed')
  ) {
    throw new Error(
      `${file}: expected executed passing tests with zero skips; check the database and migrations`
    )
  }
  return assertions.length
}
