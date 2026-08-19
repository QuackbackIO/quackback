import type { Control, FieldValues, Path } from 'react-hook-form'
import { FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'

interface TitleInputProps<T extends FieldValues = FieldValues> {
  control: Control<T>
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
              className="w-full text-lg sm:text-xl font-semibold bg-transparent border-0 outline-none placeholder:text-muted-foreground/50 focus-visible:ring-2 focus-visible:ring-ring/50"
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
