/**
 * 旧三栏舞台工作台（左材料栏 / 中内容 / 右对话）。
 * 产品默认改为聊天优先外壳后不再挂载本组件；保留文件便于调试或日后挂回。
 */
import MaterialsRail from './MaterialsRail'
import WorkbenchRight from './WorkbenchRight'
import StageWorkspace from './StageWorkspace'
import type { ResourcePage, WorkStage } from '../../stores/navigation/navigation-intents'
import type { StageSheet } from '../../stores/navigation/stage-store'
import type { ChapterRow, StageLocation, StageStatus } from '../../stores/navigation/stage-progress'

export interface ClassicStageWorkbenchProps {
  library: boolean
  focus: boolean
  settingsOpen: boolean
  stages: readonly StageStatus[]
  chapters: readonly ChapterRow[]
  location: StageLocation | null
  rightRail: 'chat' | 'run'
  sheet: StageSheet | null
  onStage: (stage: WorkStage) => void
  onChapter: (chapterNumber: number) => void
  onResource: (page: ResourcePage) => void
  onSettings: () => void
  onRightRail: (mode: 'chat' | 'run') => void
}

/** @deprecated 聊天优先外壳旁路保留；产品路径请用 ChatWorkbench。 */
export default function ClassicStageWorkbench({
  library,
  focus,
  settingsOpen,
  stages,
  chapters,
  location,
  rightRail,
  sheet,
  onStage,
  onChapter,
  onResource,
  onSettings,
  onRightRail,
}: ClassicStageWorkbenchProps) {
  return (
    <div className="stage-frame" data-workbench={!library || undefined} data-shell-presentation="stage">
      {!library && !focus && (
        <MaterialsRail
          stages={stages}
          chapters={chapters}
          location={location}
          settingsOpen={settingsOpen}
          onStage={onStage}
          onChapter={onChapter}
          onResource={onResource}
          onSettings={onSettings}
        />
      )}
      <StageWorkspace library={library} focus={focus} />
      {!library && (
        <WorkbenchRight
          mode={rightRail}
          onMode={onRightRail}
          sheet={sheet}
          focus={focus}
        />
      )}
    </div>
  )
}
