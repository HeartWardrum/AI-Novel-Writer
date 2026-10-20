import { isDeepStrictEqual } from 'node:util'
import type Database from 'better-sqlite3'
import { BlueprintRepository } from '../repositories/blueprint-repository'
import { textHash, type DurableGenerationRun } from '../repositories/generation-run-repository'
import type { GenerationTask } from '../../src/services/generation/generation-harness'
import { resolveWritingLanguage } from '../../src/shared/writing-language'
import type {
  BlueprintNextContext,
  BlueprintNextInput,
} from '../../src/shared/blueprint-next-options'
import {
  buildBlueprintNextTask,
  isBlueprintNextMode,
  parseBlueprintNextOptions,
  type BlueprintNextOption,
} from '../../src/shared/blueprint-next-options-pure'

const positive = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

const MAX_ARCH_CHARS = 2_400

function clip(value: string, max = MAX_ARCH_CHARS): string {
  const text = value.trim()
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

function summarizeBlueprint(row: {
  chapterNumber: number
  title: string
  role: string
  purpose: string
  keyEvents: string
  suspenseHook: string
  characters: string[]
}) {
  return {
    chapterNumber: row.chapterNumber,
    title: row.title,
    role: row.role,
    purpose: clip(row.purpose, 400),
    keyEvents: clip(row.keyEvents, 600),
    suspenseHook: clip(row.suspenseHook, 300),
    characters: row.characters.slice(0, 24),
  }
}

export function validateBlueprintNextInput(input: BlueprintNextInput): BlueprintNextInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !['chapterNumber', 'mode'].includes(key))
    || !positive(input.chapterNumber)
    || !isBlueprintNextMode(input.mode)) {
    throw new Error('GENERATION_BLUEPRINT_NEXT_INPUT_INVALID')
  }
  return { chapterNumber: input.chapterNumber, mode: input.mode }
}

export function captureBlueprintNextContext(
  db: Database.Database,
  input: BlueprintNextInput,
  scope: { projectId: string; epoch: string },
  key: string,
  previous?: BlueprintNextContext,
): BlueprintNextContext {
  const valid = validateBlueprintNextInput(input)
  if (!nonempty(scope.projectId) || !nonempty(scope.epoch) || !nonempty(key)
    || previous && (previous.projectId !== scope.projectId || previous.key !== key
      || !nonempty(previous.originEpoch) || !nonempty(previous.createdAt)
      || !isDeepStrictEqual(previous.input, valid))) {
    throw new Error('GENERATION_BLUEPRINT_NEXT_CONTEXT_INVALID')
  }
  const core = db.prepare("SELECT writing_language,total_chapters,premise,synopsis,global_guidance FROM project_core WHERE id='main'").get() as {
    writing_language: string
    total_chapters: number
    premise: string
    synopsis: string
    global_guidance: string
  } | undefined
  if (!core || !positive(core.total_chapters)) throw new Error('GENERATION_BLUEPRINT_NEXT_PROJECT_REQUIRED')
  const blueprints = BlueprintRepository.getAll(db)
  const blueprint = blueprints.find(row => row.chapterNumber === valid.chapterNumber)
  if (!blueprint || valid.chapterNumber > core.total_chapters) throw new Error('GENERATION_BLUEPRINT_NEXT_BLUEPRINT_REQUIRED')
  const neighbors = blueprints
    .filter(row => Math.abs(row.chapterNumber - valid.chapterNumber) <= 2 && row.chapterNumber !== valid.chapterNumber)
    .sort((left, right) => left.chapterNumber - right.chapterNumber)
    .map(summarizeBlueprint)
  return {
    projectId: scope.projectId,
    originEpoch: previous?.originEpoch ?? scope.epoch,
    key,
    createdAt: previous?.createdAt ?? new Date().toISOString(),
    input: valid,
    writingLanguage: resolveWritingLanguage(core.writing_language),
    totalChapters: core.total_chapters,
    blueprint,
    neighbors,
    architecture: {
      premise: clip(core.premise ?? ''),
      synopsis: clip(core.synopsis ?? ''),
      globalGuidance: clip(core.global_guidance ?? ''),
    },
  }
}

export function blueprintNextTask(context: BlueprintNextContext): GenerationTask {
  return buildBlueprintNextTask({
    writingLanguage: context.writingLanguage,
    mode: context.input.mode,
    totalChapters: context.totalChapters,
    blueprint: summarizeBlueprint(context.blueprint),
    neighbors: context.neighbors,
    architecture: context.architecture,
  })
}

export function readBlueprintNextContext(run: DurableGenerationRun): BlueprintNextContext {
  const manifest = run.binding.sourceManifest
  const context = manifest.blueprintNextContext as BlueprintNextContext | undefined
  if (!context || !context.input
    || manifest.operation !== 'blueprint-next-options'
    || textHash(JSON.stringify(context)) !== manifest.blueprintNextContextHash
    || context.projectId !== run.binding.projectId
    || !nonempty(context.originEpoch) || manifest.blueprintNextOriginEpoch !== context.originEpoch
    || !nonempty(context.key) || !nonempty(context.createdAt)
    || manifest.blueprintNextKey !== context.key
    || !isDeepStrictEqual(manifest.blueprintNextInput, context.input)) {
    throw new Error('GENERATION_BLUEPRINT_NEXT_CONTEXT_INVALID')
  }
  validateBlueprintNextInput(context.input)
  if (!positive(context.totalChapters) || context.blueprint?.chapterNumber !== context.input.chapterNumber) {
    throw new Error('GENERATION_BLUEPRINT_NEXT_CONTEXT_INVALID')
  }
  if (!manifest.blueprintNextTask || textHash(JSON.stringify(manifest.blueprintNextTask)) !== manifest.blueprintNextTaskHash
    || !isDeepStrictEqual(manifest.blueprintNextTask, blueprintNextTask(context))) {
    throw new Error('GENERATION_BLUEPRINT_NEXT_TASK_INVALID')
  }
  return structuredClone(context)
}

export function readBlueprintNextTask(run: DurableGenerationRun): GenerationTask {
  readBlueprintNextContext(run)
  return structuredClone(run.binding.sourceManifest.blueprintNextTask as GenerationTask)
}

export function parseBlueprintNextResult(run: DurableGenerationRun, text: string): BlueprintNextOption[] {
  const context = readBlueprintNextContext(run)
  return parseBlueprintNextOptions(text, context.input.mode)
}
