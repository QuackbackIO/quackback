import { Children, cloneElement, isValidElement } from 'react'
import { PlusIcon } from '@heroicons/react/16/solid'
import { Button } from '@/components/ui/button'

type NewButtonProps = Omit<React.ComponentProps<typeof Button>, 'size' | 'variant'> & {
  /** The thing being created; the label reads `New {noun}`. */
  noun: string
}

/**
 * The create action: primary, small, plus icon, "New {noun}". Children override
 * the label (for translated copy). With `asChild` the child element (a link) is
 * styled as the button and receives the icon and label.
 */
export function NewButton({ noun, children, asChild, ...props }: NewButtonProps) {
  const label = `New ${noun}`
  if (asChild) {
    const child = Children.toArray(children).find(isValidElement) as
      React.ReactElement<{ children?: React.ReactNode }> | undefined
    if (!child) return null
    return (
      <Button size="sm" asChild {...props}>
        {cloneElement(
          child,
          undefined,
          <PlusIcon className="size-4" />,
          child.props.children ?? label
        )}
      </Button>
    )
  }
  return (
    <Button size="sm" {...props}>
      <PlusIcon className="size-4" />
      {children ?? label}
    </Button>
  )
}
