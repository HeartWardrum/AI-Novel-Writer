import { describe, expect, it } from 'vitest'
import { startWorkflowTool } from '../start-workflow.tool'
import { createAgentExecutionContext } from '../project-context'

describe('start_workflow retired drafting pipelines', () => {
  it.each(['generate_draft', 'review', 'refine'] as const)(
    'refuses %s so chat-shell authors are not pulled into old chapter pipelines',
    async (workflow) => {
      const result = await startWorkflowTool.execute(
        { workflow, chapter_number: 1 },
        createAgentExecutionContext(),
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('流水线已停用')
      expect(result.error).toContain('对话')
    },
  )
})
