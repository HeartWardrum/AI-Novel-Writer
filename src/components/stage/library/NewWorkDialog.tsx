import { useId } from 'react'
import { FolderOpen } from 'lucide-react'
import { useLayoutStore } from '../../../stores/layout-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useNewProjectForm } from '../../dialogs/use-new-project-form'
import { Button } from '../../ui/Button'
import { InkDialog } from '../InkDialog'

/** 新建作品：起名、选保存位置。创建后打开作品，落在设定页。 */
export default function NewWorkDialog() {
  const text = useLocaleStore(s => s.text)
  const open = useLayoutStore(s => s.newProjectOpen)
  const close = useLayoutStore(s => s.closeNewProject)
  const form = useNewProjectForm(open, close)
  const nameId = useId()
  const folderId = useId()
  const reasonId = useId()
  const reason = form.creating ? null
    : !form.path ? text('先选保存位置，作品会建在那个文件夹里。', '先选保存位置，作品会建在那个文件夹里。')
      : !form.name.trim() ? text('先起个作品名。', '先起个作品名。') : null

  return (
    <InkDialog
      open={open}
      onOpenChange={next => { if (!next) close() }}
      title={text('新建作品', '新建作品')}
      description={text('起个名字，选好保存位置。类型、篇幅这些在下一步的设定里填。', '起个名字，选好保存位置。类型、篇幅这些在下一步的设定里填。')}
      footer={(
        <>
          <Button variant="secondary" onClick={close}>{text('取消', '取消')}</Button>
          <Button variant="primary" disabled={!form.canCreate} aria-describedby={reason ? reasonId : undefined} onClick={() => void form.create()}>
            {form.creating ? text('正在创建…', '正在创建…') : text('创建作品', '创建作品')}
          </Button>
        </>
      )}
    >
      <div className="pi-field">
        <label htmlFor={nameId}>{text('作品名', '作品名')}</label>
        <input
          id={nameId}
          className="pi-input"
          value={form.name}
          autoFocus
          autoComplete="off"
          placeholder={text('如：雨夜列车', '如：雨夜列车')}
          onChange={event => form.setName(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing && form.canCreate) void form.create()
          }}
        />
      </div>
      <div className="pi-field">
        <label htmlFor={folderId}>{text('保存位置', '保存位置')}</label>
        <div className="stage-field-row">
          <input
            id={folderId}
            className="pi-input"
            value={form.path?.displayName ?? ''}
            readOnly
            placeholder={text('选择一个文件夹，作品会建在它里面', '选择一个文件夹，作品会建在它里面')}
          />
          <Button variant="secondary" onClick={() => void form.selectFolder()}>
            <FolderOpen size={14} aria-hidden="true" />
            {text('选择', '选择')}
          </Button>
        </div>
        {form.recentParents.length > 0 && (
          <div className="stage-new-work-recent" data-testid="new-work-recent-parents">
            <p className="stage-dialog-hint">
              {text('最近用过', '最近用过')}
            </p>
            <div className="stage-new-work-recent-chips" role="group" aria-label={text('最近用过的保存位置', '最近用过的保存位置')}>
              {form.recentParents.map(option => {
                const active = form.selectedParentKey === option.parentKey
                return (
                  <button
                    key={option.parentKey}
                    type="button"
                    className="stage-new-work-recent-chip"
                    data-active={active || undefined}
                    data-testid={`recent-parent-${option.parentKey}`}
                    aria-pressed={active}
                    disabled={form.creating}
                    onClick={() => { void form.selectRecentParent(option) }}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
      {reason && <p id={reasonId} className="stage-dialog-hint">{reason}</p>}
    </InkDialog>
  )
}
