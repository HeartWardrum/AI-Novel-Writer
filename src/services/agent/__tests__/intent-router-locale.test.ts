import { afterEach, describe, expect, it } from 'vitest'

import {
  getAllSlashCommands,
  parseSlashCommand,
} from '../intent-router'
import { parseSkillMd, skillRegistry } from '../skill-registry'

afterEach(() => skillRegistry.clear())

describe('Agent intent menu locale', () => {
  it('returns English built-in commands without Chinese UI copy', () => {
    const commands = getAllSlashCommands('en-US')

    expect(commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'help', displayName: 'Help', description: 'Show available commands and features' }),
    ]))
    expect(JSON.stringify({ commands })).not.toMatch(/[\u3400-\u9fff]/u)
  })

  it('uses English writing-skill metadata for an English slash-command menu', () => {
    const skill = parseSkillMd(
      '---\nname: scene-craft\ndisplay_name: Scene Craft\ndescription: Build scenes around consequential choices.\nstage: drafting\n---\nUse concrete action.',
      'scene-craft',
      'user',
      'managed://skills/scene-craft',
      'managed://skills/scene-craft/SKILL.md',
    )!
    skill.metadata.displayName = '场景塑造'
    skill.metadata.description = '以有后果的选择推进场景。'
    skillRegistry.register(skill)

    expect(getAllSlashCommands('en-US')).toContainEqual(expect.objectContaining({
      name: 'scene-craft',
      displayName: 'Scene Craft',
      description: 'Build scenes around consequential choices.',
    }))
    expect(parseSlashCommand('/scene-craft', 'en-US').command?.displayName).toBe('Scene Craft')
  })
})
