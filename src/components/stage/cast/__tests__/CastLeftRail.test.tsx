import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('cast left rail wiring', () => {
  it('is mounted from ChatWorkbench with fixed absolute width', () => {
    const workbench = readFileSync(
      resolve(process.cwd(), 'src/components/stage/ChatWorkbench.tsx'),
      'utf8',
    )
    const rail = readFileSync(
      resolve(process.cwd(), 'src/components/stage/cast/CastLeftRail.tsx'),
      'utf8',
    )
    const css = readFileSync(
      resolve(process.cwd(), 'src/components/stage/cast/cast-left-rail.css'),
      'utf8',
    )
    const workbenchCss = readFileSync(
      resolve(process.cwd(), 'src/components/stage/chat-workbench.css'),
      'utf8',
    )
    const worldbook = readFileSync(
      resolve(process.cwd(), 'src/components/stage/worldbook/StageWorldbook.tsx'),
      'utf8',
    )
    const shellTest = readFileSync(
      resolve(process.cwd(), 'src/components/stage/__tests__/chat-shell.browser.tsx'),
      'utf8',
    )

    expect(workbench).toContain('CastLeftRail')
    expect(workbench).toContain('projectKey')
    expect(rail).toContain('data-testid="cast-left-rail"')
    expect(rail).toContain('cast-left-rail-portrait')
    expect(rail).toContain('cast-rail-public-content')
    expect(rail).not.toContain('cast-rail-private-content')
    expect(rail).toContain('ensureCharacterWorldbookEntry')
    expect(rail).toContain('常驻')
    expect(rail).toContain('关键词')
    expect(rail).toContain('匹配')
    expect(rail).toContain('设定')
    expect(rail).toContain('cast-left-rail-row-text')
    expect(rail).toContain('cast-left-rail-portrait-empty')
    expect(rail).toContain('getCharacterRoleLabels')
    expect(css).toContain('font-display')
    expect(css).toContain('cast-left-rail-match-row')

    expect(css).toContain('position: absolute')
    expect(css).toContain('cast-left-rail-resizer')
    expect(css).toContain('cursor: col-resize')
    expect(css).toContain('max-width: 520px')
    expect(css).not.toContain("data-expanded='true']")
    expect(css).toContain('flex-direction: column')
    expect(rail).toContain('cast-left-rail-resizer')
    expect(rail).toContain('RAIL_WIDTH')
    expect(rail).toContain('onPointerDown')

    expect(workbenchCss).toContain('align-items: center')
    expect(workbenchCss).toContain('padding-inline: var(--s-4)')
    expect(workbenchCss).toContain('min(42rem, 100%)')

    expect(worldbook).toContain('WORLDBOOK_UI_KINDS')
    expect(worldbook).toContain("if (entry.kind === 'character') return false")
    expect(shellTest).toContain('cast-left-rail')
    expect(shellTest).toContain('整壳居中')
  })
})
