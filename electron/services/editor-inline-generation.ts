import { textHash, type DurableGenerationRun } from '../repositories/generation-run-repository'
import type {
  EditorInlineContextBundle,
  EditorInlineContextOptions,
  EditorInlineInput,
  EditorInlineContext,
} from '../../src/shared/editor-inline-generation'
import { EDITOR_INLINE_CONTEXT_WINDOW_CHARS } from '../../src/shared/editor-inline-generation'
import type { WritingLanguage } from '../../src/shared/writing-language'
import { composePromptSystemRole, type PromptTemplate } from '../../src/services/builtin-prompt-templates'
import { renderPrompt } from '../../src/shared/render-prompt'
import type { GenerationTask } from '../../src/services/generation/generation-harness'
import { isDeepStrictEqual } from 'node:util'

const presetInstructions = {
  refine: ['润色这部分，使语言自然、具体并增强场景表现力。', 'Refine this passage for natural, specific language and stronger scene craft.'],
  expand: ['扩写这部分，补充与情节有关的动作、感官和环境细节。', 'Expand this passage with plot-relevant action, sensory detail, and setting.'],
  continue: ['根据现有因果和人物动机，自然续写接下来的情节。', 'Continue naturally from the established causality and character motivation.'],
  dialogue: ['将这部分改写为有区分度、能推动冲突的自然对话。', 'Rewrite this passage as distinct, natural dialogue that advances the conflict.'],
} as const

const PRESET_ACTIONS = new Set(Object.keys(presetInstructions))
const INPUT_KEYS = new Set([
  'action', 'documentText', 'from', 'to', 'selectedText', 'editInstruction',
  'chapterNumber', 'contextOptions', 'contextBundle',
])
const OPTION_KEYS = new Set([
  'includePreceding', 'includeFollowing', 'includeBlueprint', 'includeGlobalGuidance',
])
const BUNDLE_KEYS = new Set([
  'precedingText', 'followingText', 'chapterBlueprint', 'globalGuidance',
])
const MAX_EDIT_INSTRUCTION_BYTES = 32 * 1024
const MAX_BUNDLE_FIELD_CHARS = 12_000

function editInstructionFor(context: EditorInlineContext): string {
  if (context.action === 'rewrite') {
    const guidance = context.editInstruction?.trim()
    if (!guidance) throw new Error('GENERATION_EDITOR_INPUT_INVALID')
    return context.writingLanguage === 'en-US'
      ? `Rewrite the selected prose according to these author requirements:\n${guidance}`
      : `按以下要求局部重写选中正文：\n${guidance}`
  }
  return presetInstructions[context.action][context.writingLanguage === 'en-US' ? 1 : 0]
}

function sliceWindow(text: string, start: number, end: number): string {
  return text.slice(Math.max(0, start), Math.min(text.length, end))
}

function deriveAdjacentBundle(
  input: Pick<EditorInlineInput, 'documentText' | 'from' | 'to'>,
  options: EditorInlineContextOptions | undefined,
): Pick<EditorInlineContextBundle, 'precedingText' | 'followingText'> {
  const window = EDITOR_INLINE_CONTEXT_WINDOW_CHARS
  return {
    ...(options?.includePreceding
      ? { precedingText: sliceWindow(input.documentText, input.from - window, input.from) }
      : {}),
    ...(options?.includeFollowing
      ? { followingText: sliceWindow(input.documentText, input.to, input.to + window) }
      : {}),
  }
}

function normalizeOptions(value: unknown): EditorInlineContextOptions | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !OPTION_KEYS.has(key))) throw new Error('GENERATION_EDITOR_INPUT_INVALID')
  const source = value as Record<string, unknown>
  for (const key of OPTION_KEYS) {
    if (typeof source[key] !== 'boolean') throw new Error('GENERATION_EDITOR_INPUT_INVALID')
  }
  return {
    includePreceding: source.includePreceding as boolean,
    includeFollowing: source.includeFollowing as boolean,
    includeBlueprint: source.includeBlueprint as boolean,
    includeGlobalGuidance: source.includeGlobalGuidance as boolean,
  }
}

function normalizeBundleField(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error('GENERATION_EDITOR_INPUT_INVALID')
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_BUNDLE_FIELD_CHARS) throw new Error('GENERATION_EDITOR_INPUT_INVALID')
  return trimmed
}

function normalizeBundle(
  value: unknown,
  options: EditorInlineContextOptions | undefined,
): EditorInlineContextBundle | undefined {
  if (value === undefined) {
    return options ? {} : undefined
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !BUNDLE_KEYS.has(key))) throw new Error('GENERATION_EDITOR_INPUT_INVALID')
  const source = value as Record<string, unknown>
  const chapterBlueprint = normalizeBundleField(source.chapterBlueprint)
  const globalGuidance = normalizeBundleField(source.globalGuidance)
  if (chapterBlueprint && !options?.includeBlueprint) throw new Error('GENERATION_EDITOR_INPUT_INVALID')
  if (globalGuidance && !options?.includeGlobalGuidance) throw new Error('GENERATION_EDITOR_INPUT_INVALID')
  if (!options?.includeBlueprint && chapterBlueprint) throw new Error('GENERATION_EDITOR_INPUT_INVALID')
  const bundle: EditorInlineContextBundle = {
    ...(chapterBlueprint ? { chapterBlueprint } : {}),
    ...(globalGuidance ? { globalGuidance } : {}),
  }
  return bundle
}

function inputSnapshot(input: EditorInlineInput): EditorInlineInput {
  const options = input.contextOptions
  const adjacent = deriveAdjacentBundle(input, options)
  const bundle = input.contextBundle
    ? {
        ...adjacent,
        ...(options?.includeBlueprint && input.contextBundle.chapterBlueprint
          ? { chapterBlueprint: input.contextBundle.chapterBlueprint }
          : {}),
        ...(options?.includeGlobalGuidance && input.contextBundle.globalGuidance
          ? { globalGuidance: input.contextBundle.globalGuidance }
          : {}),
      }
    : options ? adjacent : undefined
  const base = {
    action: input.action,
    documentText: input.documentText,
    from: input.from,
    to: input.to,
    selectedText: input.selectedText,
    ...(typeof input.chapterNumber === 'number' ? { chapterNumber: input.chapterNumber } : {}),
    ...(options ? { contextOptions: { ...options } } : {}),
    ...(bundle && Object.keys(bundle).length > 0 ? { contextBundle: bundle } : options ? { contextBundle: adjacent } : {}),
  } as EditorInlineInput
  return input.action === 'rewrite'
    ? { ...base, action: 'rewrite', editInstruction: input.editInstruction! }
    : base
}

export function validateEditorInlineInput(input: EditorInlineInput): EditorInlineInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !INPUT_KEYS.has(key))
    || typeof input.documentText !== 'string' || typeof input.selectedText !== 'string'
    || !Number.isSafeInteger(input.from) || !Number.isSafeInteger(input.to) || input.from < 0 || input.to <= input.from
    || input.to > input.documentText.length || input.documentText.slice(input.from, input.to) !== input.selectedText
    || Buffer.byteLength(input.documentText, 'utf8') > 8 * 1024 * 1024) throw new Error('GENERATION_EDITOR_INPUT_INVALID')
  if (input.chapterNumber !== undefined
    && (!Number.isSafeInteger(input.chapterNumber) || input.chapterNumber < 1)) {
    throw new Error('GENERATION_EDITOR_INPUT_INVALID')
  }
  const contextOptions = normalizeOptions(input.contextOptions)
  const authorBundle = normalizeBundle(input.contextBundle, contextOptions)
  const adjacent = deriveAdjacentBundle(input, contextOptions)
  const contextBundle: EditorInlineContextBundle | undefined = contextOptions
    ? {
        ...adjacent,
        ...(contextOptions.includeBlueprint && authorBundle?.chapterBlueprint
          ? { chapterBlueprint: authorBundle.chapterBlueprint }
          : {}),
        ...(contextOptions.includeGlobalGuidance && authorBundle?.globalGuidance
          ? { globalGuidance: authorBundle.globalGuidance }
          : {}),
      }
    : undefined

  if (input.action === 'rewrite') {
    if (typeof input.editInstruction !== 'string') throw new Error('GENERATION_EDITOR_INPUT_INVALID')
    const editInstruction = input.editInstruction.trim()
    if (!editInstruction || Buffer.byteLength(input.editInstruction, 'utf8') > MAX_EDIT_INSTRUCTION_BYTES) {
      throw new Error('GENERATION_EDITOR_INPUT_INVALID')
    }
    return structuredClone({
      action: 'rewrite' as const,
      documentText: input.documentText,
      from: input.from,
      to: input.to,
      selectedText: input.selectedText,
      editInstruction,
      ...(typeof input.chapterNumber === 'number' ? { chapterNumber: input.chapterNumber } : {}),
      ...(contextOptions ? { contextOptions } : {}),
      ...(contextBundle ? { contextBundle } : {}),
    })
  }
  if (!PRESET_ACTIONS.has(input.action) || input.editInstruction !== undefined) throw new Error('GENERATION_EDITOR_INPUT_INVALID')
  if (contextOptions || authorBundle || input.chapterNumber !== undefined) {
    throw new Error('GENERATION_EDITOR_INPUT_INVALID')
  }
  return structuredClone({
    action: input.action,
    documentText: input.documentText,
    from: input.from,
    to: input.to,
    selectedText: input.selectedText,
  })
}
export function buildEditorInlineContext(input: EditorInlineInput, writingLanguage: WritingLanguage, template: PromptTemplate): EditorInlineContext {
  const valid = validateEditorInlineInput(input)
  if (template.key !== 'edit_selected_text' || typeof template.content !== 'string') throw new Error('GENERATION_EDITOR_TEMPLATE_INVALID')
  return { ...valid, kind: 'author-draft', documentHash: textHash(valid.documentText), writingLanguage, template: structuredClone(template) }
}
export function readEditorInlineContext(run: DurableGenerationRun): EditorInlineContext {
  const context = run.binding.sourceManifest.editorInlineContext as EditorInlineContext | undefined
  if (run.binding.sourceManifest.operation !== 'editor-inline' || !context
    || textHash(JSON.stringify(context)) !== run.binding.sourceManifest.editorInlineContextHash
    || textHash(context.documentText) !== context.documentHash) throw new Error('GENERATION_EDITOR_CONTEXT_INVALID')
  const input = validateEditorInlineInput(run.binding.sourceManifest.editorInlineInput as EditorInlineInput)
  if (!isDeepStrictEqual(input, inputSnapshot(context))) throw new Error('GENERATION_EDITOR_CONTEXT_INVALID')
  return structuredClone(context)
}
export function readEditorInlineTask(run: DurableGenerationRun): GenerationTask {
  readEditorInlineContext(run)
  const task = run.binding.sourceManifest.editorInlineTask as GenerationTask | undefined
  if (!task || textHash(JSON.stringify(task)) !== run.binding.sourceManifest.editorInlineTaskHash) throw new Error('GENERATION_EDITOR_TASK_INVALID')
  return structuredClone(task)
}
export function editorInlineTask(context: EditorInlineContext): GenerationTask {
  const { template, writingLanguage, contextBundle } = context
  return { purpose: `editor-ai-${context.action}`, reasoningStage: context.action === 'refine' ? 'review' : 'drafting', output: 'visible-text', messages: [
    { role: 'system', content: composePromptSystemRole(template, writingLanguage) },
    { role: 'user', content: renderPrompt(template, {
      edit_instruction: editInstructionFor(context),
      selected_text: context.selectedText,
      preceding_text: contextBundle?.precedingText ?? '',
      following_text: contextBundle?.followingText ?? '',
      chapter_blueprint: contextBundle?.chapterBlueprint ?? '',
      global_guidance: contextBundle?.globalGuidance ?? '',
    }, writingLanguage) },
  ] }
}
