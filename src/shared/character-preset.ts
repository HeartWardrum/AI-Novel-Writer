import type { CharacterRole } from './character-role'

/** App-level reusable cast template (not bound to a project). */
export interface CharacterPresetFields {
  name: string
  role: CharacterRole
  gender: string
  age: string
  appearance: string
  personality: string
  background: string
  abilities: string
  motivation: string
  relationships: string
  arc: string
  notes: string
}

export interface CharacterPresetPortrait {
  portraitId: string
  mime: string
  /** Relative file name under the preset's portraits/ folder. */
  fileName: string
}

export interface CharacterPresetDocument {
  schemaVersion: 1
  presetId: string
  updatedAt: string
  fields: CharacterPresetFields
  /** Relative avatar file name, if any. */
  avatarFileName?: string
  avatarMime?: string
  portraits: CharacterPresetPortrait[]
}

export interface CharacterPresetSummary {
  presetId: string
  name: string
  role: CharacterRole
  age: string
  updatedAt: string
  hasAvatar: boolean
  portraitCount: number
}

export interface CharacterPresetView extends CharacterPresetSummary {
  fields: CharacterPresetFields
  avatar?: { mime: string; base64: string }
  portraits: Array<{ portraitId: string; mime: string; base64: string }>
}

export const EMPTY_CHARACTER_PRESET_FIELDS: CharacterPresetFields = {
  name: '',
  role: 'supporting',
  gender: '',
  age: '',
  appearance: '',
  personality: '',
  background: '',
  abilities: '',
  motivation: '',
  relationships: '',
  arc: '',
  notes: '',
}

export function normalizeCharacterPresetFields(value: unknown): CharacterPresetFields {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const role = source.role
  return {
    name: typeof source.name === 'string' ? source.name.trim() : '',
    role: role === 'protagonist' || role === 'antagonist' || role === 'supporting' || role === 'minor'
      ? role
      : 'supporting',
    gender: typeof source.gender === 'string' ? source.gender : '',
    age: typeof source.age === 'string' ? source.age : '',
    appearance: typeof source.appearance === 'string' ? source.appearance : '',
    personality: typeof source.personality === 'string' ? source.personality : '',
    background: typeof source.background === 'string' ? source.background : '',
    abilities: typeof source.abilities === 'string' ? source.abilities : '',
    motivation: typeof source.motivation === 'string' ? source.motivation : '',
    relationships: typeof source.relationships === 'string' ? source.relationships : '',
    arc: typeof source.arc === 'string' ? source.arc : '',
    notes: typeof source.notes === 'string' ? source.notes : '',
  }
}
