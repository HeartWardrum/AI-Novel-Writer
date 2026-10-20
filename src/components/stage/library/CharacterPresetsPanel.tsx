import { useCallback, useEffect, useState } from 'react'
import { ImagePlus, Plus, Trash2, UserRound } from 'lucide-react'
import { CHARACTER_ROLES, getCharacterRoleLabels } from '../../../shared/character-role'
import {
  EMPTY_CHARACTER_PRESET_FIELDS,
  type CharacterPresetFields,
  type CharacterPresetSummary,
  type CharacterPresetView,
} from '../../../shared/character-preset'
import { ipc } from '../../../services/ipc-client'
import { useLocaleStore } from '../../../stores/locale-store'
import { Button } from '../../ui/Button'
import { InkDialog } from '../InkDialog'

function roleText(role: CharacterPresetFields['role'], text: (zh: string, en: string) => string): string {
  const labels = getCharacterRoleLabels(role)
  return text(labels.zhCN, labels.enUS)
}

/** 书房：维护应用级预制人物，供作品角色名单一键导入。 */
export default function CharacterPresetsPanel() {
  const text = useLocaleStore(s => s.text)
  const [presets, setPresets] = useState<CharacterPresetSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editor, setEditor] = useState<CharacterPresetView | null>(null)
  const [fields, setFields] = useState<CharacterPresetFields>(EMPTY_CHARACTER_PRESET_FIELDS)

  const reload = useCallback(async () => {
    const result = await ipc.invoke('character-preset:list')
    if (!result.success) {
      setError(result.error)
      return
    }
    setError(null)
    setPresets(result.presets)
  }, [])

  useEffect(() => { void reload() }, [reload])

  const openEditor = async (presetId?: string) => {
    setBusy(true)
    setError(null)
    try {
      if (presetId) {
        const result = await ipc.invoke('character-preset:load', presetId)
        if (!result.success) throw new Error(result.error)
        setEditor(result.preset)
        setFields(result.preset.fields)
      } else {
        const result = await ipc.invoke('character-preset:create', { name: text('未命名预制', 'Untitled preset') })
        if (!result.success) throw new Error(result.error)
        setEditor(result.preset)
        setFields(result.preset.fields)
        await reload()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const saveEditor = async () => {
    if (!editor) return
    setBusy(true)
    setError(null)
    try {
      const result = await ipc.invoke('character-preset:save-fields', editor.presetId, fields)
      if (!result.success) throw new Error(result.error)
      setEditor(result.preset)
      setFields(result.preset.fields)
      await reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const removePreset = async (presetId: string) => {
    setBusy(true)
    try {
      const result = await ipc.invoke('character-preset:delete', presetId)
      if (!result.success) throw new Error(result.error)
      if (editor?.presetId === presetId) setEditor(null)
      await reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const chooseAvatar = async () => {
    if (!editor) return
    const result = await ipc.invoke('character-preset:choose-avatar', editor.presetId)
    if (!result.success) { setError(result.error); return }
    if (result.cancelled) return
    setEditor(result.preset)
    await reload()
  }

  const clearAvatar = async () => {
    if (!editor) return
    const result = await ipc.invoke('character-preset:clear-avatar', editor.presetId)
    if (!result.success) { setError(result.error); return }
    setEditor(result.preset)
    await reload()
  }

  const addPortraits = async () => {
    if (!editor) return
    const result = await ipc.invoke('character-preset:choose-portraits-add', editor.presetId)
    if (!result.success) { setError(result.error); return }
    if (result.cancelled) return
    setEditor(result.preset)
    await reload()
  }

  const removePortrait = async (portraitId: string) => {
    if (!editor) return
    const result = await ipc.invoke('character-preset:remove-portrait', editor.presetId, portraitId)
    if (!result.success) { setError(result.error); return }
    setEditor(result.preset)
    await reload()
  }

  return (
    <section className="stage-presets" aria-labelledby="stage-presets-title">
      <div className="stage-shelf-head">
        <h2 id="stage-presets-title" className="stage-shelf-title">{text('预制人物', 'Character presets')}</h2>
        <span className="stage-shelf-hint">{text('全局模板，作品里可一键导入', 'Global templates you can import into a book')}</span>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void openEditor()}>
          <Plus size={14} aria-hidden />{text('新建预制', 'New preset')}
        </Button>
      </div>
      {error && <p className="stage-presets-error" role="alert">{error}</p>}
      {presets.length === 0 ? (
        <p className="stage-presets-empty">{text('还没有预制人物。先建几个常用模板。', 'No presets yet. Create a few reusable templates.')}</p>
      ) : (
        <ul className="stage-presets-grid" aria-label={text('预制人物列表', 'Character presets')}>
          {presets.map(preset => (
            <li key={preset.presetId}>
              <button type="button" className="stage-preset-card" disabled={busy} onClick={() => void openEditor(preset.presetId)}>
                <span className="stage-preset-icon" aria-hidden><UserRound size={18} /></span>
                <span className="stage-preset-name">{preset.name || text('未命名', 'Untitled')}</span>
                <span className="stage-preset-meta">
                  {roleText(preset.role, text)}
                  {preset.age ? ` · ${preset.age}` : ''}
                  {preset.hasAvatar ? text(' · 有头像', ' · Avatar') : ''}
                  {preset.portraitCount > 0 ? text(` · ${preset.portraitCount} 张人设图`, ` · ${preset.portraitCount} portraits`) : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <InkDialog
        open={Boolean(editor)}
        onOpenChange={open => { if (!open) setEditor(null) }}
        title={text('编辑预制人物', 'Edit character preset')}
        description={text('这些字段会在导入到作品时复制一份，之后只改作品内角色。', 'Fields are copied into a book on import; later edits stay in that book.')}
        keepOnOutsideClick
        footer={(
          <>
            {editor && (
              <Button variant="danger" disabled={busy} onClick={() => void removePreset(editor.presetId)}>
                <Trash2 size={14} aria-hidden />{text('删除', 'Delete')}
              </Button>
            )}
            <Button variant="text" disabled={busy} onClick={() => setEditor(null)}>{text('关闭', 'Close')}</Button>
            <Button variant="primary" disabled={busy || !fields.name.trim()} onClick={() => void saveEditor()}>
              {text('保存', 'Save')}
            </Button>
          </>
        )}
      >
        {editor && (
          <div className="stage-preset-form">
            <div className="stage-preset-media">
              {editor.avatar
                ? <img className="stage-preset-avatar" src={`data:${editor.avatar.mime};base64,${editor.avatar.base64}`} alt="" />
                : <span className="stage-preset-avatar stage-preset-avatar-empty" aria-hidden><UserRound size={22} /></span>}
              <div className="stage-preset-media-actions">
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => void chooseAvatar()}>
                  <ImagePlus size={14} aria-hidden />{text('头像', 'Avatar')}
                </Button>
                {editor.avatar && (
                  <Button variant="text" size="sm" disabled={busy} onClick={() => void clearAvatar()}>{text('清除头像', 'Clear')}</Button>
                )}
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => void addPortraits()}>
                  {text('添加人设图', 'Add portraits')}
                </Button>
              </div>
            </div>
            {editor.portraits.length > 0 && (
              <ul className="stage-preset-portraits">
                {editor.portraits.map(portrait => (
                  <li key={portrait.portraitId}>
                    <img src={`data:${portrait.mime};base64,${portrait.base64}`} alt="" />
                    <button type="button" disabled={busy} onClick={() => void removePortrait(portrait.portraitId)}>
                      {text('移除', 'Remove')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="pi-field">
              <label htmlFor="preset-name">{text('姓名', 'Name')}</label>
              <input id="preset-name" className="pi-input" value={fields.name} onChange={event => setFields(current => ({ ...current, name: event.target.value }))} />
            </div>
            <div className="stage-field-row">
              <div className="pi-field">
                <label htmlFor="preset-role">{text('身份', 'Role')}</label>
                <select id="preset-role" className="pi-input" value={fields.role} onChange={event => setFields(current => ({ ...current, role: event.target.value as CharacterPresetFields['role'] }))}>
                  {CHARACTER_ROLES.map(role => <option key={role} value={role}>{roleText(role, text)}</option>)}
                </select>
              </div>
              <div className="pi-field">
                <label htmlFor="preset-age">{text('年龄', 'Age')}</label>
                <input id="preset-age" className="pi-input" value={fields.age} onChange={event => setFields(current => ({ ...current, age: event.target.value }))} />
              </div>
              <div className="pi-field">
                <label htmlFor="preset-gender">{text('性别', 'Gender')}</label>
                <input id="preset-gender" className="pi-input" value={fields.gender} onChange={event => setFields(current => ({ ...current, gender: event.target.value }))} />
              </div>
            </div>
            <div className="pi-field">
              <label htmlFor="preset-appearance">{text('外貌', 'Appearance')}</label>
              <textarea id="preset-appearance" className="pi-input" rows={3} value={fields.appearance} onChange={event => setFields(current => ({ ...current, appearance: event.target.value }))} />
            </div>
            <div className="pi-field">
              <label htmlFor="preset-personality">{text('性格', 'Personality')}</label>
              <textarea id="preset-personality" className="pi-input" rows={3} value={fields.personality} onChange={event => setFields(current => ({ ...current, personality: event.target.value }))} />
            </div>
          </div>
        )}
      </InkDialog>
    </section>
  )
}
