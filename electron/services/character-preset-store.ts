import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import {
  EMPTY_CHARACTER_PRESET_FIELDS,
  normalizeCharacterPresetFields,
  type CharacterPresetDocument,
  type CharacterPresetFields,
  type CharacterPresetPortrait,
  type CharacterPresetSummary,
  type CharacterPresetView,
} from '../../src/shared/character-preset'
import { detectAvatarExtension, avatarMime } from './avatar-image'

const PRESET_ID = /^[a-zA-Z0-9_-]{8,64}$/u
const MAX_IMAGE_BYTES = 4 * 1024 * 1024

function isContainedPath(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath)
  return !(relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
}

function hash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16)
}

export class CharacterPresetStore {
  constructor(private readonly root: string) {}

  private presetsRoot(): string {
    const root = path.resolve(this.root, 'character-presets')
    fs.mkdirSync(root, { recursive: true })
    return root
  }

  private presetDir(presetId: string): string {
    if (!PRESET_ID.test(presetId)) throw new Error('INVALID_PRESET_ID')
    const directory = path.resolve(this.presetsRoot(), presetId)
    if (!isContainedPath(this.presetsRoot(), directory)) throw new Error('INVALID_PRESET_ID')
    return directory
  }

  private documentPath(presetId: string): string {
    return path.join(this.presetDir(presetId), 'preset.json')
  }

  private readDocument(presetId: string): CharacterPresetDocument {
    const file = this.documentPath(presetId)
    if (!fs.existsSync(file)) throw new Error('PRESET_NOT_FOUND')
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('PRESET_CORRUPT')
    const source = raw as Record<string, unknown>
    if (source.schemaVersion !== 1 || typeof source.presetId !== 'string') throw new Error('PRESET_CORRUPT')
    const portraits = Array.isArray(source.portraits)
      ? source.portraits.flatMap((item): CharacterPresetPortrait[] => {
        if (!item || typeof item !== 'object') return []
        const row = item as Record<string, unknown>
        if (typeof row.portraitId !== 'string' || typeof row.mime !== 'string' || typeof row.fileName !== 'string') return []
        return [{ portraitId: row.portraitId, mime: row.mime, fileName: row.fileName }]
      })
      : []
    return {
      schemaVersion: 1,
      presetId: source.presetId,
      updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : new Date(0).toISOString(),
      fields: normalizeCharacterPresetFields(source.fields),
      avatarFileName: typeof source.avatarFileName === 'string' ? source.avatarFileName : undefined,
      avatarMime: typeof source.avatarMime === 'string' ? source.avatarMime : undefined,
      portraits,
    }
  }

  private writeDocument(document: CharacterPresetDocument): void {
    const directory = this.presetDir(document.presetId)
    fs.mkdirSync(directory, { recursive: true })
    const file = this.documentPath(document.presetId)
    const temporary = `${file}.${randomUUID()}.tmp`
    fs.writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    fs.renameSync(temporary, file)
  }

  private readImageBase64(directory: string, fileName: string): { mime: string; base64: string } | null {
    if (!fileName || fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) return null
    const file = path.resolve(directory, fileName)
    if (!isContainedPath(directory, file) || !fs.existsSync(file)) return null
    const bytes = fs.readFileSync(file)
    const extension = detectAvatarExtension(bytes)
    if (!extension) return null
    return { mime: avatarMime(extension), base64: bytes.toString('base64') }
  }

  list(): CharacterPresetSummary[] {
    const root = this.presetsRoot()
    const summaries: CharacterPresetSummary[] = []
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !PRESET_ID.test(entry.name)) continue
      try {
        const document = this.readDocument(entry.name)
        summaries.push({
          presetId: document.presetId,
          name: document.fields.name || entry.name,
          role: document.fields.role,
          age: document.fields.age,
          updatedAt: document.updatedAt,
          hasAvatar: Boolean(document.avatarFileName),
          portraitCount: document.portraits.length,
        })
      } catch {
        // Skip corrupt presets so one bad folder does not break the library.
      }
    }
    return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name))
  }

  load(presetId: string): CharacterPresetView {
    const document = this.readDocument(presetId)
    const directory = this.presetDir(presetId)
    const avatar = document.avatarFileName
      ? this.readImageBase64(directory, document.avatarFileName) ?? undefined
      : undefined
    const portraits = document.portraits.flatMap(item => {
      const image = this.readImageBase64(path.join(directory, 'portraits'), item.fileName)
        ?? this.readImageBase64(directory, item.fileName)
      if (!image) return []
      return [{ portraitId: item.portraitId, mime: image.mime, base64: image.base64 }]
    })
    return {
      presetId: document.presetId,
      name: document.fields.name,
      role: document.fields.role,
      age: document.fields.age,
      updatedAt: document.updatedAt,
      hasAvatar: Boolean(avatar),
      portraitCount: portraits.length,
      fields: document.fields,
      avatar,
      portraits,
    }
  }

  create(fields?: Partial<CharacterPresetFields>): CharacterPresetView {
    const presetId = randomUUID().replaceAll('-', '')
    const document: CharacterPresetDocument = {
      schemaVersion: 1,
      presetId,
      updatedAt: new Date().toISOString(),
      fields: { ...EMPTY_CHARACTER_PRESET_FIELDS, ...normalizeCharacterPresetFields(fields ?? {}) },
      portraits: [],
    }
    if (!document.fields.name) document.fields.name = '未命名预制'
    this.writeDocument(document)
    return this.load(presetId)
  }

  saveFields(presetId: string, fields: CharacterPresetFields): CharacterPresetView {
    const document = this.readDocument(presetId)
    document.fields = normalizeCharacterPresetFields(fields)
    if (!document.fields.name) throw new Error('PRESET_NAME_REQUIRED')
    document.updatedAt = new Date().toISOString()
    this.writeDocument(document)
    return this.load(presetId)
  }

  setAvatarFromBytes(presetId: string, bytes: Buffer): CharacterPresetView {
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('IMAGE_TOO_LARGE')
    const extension = detectAvatarExtension(bytes)
    if (!extension) throw new Error('IMAGE_FORMAT_INVALID')
    const document = this.readDocument(presetId)
    const directory = this.presetDir(presetId)
    if (document.avatarFileName) {
      try { fs.rmSync(path.join(directory, document.avatarFileName), { force: true }) } catch { /* keep going */ }
    }
    const fileName = `avatar-${hash(bytes)}.${extension === 'jpeg' ? 'jpg' : extension}`
    fs.writeFileSync(path.join(directory, fileName), bytes, { mode: 0o600 })
    document.avatarFileName = fileName
    document.avatarMime = avatarMime(extension)
    document.updatedAt = new Date().toISOString()
    this.writeDocument(document)
    return this.load(presetId)
  }

  clearAvatar(presetId: string): CharacterPresetView {
    const document = this.readDocument(presetId)
    const directory = this.presetDir(presetId)
    if (document.avatarFileName) {
      try { fs.rmSync(path.join(directory, document.avatarFileName), { force: true }) } catch { /* keep going */ }
    }
    document.avatarFileName = undefined
    document.avatarMime = undefined
    document.updatedAt = new Date().toISOString()
    this.writeDocument(document)
    return this.load(presetId)
  }

  addPortraitFromBytes(presetId: string, bytes: Buffer): CharacterPresetView {
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('IMAGE_TOO_LARGE')
    const extension = detectAvatarExtension(bytes)
    if (!extension) throw new Error('IMAGE_FORMAT_INVALID')
    const document = this.readDocument(presetId)
    if (document.portraits.length >= 24) throw new Error('PORTRAIT_LIMIT_REACHED')
    const directory = path.join(this.presetDir(presetId), 'portraits')
    fs.mkdirSync(directory, { recursive: true })
    const portraitId = randomUUID().replaceAll('-', '')
    const fileName = `${portraitId}.${extension === 'jpeg' ? 'jpg' : extension}`
    fs.writeFileSync(path.join(directory, fileName), bytes, { mode: 0o600 })
    document.portraits.push({ portraitId, mime: avatarMime(extension), fileName })
    document.updatedAt = new Date().toISOString()
    this.writeDocument(document)
    return this.load(presetId)
  }

  removePortrait(presetId: string, portraitId: string): CharacterPresetView {
    const document = this.readDocument(presetId)
    const target = document.portraits.find(item => item.portraitId === portraitId)
    if (!target) throw new Error('PORTRAIT_NOT_FOUND')
    const directory = path.join(this.presetDir(presetId), 'portraits')
    try { fs.rmSync(path.join(directory, target.fileName), { force: true }) } catch { /* keep going */ }
    document.portraits = document.portraits.filter(item => item.portraitId !== portraitId)
    document.updatedAt = new Date().toISOString()
    this.writeDocument(document)
    return this.load(presetId)
  }

  delete(presetId: string): void {
    const directory = this.presetDir(presetId)
    if (!fs.existsSync(directory)) return
    fs.rmSync(directory, { recursive: true, force: false })
  }

  /** Absolute paths to avatar + portrait files for copying into a project. */
  assetFilePaths(presetId: string): { avatarPath?: string; portraitPaths: string[] } {
    const document = this.readDocument(presetId)
    const directory = this.presetDir(presetId)
    const avatarPath = document.avatarFileName
      ? path.join(directory, document.avatarFileName)
      : undefined
    const portraitPaths = document.portraits.map(item => path.join(directory, 'portraits', item.fileName))
      .filter(file => fs.existsSync(file))
    return {
      avatarPath: avatarPath && fs.existsSync(avatarPath) ? avatarPath : undefined,
      portraitPaths,
    }
  }
}
