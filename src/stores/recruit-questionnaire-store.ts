import { create } from 'zustand'
import {
  createRecruitQuestionId,
  defaultRecruitQuestionnaire,
  readRecruitQuestionnaire,
  writeRecruitQuestionnaire,
  type RecruitQuestion,
  type RecruitQuestionnaire,
} from '../shared/recruit-questionnaire'

interface RecruitQuestionnaireState {
  /** 已保存的配置（运行时招新读这个） */
  saved: RecruitQuestionnaire
  /** 设置页草稿 */
  draft: RecruitQuestionnaire
  dirty: boolean
  savedFlash: boolean
  hydrate: () => void
  setDraftQuestions: (questions: RecruitQuestion[]) => void
  updateQuestion: (id: string, patch: Partial<Omit<RecruitQuestion, 'id'>>) => void
  addQuestion: () => void
  removeQuestion: (id: string) => void
  moveQuestion: (id: string, direction: -1 | 1) => void
  resetDraftToDefault: () => void
  discardDraft: () => void
  save: () => void
}

export const useRecruitQuestionnaireStore = create<RecruitQuestionnaireState>()((set, get) => ({
  saved: defaultRecruitQuestionnaire(),
  draft: defaultRecruitQuestionnaire(),
  dirty: false,
  savedFlash: false,

  hydrate: () => {
    const saved = readRecruitQuestionnaire()
    set({ saved, draft: structuredClone(saved), dirty: false })
  },

  setDraftQuestions: (questions) => {
    set(state => ({
      draft: { ...state.draft, questions },
      dirty: true,
      savedFlash: false,
    }))
  },

  updateQuestion: (id, patch) => {
    set(state => ({
      draft: {
        ...state.draft,
        questions: state.draft.questions.map(q => (q.id === id ? { ...q, ...patch, id: q.id } : q)),
      },
      dirty: true,
      savedFlash: false,
    }))
  },

  addQuestion: () => {
    set(state => ({
      draft: {
        ...state.draft,
        questions: [
          ...state.draft.questions,
          {
            id: createRecruitQuestionId(),
            field: 'personality',
            stem: '新问题',
            options: ['选项一', '选项二', '选项三'],
          },
        ],
      },
      dirty: true,
      savedFlash: false,
    }))
  },

  removeQuestion: (id) => {
    set(state => {
      if (state.draft.questions.length <= 1) return state
      return {
        draft: {
          ...state.draft,
          questions: state.draft.questions.filter(q => q.id !== id),
        },
        dirty: true,
        savedFlash: false,
      }
    })
  },

  moveQuestion: (id, direction) => {
    set(state => {
      const list = [...state.draft.questions]
      const index = list.findIndex(q => q.id === id)
      if (index < 0) return state
      const next = index + direction
      if (next < 0 || next >= list.length) return state
      const [item] = list.splice(index, 1)
      list.splice(next, 0, item!)
      return { draft: { ...state.draft, questions: list }, dirty: true, savedFlash: false }
    })
  },

  resetDraftToDefault: () => {
    set({ draft: defaultRecruitQuestionnaire(), dirty: true, savedFlash: false })
  },

  discardDraft: () => {
    set(state => ({ draft: structuredClone(state.saved), dirty: false, savedFlash: false }))
  },

  save: () => {
    const saved = writeRecruitQuestionnaire(get().draft)
    set({ saved, draft: structuredClone(saved), dirty: false, savedFlash: true })
  },
}))

/** 招新运行时读取已保存题库（未 hydrate 时直接读 storage）。 */
export function getSavedRecruitQuestionnaire(): RecruitQuestionnaire {
  const state = useRecruitQuestionnaireStore.getState()
  if (state.saved.questions.length > 0) return state.saved
  return readRecruitQuestionnaire()
}
