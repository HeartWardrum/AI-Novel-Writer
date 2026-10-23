/** 内置冒险预设（展示用；回合引擎尚未接入）。 */
export interface AdventurePreset {
  id: string
  title: string
  lede: string
  /** 写死的开场旁白，仅展示 */
  openingBeat: string
}

export const SHAN_HAI_YAO_PRESET: AdventurePreset = {
  id: 'shan-hai-yao',
  title: '山海经捉妖',
  lede: '你是一名新入门的山海巡录者。图鉴未满，妖踪未明——从最近的山径走起。',
  openingBeat:
    '晨雾还挂在南岭余脉的松针上。石阶尽头立着半截风化的兽首碑，碑阴刻着几个旧字：录异、勿妄喂。\n\n腰间空着的竹筒轻轻晃了一下——那是给你装「初遇之妖」的器物。远处林里传来不像鸟的一声啼鸣。',
}

export const ADVENTURE_PRESETS: readonly AdventurePreset[] = [SHAN_HAI_YAO_PRESET]

export function getAdventurePreset(id: string): AdventurePreset | undefined {
  return ADVENTURE_PRESETS.find(preset => preset.id === id)
}
