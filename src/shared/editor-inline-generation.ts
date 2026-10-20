import type { MainGenerationRunHandle, MainGenerationRunView, MainGenerationExecuteReceipt } from '../services/generation/generation-runtime'
import type { PromptTemplate } from '../services/builtin-prompt-templates'
import type { WritingLanguage } from './writing-language'

export type EditorInlineAction = 'refine' | 'expand' | 'continue' | 'dialogue' | 'rewrite'

/** 局部改写可选附带的章节上下文；前后文窗口固定 800 字。 */
export const EDITOR_INLINE_CONTEXT_WINDOW_CHARS = 800

export interface EditorInlineContextOptions {
  includePreceding: boolean
  includeFollowing: boolean
  includeBlueprint: boolean
  includeGlobalGuidance: boolean
}

/** 渲染端按勾选解析后的附加材料；前后文也可由主进程按 document 切片重算。 */
export interface EditorInlineContextBundle {
  precedingText?: string
  followingText?: string
  chapterBlueprint?: string
  globalGuidance?: string
}

export interface EditorInlineInput {
  action: EditorInlineAction
  documentText: string
  from: number
  to: number
  selectedText: string
  /** Author rewrite guidance. Required for `rewrite`; omitted for preset actions. */
  editInstruction?: string
  /** 当前章号；勾选蓝图时用于加载本章蓝图。 */
  chapterNumber?: number
  contextOptions?: EditorInlineContextOptions
  /** 蓝图 / 全局要求等已解析文本；前后文以主进程按 document 切片为准。 */
  contextBundle?: EditorInlineContextBundle
}
export interface EditorInlineContext extends EditorInlineInput {
  kind: 'author-draft'
  documentHash: string
  writingLanguage: WritingLanguage
  template: PromptTemplate
}
export interface EditorInlineRecovery {
  view: MainGenerationRunView
  modelId: string
  context: EditorInlineContext
  sourceStatus: 'current' | 'conflict'
}
export interface EditorInlineGenerationChannels {
  'editor-inline:begin': { args: [{ input: EditorInlineInput; modelId: string; uiActionNonce: string }]; return: EditorInlineRecovery }
  'editor-inline:read-recovery': { args: [{ handle: MainGenerationRunHandle }]; return: EditorInlineRecovery }
  'editor-inline:execute': { args: [{ handle: MainGenerationRunHandle }]; return: MainGenerationExecuteReceipt }
  'editor-inline:cancel': { args: [{ handle: MainGenerationRunHandle }]; return: MainGenerationRunView }
}
