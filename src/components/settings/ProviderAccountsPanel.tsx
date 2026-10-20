import { useEffect, useState } from 'react'
import { KeyRound, Plus } from 'lucide-react'
import type { ModelProfile, ProviderCredential } from '../../shared/ipc-channels'
import { BUILTIN_PRESETS } from '../../shared/provider-presets'
import { useLLMStore } from '../../stores/llm-store'
import { useLocaleStore } from '../../stores/locale-store'
import { randomUUID } from '../../utils/id'
import { Button } from '../ui/Button'
import { DangerConfirm } from '../ui/DangerConfirm'
import { BulkAddModelsFromCredential } from './BulkAddModelsFromCredential'
import { CredentialForm } from './CredentialForm'

function emptyCredential(): ProviderCredential {
  const preset = BUILTIN_PRESETS.find(item => item.provider === 'deepseek') ?? BUILTIN_PRESETS[0]
  return {
    id: randomUUID(),
    name: preset?.displayName ?? 'DeepSeek',
    provider: (preset?.provider as ProviderCredential['provider']) ?? 'deepseek',
    protocol: (preset?.protocol as ProviderCredential['protocol']) ?? 'openai',
    baseUrl: preset?.baseUrl ?? 'https://api.deepseek.com',
    apiKey: '',
  }
}

/** AI 模型页顶部的厂商账号：CRUD + 从账号批量添加型号。 */
export function ProviderAccountsPanel({
  purposes,
  models,
}: {
  purposes: ModelProfile['purposes']
  models: ModelProfile[]
}) {
  const text = useLocaleStore(s => s.text)
  const credentials = useLLMStore(s => s.credentials)
  const loaded = useLLMStore(s => s.loaded)
  const loadCredentials = useLLMStore(s => s.loadCredentials)
  const saveCredential = useLLMStore(s => s.saveCredential)
  const deleteCredential = useLLMStore(s => s.deleteCredential)
  const loadModels = useLLMStore(s => s.loadModels)

  const [editing, setEditing] = useState<ProviderCredential | null>(null)
  const [bulkFor, setBulkFor] = useState<ProviderCredential | null>(null)
  const [deleting, setDeleting] = useState<ProviderCredential | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (loaded) void loadCredentials()
  }, [loaded, loadCredentials])

  if (purposes.includes('embedding')) return null

  if (editing) {
    return (
      <CredentialForm
        credential={editing}
        onChange={setEditing}
        saving={saving}
        onCancel={() => setEditing(null)}
        onSave={() => {
          void (async () => {
            setSaving(true)
            try {
              if (await saveCredential(editing)) setEditing(null)
            } finally {
              setSaving(false)
            }
          })()
        }}
      />
    )
  }

  if (bulkFor) {
    return (
      <BulkAddModelsFromCredential
        credential={bulkFor}
        purposes={purposes}
        existingModels={models}
        onClose={() => setBulkFor(null)}
        onCreated={() => { void loadModels() }}
      />
    )
  }

  return (
    <div className="stage-set-card space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <KeyRound size={15} aria-hidden />
            {text('厂商账号', 'Provider accounts')}
          </h3>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
            {text('一把 Key 挂多个型号；改账号密钥后，挂在下面的型号一起生效。', 'One key for many models. Updating the account key updates every attached model.')}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setEditing(emptyCredential())}>
          <Plus size={14} aria-hidden />
          {text('添加账号', 'Add account')}
        </Button>
      </div>

      {credentials.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {text('还没有账号。也可以继续用下面「添加模型」给单个型号单独填 Key。', 'No accounts yet. You can still add a model below with its own key.')}
        </p>
      ) : (
        <ul className="space-y-2" aria-label={text('厂商账号', 'Provider accounts')}>
          {credentials.map(credential => {
            const linked = models.filter(model => model.credentialId === credential.id).length
            const providerLabel = BUILTIN_PRESETS.find(item => item.provider === credential.provider)?.displayName ?? credential.provider
            return (
              <li
                key={credential.id}
                className="flex items-center gap-2 rounded-lg px-3 py-2"
                style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate" style={{ color: 'var(--color-text)' }}>{credential.name || providerLabel}</div>
                  <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>
                    {providerLabel} · {text(`${linked} 个型号`, `${linked} model(s)`)}
                  </p>
                </div>
                <Button variant="text" size="sm" onClick={() => setBulkFor(credential)}>
                  {text('添加型号', 'Add models')}
                </Button>
                <Button variant="text" size="sm" onClick={() => setEditing({ ...credential })}>
                  {text('编辑', 'Edit')}
                </Button>
                <Button variant="text" size="sm" onClick={() => setDeleting(credential)}>
                  {text('删除', 'Delete')}
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      <DangerConfirm
        open={deleting !== null}
        onOpenChange={open => { if (!open) setDeleting(null) }}
        title={text('删除厂商账号？', 'Delete this provider account?')}
        consequence={text('仍有型号挂在此账号上时无法删除。', 'Accounts still linked to models cannot be deleted.')}
        recoverability={text('删除后需重新填写密钥；已挂型号需先解绑或删除。', 'You will need to enter the key again. Unlink or delete attached models first.')}
        cancelLabel={text('取消', 'Cancel')}
        confirmLabel={text('删除账号', 'Delete account')}
        onConfirm={() => {
          if (!deleting) return
          void deleteCredential(deleting.id).then(ok => { if (ok) setDeleting(null) })
        }}
      />
    </div>
  )
}
