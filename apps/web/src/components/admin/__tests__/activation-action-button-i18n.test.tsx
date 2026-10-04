// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { afterEach, expect, it, vi } from 'vitest'
import de from '@/locales/de.json'
import en from '@/locales/en.json'
import ar from '@/locales/ar.json'
import es from '@/locales/es.json'
import fr from '@/locales/fr.json'
import nl from '@/locales/nl.json'
import pl from '@/locales/pl.json'
import ptBr from '@/locales/pt-br.json'
import ru from '@/locales/ru.json'
import zhCn from '@/locales/zh-cn.json'
import zhTw from '@/locales/zh-tw.json'

vi.mock('@/lib/server/functions/activation', () => ({
  markPublicBoardLinkCopiedFn: vi.fn(),
}))
vi.mock('@/lib/client/plg-events', () => ({ recordPlgEvent: vi.fn() }))

import { ActivationActionButton } from '../activation-action-button'

afterEach(cleanup)

it('labels the board link action in the viewer language', () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="de" messages={de}>
        <ActivationActionButton
          action={{
            id: 'copy-board-link',
            outcome: 'product_feedback',
            label: 'Copy board link',
            kind: 'copy',
            payload: { boardId: 'board_1', path: '/?board=feedback' },
          }}
          surface="launch_plan"
        />
      </IntlProvider>
    </QueryClientProvider>
  )
  expect(screen.getByRole('button', { name: 'Board-Link kopieren' })).toBeInTheDocument()
})

it('names Changelog and the Help menu What’s new apart in every language', () => {
  for (const messages of [de, en, ar, es, fr, nl, pl, ptBr, ru, zhCn, zhTw]) {
    const catalogue = messages as Record<string, string>
    expect(catalogue['admin.nav.changelog']).not.toBe(catalogue['admin.help.whatsNew'])
  }
})
