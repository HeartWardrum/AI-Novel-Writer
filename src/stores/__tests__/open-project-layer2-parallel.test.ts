import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('open project layer2 parallel wiring', () => {
  it('starts recent, file tree, and Layer2 together after project commit', () => {
    const projectStore = readFileSync(
      resolve(process.cwd(), 'src/stores/project-store.ts'),
      'utf8',
    )
    const openSlice = projectStore.slice(
      projectStore.indexOf('navigate({ kind: \'stage\' })'),
      projectStore.indexOf('PROJECT_LEGACY_IMPORT_REQUIRED'),
    )
    expect(openSlice).toContain('Promise.allSettled')
    expect(openSlice).toContain('loadRecentProjects()')
    expect(openSlice).toContain('refreshFileTree(result.project.path)')
    expect(openSlice).toContain('callProjectOpened(openedProjectSession)')
    // 不得再串行：先等 recent/fileTree 再 Layer2
    expect(openSlice).not.toMatch(
      /await get\(\)\.loadRecentProjects\(\)[\s\S]*await get\(\)\.refreshFileTree[\s\S]*await callProjectOpened/,
    )
  })

  it('loads derived fields lazily from CharacterProfile, not roster-read', () => {
    const profile = readFileSync(
      resolve(process.cwd(), 'src/components/stage/characters/CharacterProfile.tsx'),
      'utf8',
    )
    const store = readFileSync(
      resolve(process.cwd(), 'src/stores/character-store.ts'),
      'utf8',
    )
    const dbController = readFileSync(
      resolve(process.cwd(), 'electron/controllers/db-controller.ts'),
      'utf8',
    )
    expect(profile).toContain('loadCurrentDerivedFields')
    expect(store).toContain('db:character-derived-fields-read')
    expect(dbController).toContain("ipcMain.handle('db:character-derived-fields-read'")
    expect(dbController).toMatch(
      /db:character-roster-read'[\s\S]*?return CharacterRosterRepository\.read\(\)/,
    )
  })
})
