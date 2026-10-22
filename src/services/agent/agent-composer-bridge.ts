/** 输入框与工具栏之间传递当前草稿（续写本章取半句指导）。 */

type ComposerApi = {
  getText: () => string
  clearText: () => void
}

let api: ComposerApi | null = null

export function registerAgentComposer(next: ComposerApi): () => void {
  api = next
  return () => {
    if (api === next) api = null
  }
}

/** 取出并清空当前输入，供「续写本章」一并带上。 */
export function takeAgentComposerHint(): string {
  const text = api?.getText().trim() ?? ''
  api?.clearText()
  return text
}
