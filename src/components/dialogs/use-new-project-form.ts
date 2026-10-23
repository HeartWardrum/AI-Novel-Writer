import { useEffect, useMemo, useState } from 'react'
import type { ProjectDirectoryGrant } from '../../shared/ipc-channels'
import {
  listRecentCreateParentOptions,
  type RecentCreateParentOption,
} from '../../shared/recent-create-parents'
import { useProjectStore } from '../../stores/project-store'
import { ipc } from '../../services/ipc-client'
import { useLocaleStore } from '../../stores/locale-store'
import { toast } from '../ui/Toast'

/** 新建作品：名称与保存位置，创建后其余设定在设定页填写。 */
export function useNewProjectForm(open: boolean, onClose: () => void) {
  const createProject = useProjectStore((s) => s.createProject)
  const recentProjects = useProjectStore((s) => s.recentProjects)
  const locale = useLocaleStore(s => s.locale)
  const text = useLocaleStore(s => s.text)
  const [name, setName] = useState('')
  const [path, setPath] = useState<ProjectDirectoryGrant | null>(null)
  const [selectedParentKey, setSelectedParentKey] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const recentParents: RecentCreateParentOption[] = useMemo(
    () => listRecentCreateParentOptions(recentProjects, 8),
    [recentProjects],
  )

  useEffect(() => {
    if (!open) return
    let mounted = true
    Promise.resolve().then(() => {
      if (mounted) {
        setName('')
        setPath(null)
        setSelectedParentKey(null)
      }
    })
    return () => { mounted = false }
  }, [open])

  const selectFolder = async () => {
    const selected = await ipc.invoke('dialog:select-folder', 'project-create')
    if (selected) {
      setPath(selected)
      setSelectedParentKey(null)
    }
  }

  const selectRecentParent = async (option: RecentCreateParentOption) => {
    try {
      const grant = await ipc.invoke('dialog:grant-create-parent', option.projectPath)
      setPath(grant)
      setSelectedParentKey(option.parentKey)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : text('无法使用该历史位置', '无法使用该历史位置'))
    }
  }

  /** 类型与目标读者留空，在设定页填写。 */
  const create = async () => {
    if (!name.trim() || !path) return
    setCreating(true)
    const success = await createProject({
      name: name.trim(),
      parentGrantId: path.grantId,
      genre: '',
      targetAudience: '',
      writingLanguage: locale,
    })
    setPath(null)
    setSelectedParentKey(null)
    setCreating(false)
    if (success) onClose()
  }

  return {
    name,
    setName,
    path,
    selectFolder,
    selectRecentParent,
    recentParents,
    selectedParentKey,
    creating,
    canCreate: !creating && Boolean(name.trim()) && path !== null,
    create,
  }
}
