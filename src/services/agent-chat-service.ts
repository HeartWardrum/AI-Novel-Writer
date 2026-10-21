import type { ProjectSessionContext } from '../shared/ipc-channels'
import type {
  AgentChatLoadResult,
  PersistedAgentConversation,
} from '../shared/agent-chat'
import { ipc } from './ipc-client'

export async function loadAgentChat(session: ProjectSessionContext): Promise<AgentChatLoadResult> {
  return ipc.invokeWithProjectSession(session, 'agent-chat:load', session.projectPath)
}

export async function upsertAgentConversation(
  session: ProjectSessionContext,
  conversation: PersistedAgentConversation,
): Promise<PersistedAgentConversation> {
  const result = await ipc.invokeWithProjectSession(
    session,
    'agent-chat:upsert',
    conversation,
    session.projectPath,
  )
  if (!result.success || !result.conversation) {
    throw new Error(result.error || 'AGENT_CHAT_UPSERT_FAILED')
  }
  return result.conversation
}

export async function deleteAgentConversation(
  session: ProjectSessionContext,
  conversationId: string,
): Promise<void> {
  const result = await ipc.invokeWithProjectSession(
    session,
    'agent-chat:delete',
    conversationId,
    session.projectPath,
  )
  if (!result.success) throw new Error(result.error || 'AGENT_CHAT_DELETE_FAILED')
}

export async function setActiveAgentConversation(
  session: ProjectSessionContext,
  activeConversationId: string | null,
): Promise<void> {
  const result = await ipc.invokeWithProjectSession(
    session,
    'agent-chat:set-active',
    activeConversationId,
    session.projectPath,
  )
  if (!result.success) throw new Error(result.error || 'AGENT_CHAT_SET_ACTIVE_FAILED')
}

export async function clearAgentChat(session: ProjectSessionContext): Promise<void> {
  const result = await ipc.invokeWithProjectSession(
    session,
    'agent-chat:clear',
    session.projectPath,
  )
  if (!result.success) throw new Error(result.error || 'AGENT_CHAT_CLEAR_FAILED')
}
