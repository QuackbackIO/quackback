/**
 * Report rendering.
 *
 * Two audiences, one run. The JSON report is the contract for CI and for the
 * gauntlet critic loop; the human summary is what a person reads at 2am. Both
 * are generated from the same `ProbeReport`, so they cannot disagree.
 *
 * The summary deliberately leads with what could NOT be tested. A run with
 * three blocked probes and six passes is not "mostly fine", and a summary that
 * buries the blocked ones under a row of ticks invites exactly that reading.
 */

import type { ProbeResult, Verdict } from './types'
import type { RunOutput } from './runner'

const SYMBOL: Record<Verdict, string> = {
  PASS: 'PASS   ',
  LEAK: 'LEAK   ',
  ERROR: 'ERROR  ',
  BLOCKED: 'BLOCKED',
}

function rule(char = '-'): string {
  return char.repeat(78)
}

function indent(text: string, prefix = '           '): string {
  return text
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n')
}

function wrap(text: string, width = 66): string {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if (line.length + word.length + 1 > width) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push(line)
  return lines.join('\n')
}

function renderProbe(probe: ProbeResult): string {
  const out: string[] = []
  out.push(`${SYMBOL[probe.verdict]}  ${probe.id}  ${probe.name}  (${probe.durationMs}ms)`)
  out.push(indent(wrap(`attempted: ${probe.attempted}`)))
  if (probe.verdict !== 'BLOCKED') {
    out.push(indent(wrap(`observed:  ${probe.observed}`)))
  }
  out.push(indent(wrap(`verdict:   ${probe.reason}`)))

  const interesting = probe.controls.filter((c) => !c.ok || c.kind === 'positive')
  for (const c of interesting) {
    out.push(
      indent(`${c.ok ? '  ok  ' : ' FAIL '} [${c.kind}] ${c.label} — ${c.detail}`, '           ')
    )
  }
  if (probe.poolingCaveat && probe.verdict === 'PASS') {
    out.push(indent(wrap(`caveat:    ${probe.poolingCaveat}`)))
  }
  return out.join('\n')
}

export function renderHumanSummary(output: RunOutput): string {
  const { report, preflightSteps, filteredOut } = output
  const lines: string[] = []

  lines.push(rule('='))
  lines.push('QUACKBACK WORKSPACE ISOLATION PROBE')
  lines.push(`alpha  ${report.targets.alpha}`)
  lines.push(`bravo  ${report.targets.bravo}`)
  lines.push(rule('='))
  lines.push('')

  lines.push('PREFLIGHT')
  for (const step of preflightSteps) {
    lines.push(`  ${step.ok ? ' ok ' : 'FAIL'}  ${step.name} — ${step.detail}`)
  }
  lines.push('')

  lines.push('PROBES')
  lines.push(rule())
  for (const probe of report.probes) {
    lines.push(renderProbe(probe))
    lines.push(rule())
  }
  lines.push('')

  // --- what was not tested, first ------------------------------------------
  const notRun = report.probes.filter((p) => p.verdict === 'BLOCKED' || p.verdict === 'ERROR')
  if (notRun.length > 0) {
    lines.push('NOT EXERCISED — these prove nothing either way')
    for (const probe of notRun) {
      lines.push(`  ${SYMBOL[probe.verdict]}  ${probe.id} ${probe.name}`)
      lines.push(indent(wrap(probe.reason), '             '))
    }
    lines.push('')
  }

  if (filteredOut.length > 0) {
    lines.push(`PARTIAL RUN — --only excluded: ${filteredOut.join(', ')}`)
    lines.push('  This is not a full isolation verdict.')
    lines.push('')
  }

  if (report.missingCapabilities.length > 0) {
    lines.push(`MISSING INPUTS: ${report.missingCapabilities.join(', ')}`)
    lines.push('')
  }

  if (report.tripwireHits.length > 0) {
    lines.push('RESPONSE TRIPWIRE HITS')
    for (const hit of report.tripwireHits) {
      lines.push(
        `  ${hit.servedBy} served ${hit.markerOwner}'s ${hit.markerName} (${hit.marker}) on ${hit.method} ${hit.url} [${hit.status}]`
      )
      lines.push(indent(hit.excerpt.slice(0, 300), '      '))
    }
    lines.push('')
  }

  const c = report.counts
  lines.push(rule('='))
  lines.push(
    `VERDICT: ${report.verdict}   pass=${c.PASS} leak=${c.LEAK} error=${c.ERROR} blocked=${c.BLOCKED}   (${report.durationMs}ms)`
  )
  if (c.LEAK > 0) {
    lines.push('')
    lines.push('One cross-workspace observation is a failure of the whole run.')
  }
  lines.push(rule('='))

  return lines.join('\n')
}
