import { useState } from 'react'
import { countDraftUnits } from '../../shared/draft-units'
import { chapterLabel } from '../../shared/chapter-label'
import { parseResourceUri, resourceWriteAllowed } from '../../shared/project-paths'
import { projectSessionContextFromProject } from '../../shared/project-session-context'
import { ipc } from '../../services/ipc-client'
import { useAgentStore } from '../../stores/agent-store'
import { useEditorStore } from '../../stores/editor-store'
import { useLocaleStore } from '../../stores/locale-store'
import { useProjectStore } from '../../stores/project-store'
import { captureProjectSession, isProjectSessionCurrent, isProjectSessionPath } from '../project-session-gate'
import { Button } from '../ui/Button'
import { toast } from '../ui/Toast'

/** 从当前会话取最后一条已完成的助手消息正文。 */
function lastAssistantProse(): string | null {
  const messages = useAgentStore.getState().getActiveConversation()?.messages ?? []
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message.role !== 'assistant' || message.streaming) continue
    const prose = message.content.trim()
    if (prose) return prose
  }
  return null
}

/**
 * 右栏「写本章」：把当前对话末条助手正文直接写入中栏当前章（不调用模型、不启工作流）。
 */
export default function ChatWriteActions() {
  const text = useLocaleStore(s => s.text)
  const project = useProjectStore(s => s.currentProject)
  const tab = useEditorStore(s => s.tabs.find(candidate => candidate.id === s.activeTabId) ?? null)
  const chapterNumber = tab?.type === 'chapter' ? tab.chapterNumber : undefined
  const [busy, setBusy] = useState(false)

  if (!project || chapterNumber === undefined) return null
  const session = projectSessionContextFromProject(project)
  if (!session) return null

  const write = async () => {
    if (busy) return
    const prose = lastAssistantProse()
    if (!prose) {
      toast.error(text('对话里还没有可写入的助手正文', 'No assistant prose in the chat to write yet'))
      return
    }
    if (!tab?.filePath || tab.draftId === undefined) {
      toast.error(text('请先打开本章草稿再写入正文', 'Open this chapter draft before writing prose into it'))
      return
    }
    if (tab.draftStatus === 'finalized' || tab.draftStatus === 'archived') {
      toast.error(text('当前稿已定稿或归档，不能直接写入', 'This draft is finalized or archived and cannot be overwritten'))
      return
    }
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, tab.projectKey ?? '')) {
      toast.error(text('项目会话无效，请重新打开项目', 'Project session is invalid. Reopen the project.'))
      return
    }

    setBusy(true)
    try {
      useEditorStore.getState().updateTabContent(tab.id, prose)
      const resource = parseResourceUri(tab.filePath)
      if (!resourceWriteAllowed(tab.filePath) || resource?.kind !== 'draft') {
        throw new Error(text('当前章节资源不可写', 'The current chapter resource is not writable'))
      }
      const snapshot = {
        content: prose,
        contentRevision: (useEditorStore.getState().tabs.find(item => item.id === tab.id)?.contentRevision ?? 0),
      }
      const result = await ipc.invokeWithProjectSession(
        projectSession,
        'db:draft-update-content',
        resource.id,
        snapshot.content,
        countDraftUnits(snapshot.content),
        projectSession.projectPath,
      )
      if (!result.success) throw new Error(result.error || text('草稿保存失败', 'Could not save the draft'))
      if (!isProjectSessionCurrent(projectSession)) return
      useEditorStore.getState().settleTabSave(tab.id, snapshot)
      toast.success(text(
        `已将对话正文写入第 ${chapterNumber} 章`,
        `Wrote chat prose into chapter ${chapterNumber}`,
      ))
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      toast.error(text(`无法写入第 ${chapterNumber} 章：${reason}`, `Could not write chapter ${chapterNumber}: ${reason}`))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="workbench-chat-actions" role="group" aria-label={text('本章写作', 'Chapter writing')}>
      <span className="workbench-chat-actions-label">{chapterLabel(chapterNumber, text)}</span>
      <Button variant="secondary" size="sm" disabled={busy} onClick={() => void write()}>
        {busy ? text('写入中…', 'Writing…') : text('写本章', 'Write chapter')}
      </Button>
    </div>
  )
}
