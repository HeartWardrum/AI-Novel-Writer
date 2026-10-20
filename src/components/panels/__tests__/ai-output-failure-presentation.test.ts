import { describe, expect, it } from 'vitest'

import { presentWorkflowFailure } from '../ai-output-failure-presentation'

const promptBudgetReport = (sectionName: string) => ({
  totalUtf8Bytes: 13_000,
  limitUtf8Bytes: 12_000,
  reservedOutputTokens: 8_192,
  sections: [
    { sectionName, utf8Bytes: 12_000 },
    { sectionName: 'prompt-overhead', utf8Bytes: 1_000 },
  ],
  modelId: 'model-a',
  errorCode: 'PROMPT_BUDGET_EXHAUSTED' as const,
})

describe('AI output failure presentation', () => {
  it('maps a structured content-filter code to a clear Chinese chapter-draft failure', () => {
    expect(presentWorkflowFailure('content_filter', 'provider-safe message', 'zh-CN', true)).toEqual({
      heading: '正文生成被内容策略拦截',
      reason: '模型的内容安全策略拦截了这次输出（常见于审核 / content_filter）。',
      persistence: '本次未保存草稿或正文章节。',
      guidance: '可换用内容策略更宽松的模型后重试；只影响下一次运行，不会改你的全局默认模型。',
      action: 'retry-with-model',
      actionLabel: '换模型重试',
    })
  })

  it('maps a structured content-filter code to an English explanation instead of exposing it as prose', () => {
    expect(presentWorkflowFailure('content_filter', 'provider-safe message', 'en-US', true)).toEqual({
      heading: 'Draft generation was blocked by the content policy',
      reason: 'The model safety policy filtered this output (often content_filter / moderation).',
      persistence: 'No draft or manuscript chapter was saved.',
      guidance: 'Retry with a model whose content policy better fits your intended text. This only affects the next run; your global default model is unchanged.',
      action: 'retry-with-model',
      actionLabel: 'Retry with another model',
    })
  })

  it('maps a legacy finish:content_filter string to the content-policy presentation', () => {
    const presentation = presentWorkflowFailure(undefined, 'finish:content_filter', 'zh-CN', true)

    expect(presentation.heading).toBe('正文生成被内容策略拦截')
    expect(presentation.action).toBe('retry-with-model')
  })

  it('offers Novel configuration only for a project-configuration contributor', () => {
    expect(presentWorkflowFailure(
      'prompt_budget_exhausted',
      'safe report summary',
      'en-US',
      false,
      promptBudgetReport('global-guidance'),
    )).toMatchObject({
      action: 'open-novel-config',
      guidance: 'Shorten the listed project configuration fields in Novel configuration, then try again.',
    })
  })

  it('keeps a step-guidance overflow away from the unrelated Novel configuration action', () => {
    const presentation = presentWorkflowFailure(
      'prompt_budget_exhausted',
      'safe report summary',
      'zh-CN',
      false,
      promptBudgetReport('step-guidance'),
    )

    expect(presentation).toMatchObject({
      guidance: '请返回该生成步骤，缩短步骤指导后重试。',
    })
    expect(presentation).not.toHaveProperty('action')
  })

  it.each([
    ['architecture', 'Shorten the related story-architecture content or reduce this generation scope, then try again.'],
    ['validated-prefix', 'Reduce this structured batch and try again; validated content will not be silently truncated.'],
    ['repair-contract', 'The structured repair contract cannot be safely edited in the interface. Reduce this task scope; if the problem persists, report the result code.'],
    ['repair-candidate', 'Shorten the structured content being repaired, or split this import or generation into smaller batches, then try again.'],
  ])('provides safe non-configuration guidance for %s without an unrelated action', (sectionName, guidance) => {
    const presentation = presentWorkflowFailure(
      'prompt_budget_exhausted',
      'safe report summary',
      'en-US',
      false,
      promptBudgetReport(sectionName),
    )

    expect(presentation.guidance).toBe(guidance)
    expect(presentation).not.toHaveProperty('action')
  })
})


it.each([
  ['UND_ERR_BODY_TIMEOUT', '读取响应流超时'],
  ['UND_ERR_SOCKET', '响应连接中断'],
  [undefined, '具体原因未知'],
] as const)('explains safe review transport diagnostics without inferring the upstream cause: %s', (causeCode, reason) => {
  const presentation = presentWorkflowFailure(undefined, 'generic provider failure', 'zh-CN', false, undefined, {
    operation: 'review-chapter', diagnostics: { startedAt: 0, elapsedMs: 478000, firstResponseMs: 3000, lastResponseMs: 171000,
      lastOutputMs: null, phase: 'stream', endReason: 'failed', visibleEvents: 0, reasoningEvents: 0, ...(causeCode ? { causeCode } : {}) },
  })
  expect(presentation.reason).toContain(reason)
  expect(presentation.persistence).toBe('本次未保存完整审稿报告，原稿保留。')
  expect(presentation.guidance).toContain('重新审稿会重新调用模型')
})
