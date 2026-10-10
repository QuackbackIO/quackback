// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

describe('DropdownMenuContent', () => {
  it('does not throw when disablePortal is set (inbox composer heading menu)', () => {
    expect(() =>
      render(
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger>Text</DropdownMenuTrigger>
          <DropdownMenuContent disablePortal>
            <DropdownMenuItem>Heading 1</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    ).not.toThrow(/Menu\.Portal/)
    expect(screen.getByRole('menuitem', { name: 'Heading 1' })).toBeInTheDocument()
  })
})
