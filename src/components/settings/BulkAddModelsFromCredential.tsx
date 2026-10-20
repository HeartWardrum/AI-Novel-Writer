import { useMemo, useState } from 'react'
import { RefreshCw, Sparkles } from 'lucide-react'
import type { DiscoveredModel, ModelProfile, ProviderCredential } from '../../shared/ipc-channels'
import { applyModelProfileSelection, createModelProfileDraft } from '../../shared/model-profile-draft'
import { BUILTIN_PRESETS } from '../../shared/provider-presets'
import { useLLMStore } from '../../stores/llm-store'
import { useLocaleStore } from '../../stores/locale-store'
import { randomUUID } from '../../utils/id'
import { Button } from '../ui/Button'
import { Check } from '../ui/Check'
import { Notice } from '../ui/Notice'

/** 从厂商账号勾选预置 / 发现型号，批量创建挂账号的型号档案。 */
export function BulkAddModelsFromCredential({
  credential,
  purposes,
  existingModels,
  onClose,
  onCreated,
}: {
  credential: ProviderCredential
  purposes: ModelProfile['purposes']
  existingModels: ModelProfile[]
  onClose: () => void
  onCreated: () => void
}) {
  const text = useLocaleStore(s => s.text)
  const saveModel = useLLMStore(s => s.saveModel)
  const discoverModels = useLLMStore(s => s.discoverModels)
  const preset = BUILTIN_PRESETS.find(item => item.provider === credential.provider)
  const presetNames = useMemo(() => {
    const isEmbedding = purposes.includes('embedding')
    return isEmbedding
      ? (preset?.embeddingModels ?? [])
      : (preset?.models.map(item => item.name) ?? [])
  }, [preset, purposes])

  const [selected, setSelected] = useState<Set<string>>(() => new Set(presetNames.slice(0, 2)))
  const [discovered, setDiscovered] = useState<DiscoveredModel[]>([])
  const [discovering, setDiscovering] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const already = useMemo(() => new Set(
    existingModels
      .filter(model => model.credentialId === credential.id)
      .map(model => model.modelName),
  ), [credential.id, existingModels])

  const toggle = (name: string) => {
    setSelected(previous => {
      const next = new Set(previous)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const handleDiscover = async () => {
    setDiscovering(true)
    setError(null)
    try {
      const result = await discoverModels({
        provider: credential.provider,
        protocol: credential.protocol,
        baseUrl: credential.baseUrl,
        apiKey: credential.apiKey,
      })
      if (!result.success) {
        setError(text('获取模型列表失败，仍可勾选预置型号。', 'Could not refresh the model list. Preset models can still be selected.'))
        return
      }
      setDiscovered(result.models)
    } catch {
      setError(text('获取模型列表失败，仍可勾选预置型号。', 'Could not refresh the model list. Preset models can still be selected.'))
    } finally {
      setDiscovering(false)
    }
  }

  const handleCreate = async () => {
    const names = [...selected].filter(name => name.trim() && !already.has(name))
    if (names.length === 0) {
      setError(text('请至少勾选一个尚未添加的型号。', 'Select at least one model that is not already added.'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      for (const modelName of names) {
        const draft = createModelProfileDraft({ id: randomUUID(), purposes: [...purposes] })
        const withEndpoint = {
          ...draft,
          credentialId: credential.id,
          provider: credential.provider,
          protocol: credential.protocol,
          baseUrl: credential.baseUrl,
          apiKey: '',
          name: modelName,
        }
        const profile = purposes.includes('embedding')
          ? { ...withEndpoint, modelName }
          : applyModelProfileSelection(withEndpoint, { modelName })
        if (!await saveModel(profile)) {
          setError(text(`保存「${modelName}」失败。`, `Could not save “${modelName}”.`))
          return
        }
      }
      onCreated()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const discoveredNames = discovered.map(item => item.value)

  return (
    <div
      className="rounded-xl p-5 space-y-4"
      style={{ border: '1.5px solid var(--color-accent)', backgroundColor: 'var(--color-panel)' }}
    >
      <div>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
          {text(`从「${credential.name}」添加型号`, `Add models from “${credential.name}”`)}
        </h3>
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
          {text('勾选要挂到此账号的型号；各型号仍可单独改温度等参数。', 'Choose models to attach to this account. Each model still has its own temperature and limits.')}
        </p>
      </div>

      {presetNames.length > 0 && (
        <div className="space-y-2" role="group" aria-label={text('预置型号', 'Preset models')}>
          <p className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>{text('预置型号', 'Preset models')}</p>
          {presetNames.map(name => (
            <Check
              key={name}
              checked={selected.has(name)}
              disabled={already.has(name)}
              onChange={() => { toggle(name) }}
              label={already.has(name) ? text(`${name}（已添加）`, `${name} (already added)`) : name}
            />
          ))}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>{text('端点返回的型号', 'Models from endpoint')}</p>
          <Button type="button" size="sm" variant="outline" disabled={discovering} onClick={() => void handleDiscover()}>
            <RefreshCw size={13} className={discovering ? 'animate-spin' : undefined} aria-hidden />
            {discovering ? text('获取中…', 'Refreshing…') : text('获取模型列表', 'Refresh model list')}
          </Button>
        </div>
        {discoveredNames.length > 0 && discoveredNames.map(name => (
          <Check
            key={name}
            checked={selected.has(name)}
            disabled={already.has(name)}
            onChange={() => { toggle(name) }}
            label={already.has(name) ? text(`${name}（已添加）`, `${name} (already added)`) : name}
          />
        ))}
      </div>

      {error && <Notice tone="warn" title={error} />}

      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={saving} onClick={onClose}>{text('取消', 'Cancel')}</Button>
        <Button disabled={saving || selected.size === 0} onClick={() => void handleCreate()}>
          <Sparkles size={14} aria-hidden />
          {saving ? text('添加中…', 'Adding…') : text(`添加 ${[...selected].filter(name => !already.has(name)).length} 个型号`, `Add ${[...selected].filter(name => !already.has(name)).length}`)}
        </Button>
      </div>
    </div>
  )
}
