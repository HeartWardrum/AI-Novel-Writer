import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import type { ChapterBlueprint } from '../../../services/workflows/directory-workflow'
import {
  generationModelError,
  isGenerationModel,
  preferredGenerationModelId,
} from '../../../services/workflows/chapter-write-launch'
import {
  loadTaskGenerationModelId,
  saveTaskGenerationModelId,
} from '../../../services/workflows/task-generation-model-prefs'
import { createBlueprintNextGeneration } from '../../../services/blueprint-next-options-generation'
import type { BlueprintNextMode, BlueprintNextOption } from '../../../shared/blueprint-next-options'
import { writableFieldsFromOption } from '../../../shared/blueprint-next-options-pure'
import { useLLMStore } from '../../../stores/llm-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { captureProjectSession, isProjectSessionCurrent } from '../../project-session-gate'
import { Button } from '../../ui/Button'
import { DangerConfirm } from '../../ui/DangerConfirm'
import { InkDialog } from '../InkDialog'

const MODES: { id: BlueprintNextMode; zh: string; en: string }[] = [
  { id: 'function', zh: '按功能', en: 'By function' },
  { id: 'cost', zh: '按代价', en: 'By cost' },
  { id: 'pov', zh: '按视角', en: 'By POV' },
  { id: 'reverse', zh: '反向提问', en: 'Reverse' },
  { id: 'bad', zh: '坏选项', en: 'Bad options' },
]

function blueprintNextErrorMessage(error: unknown, text: (zh: string, en: string) => string): string {
  const raw = error instanceof Error ? error.message : String(error)
  if (/CANCELLED/u.test(raw)) return ''
  if (/GENERATION_BLUEPRINT_NEXT_BLUEPRINT_REQUIRED/u.test(raw)) {
    return text(
      '还没有可用的本章蓝图。请先保存这一章，并确认章号没有超过作品设定的总章数。',
      'This chapter has no saved blueprint yet. Save the chapter first, and make sure its number is within the book’s total chapter count.',
    )
  }
  return text('生成失败，请稍后重试。', 'Generation failed. Try again in a moment.')
}

function modeHint(mode: BlueprintNextMode, text: (zh: string, en: string) => string): string {
  switch (mode) {
    case 'function':
      return text('四条：信息推进 / 关系变化 / 蓄势加压 / 意外转折。', 'Four tracks: info / relationship / pressure / twist.')
    case 'cost':
      return text('每条必须写清主角付出什么代价。', 'Each option must name what the protagonist pays.')
    case 'pov':
      return text('同一局面：主角 / 对手 / 旁观者各一条。', 'Same situation from protagonist, antagonist, and bystander.')
    case 'reverse':
      return text('如果主角什么都不做，局面会怎么恶化。', 'How the situation worsens if the protagonist does nothing.')
    case 'bad':
      return text('看似合理但会伤害故事的方向，仅供排除，不能填入。', 'Plausible but harmful directions—for exclusion only; cannot fill the blueprint.')
  }
}

function trackLabel(option: BlueprintNextOption, text: (zh: string, en: string) => string): string | null {
  if (option.kind !== 'writable') return null
  if (option.functionRole === 'info') return text('信息推进', 'Info')
  if (option.functionRole === 'relationship') return text('关系变化', 'Relationship')
  if (option.functionRole === 'pressure') return text('蓄势加压', 'Pressure')
  if (option.functionRole === 'twist') return text('意外转折', 'Twist')
  if (option.pov === 'protagonist') return text('主角视角', 'Protagonist')
  if (option.pov === 'antagonist') return text('对手视角', 'Antagonist')
  if (option.pov === 'bystander') return text('旁观者视角', 'Bystander')
  return null
}

interface NextOptionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  blueprint: ChapterBlueprint
  onApply: (fields: {
    purpose: string
    keyEvents: string
    suspenseHook: string
    characters: string[]
  }) => void
}

/** 蓝图「接下来怎么写」参谋：五轨生成互不雷同选项；可写入选项填入蓝图，坏选项不可写入。 */
export default function NextOptionsDialog({ open, onOpenChange, blueprint, onApply }: NextOptionsDialogProps) {
  const text = useLocaleStore(s => s.text)
  const models = useLLMStore(s => s.models)
  const defaultModelId = useLLMStore(s => s.defaultModelId)
  const currentProject = useProjectStore(s => s.currentProject)
  const generationModels = models.filter(isGenerationModel)
  const [mode, setMode] = useState<BlueprintNextMode>('function')
  const [modelId, setModelId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [options, setOptions] = useState<BlueprintNextOption[]>([])
  const [pendingApply, setPendingApply] = useState<BlueprintNextOption | null>(null)
  const clientRef = useRef<ReturnType<typeof createBlueprintNextGeneration> | null>(null)

  const fallbackModelId = preferredGenerationModelId(models, defaultModelId)
  const selectedModelId = modelId ?? fallbackModelId
  const modelError = generationModelError(models, selectedModelId, text)

  useEffect(() => {
    if (!open) return
    setMode('function')
    setOptions([])
    setError(null)
    setPendingApply(null)
    setModelId(preferredGenerationModelId(models, defaultModelId))
    const session = captureProjectSession(currentProject)
    let disposed = false
    void loadTaskGenerationModelId(session, 'blueprint', models, defaultModelId).then(id => {
      if (!disposed && isProjectSessionCurrent(session)) setModelId(id)
    })
    return () => {
      disposed = true
      const client = clientRef.current
      clientRef.current = null
      if (client) {
        void client.cancel().catch(() => {})
        client.detach()
      }
      setBusy(false)
    }
  }, [open, currentProject, defaultModelId, models, blueprint.chapterNumber])

  const generate = async () => {
    const session = captureProjectSession(useProjectStore.getState().currentProject)
    if (!session || !selectedModelId || modelError) return
    const previous = clientRef.current
    clientRef.current = null
    if (previous) {
      void previous.cancel().catch(() => {})
      previous.detach()
    }
    setBusy(true)
    setError(null)
    setOptions([])
    const client = createBlueprintNextGeneration(session)
    clientRef.current = client
    try {
      await client.open({
        input: { chapterNumber: blueprint.chapterNumber, mode },
        modelId: selectedModelId,
        uiActionNonce: crypto.randomUUID(),
      })
      const recovery = await client.execute()
      if (!isProjectSessionCurrent(session)) return
      if (!recovery.options?.length) {
        setError(text('未生成有效选项，请重试。', 'No valid options were generated. Try again.'))
        return
      }
      setOptions(recovery.options)
      void saveTaskGenerationModelId(session, 'blueprint', selectedModelId)
    } catch (cause) {
      if (!isProjectSessionCurrent(session)) return
      const message = blueprintNextErrorMessage(cause, text)
      if (!message) return
      setError(message)
    } finally {
      if (clientRef.current === client) {
        client.detach()
        clientRef.current = null
      }
      setBusy(false)
    }
  }

  const cancelGenerate = () => {
    const client = clientRef.current
    if (!client) return
    void client.cancel().catch(() => {})
  }

  const needsOverwriteConfirm = Boolean(blueprint.purpose.trim() || blueprint.keyEvents.trim())

  const applyOption = (option: BlueprintNextOption) => {
    const fields = writableFieldsFromOption(option)
    if (!fields) return
    if (needsOverwriteConfirm) {
      setPendingApply(option)
      return
    }
    onApply(fields)
    onOpenChange(false)
  }

  const confirmApply = () => {
    if (!pendingApply) return
    const fields = writableFieldsFromOption(pendingApply)
    setPendingApply(null)
    if (!fields) return
    onApply(fields)
    onOpenChange(false)
  }

  return (
    <>
      <InkDialog
        open={open}
        onOpenChange={next => { if (!busy) onOpenChange(next) }}
        keepOnOutsideClick
        title={text('接下来怎么写', 'What to write next')}
        description={text(
          `为第 ${blueprint.chapterNumber} 章参谋互不雷同的方向。选中后写入蓝图字段，坏选项不能写入。`,
          `Advise non-redundant directions for chapter ${blueprint.chapterNumber}. Chosen options fill the blueprint; bad options cannot.`,
        )}
        footer={(
          <>
            {busy ? (
              <Button variant="secondary" onClick={cancelGenerate}>{text('取消生成', 'Cancel')}</Button>
            ) : (
              <Button variant="text" onClick={() => onOpenChange(false)}>{text('关闭', 'Close')}</Button>
            )}
            <Button
              variant="primary"
              disabled={busy || Boolean(modelError) || generationModels.length === 0}
              onClick={() => void generate()}
            >
              <Sparkles size={14} aria-hidden />
              {busy ? text('生成中…', 'Generating…') : text('生成选项', 'Generate options')}
            </Button>
          </>
        )}
      >
        <div className="stage-next-options">
          <div className="stage-next-modes" role="tablist" aria-label={text('参谋模式', 'Advisor mode')}>
            {MODES.map(item => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={mode === item.id}
                className="stage-next-mode"
                data-active={mode === item.id || undefined}
                disabled={busy}
                onClick={() => { setMode(item.id); setOptions([]); setError(null) }}
              >
                {text(item.zh, item.en)}
              </button>
            ))}
          </div>
          <p className="stage-next-hint">{modeHint(mode, text)}</p>
          <label className="stage-next-model">
            <span>{text('生成模型', 'Generation model')}</span>
            <select
              className="pi-input"
              value={selectedModelId ?? ''}
              disabled={busy || generationModels.length === 0}
              onChange={event => setModelId(event.target.value || null)}
            >
              <option value="" disabled>{text('选择模型', 'Choose a model')}</option>
              {generationModels.map(model => (
                <option key={model.id} value={model.id}>{model.name || model.modelName}</option>
              ))}
            </select>
          </label>
          {modelError && <p className="stage-plot-error" role="alert">{modelError}</p>}
          {error && <p className="stage-plot-error" role="alert">{error}</p>}
          {options.length > 0 && (
            <ul className="stage-next-list">
              {options.map((option, index) => {
                const track = trackLabel(option, text)
                return (
                  <li key={`${option.kind}:${option.label}:${index}`}>
                    <article className="stage-candidate" aria-label={option.label}>
                      <div className="stage-candidate-head">
                        <b>{option.label}</b>
                        {track && <span>{track}</span>}
                      </div>
                      {option.kind === 'writable' ? (
                        <>
                          <p>{option.rationale}</p>
                          {option.cost && (
                            <p className="stage-next-cost">
                              <strong>{text('代价', 'Cost')}：</strong>{option.cost}
                            </p>
                          )}
                          <p className="stage-next-preview">
                            <strong>{text('小目标', 'Goal')}：</strong>{option.purpose}
                          </p>
                          <div className="stage-candidate-foot">
                            <Button variant="secondary" size="sm" disabled={busy} onClick={() => applyOption(option)}>
                              {text('填入蓝图', 'Fill blueprint')}
                            </Button>
                          </div>
                        </>
                      ) : (
                        <p className="stage-next-bad">
                          <strong>{text('为何不好', 'Why it hurts')}：</strong>{option.whyBad}
                        </p>
                      )}
                    </article>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </InkDialog>
      <DangerConfirm
        open={pendingApply !== null}
        onOpenChange={openState => { if (!openState) setPendingApply(null) }}
        title={text('覆盖本章蓝图字段？', 'Overwrite this chapter’s blueprint fields?')}
        consequence={text(
          '将用所选方向替换当前的主角小目标、冲突与转折、悬念钩子与出场人物。标题、定位与作者微操指导不会改动。',
          'This replaces purpose, conflict, suspense hook, and cast. Title, role, and author guidance stay unchanged.',
        )}
        recoverability={text('未保存前仍可手动改回；已保存的内容需自行恢复。', 'You can edit back before saving; saved values need manual recovery.')}
        confirmLabel={text('填入蓝图', 'Fill blueprint')}
        cancelLabel={text('取消', 'Cancel')}
        onConfirm={confirmApply}
      />
    </>
  )
}
