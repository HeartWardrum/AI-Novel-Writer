import { useCallback, useEffect, useState } from 'react'
import { Library } from 'lucide-react'
import type { CharacterPresetSummary } from '../../shared/character-preset'
import { getCharacterRoleLabels } from '../../shared/character-role'
import { ipc } from '../../services/ipc-client'
import { useCharacterStore } from '../../stores/character-store'
import { useLocaleStore } from '../../stores/locale-store'
import { Button } from '../ui/Button'
import { toast } from '../ui/Toast'
import { InkDialog } from '../stage/InkDialog'
import { Check } from '../ui/Check'

/** Cast 工具栏：从书房预制人物导入到当前作品。 */
export function CharacterPresetImportButton({ disabled }: { disabled?: boolean }) {
  const text = useLocaleStore(s => s.text)
  const [open, setOpen] = useState(false)
  const [presets, setPresets] = useState<CharacterPresetSummary[]>([])
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const result = await ipc.invoke('character-preset:list')
    if (!result.success) {
      setError(result.error)
      setPresets([])
      return
    }
    setError(null)
    setPresets(result.presets)
    setSelected({})
  }, [])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const importSelected = async () => {
    const ids = Object.entries(selected).filter(([, on]) => on).map(([id]) => id)
    if (ids.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const count = await useCharacterStore.getState().importFromPresets(ids)
      toast.info(text(`已导入 ${count} 位角色`, `Imported ${count} character${count === 1 ? '' : 's'}`))
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const selectedCount = Object.values(selected).filter(Boolean).length

  return (
    <>
      <Button variant="secondary" size="sm" disabled={disabled || busy} onClick={() => setOpen(true)}>
        <Library size={14} aria-hidden />{text('从预制导入', 'Import preset')}
      </Button>
      <InkDialog
        open={open}
        onOpenChange={setOpen}
        title={text('从预制人物导入', 'Import character presets')}
        description={text('导入后成为本作品角色，可继续修改；不会改动书房里的预制。', 'Imported copies belong to this book and can be edited; library presets stay unchanged.')}
        footer={(
          <>
            <Button variant="text" disabled={busy} onClick={() => setOpen(false)}>{text('取消', 'Cancel')}</Button>
            <Button variant="primary" disabled={busy || selectedCount === 0} onClick={() => void importSelected()}>
              {text(`导入 ${selectedCount || ''}`.trim(), `Import ${selectedCount || ''}`.trim())}
            </Button>
          </>
        )}
      >
        {error && <p className="stage-presets-error" role="alert">{error}</p>}
        {presets.length === 0 ? (
          <p className="stage-presets-empty">{text('书房里还没有预制人物。请先在主页添加。', 'No presets in the library yet. Add some on the home page first.')}</p>
        ) : (
          <ul className="cast-preset-import-list">
            {presets.map(preset => {
              const role = getCharacterRoleLabels(preset.role)
              return (
                <li key={preset.presetId}>
                  <Check
                    checked={Boolean(selected[preset.presetId])}
                    onChange={checked => setSelected(current => ({ ...current, [preset.presetId]: checked }))}
                    label={(
                      <span className="cast-preset-import-label">
                        <strong>{preset.name || text('未命名', 'Untitled')}</strong>
                        <small>{text(role.zhCN, role.enUS)}{preset.age ? ` · ${preset.age}` : ''}</small>
                      </span>
                    )}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </InkDialog>
    </>
  )
}
