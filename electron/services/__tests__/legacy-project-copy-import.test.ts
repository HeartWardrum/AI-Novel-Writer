import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { afterEach, expect, it } from 'vitest'
import { build } from 'esbuild'
import * as lance from '@lancedb/lancedb'
import { Field, Int32, Schema, Utf8 } from 'apache-arrow'
import { importLegacyProjectCopy } from '../legacy-project-copy-import'
import { verifyProjectSqlite } from '../sqlite-project-migration'
import { readPortableRuntimeFreeze } from '../portable-runtime-freeze'
import { closeProjectDatabase, getProjectDb, initProjectDatabase } from '../../database'
import { ChapterDeletionService } from '../chapter-deletion-service'
import { readPortableCurrentAuthority } from '../portable-current-authority'
import { ProjectAccessService } from '../project-access'
import { createPortableTransferAuthority } from '../portable-transfer-authority'
import { ProjectCoreRepository } from '../../repositories/project-core-repository'
import { CharacterRosterRepository, renderCharacterRosterMarkdown } from '../../repositories/character-roster-repository'
import { commitAuthorCharacterRoster } from '../character-roster-author'
import { buildGenerationSourceBinding } from '../generation-source-binding'
import { SummaryRepository } from '../../repositories/summary-repository'
import { LLMHistoryRepository } from '../../repositories/llm-repository'
import { PostProcessRepository } from '../../repositories/post-process-repository'
import { closeConnection } from '../../vector-store'
import { listDocuments, readDocumentCopy } from '../../knowledge-base'

const Database = createRequire(import.meta.url)('better-sqlite3') as typeof import('better-sqlite3')
const roots: string[] = []
const preflightOptions = { maxNativePathCharacters: 4096 }
const hash = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
function fixture(version: 'v100' | 'v100-official' | 'v110', charactersArch = '浣滆€呮槑纭鑹茬兢鍍忥紝涓庢鏂囨帹鏂笉鍚?) {
  const base = path.resolve('.runtime/.cache/novel-quality-modernization/a11-copy-import')
  fs.mkdirSync(base, { recursive: true })
  const root = fs.mkdtempSync(path.join(base, 'attempt-')); roots.push(root)
  const source = path.join(root, 'old'), target = path.join(root, 'new'), legacy = path.join(source, '.vela')
  fs.mkdirSync(legacy, { recursive: true })
  const seed = path.join(root, 'seed.db'), db = new Database(seed)
  try {
    db.pragma('journal_mode = WAL'); db.pragma('wal_autocheckpoint = 0')
    db.exec(fs.readFileSync(new URL(`./legacy-${version}-schema.sql`, import.meta.url), 'utf8'))
    db.prepare('INSERT INTO project_core(rowid,id,project_name,characters_arch) VALUES (?,?,?,?)')
      .run(7, 'main', '鍚堟垚鏃ч」鐩?, charactersArch)
    db.prepare('INSERT INTO contents(id,body) VALUES (?,?)').run(11, '鍚堟垚绔犺妭姝ｆ枃\r\n鍘熷瓧鑺?)
    db.prepare('INSERT INTO drafts(id,chapter_number,version,content_id,word_count) VALUES (?,?,?,?,?)').run(19, 7, 1, 11, 876)
    for (const suffix of ['', '-wal', '-shm']) fs.copyFileSync(seed + suffix, path.join(legacy, 'vela.db') + suffix)
  } finally { db.close() }
  const sourceProjectId = randomUUID()
  fs.writeFileSync(path.join(legacy, 'project.json'), JSON.stringify({ schemaVersion: 1, kind: 'ai-novel-project', projectId: sourceProjectId, createdAt: '2026-09-01T00:00:00.000Z' }))
  fs.mkdirSync(path.join(legacy, 'prompts'))
  fs.writeFileSync(path.join(legacy, 'prompts', 'author.txt'), '浣滆€呴」鐩骇鎻愮ず璇?)
  fs.mkdirSync(path.join(legacy, 'skills'))
  fs.writeFileSync(path.join(legacy, 'skills', 'author.md'), '浣滆€呴」鐩骇 Skill 鍘熸枃')
  fs.writeFileSync(path.join(source, 'outline.md'), '浣滆€呯洰褰曠骇澶х翰')
  const sourceHashes = Object.fromEntries(['vela.db', 'vela.db-wal', 'vela.db-shm', 'project.json', 'prompts/author.txt', 'skills/author.md']
    .map(name => [name, hash(path.join(legacy, name))]))
  return { source, target, legacy, sourceProjectId, sourceHashes }
}

function sourceState(f: ReturnType<typeof fixture>) {
  const entries: [string, string][] = []
  const visit = (directory: string) => {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name), info = fs.lstatSync(file)
      entries.push([path.relative(f.source, file), info.isFile() ? hash(file) : 'directory'])
      if (info.isDirectory()) visit(file)
    }
  }
  visit(f.source)
  return entries
}

async function verifyFrozenLegacyConsumersAfterRestart(target: string, entry: string) {
  await build({
    stdin: {
      resolveDir: process.cwd(), sourcefile: 'legacy-freeze-child.ts', loader: 'ts',
      contents: `
        import assert from 'node:assert/strict'
        import { initProjectDatabase, closeProjectDatabase, getProjectDb } from './electron/database'
        import { FinalizationService } from './electron/services/finalization-service'
        import { BlueprintRepository } from './electron/repositories/blueprint-repository'
        import { RecoveryCandidateRepository } from './electron/repositories/recovery-candidate-repository'
        import { ImportRunRepository } from './electron/repositories/import-run-repository'

        const root = process.env.LEGACY_FREEZE_ROOT!
        let publishCalls = 0, modelFetchCalls = 0
        globalThis.fetch = async () => { modelFetchCalls++; throw new Error('unexpected model fetch') }
        initProjectDatabase(root)
        try {
          const db = getProjectDb()!
          const rows = () => ['finalization_outbox', 'recovery_candidates', 'import_runs']
            .map(table => db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all())
          const before = rows()
          const retry = await new FinalizationService({ publisher: { async publish() { publishCalls++ } } })
            .retry({ projectRoot: root, finalizationId: 'old-outbox' })
          assert.equal(retry.success, false)
          assert.equal(retry.committed, true)
          assert.equal(retry.error, 'PORTABLE_RUNTIME_FROZEN')
          assert.equal(RecoveryCandidateRepository.listPending().some(item =>
            item.candidateId === 'old-candidate' && item.visibleText === '鏃у€欓€夋鏂? && !item.sourceCurrent), true)
          assert.throws(() => RecoveryCandidateRepository.updatePending('old-candidate', '瑕嗙洊姝ｆ枃'), /PORTABLE_RUNTIME_FROZEN/)
          assert.throws(() => RecoveryCandidateRepository.resolve('old-candidate', 'discarded'), /PORTABLE_RUNTIME_FROZEN/)
          db.exec('SAVEPOINT mixed_candidates')
          try {
            const source = { chapterNumber: 8, title: '绗叓绔?, role: '鎺ㄨ繘', purpose: '缁х画',
              keyEvents: '鏂扮嚎绱?, characters: [], suspenseHook: '', userGuidance: '' }
            BlueprintRepository.upsert({ ...source, notes: '', notesUpdatedAt: '' })
            const fresh = RecoveryCandidateRepository.record({ runId: 'new-run', stepId: 'generate-draft',
              projectId: 'current-project', chapterNumber: 8, chapterTitle: source.title, source, sourceDraft: null,
              visibleText: '鏂板€欓€夋鏂?, failureCode: 'NETWORK_ERROR', failureReason: 'test' })
            assert.deepEqual(RecoveryCandidateRepository.listPending().map(item => ({
              candidateId: item.candidateId, visibleText: item.visibleText, sourceCurrent: item.sourceCurrent,
            })), [
              { candidateId: 'old-candidate', visibleText: '鏃у€欓€夋鏂?, sourceCurrent: false },
              { candidateId: fresh.candidateId, visibleText: '鏂板€欓€夋鏂?, sourceCurrent: true },
            ])
            assert.equal(RecoveryCandidateRepository.updatePending(fresh.candidateId, '鍙紪杈戞鏂?).visibleText, '鍙紪杈戞鏂?)
            db.prepare('UPDATE recovery_candidates SET source_hash=? WHERE candidate_id=?').run('bad', fresh.candidateId)
            assert.throws(() => RecoveryCandidateRepository.listPending(), /鎭㈠鍊欓€夊畬鏁存€ф牎楠屽け璐?)
          } finally { db.exec('ROLLBACK TO mixed_candidates; RELEASE mixed_candidates') }
          assert.equal(ImportRunRepository.get('old-import')?.id, 'old-import')
          assert.equal(ImportRunRepository.listResumable().some(item => item.id === 'old-import'), false)
          assert.throws(() => ImportRunRepository.startOrResume('old-import', 'new-owner'), /PORTABLE_RUNTIME_FROZEN/)
          assert.equal(publishCalls, 0)
          assert.equal(modelFetchCalls, 0)
          assert.deepEqual(rows(), before)
        } finally { closeProjectDatabase() }
      `,
    },
    outfile: entry, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22',
    plugins: [{ name: 'unused-electron-imports', setup(build) {
      build.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'test-shim' }))
      build.onLoad({ filter: /.*/, namespace: 'test-shim' }, () => ({ contents:
        'export const app = { getPath() { throw Error("Electron-only path used") } }; export const nativeImage = {}', loader: 'js' }))
    } }],
  })
  const child = spawn(process.execPath, [entry], {
    cwd: process.cwd(), env: { ...process.env, LEGACY_FREEZE_ROOT: target }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', data => { stderr += String(data) })
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  expect(code, stderr).toBe(0)
}

async function terminateImportAt(f: ReturnType<typeof fixture>, phase: 'sqlite-converted' | 'renamed') {
  const entry = path.join(path.dirname(f.source), 'import-child.mjs')
  await build({ entryPoints: [path.resolve('electron/services/legacy-project-copy-import.ts')], outfile: entry,
    bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22',
    plugins: [{ name: 'unused-electron-imports', setup(build) {
      build.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'test-shim' }))
      build.onLoad({ filter: /.*/, namespace: 'test-shim' }, () => ({ contents:
        'export const app = { getPath() { throw Error("Electron-only path used") } }; export const nativeImage = {}', loader: 'js' }))
    } }],
  })
  const script = `
    import fs from 'node:fs'
    import { pathToFileURL } from 'node:url'
    const { entry, sourceRoot, targetRoot, phase } = JSON.parse(process.env.LEGACY_IMPORT_CHILD)
    const pause = () => { fs.writeSync(1, 'REACHED\\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0) }
    if (phase === 'renamed') {
      const rename = fs.renameSync
      fs.renameSync = (from, to) => { rename(from, to); if (to === targetRoot) pause() }
    }
    const { importLegacyProjectCopy } = await import(pathToFileURL(entry).href)
    await importLegacyProjectCopy({ sourceRoot, targetRoot, preflightOptions: { maxNativePathCharacters: 4096 },
      checkpoint: current => { if (current === phase) pause() } })
    process.exitCode = 31
  `
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(), env: { ...process.env, LEGACY_IMPORT_CHILD: JSON.stringify({ entry, sourceRoot: f.source, targetRoot: f.target, phase }) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', data => { stderr += String(data) })
  const exited = new Promise<[number | null, NodeJS.Signals | null]>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve([code, signal]))
  })
  let stdout = ''
  const reached = new Promise<void>(resolve => child.stdout.on('data', data => {
    stdout += String(data)
    if (stdout.includes('REACHED\n')) resolve()
  }))
  let timer: ReturnType<typeof setTimeout> | undefined
  let observed = false
  try {
    await Promise.race([
      reached,
      exited.then(([code, signal]) => { throw new Error(`child exited before ${phase}: ${code}/${signal} ${stderr}`) }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`child timeout at ${phase}: ${stderr}`)), 30_000) }),
    ])
    expect(child.exitCode).toBeNull()
    observed = true
  } finally {
    if (timer) clearTimeout(timer)
    const killed = child.exitCode === null ? child.kill() : false
    const [, signal] = await exited
    if (observed) { expect(killed).toBe(true); expect(signal).toBe('SIGTERM') }
  }
}
afterEach(() => { closeProjectDatabase(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

it.each(['v100', 'v110'] as const)('%s 鏈夋棫瑙掕壊鍘熸枃浣嗘棤瑙掕壊鍗℃椂鎷掔粷鍙戝竷涓斾繚鐣欐簮', async version => {
  const f = fixture(version), before = sourceState(f)
  expect(await importLegacyProjectCopy({ sourceRoot: f.source, targetRoot: f.target, preflightOptions }))
    .toMatchObject({ state: 'blocked', code: 'LEGACY_IMPORT_ROSTER_UNAVAILABLE' })
  expect(fs.existsSync(f.target)).toBe(false)
  expect(sourceState(f)).toEqual(before)
  const attempts = fs.readdirSync(path.dirname(f.target)).filter(name => name.startsWith('.new.legacy-import-'))
  expect(attempts).toHaveLength(1)
  const staging = path.join(path.dirname(f.target), attempts[0]!, 'target', '.ai-novel', 'project.db')
  const preserved = new Database(staging, { readonly: true, fileMustExist: true })
  try {
    expect(preserved.prepare("SELECT legacy_markdown FROM character_roster_meta WHERE id='main'").pluck().get())
      .toBe('浣滆€呮槑纭鑹茬兢鍍忥紝涓庢鏂囨帹鏂笉鍚?)
  } finally { preserved.close() }
})

function addLegacyCards(f: ReturnType<typeof fixture>) {
  const source = new Database(path.join(f.legacy, 'vela.db'))
  try {
    source.prepare(`INSERT INTO characters(rowid,name,role,background,relationships,cs_location,cs_updated_at_chapter)
      VALUES (?,?,?,?,?,?,?)`).run(44, '涔?, 'protagonist', '鏃ц鑹茶祫鏂橽r\n鍘熸枃',
      JSON.stringify([{ target: '鐢?, relation: '鍚岄棬' }]), '鏃у北闂?, 0)
    source.prepare('INSERT INTO characters(rowid,name,role,background) VALUES (?,?,?,?)')
      .run(45, '鐢?, 'supporting', '鍚岄棬鐨勪綔鑰呰瀹?)
  } finally { source.close() }
}

async function markLegacyCardsReady(f: ReturnType<typeof fixture>, officialV100 = false) {
  // Produce old ready hashes through the existing roster commit path.
  expect(await importLegacyProjectCopy({ sourceRoot: f.source, targetRoot: f.target, preflightOptions }))
    .toMatchObject({ state: 'ready' })
  const converted = new Database(path.join(f.target, '.ai-novel', 'project.db'), { readonly: true })
  let meta: { projection_hash: string; fact_hash: string; characters_arch: string }
  try {
    meta = converted.prepare(`SELECT m.projection_hash,m.fact_hash,c.characters_arch FROM character_roster_meta m
      JOIN project_core c ON c.id=m.id WHERE m.id='main'`).get() as typeof meta
    const entries = CharacterRosterRepository.read(converted).entries
    for (const entry of entries) entry.relationships.sort((left, right) => {
      const a = `${left.target}\u0000${left.relation}`, b = `${right.target}\u0000${right.relation}`
      return a < b ? -1 : a > b ? 1 : 0
    })
    meta.characters_arch = renderCharacterRosterMarkdown(entries)
    meta.projection_hash = createHash('sha256').update(meta.characters_arch).digest('hex')
  } finally { converted.close() }
  fs.rmSync(f.target, { recursive: true, force: true })
  const old = new Database(path.join(f.legacy, 'vela.db'))
  try {
    old.prepare("INSERT INTO character_roster_meta(id,schema_version,revision,migration_state,projection_hash,fact_hash) VALUES('main',1,1,'ready',?,?)")
      .run(meta.projection_hash, meta.fact_hash)
    old.prepare("UPDATE project_core SET characters_arch=? WHERE id='main'").run(meta.characters_arch)
    if (officialV100) expect(old.prepare("SELECT migration_state FROM character_roster_meta WHERE id='main'").pluck().get()).toBe('ready')
    else expect(CharacterRosterRepository.read(old).status).toBe('ready')
  } finally { old.close() }
  return meta
}

it('v1.1 ready 鏃у崱鍦ㄧ绾垮壇鏈唴缁戝畾鍞竴 PK 鍏崇郴骞朵繚鎸佷綔鑰呮姇褰?, async () => {
  const f = fixture('v110', '')
  addLegacyCards(f)
  const oldMeta = await markLegacyCardsReady(f)
  const before = sourceState(f)
  const result = await importLegacyProjectCopy({ sourceRoot: f.source, targetRoot: f.target, preflightOptions })
  expect(result, JSON.stringify(result)).toMatchObject({ state: 'ready' })
  if (result.state !== 'ready') return
  const db = new Database(path.join(f.target, '.ai-novel', 'project.db'), { readonly: true })
  try {
    const roster = CharacterRosterRepository.read(db)
    expect(roster).toMatchObject({ migrationState: 'ready', status: 'ready' })
    const owner = roster.entries.find(entry => entry.name === '涔?)!
    const target = roster.entries.find(entry => entry.name === '鐢?)!
    expect(owner.relationships).toEqual([{ target: '鐢?, targetCharacterId: target.characterId, relation: '鍚岄棬' }])
    expect(db.prepare('SELECT source_character_id,target_character_id,relation,provenance_json FROM character_relationships').all())
      .toEqual([{ source_character_id: owner.characterId, target_character_id: target.characterId, relation: '鍚岄棬',
        provenance_json: expect.any(String) }])
    const edge = db.prepare('SELECT provenance_json FROM character_relationships').pluck().get() as string
    expect(JSON.parse(edge)).toMatchObject({ kind: 'legacy', sourceKey: 'legacy:characters:0:relationships:0',
      sourceHash: createHash('sha256').update('[{"target":"鐢?,"relation":"鍚岄棬"}]').digest('hex') })
    expect(db.prepare('SELECT projection_hash,fact_hash FROM character_roster_meta WHERE id=?').get('main'))
      .toEqual({ projection_hash: oldMeta.projection_hash, fact_hash: oldMeta.fact_hash })
    expect(db.prepare('SELECT characters_arch FROM project_core WHERE id=?').pluck().get('main')).toBe(oldMeta.characters_arch)
    expect(db.prepare('SELECT resolved_character_id FROM character_identity_proposals').pluck().get()).toBe(target.characterId)
    expect(db.prepare('SELECT operation_id FROM character_identity_approvals').pluck().all())
      .toEqual(['legacy-offline-identity-binding'])
  } finally { db.close() }
  expect(sourceState(f)).toEqual(before)
})

it.each(['v100-official', 'v110'] as const)('%s 鍚屼竴瑙掕壊瀵圭殑涓嶅悓鍏崇郴瀹屾暣瀵煎叆骞堕噸寤虹洰鏍囨姇褰?, async version => {
  const f = fixture(version, '')
  addLegacyCards(f)
  const relationships = JSON.stringify([{ target: '鐢?, relation: '鍚岄棬' }, { target: '鐢?, relation: '鍙嬩汉' }])
  const old = new Database(path.join(f.legacy, 'vela.db'))
  try { old.prepare('UPDATE characters SET relationships=? WHERE name=?').run(relationships, '涔?) }
  finally { old.close() }
  const oldMeta = await markLegacyCardsReady(f, version === 'v100-official')
  const before = sourceState(f)
  const result = await importLegacyProjectCopy({ sourceRoot: f.source, targetRoot: f.target, preflightOptions })
  expect(result).toMatchObject({ state: 'ready' })
  if (result.state !== 'ready') return
  const db = new Database(path.join(f.target, '.ai-novel', 'project.db'), { readonly: true })
  try {
    const roster = CharacterRosterRepository.read(db)
    expect(roster).toMatchObject({ migrationState: 'ready', status: 'ready' })
    const owner = roster.entries.find(entry => entry.name === '涔?)!
    const target = roster.entries.find(entry => entry.name === '鐢?)!
    expect(owner.relationships).toHaveLength(2)
    expect(owner.relationships).toEqual(expect.arrayContaining([
      { target: '鐢?, targetCharacterId: target.characterId, relation: '鍙嬩汉' },
      { target: '鐢?, targetCharacterId: target.characterId, relation: '鍚岄棬' },
    ]))
    expect(db.prepare('SELECT COUNT(DISTINCT relationship_id) FROM character_relationships').pluck().get()).toBe(2)
    expect(db.prepare('SELECT relationships FROM characters WHERE character_id=?').pluck().get(owner.characterId)).toBe(relationships)
    expect(db.prepare('SELECT source_key,resolved_character_id,approval_id FROM character_identity_proposals ORDER BY source_key').all())
      .toEqual([0, 1].map(index => ({ source_key: `legacy:characters:0:relationships:${index}`,
        resolved_character_id: target.characterId, approval_id: 'legacy-offline-identity-binding' })))
    expect(db.prepare('SELECT fact_hash FROM character_roster_meta WHERE id=?').pluck().get('main')).toBe(oldMeta.fact_hash)
    expect(db.prepare('SELECT characters_arch FROM project_core WHERE id=?').pluck().get('main')).toBe(roster.renderedMarkdown)
  } finally { db.close() }
  expect(sourceState(f)).toEqual(before)
})

it('瀹樻柟 v1.0 ready 鏃у崱鍦ㄥ彧璇婚獙婧愬悗瀵煎叆锛屾簮鍜屾棫鍓湰鐨?DDL銆佽銆佸凡鏈?DB/WAL 鏁版嵁涓嶅彉', async () => {
  const f = fixture('v100-official', '')
  addLegacyCards(f)
  await markLegacyCardsReady(f, true)
  const before = sourceState(f)
  const copied: Array<unknown> = []
  const result = await importLegacyProjectCopy({ sourceRoot: f.source, targetRoot: f.target, preflightOptions,
    checkpoint(phase) {
      if (phase !== 'assets-converted' && phase !== 'verified') return
      const attempt = fs.readdirSync(path.dirname(f.target)).find(name => name.startsWith('.new.legacy-import-'))!
      const oldPath = path.join(path.dirname(f.target), attempt, 'source', '.vela', 'vela.db')
      const old = new Database(oldPath, { readonly: true, fileMustExist: true })
      try { copied.push({ database: hash(oldPath), wal: fs.existsSync(oldPath + '-wal') && fs.statSync(oldPath + '-wal').size
        ? hash(oldPath + '-wal') : null,
        schema: old.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all(),
        cards: old.prepare('SELECT rowid AS source_rowid,* FROM characters ORDER BY rowid').all(),
        meta: old.prepare('SELECT rowid AS source_rowid,* FROM character_roster_meta').all(),
      }) } finally { old.close() }
    },
  })
  expect(result, JSON.stringify(result)).toMatchObject({ state: 'ready' })
  expect(copied).toHaveLength(2)
  expect(copied[1]).toEqual(copied[0])
  expect(sourceState(f)).toEqual(before)
  if (result.state !== 'ready') return
  const db = new Database(path.join(f.target, '.ai-novel', 'project.db'), { readonly: true, fileMustExist: true })
  try { expect(CharacterRosterRepository.read(db)).toMatchObject({ migrationState: 'ready', status: 'ready' }) }
  finally { db.close() }
})

it('瀹樻柟 v1.0 鏃?ready 鏍囩涓嶈兘娲楃櫧宸茬鏀圭殑鍘熷鍏崇郴', async () => {
  const f = fixture('v100-official', '')
  addLegacyCards(f)
  await markLegacyCardsReady(f, true)
  const old = new Database(path.join(f.legacy, 'vela.db'))
  try { old.prepare("UPDATE characters SET relationships=? WHERE name='涔?").run('[{"target":"鐢?,"relation":"鏀瑰啓鍚庡叧绯?}]') }
  finally { old.close() }
  const before = sourceState(f)
  expect(await importLegacyProjectCopy({ sourceRoot: f.source, targetRoot: f.target, preflightOptions }))
    .toEqual({ state: 'blocked', code: 'LEGACY_IMPORT_ROSTER_UNAVAILABLE' })
  expect(fs.existsSync(f.target)).toBe(false)
  expect(sourceState(f)).toEqual(before)
  const attempt = fs.readdirSync(path.dirname(f.target)).find(name => name.startsWith('.new.legacy-import-'))!
  expect(fs.readdirSync(path.join(path.dirname(f.target), attempt, 'source', '.vela'))
    .filter(name => name.startsWith('.roster-check-'))).toEqual([])
})

it.each(['missing', 'stale-source', 'ambiguous', 'missing-origin'] as const)('v1.1 ready 鏃у叧绯?%s endpoint 闃绘柇鍙戝竷涓斾笉鍐欑ǔ瀹氳竟', async problem => {
  const f = fixture('v110', '')
  addLegacyCards(f)
  await markLegacyCardsReady(f)
  if (problem === 'missing' || problem === 'stale-source') {
    const old = new Database(path.join(f.legacy, 'vela.db'))
    try { old.prepare('UPDATE characters SET relationships=? WHERE name=?')
      .run(problem === 'missing' ? '[{"target":"涓嶅瓨鍦?,"relation":"鍚岄棬"}]' : '[{"target":"鐢?,"relation":"鏃у揩鐓т互澶栫殑鏂板叧绯?}]', '涔?) } finally { old.close() }
  }
  const before = sourceState(f)
  const result = await importLegacyProjectCopy({ sourceRoot: f.source, targetRoot: f.target, preflightOptions,
    checkpoint: problem === 'ambiguous' || problem === 'missing-origin' ? phase => {
      if (phase !== 'assets-converted') return
      const attempt = fs.readdirSync(path.dirname(f.target)).find(name => name.startsWith('.new.legacy-import-'))!
      const staging = new Database(path.join(path.dirname(f.target), attempt, 'target', '.ai-novel', 'project.db'))
      try {
        if (problem === 'ambiguous') {
          const ids = staging.prepare('SELECT character_id FROM characters ORDER BY name').pluck().all() as string[]
          staging.prepare('UPDATE character_identity_proposals SET candidate_ids_json=? WHERE owner_character_id IS NOT NULL')
            .run(JSON.stringify(ids))
        } else staging.prepare("DELETE FROM character_identity_origins WHERE source_key='legacy:characters:1'").run()
      } finally { staging.close() }
    } : undefined,
  })
  expect(result).toEqual({ state: 'blocked', code: problem === 'missing' || problem === 'stale-source'
    ? 'LEGACY_IMPORT_ROSTER_UNAVAILABLE'
    : problem === 'ambiguous' ? 'LEGACY_IMPORT_SQLITE_VERIFICATION_FAILED' : 'MIGRATION_VERIFICATION_FAILED' })
  expect(fs.existsSync(f.target)).toBe(false)
  expect(sourceState(f)).toEqual(before)
  if (problem !== 'missing' && problem !== 'stale-source') return
  const attempt = fs.readdirSync(path.dirname(f.target)).find(name => name.startsWith('.new.legacy-import-'))!
  const staging = new Database(path.join(path.dirname(f.target), attempt, 'target', '.ai-novel', 'project.db'), { readonly: true })
  try { expect(staging.prepare('SELECT COUNT(*) FROM character_relationships').pluck().get()).toBe(0) }
  finally { staging.close() }
})

it.each(['v100', 'v110'] as const)('%s 闈炵┖鏃ц鑹插崱涓庡叧绯荤‘瀹氭€ч噰鐢紝鐢熶骇淇濆瓨閲嶅紑涓嶅洖鍐欐簮', async version => {
  const f = fixture(version, '')
  addLegacyCards(f)
  const old = new Database(path.join(f.legacy, 'vela.db'))
  try { old.prepare('INSERT INTO blueprints(chapter_number,characters) VALUES(?,?)').run(7, '["涔?,"鐢?,"绔犵骇寰呭嚭鍦?]') }
  finally { old.close() }
  const before = sourceState(f)
  let preservedFacts: unknown[] = []
  const tables = ['characters', 'character_aliases', 'character_identity_origins']
  const result = await importLegacyProjectCopy({ sourceRoot: f.source, targetRoot: f.target, preflightOptions,
    checkpoint(phase) {
      if (phase !== 'assets-converted') return
      const attempt = fs.readdirSync(path.dirname(f.target)).find(name => name.startsWith('.new.legacy-import-'))!
      const staging = new Database(path.join(path.dirname(f.target), attempt, 'target', '.ai-novel', 'project.db'), { readonly: true })
      try { preservedFacts = tables.map(table => staging.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()) }
      finally { staging.close() }
    },
  })
  expect(result, JSON.stringify(result)).toMatchObject({ state: 'ready' })
  if (result.state !== 'ready') return
  initProjectDatabase(f.target)
  const db = getProjectDb()!
  expect(tables.map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())).toEqual(preservedFacts)
  const roster = CharacterRosterRepository.read()
  expect(roster).toMatchObject({ status: 'ready', migrationState: 'ready', identityRevision: 0 })
  expect(roster.entries).toHaveLength(2)
  const protagonist = roster.entries.find(entry => entry.name === '涔?)!
  const companion = roster.entries.find(entry => entry.name === '鐢?)!
  expect(protagonist.characterId).toBeTruthy()
  expect(companion.characterId).toBeTruthy()
  expect(protagonist).toMatchObject({ background: '鏃ц鑹茶祫鏂橽r\n鍘熸枃',
    currentState: { location: '鏃у北闂?, updatedAtChapter: 0 },
    relationships: [{ target: '鐢?, targetCharacterId: companion.characterId, relation: '鍚岄棬' }] })
  expect(db.prepare("SELECT legacy_markdown FROM character_roster_meta WHERE id='main'").pluck().get()).toBe('')
  expect(ProjectCoreRepository.get()!.charactersArch).toContain('鐢诧紙鍚岄棬锛?)
  const relation = db.prepare('SELECT * FROM character_relationships').get() as { provenance_json: string; approval_id: string }
  expect(JSON.parse(relation.provenance_json)).toMatchObject({ kind: 'legacy', sourceKey: 'legacy:characters:0:relationships:0', migration: 'offline-project-copy' })
  expect(relation.approval_id).toBe('legacy-offline-identity-binding')
  expect(db.prepare('SELECT characters FROM blueprints WHERE chapter_number=7').pluck().get()).toBe('["涔?,"鐢?,"绔犵骇寰呭嚭鍦?]')
  expect(db.prepare('SELECT raw_value,resolved_character_id FROM character_identity_proposals WHERE owner_character_id IS NULL ORDER BY source_key').all())
    .toEqual([{ raw_value: '涔?, resolved_character_id: protagonist.characterId },
      { raw_value: '鐢?, resolved_character_id: companion.characterId }, { raw_value: '绔犵骇寰呭嚭鍦?, resolved_character_id: null }])
  expect(db.prepare("SELECT COUNT(*) FROM character_identity_approvals WHERE operation_id LIKE 'legacy-cards-adoption:%'").pluck().get()).toBe(1)
  expect(db.prepare('SELECT COUNT(*) FROM llm_calls').pluck().get()).toBe(0)
  expect(db.prepare('SELECT COUNT(*) FROM generation_runs').pluck().get()).toBe(0)
  const fingerprint = 'a'.repeat(64)
  const writing = buildGenerationSourceBinding({ db, projectStorageRoot: path.join(f.target, '.ai-novel'),
    globalDataRoot: path.dirname(f.source), readBuiltinPrompt: () => JSON.stringify({ key: 'draft', content: '娴嬭瘯鍐欎綔濂戠害', systemRole: '娴嬭瘯' }) },
  { projectId: result.projectId, epoch: 'test-import-session', operation: 'chapter-draft', chapterNumber: 7,
    selectedDraftIds: [], selectedFinalizedDraftIds: [], promptKeys: ['draft'], skillStages: [],
    modelReceipt: { modelId: 'fixture', provider: 'openai', protocol: 'openai', modelName: 'fixture',
      modelRevision: fingerprint, endpointFingerprint: fingerprint, capabilityEvidence: {
        source: { contextWindowTokens: 'unknown', maxOutputTokens: 'user-operational-cap', featureFlags: 'unknown' },
        subjectFingerprint: fingerprint, contextWindowTokens: 8000, maxOutputTokens: 1000, reasoning: false, structuredOutput: false, usage: true } },
    policy: { version: 'fixture', maxPhysicalRequests: 1 }, outputContract: 'visible-text' })
  expect(JSON.parse(writing.materials.find(item => item.ref.sourceId === 'character-relationships:all')!.text))
    .toMatchObject([{ source_character_id: protagonist.characterId, target_character_id: companion.characterId, relation: '鍚岄棬' }])
  const saved = commitAuthorCharacterRoster(db, { operationId: 'imported-author-edit', schemaVersion: 1,
    intent: 'manual_edit', expectedRevision: roster.revision, expectedIdentityRevision: roster.identityRevision,
    entries: roster.entries.map(entry => entry.characterId === protagonist.characterId ? { ...entry, notes: '鏂扮増淇濆瓨绗旇' } : entry),
  }, { projectId: result.projectId, epoch: 'test-import-session' }, () => {})
  closeProjectDatabase()
  initProjectDatabase(f.target)
  expect(CharacterRosterRepository.read()).toEqual(saved.snapshot)
  expect(CharacterRosterRepository.read().entries.find(entry => entry.characterId === protagonist.characterId)?.notes).toBe('鏂扮増淇濆瓨绗旇')
  expect(getProjectDb()!.prepare("SELECT COUNT(*) FROM character_identity_approvals WHERE operation_id LIKE 'legacy-cards-adoption:%'").pluck().get()).toBe(1)
  expect(sourceState(f)).toEqual(before)
})

it.each([
  '涓庣敳鏄悓闂?, '[{"target":" 鐢?,"relation":"鍚岄棬"}]', '[{"target":"涓嶅瓨鍦?,"relation":"鍚岄棬"}]',
  '[{"target":"涔?,"relation":"鑷寚"}]', '[{"target":"鐢?,"relation":""}]',
  '[{"target":"鐢?,"relation":"鍚岄棬","confidence":1}]',
  '[{"target":"鐢?,"relation":"鍚岄棬"},{"target":"鐢?,"relation":"鍚岄棬"}]',
  '{"target":"鐢?,"relation":"鍚岄棬"}',
])('鏃у崱鍏崇郴涓嶆弧瓒冲畬鏁翠富閿竟濂戠害鏃堕樆鏂笖淇濆叏锛?s', async relationships => {
  const f = fixture('v110', '')
  addLegacyCards(f)
  const old = new Database(path.join(f.legacy, 'vela.db'))
  try { old.prepare('UPDATE characters SET relationships=? WHERE name=?').run(relationships, '涔?) }
  finally { old.close() }
  const before = sourceState(f)
  expect(await importLegacyProjectCopy({ sourceRoot: f.source, targetRoot: f.target, preflightOptions }))
    .toEqual({ state: 'blocked', code: 'LEGACY_IMPORT_ROSTER_UNAVAILABLE' })
  expect(sourceState(f)).toEqual(before)
  expect(fs.existsSync(f.target)).toBe(false)
  const attempt = fs.readdirSync(path.dirname(f.target)).find(name => name.startsWith('.new.legacy-import-'))!
  const staging = new Database(path.join(path.dirname(f.target), attempt, 'target', '.ai-novel', 'project.db'), { readonly: true })
  try {
    expect(staging.prepare('SELECT relationships FROM characters WHERE name=?').pluck().get('涔?)).toBe(relationships)
    expect(staging.prepare('SELECT COUNT(*) FROM character_relationships').pluck().get()).toBe(0)
    expect(staging.prepare('SELECT COUNT(*) FROM character_identity_approvals').pluck().get()).toBe(0)
    expect(CharacterRosterRepository.read(staging).migrationState).toBe('legacy_cards_preserved')
  } finally { staging.close() }
})

it.each(['v100', 'v110'] as const)('%s 闈炵┖鏃у師鏂囦笌鍗＄墖鏃犳硶璇佹槑鏃犳崯鏃朵粛鎷掔粷鍙戝竷骞朵繚鐣?staging', async version => {
  const f = fixture(version)
  addLegacyCards(f)
  const before = sourceState(f)
  expect(await importLegacyProjectCopy({ sourceRoot: f.source, targetRoot: f.target, preflightOptions }))
    .toMatchObject({ state: 'blocked', code: 'LEGACY_IMPORT_ROSTER_UNAVAILABLE' })
  expect(fs.existsSync(f.target)).toBe(false)
  expect(sourceState(f)).toEqual(before)
  const attempt = fs.readdirSync(path.dirname(f.target)).find(name => name.startsWith('.new.legacy-import-'))!
  const staging = new Database(path.join(path.dirname(f.target), attempt, 'target', '.ai-novel', 'project.db'), { readonly: true })
  try {
    expect(CharacterRosterRepository.read(staging)).toMatchObject({ migrationState: 'legacy_cards_preserved', status: 'inconsistent',
      legacyMarkdown: '浣滆€呮槑纭鑹茬兢鍍忥紝涓庢鏂囨帹鏂笉鍚? })
    expect(staging.prepare('SELECT COUNT(*) FROM characters').pluck().get()).toBe(2)
    expect(staging.prepare('SELECT relationships FROM characters WHERE name=?').pluck().get('涔?))
      .toBe('[{"target":"鐢?,"relation":"鍚岄棬"}]')
    expect(staging.prepare('SELECT raw_value,resolved_character_id FROM character_identity_proposals').all())
      .toEqual([{ raw_value: '{"target":"鐢?,"relation":"鍚岄棬"}', resolved_character_id: null }])
    expect(staging.prepare('SELECT COUNT(*) FROM character_identity_approvals').pluck().get()).toBe(0)
  } finally { staging.close() }
})

it.each(['v100', 'v110'] as const)('%s 鍚堟硶绌鸿鑹插悕鍗曠殑绂荤嚎瀹屾暣鍓湰鍚?WAL銆佷綔鑰呴厤缃拰姝ｆ枃', async version => {
  const f = fixture(version, '')
  const result = await importLegacyProjectCopy({ sourceRoot: f.source, targetRoot: f.target, preflightOptions })
  expect(result, JSON.stringify(result)).toMatchObject({ state: 'ready', targetRoot: f.target })
  if (result.state !== 'ready') return
  expect(result.projectId).not.toBe(f.sourceProjectId)
  expect(fs.existsSync(path.join(f.target, '.vela'))).toBe(false)
  expect(fs.readFileSync(path.join(f.target, 'outline.md'), 'utf8')).toBe('浣滆€呯洰褰曠骇澶х翰')
  expect(fs.readFileSync(path.join(f.target, '.ai-novel', 'prompts', 'author.txt'), 'utf8')).toBe('浣滆€呴」鐩骇鎻愮ず璇?)
  expect(fs.readFileSync(path.join(f.target, '.ai-novel', 'skills', 'author.md'), 'utf8')).toBe('浣滆€呴」鐩骇 Skill 鍘熸枃')
  expect(verifyProjectSqlite({ databasePath: path.join(f.target, '.ai-novel', 'project.db') }).schemaVersion).toBe(12)
  const db = new Database(path.join(f.target, '.ai-novel', 'project.db'), { readonly: true })
  try {
    expect(db.prepare('SELECT characters_arch FROM project_core WHERE id=?').pluck().get('main')).toBe('')
    expect(db.prepare("SELECT migration_state FROM character_roster_meta WHERE id='main'").pluck().get()).toBe('empty')
    expect(db.prepare('SELECT body FROM contents WHERE id=11').pluck().get()).toBe('鍚堟垚绔犺妭姝ｆ枃\r\n鍘熷瓧鑺?)
    expect(db.prepare('SELECT content_id FROM drafts WHERE id=19').pluck().get()).toBe(11)
  } finally { db.close() }
  expect(Object.fromEntries(Object.keys(f.sourceHashes).map(name => [name, hash(path.join(f.legacy, name))]))).toEqual(f.sourceHashes)
  expect(await importLegacyProjectCopy({ sourceRoot: f.source, targetRoot: f.target, preflightOptions })).toMatchObject({ state: 'blocked', code: 'LEGACY_IMPORT_TARGET_EXISTS' })
})

it.each([false, true])('preserves official legacy trash as inactive files (populated=%s)', async populated => {
  const f = fixture('v100-official', '')
  const relative = path.join('trash', 'clear-2026-09-01T00-00-00-000Z', '绗?绔?鏃ф鏂?txt')
  fs.mkdirSync(path.join(f.legacy, 'trash'))
  if (populated) {
    fs.mkdirSync(path.dirname(path.join(f.legacy, relative)))
    fs.writeFileSync(path.join(f.legacy, relative), '宸叉竻绌烘棫绔犺妭\r\n鍙繚鐣欏瓧鑺?)
  }
  const before = sourceState(f)
  expect(await importLegacyProjectCopy({ sourceRoot: f.source, targetRoot: f.target, preflightOptions }))
    .toMatchObject({ state: 'ready' })
  expect(fs.statSync(path.join(f.target, '.ai-novel', 'trash')).isDirectory()).toBe(true)
  if (populated) expect(hash(path.join(f.target, '.ai-novel', relative))).toBe(hash(path.join(f.legacy, relative)))
  else expect(fs.readdirSync(path.join(f.target, '.ai-novel', 'trash'))).toEqual([])
  const opened = new ProjectAccessService({ homePath: path.dirname(f.source) }).probeExistingProject(f.target)
  expect(opened).toMatchObject({ kind: 'manifest', storageFormat: 'canonical' })
  initProjectDatabase(f.target)
  try {
    expect(getProjectDb()!.prepare('SELECT COUNT(*) FROM drafts').pluck().get()).toBe(1)
    expect(getProjectDb()!.prepare('SELECT COUNT(*) FROM recovery_candidates').pluck().get()).toBe(0)
    expect(fs.existsSync(path.join(f.target, path.basename(relative)))).toBe(false)
  } finally { closeProjectDatabase() }
  expect(sourceState(f)).toEqual(before)
  fs.mkdirSync(path.join(f.legacy, 'unknown-old-directory'))
  expect(await importLegacyProjectCopy({ sourceRoot: f.source, targetRoot: f.target + '-unknown', preflightOptions }))
    .toMatchObject({ state: 'blocked', code: 'LEGACY_IMPORT_UNMAPPED_ASSET' })
  expect(fs.existsSync(f.target + '-unknown')).toBe(false)
})

it('鏃ч」鐩牴鍐呯殑鐪熷疄鐭ヨ瘑鍘熸枃鍙樻垚鍙椤圭洰鍓湰锛岀墖娈典笉鑳藉啋鍏呭叏鏂?, async () => {
  const f = fixture('v110', '')
  const original = path.join(f.source, '鍒涗綔璧勬枡.txt')
  const content = '瀹屾暣鍘熸枃绗竴娈点€俓n\n瀹屾暣鍘熸枃绗簩娈靛彧瀛樺湪浜庢棫椤圭洰鏂囦欢銆?
  fs.writeFileSync(original, content)
  const connection = await lance.connect(path.join(f.legacy, 'lancedb'))
  const tables: lance.Table[] = []
  try {
    const fields = [new Field('id', new Utf8()), new Field('docId', new Utf8()), new Field('fileName', new Utf8()),
      new Field('text', new Utf8()), new Field('chunkIndex', new Int32()), new Field('totalChunks', new Int32()),
      new Field('importedAt', new Utf8()), new Field('corpusKind', new Utf8())]
    tables.push(await connection.createTable('chunks', [
      { id: 'old-chunk', docId: 'old-doc', fileName: '鍒涗綔璧勬枡.txt', text: '瀹屾暣鍘熸枃绗竴娈点€?,
        chunkIndex: 0, totalChunks: 1, importedAt: '2026-09-13', corpusKind: 'reference' },
    ],
    { schema: new Schema(fields) }))
    tables.push(await connection.createTable('documents', [
      { id: 'old-doc', fileName: '鍒涗綔璧勬枡.txt', filePath: original,
        importedAt: '2026-09-13', chunkCount: 1, corpusKind: 'reference' },
    ]))
  } finally { for (const table of tables) table.close(); connection.close() }
  const originalHash = hash(original)
  const result = await importLegacyProjectCopy({ sourceRoot: f.source, targetRoot: f.target, preflightOptions })
  expect(result, JSON.stringify(result)).toMatchObject({ state: 'ready' })
  expect(hash(original)).toBe(originalHash)
  expect(hash(path.join(f.target, '鍒涗綔璧勬枡.txt'))).toBe(originalHash)
  initProjectDatabase(f.target)
  try {
    const documents = await listDocuments(f.target)
    expect(documents.find(doc => doc.id === 'old-doc')?.filePath).toBe('knowledge-copy:old-doc')
    expect(await readDocumentCopy('old-doc', f.target)).toMatchObject({
      available: true, content, edited: false, indexStatus: 'stale',
    })
  } finally { closeConnection(f.target) }
})

it.each(['outside', 'missing'] as const)('鏃х煡璇嗗師鏂囧紩鐢?%s 鏃堕樆鏂彂甯冧笖涓嶈鍙栨棫椤圭洰澶栨枃浠?, async reference => {
  const f = fixture('v110')
  const filePath = reference === 'outside' ? path.join(path.dirname(f.source), '澶栭儴璧勬枡.txt')
    : path.join(f.source, '缂哄け璧勬枡.txt')
  if (reference === 'outside') fs.writeFileSync(filePath, '鍙湪鏃ч」鐩鐨勫悎鎴愯祫鏂欙紝涓嶅緱璇诲彇鎴栬浆鍏ユ柊椤圭洰銆?)
  const sourceHash = hash(path.join(f.legacy, 'vela.db'))
  const outsideHash = reference === 'outside' ? hash(filePath) : null
  const connection = await lance.connect(path.join(f.legacy, 'lancedb'))
  const tables: lance.Table[] = []
  try {
    tables.push(await connection.createTable('chunks', [{ id: 'old-chunk', docId: 'old-doc',
      fileName: '鍒涗綔璧勬枡.txt', text: '鏃х储寮曠墖娈?, chunkIndex: 0, totalChunks: 1,
      importedAt: '2026-09-13', corpusKind: 'reference' }], { schema: new Schema([
      new Field('id', new Utf8()), new Field('docId', new Utf8()), new Field('fileName', new Utf8()),
      new Field('text', new Utf8()), new Field('chunkIndex', new Int32()), new Field('totalChunks', new Int32()),
      new Field('importedAt', new Utf8()), new Field('corpusKind', new Utf8()),
    ]) }))
    tables.push(await connection.createTable('documents', [{ id: 'old-doc', fileName: '鍒涗綔璧勬枡.txt',
      filePath, importedAt: '2026-09-13', chunkCount: 1, corpusKind: 'reference' }]))
  } finally { for (const table of tables) table.close(); connection.close() }
  expect(await importLegacyProjectCopy({ sourceRoot: f.source, targetRoot: f.target, preflightOptions }))
    .toMatchObject({ state: 'blocked', code: 'LEGACY_IMPORT_KNOWLEDGE_ORIGINAL_UNAVAILABLE' })
  expect(fs.existsSync(f.target)).toBe(false)
  expect(hash(path.join(f.legacy, 'vela.db'))).toBe(sourceHash)
  if (outsideHash) expect(hash(filePath)).toBe(outsideHash)
})

it('婧愯祫鏂欏彉鍖栥€佹湭鐭ユ棫璧勪骇鍧囧湪鍙戝竷鍓嶆嫆缁濓紝鏃ч」鐩繚鐣?, async () => {
  const f = fixture('v110')
  const changed = await importLegacyProjectCopy({ sourceRoot: f.source, targetRoot: f.target, preflightOptions,
    checkpoint: phase => { if (phase === 'copied') fs.appendFileSync(path.join(f.legacy, 'prompts', 'author.txt'), '澶栭儴鏀瑰啓') },
  })
  expect(changed).toMatchObject({ state: 'blocked', code: 'LEGACY_IMPORT_SOURCE_CHANGED' })
  expect(fs.existsSync(f.target)).toBe(false)
  expect(fs.readdirSync(path.dirname(f.target)).filter(name => name.includes('.new.legacy-import-'))).toEqual([])
  fs.writeFileSync(path.join(f.legacy, 'unmapped-author-notes.txt'), '涓嶅彲闈欓粯涓㈠純')
  expect(await importLegacyProjectCopy({ sourceRoot: f.source, targetRoot: f.target, preflightOptions }))
    .toMatchObject({ state: 'blocked', code: 'LEGACY_IMPORT_UNMAPPED_ASSET' })
  expect(fs.existsSync(path.join(f.legacy, 'unmapped-author-notes.txt'))).toBe(true)
})

it('缂哄け蹇呴渶鏃у簱鎴栫洰鏍囧彂甯冨墠涓柇鍧囦笉鐣欎笅鍗婃垚鍝?, async () => {
  const missing = fixture('v110')
  fs.unlinkSync(path.join(missing.legacy, 'vela.db'))
  expect(await importLegacyProjectCopy({ sourceRoot: missing.source, targetRoot: missing.target, preflightOptions }))
    .toMatchObject({ state: 'blocked', code: 'LEGACY_IMPORT_UNMAPPED_ASSET' })
  expect(fs.existsSync(missing.target)).toBe(false)
  expect(fs.existsSync(path.join(missing.legacy, 'vela.db-wal'))).toBe(true)

  const interrupted = fixture('v100', '')
  let reachedVerified = false
  expect(await importLegacyProjectCopy({ sourceRoot: interrupted.source, targetRoot: interrupted.target, preflightOptions,
    checkpoint: phase => { if (phase === 'verified') { reachedVerified = true; throw new Error('synthetic interruption') } },
  })).toMatchObject({ state: 'blocked', code: 'LEGACY_IMPORT_IO_FAILED' })
  expect(reachedVerified).toBe(true)
  expect(fs.existsSync(interrupted.target)).toBe(false)
  expect(fs.readdirSync(path.dirname(interrupted.target)).filter(name => name.startsWith('.new.legacy-import-'))).toEqual([])
  expect(Object.fromEntries(Object.keys(interrupted.sourceHashes).map(name => [name, hash(path.join(interrupted.legacy, name))])))
    .toEqual(interrupted.sourceHashes)
})

it.each(['sqlite-converted', 'assets-converted', 'history-frozen'] as const)(
  '%s 鎸佷箙鍖栧悗涓柇鍙竻鐞嗙洰鏍?staging锛屽悓璺緞閲嶈瘯鍙畬鎴?, async phase => {
    const f = fixture('v110', '')
    if (phase === 'history-frozen') {
      const db = new Database(path.join(f.legacy, 'vela.db'))
      try {
        db.prepare(`INSERT INTO llm_calls(id,model_id,model_name,purpose,prompt_tokens,completion_tokens,
          total_tokens,duration_ms,success,error_message,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
          .run(31, 'old-model', 'old-model', 'review', 1, 1, 2, 10, 1, '', '2026-09-01 12:00:00')
      } finally { db.close() }
    }
    const sourceFiles = Object.keys(f.sourceHashes)
    const sourceHashes = () => Object.fromEntries(sourceFiles.map(name => {
      const file = path.join(f.legacy, name)
      return [name, fs.existsSync(file) ? hash(file) : null]
    }))
    const before = sourceHashes()
    let reached = false
    const stopped = await importLegacyProjectCopy({ sourceRoot: f.source, targetRoot: f.target, preflightOptions,
      checkpoint: current => { if (current === phase) { reached = true; throw new Error('synthetic interruption') } },
    })
    expect(reached).toBe(true)
    expect(stopped).toMatchObject({ state: 'blocked', code: 'LEGACY_IMPORT_IO_FAILED' })
    expect(fs.existsSync(f.target)).toBe(false)
    expect(fs.readdirSync(path.dirname(f.target)).filter(name => name.startsWith('.new.legacy-import-'))).toEqual([])
    expect(sourceHashes()).toEqual(before)
    expect(await importLegacyProjectCopy({ sourceRoot: f.source, targetRoot: f.target, preflightOptions }))
      .toMatchObject({ state: 'ready', targetRoot: f.target })
  },
)

it.each(['sqlite-converted', 'renamed'] as const)('%s 瀛愯繘绋嬬粓姝㈠悗婧愪繚鐣欎笖鐩爣鍙畨鍏ㄦ仮澶?, async phase => {
  const f = fixture('v110', ''), before = sourceState(f)
  await terminateImportAt(f, phase)
  expect(sourceState(f)).toEqual(before)
  const attempts = fs.readdirSync(path.dirname(f.target)).filter(name => name.startsWith('.new.legacy-import-'))
  expect(attempts).toHaveLength(1)
  const owner = JSON.parse(fs.readFileSync(path.join(path.dirname(f.target), attempts[0]!, '.vibe-owner.json'), 'utf8'))
  expect(owner).toMatchObject({ owner: 'AI Novel A11 offline import', sourceProject: f.source, ttlHours: 24 })
  expect(owner.cleanupCommand).toContain(attempts[0])
  if (phase === 'sqlite-converted') {
    expect(fs.existsSync(f.target)).toBe(false)
    expect(await importLegacyProjectCopy({ sourceRoot: f.source, targetRoot: f.target, preflightOptions }))
      .toMatchObject({ state: 'ready', targetRoot: f.target })
  } else {
    expect(verifyProjectSqlite({ databasePath: path.join(f.target, '.ai-novel', 'project.db') }).schemaVersion).toBe(12)
    const access = new ProjectAccessService(preflightOptions)
    const trusted = access.adoptLegacyProject(access.probeExistingProject(f.target))
    expect(trusted.projectId).not.toBe(f.sourceProjectId)
    initProjectDatabase(trusted.rootPath)
    expect(ProjectCoreRepository.get()?.projectName).toBe('鍚堟垚鏃ч」鐩?)
    closeProjectDatabase()
    expect(await importLegacyProjectCopy({ sourceRoot: f.source, targetRoot: f.target, preflightOptions }))
      .toMatchObject({ state: 'blocked', code: 'LEGACY_IMPORT_TARGET_EXISTS' })
  }
  const targetDb = new Database(path.join(f.target, '.ai-novel', 'project.db'), { readonly: true })
  try {
    expect(targetDb.prepare('SELECT body FROM contents WHERE id=11').pluck().get()).toBe('鍚堟垚绔犺妭姝ｆ枃\r\n鍘熷瓧鑺?)
  } finally { targetDb.close() }
  expect(hash(path.join(f.target, 'outline.md'))).toBe(hash(path.join(f.source, 'outline.md')))
  for (const file of ['prompts/author.txt', 'skills/author.md'])
    expect(hash(path.join(f.target, '.ai-novel', file))).toBe(hash(path.join(f.legacy, file)))
  expect(sourceState(f)).toEqual(before)
})

it('鏃у€欓€夋鏂囦繚鐣欎负鍙鍐荤粨鍘嗗彶锛屾柊椤圭洰涓嶉噸鏀?, async () => {
  const f = fixture('v110', ''), db = new Database(path.join(f.legacy, 'vela.db'))
  const candidateSource = JSON.stringify({ chapterNumber: 7, title: '绗竷绔?, role: '鎺ㄨ繘', purpose: '杩借釜', keyEvents: '绾跨储', characters: [] })
  try {
    db.prepare('INSERT INTO contents(id,body) VALUES(?,?)').run(12, '鏃х増浜哄伐瀹＄鍘熸枃')
    db.prepare(`INSERT INTO reviews(id,base_draft_id,review_index,content_id,source_draft_chapter_number,
      source_draft_version,source_draft_status,source_content) VALUES(?,?,?,?,?,?,?,?)`)
      .run(21, 19, 1, 12, 7, 1, 'draft', '鍚堟垚绔犺妭姝ｆ枃\r\n鍘熷瓧鑺?)
    db.prepare(`INSERT INTO finalization_outbox(finalization_id,draft_id,chapter_number,chapter_title,
      content_hash,content_revision,content_snapshot,target_file_name,publication_status,last_error)
      VALUES(?,?,?,?,?,1,?,?,'pending',?)`).run('old-outbox', 19, 7, '绗竷绔?,
      createHash('sha256').update('鍚堟垚绔犺妭姝ｆ枃\r\n鍘熷瓧鑺?).digest('hex'), '鍚堟垚绔犺妭姝ｆ枃\r\n鍘熷瓧鑺?, '绗竷绔?md', 'C:\\private\\token-secret')
    db.prepare(`INSERT INTO import_runs(id,root_run_id,effect_namespace,source_fingerprint,manifest_fingerprint,
      locale,stage,status,total_chapters,manifest_chapter_count,execution_owner,execution_epoch,lease_expires_at)
      VALUES(?,?,?,?,?,'zh-CN','parsing','running',0,0,?,?,?)`)
      .run('old-import', 'old-import', 'import:old-import', createHash('sha256').update('source').digest('hex'),
        createHash('sha256').update('manifest').digest('hex'), 'old-machine-authority', 4, 999999999)
    db.prepare(`INSERT INTO recovery_candidates(candidate_id,run_id,step_id,project_id,chapter_number,
      source_snapshot,source_hash,visible_text,content_hash) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run('old-candidate', 'old-run', 'old-step', f.sourceProjectId, 7,
        candidateSource, createHash('sha256').update(candidateSource).digest('hex'),
        '鏃у€欓€夋鏂?, createHash('sha256').update('鏃у€欓€夋鏂?).digest('hex'))
    db.prepare(`INSERT INTO llm_calls(id,model_id,model_name,purpose,prompt_tokens,completion_tokens,
      total_tokens,duration_ms,success,error_message,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(31, 'model?token=secret', 'C:\\private\\model', 'review', 120, 0, 120, 43, 0,
        'C:\\private\\token-secret', '2026-09-01 12:00:00')
    db.prepare('INSERT INTO post_process_runs(id,trigger_source_type,trigger_source_id) VALUES(?,?,?)')
      .run('old-post-run', 'draft', '19')
    db.prepare('INSERT INTO post_process_steps(run_id,step_key,ok,attempt_count,error_msg) VALUES(?,?,?,?,?)')
      .run('old-post-run', 'review', 0, 1, 'C:\\private\\token-secret')
  } finally { db.close() }
  const before = Object.fromEntries(fs.readdirSync(f.legacy).filter(name => fs.lstatSync(path.join(f.legacy, name)).isFile())
    .map(name => [name, hash(path.join(f.legacy, name))]))
  const result = await importLegacyProjectCopy({ sourceRoot: f.source, targetRoot: f.target, preflightOptions })
  expect(result).toMatchObject({ state: 'ready' })
  const frozen = readPortableRuntimeFreeze(f.target)
  const transferred = JSON.parse(fs.readFileSync(path.join(f.target, '.ai-novel', 'portable-transfer-authority.json'), 'utf8'))
  expect(transferred).toMatchObject({ originProjectId: f.sourceProjectId, targetProjectId: result.state === 'ready' ? result.projectId : undefined })
  expect(frozen.isFrozen('recovery_candidates', 'old-candidate')).toBe(true)
  expect(frozen.isFrozen('finalization_outbox', 'old-outbox')).toBe(true)
  expect(frozen.isFrozen('import_runs', 'old-import')).toBe(true)
  expect(() => frozen.assertMutable('recovery_candidates', 'old-candidate')).toThrow('PORTABLE_RUNTIME_FROZEN')
  const copy = new Database(path.join(f.target, '.ai-novel', 'project.db'), { readonly: true })
  try {
    expect(copy.prepare('SELECT source_hash FROM recovery_candidates WHERE candidate_id=?').pluck().get('old-candidate')).toBe('')
    expect(copy.prepare('SELECT visible_text FROM recovery_candidates WHERE candidate_id=?').pluck().get('old-candidate')).toBe('鏃у€欓€夋鏂?)
    expect(copy.prepare('SELECT body FROM contents WHERE id=(SELECT content_id FROM reviews WHERE id=21)').pluck().get()).toBe('鏃х増浜哄伐瀹＄鍘熸枃')
    expect(copy.prepare('SELECT source_content FROM reviews WHERE id=21').pluck().get()).toBe('鍚堟垚绔犺妭姝ｆ枃\r\n鍘熷瓧鑺?)
    expect(copy.prepare('SELECT publication_status FROM finalization_outbox WHERE finalization_id=?').pluck().get('old-outbox')).toBe('pending')
    expect(copy.prepare('SELECT last_error FROM finalization_outbox WHERE finalization_id=?').pluck().get('old-outbox')).not.toContain('token-secret')
    expect(copy.prepare('SELECT execution_owner FROM import_runs WHERE id=?').pluck().get('old-import')).not.toBe('old-machine-authority')
    expect(copy.prepare('SELECT model_id,model_name,purpose,prompt_tokens,total_tokens,success,error_message FROM llm_calls WHERE id=31').get())
      .toMatchObject({ model_id: '', model_name: '鏃х増妯″瀷韬唤涓嶅彲鐢?, purpose: 'legacy', prompt_tokens: 120,
        total_tokens: 120, success: 0, error_message: '鏃х増閿欒璇︽儏涓嶅彲鐢? })
    expect(copy.prepare("SELECT error_msg FROM post_process_steps WHERE run_id='old-post-run'").pluck().get())
      .toBe('鏃х増閿欒璇︽儏涓嶅彲鐢?)
    expect(JSON.stringify(copy.prepare('SELECT * FROM llm_calls').all())).not.toContain('token-secret')
  }
  finally { copy.close() }
  initProjectDatabase(f.target)
  expect(LLMHistoryRepository.getStats()).toMatchObject({ totalCalls: 1, failedCalls: 1, totalTokens: 120 })
  expect(LLMHistoryRepository.getHistory(1)).toMatchObject([{ modelName: '鏃х増妯″瀷韬唤涓嶅彲鐢?, success: 0 }])
  expect(PostProcessRepository.getSteps('old-post-run')).toMatchObject([{ errorMsg: '鏃х増閿欒璇︽儏涓嶅彲鐢?, attemptCount: 1 }])
  closeProjectDatabase()
  await verifyFrozenLegacyConsumersAfterRestart(f.target, path.join(path.dirname(f.source), 'legacy-freeze-child.mjs'))
  expect(Object.fromEntries(Object.keys(before).map(name => [name, hash(path.join(f.legacy, name))]))).toEqual(before)
  expect(fs.existsSync(path.join(f.legacy, 'vela.db'))).toBe(true)
})

it.each(['v100', 'v110'] as const)('%s 鏃?manifest 鐨勬棫鍘嗗彶鍚敤鏂?lineage锛屾棫鍒犻櫎鎿嶄綔涓嶈兘閲嶆斁', async version => {
  const f = fixture(version, '')
  fs.rmSync(path.join(f.legacy, 'project.json'))
  const oldCandidateProjectId = randomUUID()
  const source = new Database(path.join(f.legacy, 'vela.db'))
  try {
    source.prepare(`INSERT INTO recovery_candidates(candidate_id,run_id,step_id,project_id,chapter_number,
      source_snapshot,source_hash,visible_text,content_hash) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run('old-candidate', 'old-run', 'old-step', oldCandidateProjectId, 7,
        JSON.stringify({ chapterNumber: 7, title: '绗竷绔?, role: '鎺ㄨ繘', purpose: '杩借釜', keyEvents: '绾跨储', characters: [] }),
        'old-source-hash', '鏃у€欓€夋鏂?, 'old-content-hash')
    source.prepare(`INSERT INTO chapter_deletion_operations(operation_id,draft_id,chapter_number,finalization_id,
      target_file_name,knowledge_document_id,status) VALUES(?,?,?,?,?,?,'pending')`)
      .run('old-deletion', 19, 7, 'old-finalization', '绗竷绔?md', 'old-knowledge-doc')
    source.prepare(`INSERT INTO finalization_outbox(finalization_id,draft_id,chapter_number,chapter_title,
      content_hash,content_revision,content_snapshot,target_file_name,publication_status)
      VALUES(?,?,?,?,?,1,?,?,'pending')`).run('old-outbox', 19, 7, '绗竷绔?,
        createHash('sha256').update('鍚堟垚绔犺妭姝ｆ枃\r\n鍘熷瓧鑺?).digest('hex'), '鍚堟垚绔犺妭姝ｆ枃\r\n鍘熷瓧鑺?, '绗竷绔?md')
    source.prepare(`INSERT INTO import_runs(id,root_run_id,effect_namespace,source_fingerprint,manifest_fingerprint,
      locale,stage,status,total_chapters,manifest_chapter_count) VALUES(?,?,?,?,?,'zh-CN','parsing','running',0,0)`)
      .run('old-import', 'old-import', 'import:old-import', createHash('sha256').update('source').digest('hex'),
        createHash('sha256').update('manifest').digest('hex'))
  } finally { source.close() }
  const sourceDatabaseHash = hash(path.join(f.legacy, 'vela.db'))
  const result = await importLegacyProjectCopy({ sourceRoot: f.source, targetRoot: f.target, preflightOptions })
  expect(result, JSON.stringify(result)).toMatchObject({ state: 'ready' })
  if (result.state !== 'ready') return
  expect(result.projectId).not.toBe(oldCandidateProjectId)
  const storage = path.join(f.target, '.ai-novel')
  const freeze = JSON.parse(fs.readFileSync(path.join(storage, 'portable-runtime-freeze.json'), 'utf8'))
  const authority = JSON.parse(fs.readFileSync(path.join(storage, 'portable-transfer-authority.json'), 'utf8'))
  expect(freeze.originProjectId).toBe(result.projectId)
  expect(authority).toMatchObject({ originProjectId: result.projectId, targetProjectId: result.projectId })
  expect(readPortableRuntimeFreeze(f.target).isFrozen('recovery_candidates', 'old-candidate')).toBe(true)
  expect(readPortableRuntimeFreeze(f.target).isFrozen('chapter_deletion_operations', 'old-deletion')).toBe(true)
  expect(readPortableRuntimeFreeze(f.target).isFrozen('finalization_outbox', 'old-outbox')).toBe(true)
  expect(readPortableRuntimeFreeze(f.target).isFrozen('import_runs', 'old-import')).toBe(true)
  initProjectDatabase(f.target)
  const targetDb = getProjectDb()!
  expect(readPortableCurrentAuthority({ database: targetDb, projectStorageRoot: storage, projectId: result.projectId }))
    .toMatchObject({ originProjectId: result.projectId })
  expect(targetDb.prepare('SELECT project_id FROM recovery_candidates WHERE candidate_id=?').pluck().get('old-candidate'))
    .toBe(oldCandidateProjectId)
  expect(targetDb.prepare('SELECT status FROM chapter_deletion_operations WHERE operation_id=?').pluck().get('old-deletion'))
    .toBe('pending')
  const frozenRefusal = { success: false, committed: false, error: expect.stringContaining('浠呬繚鐣欎负鍘嗗彶') }
  const calls: string[] = []
  const service = new ChapterDeletionService({ cleaner: {
    async removeManuscript() { calls.push('manuscript') },
    async removeKnowledgeDocument() { calls.push('knowledge') },
  } })
  expect(await service.retry(f.target, 'old-deletion')).toEqual(frozenRefusal)
  expect(await service.confirmLegacyKnowledgeAbsent(f.target, 'old-deletion')).toEqual(frozenRefusal)
  expect(await service.delete(f.target, { draftId: 19, chapterNumber: 7 })).toEqual(frozenRefusal)
  expect(calls).toEqual([])
  expect(targetDb.prepare('SELECT status,attempt_count FROM chapter_deletion_operations WHERE operation_id=?')
    .get('old-deletion')).toMatchObject({ status: 'pending', attempt_count: 0 })
  expect(hash(path.join(f.legacy, 'vela.db'))).toBe(sourceDatabaseHash)
})

it.each(['v100', 'v110'] as const)('%s 鏃х増鏃犳敹鎹畾绋挎鏂囦繚鐣欎负 legacy锛屼粎杞Щ鏈夎瘉鏄庣殑瀹氱', async version => {
  const f = fixture(version, '')
  const source = new Database(path.join(f.legacy, 'vela.db'))
  try {
    source.prepare("UPDATE drafts SET status='finalized' WHERE id=19").run()
    source.prepare('INSERT INTO summary_snapshots(id,chapter_number,character_states) VALUES(?,?,?)')
      .run(31, 7, '{"涓昏":{"location":"鏃ц瀹?}}')
    source.prepare('INSERT INTO contents(id,body) VALUES(?,?)').run(12, '鏈夋潵婧愭敹鎹殑绗叓绔犲畾绋?)
    source.prepare("INSERT INTO drafts(id,chapter_number,version,content_id,status) VALUES(22,8,1,12,'finalized')").run()
    source.prepare(`INSERT INTO finalization_outbox(finalization_id,draft_id,chapter_number,chapter_title,
      content_hash,content_revision,content_snapshot,target_file_name,publication_status)
      VALUES(?,?,?,?,?,1,?,?,'published')`).run('bound-finalization', 22, 8, '绗叓绔?,
        createHash('sha256').update('鏈夋潵婧愭敹鎹殑绗叓绔犲畾绋?).digest('hex'), '鏈夋潵婧愭敹鎹殑绗叓绔犲畾绋?, '绗叓绔?md')
  } finally { source.close() }
  const sourceHash = hash(path.join(f.legacy, 'vela.db'))
  const result = await importLegacyProjectCopy({ sourceRoot: f.source, targetRoot: f.target, preflightOptions })
  expect(result, JSON.stringify(result)).toMatchObject({ state: 'ready' })
  if (result.state !== 'ready') return
  const storage = path.join(f.target, '.ai-novel')
  const authority = JSON.parse(fs.readFileSync(path.join(storage, 'portable-transfer-authority.json'), 'utf8'))
  expect(authority.finalizations).toEqual([{
    finalizationId: 'bound-finalization', draftId: 22, chapterNumber: 8,
    contentHash: createHash('sha256').update('鏈夋潵婧愭敹鎹殑绗叓绔犲畾绋?).digest('hex'),
  }])
  expect(authority.summarySources).toEqual([])
  initProjectDatabase(f.target)
  expect(SummaryRepository.readFinalizedSource(19)).toMatchObject({ status: 'legacy', content: '鍚堟垚绔犺妭姝ｆ枃\r\n鍘熷瓧鑺? })
  expect(getProjectDb()!.prepare('SELECT content_snapshot FROM finalization_outbox WHERE finalization_id=?').pluck().get('bound-finalization'))
    .toBe('鏈夋潵婧愭敹鎹殑绗叓绔犲畾绋?)
  expect(getProjectDb()!.prepare('SELECT character_states FROM summary_snapshots WHERE id=31').pluck().get())
    .toBe('{"涓昏":{"location":"鏃ц瀹?}}')
  expect(() => createPortableTransferAuthority({ database: getProjectDb()!, originProjectId: result.projectId,
    snapshotGeneration: randomUUID(), portableDatabaseSha256: 'a'.repeat(64) })).toThrow('PORTABLE_TRANSFER_AUTHORITY_INVALID')
  expect(hash(path.join(f.legacy, 'vela.db'))).toBe(sourceHash)
})

it('鏃у畾绋垮瓨鍦ㄥけ閰嶆敹鎹椂鎷掔粷鍙戝竷锛屼笉鑳芥妸鍧忔敹鎹檷涓?legacy', async () => {
  const f = fixture('v110')
  const source = new Database(path.join(f.legacy, 'vela.db'))
  try {
    source.prepare("UPDATE drafts SET status='finalized' WHERE id=19").run()
    source.prepare(`INSERT INTO finalization_outbox(finalization_id,draft_id,chapter_number,chapter_title,
      content_hash,content_revision,content_snapshot,target_file_name,publication_status)
      VALUES(?,?,?,?,?,1,?,?,'published')`).run('bad-finalization', 19, 7, '绗竷绔?,
        'a'.repeat(64), '澶遍厤姝ｆ枃', '绗竷绔?md')
  } finally { source.close() }
  expect(await importLegacyProjectCopy({ sourceRoot: f.source, targetRoot: f.target, preflightOptions }))
    .toMatchObject({ state: 'blocked', code: 'PORTABLE_TRANSFER_AUTHORITY_INVALID' })
  expect(fs.existsSync(f.target)).toBe(false)
})

it('鏈瑙掕壊寮曠敤鐨勫ご鍍忓師瀛楄妭淇濈暀涓哄緟澶勭悊璧勬枡', async () => {
  const f = fixture('v110', '')
  fs.mkdirSync(path.join(f.legacy, 'avatars'))
  fs.writeFileSync(path.join(f.legacy, 'avatars', 'unmapped.png'), Buffer.from('89504e470d0a1a0a00000000', 'hex'))
  expect(await importLegacyProjectCopy({ sourceRoot: f.source, targetRoot: f.target, preflightOptions }))
    .toMatchObject({ state: 'ready' })
  const unresolved = path.join(f.target, '.ai-novel', 'avatars', 'unresolved')
  expect(fs.readFileSync(path.join(unresolved, fs.readdirSync(unresolved)[0]!))).toEqual(fs.readFileSync(path.join(f.legacy, 'avatars', 'unmapped.png')))
  expect(fs.existsSync(path.join(f.legacy, 'avatars', 'unmapped.png'))).toBe(true)
})
