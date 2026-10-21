/**
 * 单条消息渲染组件（升级版）
 *
 * 支持三种渲染模式：
 * - 用户消息：右对齐气泡
 * - 助手消息：左侧 Markdown 风格渲染
 * - Tool 调用：ToolCallBlock / ConfirmCard / ArtifactCard
 */
import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import type { AgentMessage as AgentMessageType, AgentRequestDebug } from '../../../stores/agent-store'
import { useLocaleStore } from '../../../stores/locale-store'
import MarkdownContent, { StreamingCursor } from '../../ui/MarkdownContent'
import ToolCallBlock from './ToolCallBlock'
import ConfirmCard from './ConfirmCard'
import ArtifactCard from './ArtifactCard'
import '../../../styles/agent-tools.css'

interface Props {
  message: AgentMessageType
}

function RequestDebugPanel({ debug }: { debug: AgentRequestDebug }) {
  const text = useLocaleStore(state => state.text)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const metaParts = [
    `${text('模型', '模型')}: ${debug.modelId}`,
    `${text('历史', '历史')}: ${debug.meta.historyCount}`,
    `purpose: ${debug.meta.purpose}`,
    `stage: ${debug.meta.reasoningStage}`,
  ]
  if (debug.meta.creativeStrategy) {
    metaParts.push(`strategy: ${debug.meta.creativeStrategy}`)
  }

  const copyDebug = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(debug, null, 2))
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  return (
    <details className="my-2 rounded border border-[var(--color-border)] px-2 py-1">
      <summary className="cursor-pointer text-[0.7rem] font-medium text-[var(--color-text-secondary)]">
        {text('本次请求上下文', '本次请求上下文')}
      </summary>
      <div className="mt-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[0.68rem] leading-relaxed text-[var(--color-text-muted)]">
            {metaParts.join(' · ')}
          </p>
          <button
            type="button"
            className="rounded px-1.5 py-0.5 text-[0.68rem]"
            style={{
              color: 'var(--color-text-secondary)',
              background: 'var(--color-hover)',
              border: '1px solid var(--color-border)',
            }}
            onClick={() => void copyDebug()}
          >
            {copyState === 'copied' ? text('已复制', '已复制') : text('复制', '复制')}
          </button>
          {copyState === 'failed' && (
            <span role="alert" className="text-[0.68rem] text-[var(--color-text-muted)]">
              {text('复制失败', '复制失败')}
            </span>
          )}
        </div>
        {debug.messages.map((msg, index) => (
          <div key={`${msg.role}-${index}`} className="space-y-0.5">
            <p className="text-[0.68rem] font-medium text-[var(--color-text-secondary)]">
              [{msg.role}] · {msg.content.length} {text('字', '字')}
            </p>
            <pre
              className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded px-2 py-1 text-[0.68rem] leading-relaxed"
              style={{
                background: 'var(--color-hover)',
                color: 'var(--color-text-muted)',
                border: '1px solid var(--color-border)',
              }}
            >
              {msg.content}
            </pre>
          </div>
        ))}
      </div>
    </details>
  )
}

export default function AgentMessage({ message }: Props) {
  const { role, content, streaming, toolCalls, artifacts, requestDebug } = message
  const text = useLocaleStore(state => state.text)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }
  const copyButton = (
    <>
      <button
        type="button"
        aria-label={text('复制消息', 'Copy message')}
        title={copyState === 'copied'
          ? text('已复制', 'Copied')
          : text('复制消息', 'Copy message')}
        disabled={!content || streaming}
        onClick={() => void copyMessage()}
        className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 disabled:cursor-not-allowed disabled:opacity-0"
        style={{ color: 'var(--color-text-muted)', background: 'var(--color-hover)' }}
      >
        {copyState === 'copied' ? <Check size={13} /> : <Copy size={13} />}
      </button>
      {copyState === 'failed' && <span role="alert" className="sr-only">{text('无法复制这条消息', 'Could not copy this message')}</span>}
    </>
  )

  if (role === 'user') {
    return (
      <div className="group relative flex justify-end mb-2">
        <div
          className="max-w-[88%] px-3 py-2 rounded-2xl text-xs leading-relaxed break-words whitespace-pre-wrap"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)',
            color: 'var(--color-text)',
          }}
        >
          {content}
        </div>
        {copyButton}
      </div>
    )
  }

  // 助手消息
  return (
    <div className="group relative flex justify-start mb-2">
      <div
        className="max-w-full text-xs leading-relaxed break-words w-full"
        style={{ color: 'var(--color-text)' }}
      >
        {/* 文本内容 */}
        {content ? (
          <MarkdownContent content={content} streaming={streaming} />
        ) : streaming ? (
          <span className="inline-flex items-center h-4">
            <StreamingCursor />
          </span>
        ) : null}

        {/* Tool 调用区块列表 */}
        {toolCalls && toolCalls.length > 0 && (
          <div className="mt-2">
            {toolCalls.map(tc => (
              tc.status === 'waiting_confirm' ? (
                <ConfirmCard key={tc.id} toolCall={tc} />
              ) : (
                <ToolCallBlock key={tc.id} toolCall={tc} />
              )
            ))}
          </div>
        )}

        {/* 产物卡片列表 */}
        {artifacts && artifacts.length > 0 && (
          <div className="mt-2">
            {artifacts.map((a, i) => (
              <ArtifactCard key={`artifact-${i}`} artifact={a} />
            ))}
          </div>
        )}

        {requestDebug ? <RequestDebugPanel debug={requestDebug} /> : null}
      </div>
      {copyButton}
    </div>
  )
}
