import { formatResourceUri } from '../../../shared/project-paths'
import { countDraftUnits } from '../../../shared/draft-units'
import { NsfwMarkerError } from '../../../shared/nsfw-soft-markers'
import {
  buildNsfwUnlockSpanPrompt,
  unlockNsfwTextSequentially,
} from '../../../shared/nsfw-unlock-apply'
import { buildNsfwScaleNotes } from '../../../shared/sanitize-chapter-info-for-soft-draft'
import {
  projectSessionContextFromProject,
  sameProjectSessionContext,
} from '../../../shared/project-session-context'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'
import {
  requireWorkflowProjectSession,
  workflowUiText,
} from '../workflow-project-session'
import type { FrozenDraftSourceIdentity } from '../chapter-workflow'
import {
  BaseWorkflowCommand,
  type CommandExecuteParams,
  type WorkflowGenerationRuntimeDependencies,
} from './base-command'

export interface NsfwUnlockCommandParams {
  draftPath: string
  draftContent: string
  sourceDraft: FrozenDraftSourceIdentity
  chapterNumber: number
  chapterTitle: string
  /** Full-scale blueprint notes for B; may be empty if not frozen from soft draft. */
  scaleNotes?: string
}

/**
 * Unlock ⟦NSFW⟧…⟦/NSFW⟧ spans via model B and save a new rewrite draft version.
 * Soft draft is left untouched for rollback.
 */
export class NsfwUnlockCommand extends BaseWorkflowCommand<string> {
  constructor(
    private readonly params: NsfwUnlockCommandParams,
    generationDependencies?: WorkflowGenerationRuntimeDependencies,
  ) {
    super(generationDependencies)
  }

  async execute(params: CommandExecuteParams): Promise<string> {
    // Span unlock is a bounded text job; it does not own a main draft composition run.
    return this.executeWithGenerationRuntime(
      'text',
      params,
      () => this.executeWithinGeneration(params),
    )
  }

  private async executeWithinGeneration({
    context,
    callbacks,
  }: CommandExecuteParams): Promise<string> {
    const text = (zh: string, en: string) => workflowUiText(context, zh, en)
    const projectSession = requireWorkflowProjectSession(context)
    const expectedProjectPath = context.projectPath
    const project = useProjectStore.getState().currentProject
    if (
      !project
      || !sameProjectSessionContext(
        projectSession,
        projectSessionContextFromProject(project),
      )
    ) {
      throw new Error(text(
        '当前项目已切换，NSFW 化已停止',
        'The project changed, so NSFW unlock was stopped.',
      ))
    }

    const softText = this.params.draftContent
    let scaleNotes = this.params.scaleNotes?.trim() ?? ''
    if (!scaleNotes) {
      const fromContext = typeof context.data.nsfwScaleNotes === 'string'
        ? context.data.nsfwScaleNotes.trim()
        : ''
      scaleNotes = fromContext
    }
    if (!scaleNotes) {
      scaleNotes = buildNsfwScaleNotes({
        chapterNumber: this.params.chapterNumber,
        title: this.params.chapterTitle,
        role: '',
        purpose: '',
        characters: [],
        keyEvents: '',
      })
    }

    callbacks.log(text('正在按标记逐块 NSFW 化…', 'Unlocking NSFW markers span by span…'))
    callbacks.setProgress(5)

    let unlocked: string
    try {
      unlocked = await unlockNsfwTextSequentially(
        softText,
        scaleNotes,
        async request => {
          this.assertNotCancelled(context)
          const { system, user } = buildNsfwUnlockSpanPrompt(request)
          callbacks.log(text(
            `  解锁第 ${request.index + 1}/${request.total} 块…`,
            `  Unlocking span ${request.index + 1}/${request.total}…`,
          ))
          callbacks.setProgress(10 + Math.floor((request.index / request.total) * 70))
          return this.callLLM(
            user,
            system,
            callbacks,
            { purpose: 'nsfw_unlock_span', writingSkillStage: 'drafting' },
            context,
          )
        },
      )
    } catch (error) {
      if (error instanceof NsfwMarkerError) {
        const message = error.message.includes('没有可解锁')
          ? text('没有可解锁的标记', 'No NSFW markers to unlock.')
          : text(
            `NSFW 标记校验失败：${error.message}`,
            `NSFW marker check failed: ${error.message}`,
          )
        throw new Error(message)
      }
      throw error
    }

    this.assertNotCancelled(context)
    callbacks.setProgress(85)
    callbacks.replaceText?.(unlocked)

    const nextVersion: number = await ipc.invokeWithProjectSession(
      projectSession,
      'db:draft-next-version',
      this.params.chapterNumber,
      expectedProjectPath,
    )
    this.assertNotCancelled(context)

    const saved = await ipc.invokeWithProjectSession(projectSession, 'db:draft-create', {
      chapterNumber: this.params.chapterNumber,
      version: nextVersion,
      source: 'rewrite',
      content: unlocked,
      wordCount: countDraftUnits(unlocked),
    }, expectedProjectPath)

    if (!saved.success || !saved.id) {
      throw new Error(
        ('error' in saved ? String(saved.error) : '')
          || text('NSFW 化草稿保存失败', 'Failed to save the unlocked draft.'),
      )
    }

    const pseudoPath = formatResourceUri({ kind: 'draft', id: saved.id })
    context.data.draft = unlocked
    context.data.draftContent = unlocked
    context.data.draftPath = pseudoPath
    context.data.draftId = saved.id
    context.data.draftVersion = nextVersion
    context.data.chapterNumber = this.params.chapterNumber

    try {
      await useProjectStore.getState().refreshFileTree(expectedProjectPath, undefined, projectSession)
      const { useDraftStore } = await import('../../../stores/draft-store')
      await useDraftStore.getState().loadAllDrafts(expectedProjectPath, projectSession)
    } catch { /* ignore refresh failures */ }

    try {
      if (!sameProjectSessionContext(
        projectSession,
        projectSessionContextFromProject(useProjectStore.getState().currentProject),
      )) {
        throw new Error(text(
          '当前项目已切换，已拒绝打开新草稿',
          'The project changed, so opening the new draft was refused.',
        ))
      }
      const { useEditorStore } = await import('../../../stores/editor-store')
      useEditorStore.getState().openFile({
        id: pseudoPath,
        name: text(
          `第${this.params.chapterNumber}章 ${this.params.chapterTitle} v${nextVersion}`,
          `Chapter ${this.params.chapterNumber} ${this.params.chapterTitle} v${nextVersion}`,
        ),
        type: 'chapter',
        filePath: pseudoPath,
        content: unlocked,
        savedContent: unlocked,
        projectKey: expectedProjectPath,
      })
    } catch { /* ignore open failures */ }

    callbacks.setProgress(100)
    callbacks.log(text(
      `NSFW 化完成，已保存为草稿 v${nextVersion}（软版保留）`,
      `NSFW unlock complete; saved as draft v${nextVersion} (soft draft kept)`,
    ))
    return unlocked
  }
}
