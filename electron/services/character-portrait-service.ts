import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  MAX_CHARACTER_PORTRAIT_INPUT_BYTES,
  MAX_CHARACTER_PORTRAITS_PER_CHARACTER,
  type CharacterPortraitView,
} from '../../src/shared/character-portraits'
import {
  CharacterPortraitRepository,
  type CharacterPortraitRecord,
} from '../repositories/character-portrait-repository'
import { avatarMime, compressAvatarImage, detectAvatarExtension, type CompressedAvatar } from './avatar-image'

const hash = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')
const CHARACTER_ID = /^[a-zA-Z0-9_-]{1,128}$/u
const PORTRAIT_ID = /^[0-9a-f-]{36}$/iu

export interface CharacterPortraitProjectScope {
  projectId: string
  sessionLease: string
  storageRoot: string
  database: Database.Database
}

export interface CharacterPortraitServiceDependencies {
  compress?(bytes: Buffer, extension: NonNullable<ReturnType<typeof detectAvatarExtension>>): CompressedAvatar
  now?: () => Date
}

function contained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function assertSafePath(location: string, expected: 'file' | 'directory' | 'either' = 'either'): void {
  const absolute = path.resolve(location)
  let cursor = path.parse(absolute).root
  const parts = absolute.slice(cursor.length).split(path.sep).filter(Boolean)
  for (const [index, part] of parts.entries()) {
    cursor = path.join(cursor, part)
    try {
      const info = fs.lstatSync(cursor)
      if (info.isSymbolicLink()) throw new Error('CHARACTER_PORTRAIT_UNSAFE_PATH')
      if (index < parts.length - 1 && !info.isDirectory()) throw new Error('CHARACTER_PORTRAIT_UNSAFE_PATH')
      if (index === parts.length - 1 && expected !== 'either'
        && (expected === 'file' ? !info.isFile() : !info.isDirectory())) {
        throw new Error('CHARACTER_PORTRAIT_UNSAFE_PATH')
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

function targetPath(root: string, relativePath: string): string {
  const target = path.resolve(root, ...relativePath.split('/'))
  if (!contained(path.resolve(root), target)) throw new Error('CHARACTER_PORTRAIT_UNSAFE_PATH')
  assertSafePath(path.dirname(target), 'directory')
  return target
}

function installFile(root: string, relativePath: string, bytes: Buffer): boolean {
  const target = targetPath(root, relativePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  assertSafePath(path.dirname(target), 'directory')
  if (fs.existsSync(target)) {
    assertSafePath(target, 'file')
    if (hash(fs.readFileSync(target)) !== hash(bytes)) throw new Error('CHARACTER_PORTRAIT_TARGET_CONFLICT')
    return false
  }
  const temporary = `${target}.${randomUUID()}.tmp`
  const fd = fs.openSync(temporary, 'wx', 0o600)
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  try { fs.linkSync(temporary, target) } finally { fs.rmSync(temporary, { force: true }) }
  return true
}

function toView(record: CharacterPortraitRecord, base64: string): CharacterPortraitView {
  return {
    portraitId: record.portraitId,
    characterId: record.characterId,
    sortIndex: record.sortIndex,
    mime: record.mime,
    base64,
    createdAt: record.createdAt,
  }
}

export class CharacterPortraitService {
  readonly repository: CharacterPortraitRepository
  private readonly root: string
  private readonly compress: NonNullable<CharacterPortraitServiceDependencies['compress']>
  private readonly now: () => Date

  constructor(
    readonly scope: CharacterPortraitProjectScope,
    dependencies: CharacterPortraitServiceDependencies = {},
  ) {
    if (!scope.projectId || !scope.sessionLease) throw new Error('CHARACTER_PORTRAIT_SCOPE_REQUIRED')
    this.root = path.resolve(scope.storageRoot)
    if (!fs.existsSync(this.root)) throw new Error('CHARACTER_PORTRAIT_SCOPE_REQUIRED')
    assertSafePath(this.root, 'directory')
    this.repository = new CharacterPortraitRepository(scope.database)
    this.compress = dependencies.compress ?? compressAvatarImage
    this.now = dependencies.now ?? (() => new Date())
  }

  hasCharacter(characterId: string): boolean {
    return CHARACTER_ID.test(characterId) && this.repository.characterExists(characterId)
  }

  list(characterId: string): CharacterPortraitView[] {
    if (!CHARACTER_ID.test(characterId)) throw new Error('INVALID_CHARACTER_ID')
    if (!this.repository.characterExists(characterId)) throw new Error('CHARACTER_NOT_FOUND')
    const views: CharacterPortraitView[] = []
    for (const record of this.repository.list(characterId)) {
      try {
        const file = targetPath(this.root, record.relativePath)
        assertSafePath(file, 'file')
        const bytes = fs.readFileSync(file)
        const extension = detectAvatarExtension(bytes)
        if (!extension || bytes.length !== record.byteSize || hash(bytes) !== record.contentHash) continue
        views.push(toView(record, bytes.toString('base64')))
      } catch { /* skip corrupt / missing */ }
    }
    return views
  }

  async readFileBytes(filePath: string): Promise<Buffer> {
    assertSafePath(filePath, 'file')
    const before = await fs.promises.lstat(filePath)
    if (!before.isFile() || before.isSymbolicLink() || before.size <= 0) throw new Error('IMAGE_READ_FAILED')
    if (before.size > MAX_CHARACTER_PORTRAIT_INPUT_BYTES) throw new Error('IMAGE_TOO_LARGE')
    const handle = await fs.promises.open(filePath, 'r')
    try {
      const opened = await handle.stat()
      if (!opened.isFile() || opened.size !== before.size) throw new Error('IMAGE_READ_FAILED')
      const bytes = Buffer.alloc(opened.size)
      let offset = 0
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
        if (!bytesRead) throw new Error('IMAGE_READ_FAILED')
        offset += bytesRead
      }
      return bytes
    } finally { await handle.close() }
  }

  addFromBytes(characterId: string, original: Buffer): CharacterPortraitView {
    if (!this.hasCharacter(characterId)) throw new Error('CHARACTER_NOT_FOUND')
    if (this.repository.countForCharacter(characterId) >= MAX_CHARACTER_PORTRAITS_PER_CHARACTER) {
      throw new Error('PORTRAIT_LIMIT_REACHED')
    }
    if (!original.length) throw new Error('IMAGE_FORMAT_INVALID')
    if (original.length > MAX_CHARACTER_PORTRAIT_INPUT_BYTES) throw new Error('IMAGE_TOO_LARGE')
    const extension = detectAvatarExtension(original)
    if (!extension) throw new Error('IMAGE_FORMAT_INVALID')
    const encoded = this.compress(original, extension)
    const encodedExtension = detectAvatarExtension(encoded.bytes)
    if (!encodedExtension) throw new Error('IMAGE_FORMAT_INVALID')
    const contentHash = hash(encoded.bytes)
    const portraitId = randomUUID()
    const suffix = encodedExtension === 'jpeg' ? 'jpg' : encodedExtension
    const relativePath = `portraits/${hash(characterId)}/${portraitId}-${contentHash}.${suffix}`
    const installed = installFile(this.root, relativePath, encoded.bytes)
    const record: CharacterPortraitRecord = {
      portraitId,
      characterId,
      sortIndex: this.repository.nextSortIndex(characterId),
      relativePath,
      contentHash,
      mime: avatarMime(encodedExtension),
      byteSize: encoded.bytes.byteLength,
      createdAt: this.now().toISOString(),
    }
    try {
      this.repository.insert(record)
    } catch (error) {
      if (installed) fs.rmSync(targetPath(this.root, relativePath), { force: true })
      throw error
    }
    return toView(record, encoded.bytes.toString('base64'))
  }

  async addFromFiles(characterId: string, filePaths: readonly string[]): Promise<CharacterPortraitView[]> {
    if (!this.hasCharacter(characterId)) throw new Error('CHARACTER_NOT_FOUND')
    if (filePaths.length === 0) return []
    const remaining = MAX_CHARACTER_PORTRAITS_PER_CHARACTER - this.repository.countForCharacter(characterId)
    if (remaining <= 0) throw new Error('PORTRAIT_LIMIT_REACHED')
    if (filePaths.length > remaining) throw new Error('PORTRAIT_LIMIT_REACHED')
    const added: CharacterPortraitView[] = []
    for (const filePath of filePaths) {
      const bytes = await this.readFileBytes(filePath)
      added.push(this.addFromBytes(characterId, bytes))
    }
    return added
  }

  remove(portraitId: string): void {
    if (!PORTRAIT_ID.test(portraitId)) throw new Error('INVALID_PORTRAIT_ID')
    const previous = this.repository.remove(portraitId)
    if (!previous) throw new Error('PORTRAIT_NOT_FOUND')
    this.reclaim(previous, `runtime-remove:${previous.characterId}`)
  }

  reorder(characterId: string, portraitIds: readonly string[]): CharacterPortraitView[] {
    if (!CHARACTER_ID.test(characterId)) throw new Error('INVALID_CHARACTER_ID')
    this.repository.reorder(characterId, portraitIds)
    return this.list(characterId)
  }

  private reclaim(record: CharacterPortraitRecord, sourceReference: string): void {
    if (this.repository.referencedPaths().has(record.relativePath)) return
    try {
      fs.rmSync(targetPath(this.root, record.relativePath), { force: true })
      return
    } catch { /* preserve below */ }
    const recordId = hash(JSON.stringify([sourceReference, record.relativePath, record.contentHash]))
    this.scope.database.prepare(`INSERT OR IGNORE INTO character_portrait_unresolved(
      record_id,disposition,source_reference,source_relative_path,preserved_relative_path,
      content_hash,mime,byte_size,candidate_character_ids_json
    ) VALUES(?,'orphan',?,?,?,?,?,?,?)`).run(
      recordId,
      sourceReference,
      record.relativePath,
      record.relativePath,
      record.contentHash,
      record.mime,
      record.byteSize,
      JSON.stringify([record.characterId]),
    )
  }
}
