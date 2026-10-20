import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import type { ProviderCredential } from '../../shared/ipc-channels'
import { BUILTIN_PRESETS } from '../../shared/provider-presets'
import { useLocaleStore } from '../../stores/locale-store'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { NativeSelect } from '../ui/NativeSelect'

const PROVIDERS: Array<ProviderCredential['provider']> = [
  'openai', 'deepseek', 'gemini', 'xai', 'siliconflow', 'aion', 'ollama', 'bigmodel', 'novelai', 'custom',
]

/** 厂商账号表单：名称、厂商、端点与 API Key。 */
export function CredentialForm({
  credential,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  credential: ProviderCredential
  onChange: (next: ProviderCredential) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
}) {
  const text = useLocaleStore(s => s.text)
  const [showKey, setShowKey] = useState(false)

  const up = <K extends keyof ProviderCredential>(key: K, value: ProviderCredential[K]) => {
    onChange({ ...credential, [key]: value })
  }

  const handleProviderChange = (provider: ProviderCredential['provider']) => {
    const preset = BUILTIN_PRESETS.find(item => item.provider === provider)
    onChange({
      ...credential,
      provider,
      protocol: (preset?.protocol as ProviderCredential['protocol']) ?? credential.protocol,
      baseUrl: preset?.baseUrl ?? credential.baseUrl,
      name: credential.name.trim() || (preset?.displayName ?? provider),
    })
  }

  return (
    <div
      className="rounded-xl p-5 space-y-4"
      style={{ border: '1.5px solid var(--color-accent)', backgroundColor: 'var(--color-panel)' }}
    >
      <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
        {credential.name
          ? text(`编辑账号：${credential.name}`, `Edit account: ${credential.name}`)
          : text('新建厂商账号', 'New provider account')}
      </h3>

      <div>
        <Label>{text('账号名称', 'Account name')}</Label>
        <Input
          value={credential.name}
          onChange={event => up('name', event.target.value)}
          placeholder={text('如：DeepSeek 主账号', 'e.g. DeepSeek primary')}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>{text('服务商', 'Provider')}</Label>
          <NativeSelect
            value={credential.provider}
            onChange={event => handleProviderChange(event.target.value as ProviderCredential['provider'])}
          >
            {PROVIDERS.map(provider => (
              <option key={provider} value={provider}>
                {BUILTIN_PRESETS.find(item => item.provider === provider)?.displayName ?? provider}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <Label>{text('调用协议', 'Protocol')}</Label>
          <NativeSelect
            value={credential.protocol}
            onChange={event => up('protocol', event.target.value as ProviderCredential['protocol'])}
          >
            <option value="openai">OpenAI</option>
            <option value="gemini">Gemini</option>
          </NativeSelect>
        </div>
      </div>

      <div>
        <Label>{text('base_url', 'base_url')}</Label>
        <Input
          value={credential.baseUrl}
          onChange={event => up('baseUrl', event.target.value)}
          placeholder="https://api.deepseek.com"
        />
      </div>

      <div>
        <Label>{text('API Key', 'API Key')}</Label>
        <div className="relative">
          <Input
            type={showKey ? 'text' : 'password'}
            value={credential.apiKey}
            onChange={event => up('apiKey', event.target.value)}
            placeholder={credential.provider === 'ollama' ? text('本地部署可留空', 'Optional for local deployment') : 'sk-...'}
            className="pr-9"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
          {text('一把 Key 可挂多个型号；各型号仍可单独调温度等参数。', 'One key can cover many models; each model still has its own temperature and limits.')}
        </p>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="outline" onClick={onCancel} disabled={saving}>{text('取消', 'Cancel')}</Button>
        <Button
          onClick={onSave}
          disabled={saving || !credential.baseUrl.trim() || (!credential.apiKey.trim() && credential.provider !== 'ollama')}
        >
          {saving ? text('保存中…', 'Saving…') : text('保存账号', 'Save account')}
        </Button>
      </div>
    </div>
  )
}
