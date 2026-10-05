import type { Control, FieldValues, Path } from 'react-hook-form'
import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'

interface TitleInputProps<T extends FieldValues = FieldValues> {
  control: Control<T, unknown, any>
  name?: Path<T>
  placeholder?: string
  autoFocus?: boolean
}

export function TitleInput<T extends FieldValues = FieldValues>({
  control,
  name = 'title' as Path<T>,
  placeholder = 'Title',
  autoFocus = false,
}: TitleInputProps<T>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormControl>
            <input
              type="text"
              aria-label={placeholder}
              placeholder={placeholder}
              // Borderless, so focus is a neutral underline in the ring colour,
              // reserved transparent so focusing does not shift the layout.
              className="w-full text-lg sm:text-xl font-semibold bg-transparent border-x-0 border-t-0 border-b-2 border-transparent outline-none transition-colors placeholder:text-muted-foreground/50 focus-visible:border-ring"
              autoFocus={autoFocus}
              {...field}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
