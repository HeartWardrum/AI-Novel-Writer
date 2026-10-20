import { ipc } from '../../../services/ipc-client'
import type { ProjectSessionContext } from '../../../shared/ipc-channels'
import { useCharacterStore } from '../../../stores/character-store'
import { useReferenceFloatStore } from '../../../stores/reference-float-store'
import { isProjectSessionCurrent } from '../../project-session-gate'

function objectUrlFromBase64(base64: string, mime: string): string {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return URL.createObjectURL(new Blob([bytes], { type: mime }))
}

/**
 * Open floating reference windows for this chapter's cast portraits / avatars.
 * Windows stay above the writing shell (ReferenceFloatLayer).
 */
export async function openWritingReferences(options: {
  session: ProjectSessionContext
  chapterNumber: number
  characterNames: readonly string[]
}): Promise<{ opened: number }> {
  const { session, chapterNumber, characterNames } = options
  const open = useReferenceFloatStore.getState().open
  let opened = 0

  const cards = useCharacterStore.getState().characters
  const names = new Set(characterNames.map(name => name.trim()).filter(Boolean))
  const matched = cards.filter(card => card.characterId && names.has(card.name.trim()))

  for (const card of matched) {
    if (!isProjectSessionCurrent(session)) return { opened }
    const characterId = card.characterId!
    try {
      const portraits = await ipc.invokeWithProjectSession(session, 'character-portrait:list', characterId)
      if (!isProjectSessionCurrent(session)) return { opened }
      if (portraits.success && portraits.portraits.length > 0) {
        for (const portrait of portraits.portraits) {
          open({
            kind: 'character',
            subjectId: `${characterId}:${portrait.portraitId}`,
            title: card.name,
            imageUrl: objectUrlFromBase64(portrait.base64, portrait.mime),
            mime: portrait.mime,
            chapterNumber,
          })
          opened += 1
        }
        continue
      }
      const avatars = await ipc.invokeWithProjectSession(session, 'character-avatar:read-batch', [characterId])
      if (!isProjectSessionCurrent(session)) return { opened }
      const avatar = avatars.success ? avatars.avatars[0] : undefined
      if (avatar) {
        open({
          kind: 'character',
          subjectId: characterId,
          title: card.name,
          imageUrl: objectUrlFromBase64(avatar.base64, avatar.mime),
          mime: avatar.mime,
          chapterNumber,
        })
        opened += 1
      }
    } catch {
      /* Skip one cast member; keep opening others. */
    }
  }

  return { opened }
}
