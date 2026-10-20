import type { ModelProfile, ProviderCredential } from './ipc-channels'

export class ProviderCredentialError extends Error {
  constructor(
    readonly code: 'CREDENTIAL_NOT_FOUND' | 'CREDENTIAL_IN_USE',
    message: string,
  ) {
    super(message)
    this.name = 'ProviderCredentialError'
  }
}

/** 将账号上的端点与密钥合并进型号档案；无 credentialId 时原样返回。 */
export function resolveModelProfile(
  profile: ModelProfile,
  credentials: readonly ProviderCredential[],
): ModelProfile {
  const credentialId = profile.credentialId?.trim()
  if (!credentialId) return profile
  const credential = credentials.find(item => item.id === credentialId)
  if (!credential) {
    throw new ProviderCredentialError(
      'CREDENTIAL_NOT_FOUND',
      `厂商账号不存在：${credentialId}`,
    )
  }
  return {
    ...profile,
    provider: credential.provider,
    protocol: credential.protocol,
    baseUrl: credential.baseUrl,
    apiKey: credential.apiKey,
  }
}

/** 挂账号保存时清空档案内密钥，避免与账号双份漂移。 */
export function normalizeModelProfileForSave(
  profile: ModelProfile,
  credentials: readonly ProviderCredential[],
): ModelProfile {
  const credentialId = profile.credentialId?.trim() || undefined
  if (!credentialId) {
    return { ...profile, credentialId: undefined, apiKey: profile.apiKey ?? '' }
  }
  const credential = credentials.find(item => item.id === credentialId)
  if (!credential) {
    throw new ProviderCredentialError(
      'CREDENTIAL_NOT_FOUND',
      `厂商账号不存在：${credentialId}`,
    )
  }
  return {
    ...profile,
    credentialId,
    provider: credential.provider,
    protocol: credential.protocol,
    baseUrl: credential.baseUrl,
    apiKey: '',
  }
}

export function assertCredentialNotReferenced(
  credentialId: string,
  models: readonly ModelProfile[],
): void {
  if (models.some(model => model.credentialId === credentialId)) {
    throw new ProviderCredentialError(
      'CREDENTIAL_IN_USE',
      '仍有型号挂在此账号上，请先解绑或删除这些型号。',
    )
  }
}
