import { useState } from 'react'
import { PLOT_OUTLINE_RESUME_ERROR_CODE } from '../../services/workflows/commands/architecture.command'
import { launchCreativeWorkflow } from '../../services/workflows/creative-workflow-launcher'
import { projectSessionContextFromProject, sameProjectPathKey, sameProjectSessionContext } from '../../shared/project-session-context'
import { navigate } from '../../stores/navigation/navigation-intents'
import { useProjectStore } from '../../stores/project-store'
import { useWorkflowStore, type WorkflowRun } from '../../stores/workflow-store'
import { toast } from '../ui/Toast'
import {
  normalizeWorkflowFailureCode,
  presentWorkflowFailure,
  type WorkflowFailurePresentation,
} from '../panels/ai-output-failure-presentation'
import {
  blueprintWritePrefill,
  chapterDefaultWordsTarget,
  chapterWriteFormFromPrefill,
  launchChapterWrite,
} from '../../services/workflows/chapter-write-launch'
import { saveTaskGenerationModelId, type TaskGenerationModelKey } from '../../services/workflows/task-generation-model-prefs'
import { createRefineOnlyWorkflow } from '../../services/workflows/chapter-workflow'
import { ipc } from '../../services/ipc-client'
import { isProjectSessionCurrent } from '../project-session-gate'

/** 运行侧页为一次失败的运行显示的内容：标题、原因、错误码，以及能接着做什么。 */
export interface RunFailure {
  title: string
  errorCode?: string
  presentation: WorkflowFailurePresentation
  /** 情节大纲生成被截断且已完成部分已保存：可以从断点续写。 */
  canResumeOutline: boolean
}

function chapterNumberFromRun(run: WorkflowRun): number | null {
  for (const key of run.resourceKeys ?? []) {
    const match = /^chapter:(\d+)$/u.exec(key)
    if (match) return Number(match[1])
  }
  return null
}

function taskKeyForRun(run: WorkflowRun): TaskGenerationModelKey | null {
  if (run.type === 'architecture_generation') return 'architecture'
  if (run.type === 'directory') return 'blueprint'
  if (run.type === 'config_generation') return 'setup'
  if (run.type === 'chapter_creation' || run.type === 'batch_generate') {
    if (run.chapterWordsTarget !== undefined) return 'writing'
    if (/修稿|Revise|审稿修复|Apply review/u.test(run.title)) return 'revise'
    return 'writing'
  }
  return null
}

export function runFailure(run: WorkflowRun): RunFailure {
  const failedStep = run.steps.find(step => step.status === 'failed')
  const currentStep = run.steps[run.currentStepIndex] ?? run.steps[0]
  const error = run.error || currentStep?.error
  return {
    title: run.title,
    errorCode: run.errorCode ?? failedStep?.errorCode,
    presentation: presentWorkflowFailure(
      normalizeWorkflowFailureCode(run.failureCode ?? currentStep?.failureCode, error),
      error,
      run.uiLocale,
      run.type === 'chapter_creation' && run.chapterWordsTarget !== undefined && !(currentStep?.result || '').trim(),
      run.promptBudgetReport ?? currentStep?.promptBudgetReport,
      failedStep?.generationActivity ?? currentStep?.generationActivity,
    ),
    canResumeOutline: run.errorCode === PLOT_OUTLINE_RESUME_ERROR_CODE || failedStep?.errorCode === PLOT_OUTLINE_RESUME_ERROR_CODE,
  }
}

/** 运行属于当前打开的这次项目会话；失败提示里的动作只对它生效。 */
export function isCurrentSessionRun(run: Pick<WorkflowRun, 'projectPath' | 'projectSession'>): boolean {
  const project = useProjectStore.getState().currentProject
  return sameProjectPathKey(run.projectPath, project?.path)
    && sameProjectSessionContext(run.projectSession, projectSessionContextFromProject(project))
}

export function openNovelConfigurationFor(run: WorkflowRun): void {
  if (isCurrentSessionRun(run)) navigate({ kind: 'stage', stage: 'setup' })
}

/** 从断点续写情节大纲：已完成部分已存为不完整大纲，这次让模型接着末尾写。 */
export function useResumePlotOutline(run: WorkflowRun) {
  const [resuming, setResuming] = useState(false)
  const resume = async () => {
    if (resuming || !run.projectSession || !isCurrentSessionRun(run)) return
    setResuming(true)
    try {
      await launchCreativeWorkflow({ workflow: 'generate_architecture', selectedSteps: ['synopsis'], resumeSynopsis: true }, run.projectSession)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      toast.error(run.uiLocale === 'en-US' ? `Failed to start the continuation: ${detail}` : `续写启动失败：${detail}`)
    } finally {
      setResuming(false)
    }
  }
  return { resuming, resume }
}

/**
 * 内容策略失败后换模型重试：写稿/直接修稿重新开跑；架构/蓝图/设定只记住模型并提示作者重新发起。
 */
export function useRetryWithModel(run: WorkflowRun) {
  const [retrying, setRetrying] = useState(false)
  const en = run.uiLocale === 'en-US'
  const retry = async (modelId: string) => {
    if (retrying || !modelId.trim() || !run.projectSession || !isCurrentSessionRun(run)) return
    setRetrying(true)
    const session = run.projectSession
    try {
      const task = taskKeyForRun(run)
      if (task) await saveTaskGenerationModelId(session, task, modelId)

      if (run.type === 'architecture_generation' || run.type === 'directory' || run.type === 'config_generation') {
        toast.info(en
          ? 'Model preference saved. Open the generate dialog again to retry.'
          : '已记住该模型。请重新打开生成对话框再试。')
        return
      }

      if (run.type === 'chapter_creation' && run.chapterWordsTarget !== undefined) {
        const chapterNumber = chapterNumberFromRun(run)
        if (!chapterNumber) throw new Error(en ? 'Could not find the chapter for this run.' : '找不到这次运行对应的章节。')
        const project = useProjectStore.getState().currentProject
        if (!project || !isProjectSessionCurrent(session)) return
        const blueprint = await ipc.invokeWithProjectSession(session, 'db:blueprint-get', chapterNumber, session.projectPath)
        if (!isProjectSessionCurrent(session)) return
        if (!blueprint) throw new Error(en ? 'Chapter blueprint is missing.' : '缺少本章蓝图。')
        const wordsPerChapter = project.novelConfig.wordsPerChapter
        const form = chapterWriteFormFromPrefill(
          { ...blueprintWritePrefill(blueprint), chapterNumber },
          chapterDefaultWordsTarget(wordsPerChapter),
        )
        const outcome = await launchChapterWrite({
          session,
          form,
          generationModelId: modelId,
          wordsPerChapter,
          ignoreFindingsOnce: true,
          locale: run.uiLocale,
        })
        if (!isProjectSessionCurrent(session)) return
        if (outcome.kind === 'started') {
          toast.info(en ? 'Retry started with the selected model.' : '已用所选模型重新开始写稿。')
          return
        }
        if (outcome.kind === 'stale') return
        throw new Error(outcome.kind === 'preflight'
          ? (en ? 'Consistency preflight still needs attention.' : '一致性预检仍需处理。')
          : outcome.message)
      }

      if (run.type === 'chapter_creation' && /修稿|Revise/u.test(run.title) && !/审稿修复|Apply review/u.test(run.title)) {
        const chapterNumber = chapterNumberFromRun(run)
        if (!chapterNumber) throw new Error(en ? 'Could not find the chapter for this run.' : '找不到这次运行对应的章节。')
        const latest = await ipc.invokeWithProjectSession(session, 'db:draft-get-latest', chapterNumber, session.projectPath)
        if (!isProjectSessionCurrent(session)) return
        if (!latest) throw new Error(en ? 'No draft found for this chapter.' : '本章没有可修的草稿。')
        const full = await ipc.invokeWithProjectSession(session, 'db:draft-get-full', latest.id, session.projectPath)
        if (!isProjectSessionCurrent(session)) return
        const body = full?.content
        if (!body) throw new Error(en ? 'Could not load the draft body.' : '无法读取草稿正文。')
        useWorkflowStore.getState().startWorkflow(createRefineOnlyWorkflow({
          projectPath: session.projectPath,
          chapterNumber,
          chapterTitle: latest.chapterTitle ?? `第 ${chapterNumber} 章`,
          draftPath: latest.filePath,
          draftContent: body,
          sourceDraft: {
            id: latest.id,
            chapterNumber,
            version: latest.version,
            status: latest.status,
            contentRevision: 0,
          },
          generationModelId: modelId,
        }, session), false)
        toast.info(en ? 'Retry started with the selected model.' : '已用所选模型重新开始修稿。')
        return
      }

      toast.info(en
        ? 'Model preference saved. Retry from the chapter actions with the new model.'
        : '已记住该模型。请从章节动作里用新模型再试。')
    } catch (error) {
      if (!isProjectSessionCurrent(session)) return
      const detail = error instanceof Error ? error.message : String(error)
      toast.error(en ? `Could not retry: ${detail}` : `换模重试失败：${detail}`)
    } finally {
      setRetrying(false)
    }
  }
  return { retrying, retry }
}
