import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('StageWorldbook hides character entries', () => {
  it('excludes character from UI kinds, list filter, and import candidates', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/stage/worldbook/StageWorldbook.tsx'),
      'utf8',
    )
    expect(source).toContain('WORLDBOOK_UI_KINDS')
    expect(source).toContain("kind !== 'character'")
    expect(source).toContain("if (entry.kind === 'character') return false")
    expect(source).toContain("if (kind === 'character') return")
    expect(source).toContain('.filter(item => item.kind !== \'character\')')
    // 类型下拉与新建类型改用 UI kinds，不再直接 map 全量含人物
    expect(source).toMatch(/WORLDBOOK_UI_KINDS\.map\(kind =>/)
    expect(source).not.toMatch(/WORLD_BOOK_ENTRY_KINDS\.map\(kind => <option/)
  })
})
