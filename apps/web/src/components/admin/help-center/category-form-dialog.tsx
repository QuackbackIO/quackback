import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { CategoryIcon, ICON_LOOKUP, ALL_ICON_KEYS } from '@/components/help-center/category-icon'
import { SegmentMultiSelect } from '@/components/admin/segments/segment-multi-select'
import { cn } from '@/lib/shared/utils'
import { listSegmentsFn } from '@/lib/server/functions/admin'
import { useCreateCategory, useUpdateCategory } from '@/lib/client/mutations/help-center'
import { helpCenterQueries } from '@/lib/client/queries/help-center'
import {
  MAX_CATEGORY_DEPTH,
  collectDescendantIdsIncludingSelf,
  getCategoryDepth,
  getSubtreeMaxDepth,
} from '@/lib/shared/help-center-tree'
import { settingsQueries } from '@/lib/client/queries/settings'
import {
  getCategoryTranslationStatusesFn,
  listCategoryTranslationsFn,
  upsertCategoryTranslationFn,
  deleteCategoryTranslationFn,
} from '@/lib/server/functions/help-center-translations'
import { InlineSpinner } from '@/components/admin/settings/inline-spinner'
import type { KbCategoryId } from '@quackback/ids'
import type { SupportedLocale } from '@/lib/shared/i18n'

const LOCALE_LABELS: Record<string, string> = {
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  ar: 'العربية',
  ru: 'Русский',
  'pt-br': 'Português (Brasil)',
  'zh-cn': '简体中文',
  'zh-tw': '繁體中文',
}

/** Compact per-locale name/description editor (domains/languages §2). No
 *  draft/published status for categories -- a non-empty name IS translated. */
function CategoryTranslationsSection({ categoryId }: { categoryId: KbCategoryId }) {
  const configQuery = useQuery(settingsQueries.helpCenterConfig())
  const additionalLocales = configQuery.data?.locales?.additional ?? []
  const [locale, setLocale] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [translated, setTranslated] = useState(false)

  const statusesQuery = useQuery({
    queryKey: ['help-center', 'category-translation-statuses', categoryId],
    queryFn: () => getCategoryTranslationStatusesFn({ data: { categoryId } }),
  })

  useEffect(() => {
    if (!locale && additionalLocales.length > 0) setLocale(additionalLocales[0])
  }, [locale, additionalLocales])

  useEffect(() => {
    if (!locale) return
    let cancelled = false
    async function load() {
      const translations = await listCategoryTranslationsFn({ data: { categoryId } })
      if (cancelled) return
      const existing = translations.find((t) => t.locale === locale)
      setName(existing?.name ?? '')
      setDescription(existing?.description ?? '')
      setTranslated(!!existing?.name?.trim())
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [categoryId, locale])

  if (additionalLocales.length === 0) return null

  async function handleSave() {
    if (!locale) return
    setSaving(true)
    try {
      await upsertCategoryTranslationFn({
        data: {
          categoryId,
          locale: locale as SupportedLocale,
          name,
          description: description || undefined,
        },
      })
      setTranslated(!!name.trim())
      void statusesQuery.refetch()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!locale) return
    setSaving(true)
    try {
      await deleteCategoryTranslationFn({ data: { categoryId, locale: locale as SupportedLocale } })
      setName('')
      setDescription('')
      setTranslated(false)
      void statusesQuery.refetch()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-border/50 p-3">
      <div className="flex items-center justify-between">
        <Label>Translations</Label>
        <Select value={locale ?? undefined} onValueChange={setLocale}>
          <SelectTrigger size="sm" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {additionalLocales.map((l) => (
              <SelectItem key={l} value={l}>
                {LOCALE_LABELS[l] ?? l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Translated name" />
      <Input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Translated description (optional)"
      />
      <div className="flex justify-between">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={saving || !translated}
          onClick={handleDelete}
        >
          Clear
        </Button>
        <Button type="button" size="sm" disabled={saving || !name.trim()} onClick={handleSave}>
          <InlineSpinner visible={saving} />
          Save translation
        </Button>
      </div>
    </div>
  )
}

const DEFAULT_ICON = 'FolderIcon'

function iconLabel(key: string): string {
  return key
    .replace(/Icon$/, '')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .toLowerCase()
}

interface CategoryFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialValues?: {
    id: KbCategoryId
    name: string
    description: string | null
    icon: string | null
    isPublic: boolean
    segmentIds: string[]
    parentId: KbCategoryId | null
  }
  /** Pre-selected parent when creating a new category (ignored if initialValues is set). */
  defaultParentId?: KbCategoryId | null
  onCreated?: (categoryId: string) => void
}

export function CategoryFormDialog({
  open,
  onOpenChange,
  initialValues,
  defaultParentId,
  onCreated,
}: CategoryFormDialogProps) {
  const isEdit = !!initialValues
  const createCategory = useCreateCategory()
  const updateCategory = useUpdateCategory()

  const [icon, setIcon] = useState(DEFAULT_ICON)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [segmentIds, setSegmentIds] = useState<string[]>([])
  const [parentId, setParentId] = useState<KbCategoryId | null>(null)
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [iconSearch, setIconSearch] = useState('')

  useEffect(() => {
    if (open) {
      setIcon(initialValues?.icon || DEFAULT_ICON)
      setName(initialValues?.name || '')
      setDescription(initialValues?.description || '')
      setIsPublic(initialValues?.isPublic ?? true)
      setSegmentIds(initialValues?.segmentIds ?? [])
      setParentId(initialValues?.parentId ?? defaultParentId ?? null)
    }
  }, [open, initialValues, defaultParentId])

  const segmentsQuery = useQuery({
    queryKey: ['admin', 'segments'] as const,
    queryFn: () => listSegmentsFn(),
    staleTime: 60_000,
    enabled: open,
  })
  const segments = (segmentsQuery.data ?? []).map((s) => ({ id: s.id, name: s.name }))

  const { data: allCategories = [] } = useQuery({
    ...helpCenterQueries.categories(),
    enabled: open,
  })

  const eligibleParents = useMemo(() => {
    const flat = allCategories as Array<{
      id: string
      parentId: string | null
      name: string
      icon: string | null
      articleCount: number
    }>

    const excluded = new Set<string>()
    if (initialValues?.id) {
      for (const ex of collectDescendantIdsIncludingSelf(flat, initialValues.id)) {
        excluded.add(ex)
      }
    }

    const subtreeHeight = initialValues?.id ? getSubtreeMaxDepth(flat, initialValues.id) : 0

    return flat.filter((cat) => {
      if (excluded.has(cat.id)) return false
      const parentDepth = getCategoryDepth(flat, cat.id)
      return parentDepth + 1 + subtreeHeight <= MAX_CATEGORY_DEPTH - 1
    })
  }, [allCategories, initialValues?.id])

  const filteredIcons = useMemo(() => {
    const q = iconSearch.toLowerCase().trim()
    if (!q) return ALL_ICON_KEYS
    return ALL_ICON_KEYS.filter((k) => iconLabel(k).includes(q))
  }, [iconSearch])

  const isPending = createCategory.isPending || updateCategory.isPending

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedName = name.trim()
    const trimmedDesc = description.trim()
    if (!trimmedName) return

    if (isEdit) {
      await updateCategory.mutateAsync({
        id: initialValues.id,
        name: trimmedName,
        description: trimmedDesc || null,
        icon,
        isPublic,
        segmentIds: isPublic ? segmentIds : [],
        parentId,
      })
    } else {
      const result = await createCategory.mutateAsync({
        name: trimmedName,
        description: trimmedDesc || undefined,
        icon,
        isPublic,
        segmentIds: isPublic ? segmentIds : [],
        parentId,
      })
      onCreated?.(result.id)
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit category' : 'New category'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Update category details.' : 'Create a new help center category.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="category-name">Name</Label>
            <div className="flex items-center gap-2">
              <Popover
                open={iconPickerOpen}
                onOpenChange={(o) => {
                  setIconPickerOpen(o)
                  if (!o) setIconSearch('')
                }}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="h-9 w-9 rounded-md border border-border/50 flex items-center justify-center hover:bg-muted transition-colors shrink-0"
                  >
                    <CategoryIcon icon={icon} className="w-5 h-5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-2" align="start">
                  <Input
                    placeholder="Search icons…"
                    value={iconSearch}
                    onChange={(e) => setIconSearch(e.target.value)}
                    className="mb-2 h-8 text-sm"
                  />
                  <div className="grid grid-cols-8 gap-1 max-h-[288px] overflow-y-auto">
                    {filteredIcons.map((key) => {
                      const Icon = ICON_LOOKUP[key]
                      return (
                        <button
                          key={key}
                          type="button"
                          title={iconLabel(key)}
                          className={cn(
                            'h-8 w-8 rounded-md flex items-center justify-center hover:bg-muted transition-colors',
                            icon === key && 'bg-primary/15 ring-1 ring-inset ring-primary/30'
                          )}
                          onClick={() => {
                            setIcon(key)
                            setIconPickerOpen(false)
                            setIconSearch('')
                          }}
                        >
                          <Icon className="w-4 h-4" />
                        </button>
                      )
                    })}
                  </div>
                </PopoverContent>
              </Popover>
              <Input
                id="category-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Getting Started"
                required
                className="flex-1"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="category-description">Description</Label>
            <Input
              id="category-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional short description"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="category-parent">Parent category</Label>
            <Select
              value={parentId ?? '__none__'}
              onValueChange={(value) =>
                setParentId(value === '__none__' ? null : (value as KbCategoryId))
              }
            >
              <SelectTrigger id="category-parent">
                <SelectValue placeholder="No parent (top-level)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No parent (top-level)</SelectItem>
                {eligibleParents.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    <span className="flex items-center gap-1.5">
                      <CategoryIcon icon={cat.icon} className="w-4 h-4 shrink-0" />
                      {cat.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Maximum depth is {MAX_CATEGORY_DEPTH} levels. Parents that would exceed it are hidden.
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Public</Label>
              <p className="text-xs text-muted-foreground">Visible on your public help center</p>
            </div>
            <Switch checked={isPublic} onCheckedChange={setIsPublic} />
          </div>

          {isPublic && segments.length > 0 && (
            <div className="space-y-2">
              <Label>
                Restrict to segments{' '}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <p className="text-xs text-muted-foreground">
                Leave empty to show this category and its articles to everyone. Selecting segments
                limits them to signed-in members of those segments.
              </p>
              <SegmentMultiSelect
                segments={segments}
                value={segmentIds}
                onChange={setSegmentIds}
                ariaLabel="Category segment gate"
              />
            </div>
          )}

          {isEdit && <CategoryTranslationsSection categoryId={initialValues.id} />}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !name.trim()}>
              {isPending ? (isEdit ? 'Saving...' : 'Creating...') : isEdit ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
