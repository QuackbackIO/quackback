import type { Update } from '@/components/admin/settings/appearance/section-controls'
import { WordsSection } from '@/components/admin/settings/appearance/words-section'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { PropertiesPanel, type Crumb } from './properties/properties-panel'
import { ScopeLine } from './properties/scope-line'
import { WORDS } from './properties/words'

/** The words every page uses, on the properties frame. Their looks are in Theme. */
export function SiteInspector({
  crumbs,
  design,
  update,
}: {
  crumbs: readonly Crumb[]
  design: PortalDesign
  update: Update
}) {
  return (
    <PropertiesPanel
      crumbs={crumbs}
      title={WORDS.words}
      kind={WORDS.everyPage}
      className="pb-24"
      data-words-panel=""
      scope={
        <ScopeLine
          one="words"
          widest={{ id: 'everywhere', phrase: 'the words on every page' }}
          narrower={[]}
          value="everywhere"
          onChange={() => {}}
        />
      }
    >
      <div className="px-4 py-3">
        <WordsSection design={design} update={update} />
      </div>
    </PropertiesPanel>
  )
}
