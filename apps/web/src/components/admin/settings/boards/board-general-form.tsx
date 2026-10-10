import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { updateBoardSchema, type UpdateBoardInput } from '@/lib/shared/schemas/boards'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { useNavigate } from '@tanstack/react-router'
import { useUpdateBoard } from '@/lib/client/mutations'
import type { BoardId } from '@quackback/ids'

interface Board {
  id: BoardId
  name: string
  slug: string
  description: string | null
}

interface BoardGeneralFormProps {
  board: Board
}

export function BoardGeneralForm({ board }: BoardGeneralFormProps) {
  const mutation = useUpdateBoard()
  const navigate = useNavigate()

  const form = useForm<UpdateBoardInput>({
    resolver: standardSchemaResolver(updateBoardSchema),
    defaultValues: {
      name: board.name,
      description: board.description || '',
    },
  })

  // Name and description save when a field loses focus (or on Enter), so a
  // rename never changes the URL while it is still being typed.
  function onSubmit(data: UpdateBoardInput) {
    mutation.mutate(
      {
        id: board.id,
        name: data.name,
        description: data.description,
      },
      {
        onSuccess: (updated) => {
          if (updated.slug !== board.slug) {
            void navigate({
              to: '/admin/settings/boards/$slug',
              params: { slug: updated.slug },
              search: {},
              replace: true,
            })
          }
        },
      }
    )
  }

  const saveIfChanged = form.handleSubmit((data) => {
    if (data.name !== board.name || (data.description ?? '') !== (board.description ?? '')) {
      onSubmit(data)
    }
  })

  return (
    <Form {...form}>
      <form onSubmit={saveIfChanged} onBlur={() => void saveIfChanged()} className="space-y-6">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea rows={3} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  )
}
