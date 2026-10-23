import { projectPathKey, sameProjectPathKey } from './project-session-context'

/** 新建作品时可点选的历史保存父目录（由最近作品路径推导）。 */
export interface RecentCreateParentOption {
  /** 用于向主进程证明「该父目录来自最近作品」的作品根路径 */
  projectPath: string
  /** 父目录规范化键（去重用） */
  parentKey: string
  /** 按钮上显示的短名 */
  label: string
}

/** 去掉尾部分隔符后取父目录；无父级时返回 null。 */
export function parentDirectoryOfProjectPath(projectPath: string): string | null {
  const trimmed = projectPath.trim().replace(/[/\\]+$/u, '')
  if (!trimmed) return null
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (slash <= 0) return null
  // Windows 盘符根如 C:\
  if (slash === 2 && /^[A-Za-z]:\\/u.test(trimmed.slice(0, 3))) {
    return trimmed.slice(0, 3)
  }
  const parent = trimmed.slice(0, slash)
  return parent || null
}

function basenameOfPath(directoryPath: string): string {
  const trimmed = directoryPath.replace(/[/\\]+$/u, '')
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (slash < 0) return trimmed
  // 盘符根
  if (slash <= 2 && /^[A-Za-z]:\\?$/u.test(trimmed)) return trimmed
  return trimmed.slice(slash + 1) || trimmed
}

/**
 * 从最近作品列表推出去重父目录选项（最近优先）。
 * `projectPath` 取该父目录下「最近一条」作品路径，供 grant IPC 校验。
 */
export function listRecentCreateParentOptions(
  recent: readonly { path: string }[],
  max = 8,
): RecentCreateParentOption[] {
  const options: RecentCreateParentOption[] = []
  const seen = new Set<string>()

  for (const item of recent) {
    const parent = parentDirectoryOfProjectPath(item.path)
    if (!parent) continue
    const key = projectPathKey(parent)
    if (!key || seen.has(key)) continue
    seen.add(key)
    options.push({
      projectPath: item.path,
      parentKey: key,
      label: basenameOfPath(parent),
    })
    if (options.length >= max) break
  }

  // 同名 basename 用父路径尾缀区分
  const labelCounts = new Map<string, number>()
  for (const option of options) {
    labelCounts.set(option.label, (labelCounts.get(option.label) ?? 0) + 1)
  }
  return options.map(option => {
    if ((labelCounts.get(option.label) ?? 0) <= 1) return option
    const parent = parentDirectoryOfProjectPath(option.projectPath)
    if (!parent) return option
    const trimmed = parent.replace(/[/\\]+$/u, '')
    const parts = trimmed.split(/[/\\]/u).filter(Boolean)
    const label = parts.length >= 2
      ? `${parts[parts.length - 2]}${trimmed.includes('\\') ? '\\' : '/'}${parts[parts.length - 1]}`
      : trimmed
    return { ...option, label }
  })
}

/** 判断两条路径是否视为同一父目录候选键。 */
export function sameCreateParentKey(left: string, right: string): boolean {
  return sameProjectPathKey(left, right)
}
