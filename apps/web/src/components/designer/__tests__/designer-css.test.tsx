// @vitest-environment happy-dom
/**
 * Custom CSS is a row under Site styles in the builder: picked, its editor is
 * open at once and writes the draft's CSS, with the check's warnings beside it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'

vi.mock('@/components/admin/settings/branding/custom-css-editor', () => ({
  CustomCssEditor: ({ value, onChange }: { value: string; onChange: (css: string) => void }) => (
    <textarea aria-label="CSS" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}))

const { CssFields } = await import('@/components/admin/settings/appearance/css-section')

afterEach(cleanup)

describe('Custom CSS in the builder', () => {
  it('opens on the editor, writes the draft’s CSS and lists what the check warns about', async () => {
    const seen = { design: defaultDesign() }
    function Harness() {
      const [design, setDesign] = useState<PortalDesign>(seen.design)
      return (
        <CssFields
          design={design}
          warnings={[{ message: 'An internal class name', line: 1 }]}
          update={(change) => {
            const next = structuredClone(design)
            change(next)
            seen.design = next
            setDesign(next)
          }}
        />
      )
    }
    render(<Harness />)
    const editor = await screen.findByRole('textbox', { name: 'CSS' })
    fireEvent.change(editor, { target: { value: '[data-qb-part="post-card"] { color: red; }' } })
    expect(seen.design.css).toBe('[data-qb-part="post-card"] { color: red; }')
    expect(screen.getByText('Line 1: An internal class name')).toBeTruthy()
  })
})
