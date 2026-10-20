import { describe, expect, it } from 'vitest'

import type { ModelProfile, ProviderCredential } from '../ipc-channels'
import {
  assertCredentialNotReferenced,
  normalizeModelProfileForSave,
  ProviderCredentialError,
  resolveModelProfile,
} from '../provider-credential'

const credential: ProviderCredential = {
  id: 'cred-ds',
  name: 'DeepSeek',
  provider: 'deepseek',
  protocol: 'openai',
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'sk-account',
}

const linked: ModelProfile = {
  id: 'm-flash',
  name: 'flash',
  provider: 'openai',
  protocol: 'openai',
  modelName: 'deepseek-v4-flash',
  apiKey: '',
  baseUrl: 'https://stale.example',
  temperature: 0.7,
  maxTokens: 8192,
  purposes: ['generation'],
  credentialId: 'cred-ds',
}

describe('resolveModelProfile', () => {
  it('returns standalone profiles unchanged', () => {
    const solo = { ...linked, credentialId: undefined, apiKey: 'sk-solo' }
    expect(resolveModelProfile(solo, [credential])).toEqual(solo)
  })

  it('merges account endpoint and key onto linked profiles', () => {
    expect(resolveModelProfile(linked, [credential])).toMatchObject({
      id: 'm-flash',
      modelName: 'deepseek-v4-flash',
      provider: 'deepseek',
      protocol: 'openai',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-account',
      credentialId: 'cred-ds',
    })
  })

  it('throws when the linked account is missing', () => {
    expect(() => resolveModelProfile(linked, [])).toThrow(ProviderCredentialError)
  })
})

describe('normalizeModelProfileForSave', () => {
  it('clears the profile key when linked to an account', () => {
    const saved = normalizeModelProfileForSave({
      ...linked,
      apiKey: 'should-not-persist',
      baseUrl: 'https://stale.example',
    }, [credential])
    expect(saved.apiKey).toBe('')
    expect(saved.baseUrl).toBe('https://api.deepseek.com')
    expect(saved.provider).toBe('deepseek')
  })
})

describe('assertCredentialNotReferenced', () => {
  it('blocks deleting an account that still has models', () => {
    expect(() => assertCredentialNotReferenced('cred-ds', [linked])).toThrow(/仍有型号/)
  })

  it('allows deleting an unused account', () => {
    expect(() => assertCredentialNotReferenced('cred-ds', [])).not.toThrow()
  })
})
