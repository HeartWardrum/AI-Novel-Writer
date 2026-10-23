/**
 * 作品级文风滤镜（世界书里切换；作者对话注入短指令，不改 writingStyle 长文）。
 */

export const PROSE_TONE_IDS = [
  'default',
  'web-novel',
  'literary',
  'dialogue-dense',
  'oppressive',
] as const

export type ProseToneId = (typeof PROSE_TONE_IDS)[number]

export interface ProseTonePreset {
  id: ProseToneId
  /** 芯片上显示的短标签 */
  label: string
  /** 注入模型的短指令；default 为空 */
  instruction: string
}

export const PROSE_TONE_PRESETS: readonly ProseTonePreset[] = [
  {
    id: 'default',
    label: '默认',
    instruction: '',
  },
  {
    id: 'web-novel',
    label: '网文爽',
    instruction: [
      '调性：网文爽感。',
      '节奏偏快，段落短，冲突与兑现感要足；对话干脆，少空转抒情。',
      '用词偏口语、画面感强，章内推进明确。',
    ].join('\n'),
  },
  {
    id: 'literary',
    label: '正经沉稳',
    instruction: [
      '调性：正经沉稳。',
      '叙述克制、句式完整，少网文口头禅与夸张钩子。',
      '心理与氛围可细，但保持冷静、可信。',
    ].join('\n'),
  },
  {
    id: 'dialogue-dense',
    label: '对话密',
    instruction: [
      '调性：对话密。',
      '优先用对白推进信息与关系，减少大段旁白与景物堆砌。',
      '对白要有个性与潜台词，穿插必要的动作与反应即可。',
    ].join('\n'),
  },
  {
    id: 'oppressive',
    label: '压抑沉重',
    instruction: [
      '调性：压抑沉重。',
      '节奏偏慢，压迫感与不安感优先；少轻松玩笑与廉价爽点。',
      '用细节、留白与克制情绪营造沉重氛围。',
    ].join('\n'),
  },
] as const

const PRESET_BY_ID = new Map(PROSE_TONE_PRESETS.map(item => [item.id, item]))

export function isProseToneId(value: unknown): value is ProseToneId {
  return typeof value === 'string' && PRESET_BY_ID.has(value as ProseToneId)
}

export function normalizeProseToneId(value: unknown): ProseToneId {
  return isProseToneId(value) ? value : 'default'
}

export function getProseTonePreset(id: ProseToneId | unknown): ProseTonePreset {
  return PRESET_BY_ID.get(normalizeProseToneId(id)) ?? PROSE_TONE_PRESETS[0]!
}

/**
 * 拼装注入 system 的文风块；default 或空指令返回 null。
 * 边界：只改表达方式，不新增剧情事实。
 */
export function formatProseToneBlock(tone: ProseToneId | unknown): string | null {
  const preset = getProseTonePreset(tone)
  const instruction = preset.instruction.trim()
  if (!instruction || preset.id === 'default') return null
  return [
    '【本轮文风滤镜】',
    instruction,
    '【文风适用边界】',
    '- 文风仅用于选择表达方式，不是新增事实或事件要求；无需逐条强行兑现。',
    '- 作者明确事实与指导、实际前文、本章关键因果优先；不得为兑现文风增加场景、动作或事件。',
  ].join('\n')
}
