import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'

import SlashCommandMenu from '../agent/SlashCommandMenu'
import { getAllSlashCommands } from '../../../services/agent/intent-router'
import { skillRegistry } from '../../../services/agent/skill-registry'
import { useLocaleStore } from '../../../stores/locale-store'

const pseudoIconPattern = new RegExp([
  '[\\u2600-\\u27BF]',
  '[\\u{1F300}-\\u{1FAFF}]',
  '[\\u2190-\\u25FF]',
  '[\\u00AB\\u00BB]',
  '\\uFE0F',
].join('|'), 'u')

afterEach(() => skillRegistry.clear())

describe('data-driven menu icon contract', () => {
  it('renders every slash command with shared icons instead of Unicode glyphs', () => {
    const locale = useLocaleStore.getInitialState().locale
    const commands = getAllSlashCommands(locale)
    const markup = renderToStaticMarkup(createElement(SlashCommandMenu, {
      query: '',
      onSelect: () => undefined,
      onClose: () => undefined,
    }))

    for (const command of commands) {
      expect(markup).toContain(`/${command.name}`)
      expect(command).not.toHaveProperty('icon')
    }
    expect(JSON.stringify(commands)).not.toMatch(pseudoIconPattern)
    expect(markup).not.toMatch(pseudoIconPattern)
    expect(markup).toContain('<svg')
  })
})
