import { describe, expect, it } from 'vitest'

import { getBuiltinPromptTemplate } from '../../../src/services/builtin-prompt-templates'
import {
  buildEditorInlineContext,
  editorInlineTask,
  validateEditorInlineInput,
} from '../editor-inline-generation'

describe('editor inline context options', () => {
  const documentText = `${'前'.repeat(10)}选中段${'后'.repeat(10)}`
  const from = 10
  const to = 13
  const selectedText = '选中段'
  const template = getBuiltinPromptTemplate('edit_selected_text', 'zh-CN')!

  it('derives preceding and following windows from the document when checked', () => {
    const input = validateEditorInlineInput({
      action: 'rewrite',
      documentText,
      from,
      to,
      selectedText,
      editInstruction: '写得更紧',
      contextOptions: {
        includePreceding: true,
        includeFollowing: true,
        includeBlueprint: false,
        includeGlobalGuidance: false,
      },
    })
    expect(input.contextBundle?.precedingText).toBe('前'.repeat(10))
    expect(input.contextBundle?.followingText).toBe('后'.repeat(10))
    expect(input.contextBundle?.chapterBlueprint).toBeUndefined()
  })

  it('keeps blueprint only when the option is on and a bundle value is provided', () => {
    expect(() => validateEditorInlineInput({
      action: 'rewrite',
      documentText,
      from,
      to,
      selectedText,
      editInstruction: '写得更紧',
      contextOptions: {
        includePreceding: false,
        includeFollowing: false,
        includeBlueprint: false,
        includeGlobalGuidance: false,
      },
      contextBundle: { chapterBlueprint: '不应出现' },
    })).toThrow('GENERATION_EDITOR_INPUT_INVALID')

    const input = validateEditorInlineInput({
      action: 'rewrite',
      documentText,
      from,
      to,
      selectedText,
      editInstruction: '写得更紧',
      chapterNumber: 3,
      contextOptions: {
        includePreceding: false,
        includeFollowing: false,
        includeBlueprint: true,
        includeGlobalGuidance: true,
      },
      contextBundle: {
        chapterBlueprint: '蓝图摘要',
        globalGuidance: '全局要求',
      },
    })
    expect(input.contextBundle).toEqual({
      chapterBlueprint: '蓝图摘要',
      globalGuidance: '全局要求',
    })
  })

  it('renders optional sections into the prompt and omits empty ones', () => {
    const context = buildEditorInlineContext({
      action: 'rewrite',
      documentText,
      from,
      to,
      selectedText,
      editInstruction: '写得更紧',
      contextOptions: {
        includePreceding: true,
        includeFollowing: false,
        includeBlueprint: true,
        includeGlobalGuidance: false,
      },
      contextBundle: { chapterBlueprint: '本章要推进冲突' },
    }, 'zh-CN', template)
    const task = editorInlineTask(context)
    const user = task.messages.find(message => message.role === 'user')?.content ?? ''
    expect(user).toContain('前'.repeat(10))
    expect(user).toContain('本章要推进冲突')
    expect(user).not.toContain('【选区后文】')
    expect(user).not.toContain('【全局创作要求】')
  })
})
