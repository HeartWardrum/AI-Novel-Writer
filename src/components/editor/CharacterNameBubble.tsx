import { useMemo, useState } from 'react'
import { getCharacterRoleLabels } from '../../shared/character-role'
import { useCharacterStore } from '../../stores/character-store'
import { useLocaleStore } from '../../stores/locale-store'
import { openBuiltinEditor } from '../../stores/open-builtin-editor'
import { Button } from '../ui/Button'
import { useCharacterAvatar } from './use-character-avatar'

const SUMMARY_MAX = 80

function truncateSummary(value: string | undefined): string {
  const text = value?.trim() ?? ''
  if (!text) return ''
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX)}…` : text
}

function shortId(characterId: string): string {
  return characterId.length <= 8 ? characterId : characterId.slice(-6)
}

export interface CharacterNameBubbleProps {
  name: string
  characterIds: readonly string[]
  top: number
  left: number
  inkThemeName: string
  onClose: () => void
}

function ProfileBody({
  characterId,
  showBack,
  onBack,
  onClose,
}: {
  characterId: string
  showBack: boolean
  onBack: () => void
  onClose: () => void
}) {
  const text = useLocaleStore(s => s.text)
  const locale = useLocaleStore(s => s.locale)
  const card = useCharacterStore(s => s.characters.find(item => item.characterId === characterId))
  const avatar = useCharacterAvatar(characterId, false)
  const role = card ? getCharacterRoleLabels(card.role) : null
  const appearance = truncateSummary(card?.appearance)
  const personality = truncateSummary(card?.personality)
  const initial = (card?.name?.trim() || '?').slice(0, 1)

  const openCast = () => {
    useCharacterStore.getState().setSelectedId(characterId)
    openBuiltinEditor('character-editor', text('角色名单', 'Cast'), 'character')
    onClose()
  }

  if (!card) {
    return (
      <div className="cm-namebubble-body">
        <p className="cm-namebubble-empty">{text('找不到这张角色卡。', 'This character card could not be found.')}</p>
        <div className="cm-namebubble-actions">
          {showBack && <Button variant="text" size="sm" onClick={onBack}>{text('返回', 'Back')}</Button>}
          <Button variant="text" size="sm" onClick={onClose}>{text('关闭', 'Close')}</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="cm-namebubble-body">
      <div className="cm-namebubble-head">
        {avatar.avatarUrl
          ? <img className="cm-namebubble-avatar" src={avatar.avatarUrl} alt="" />
          : <span className="cm-namebubble-avatar cm-namebubble-avatar-fallback" aria-hidden>{initial}</span>}
        <div className="cm-namebubble-titles">
          <strong>{card.name}</strong>
          {role && <span>{locale === 'en-US' ? role.enUS : role.zhCN}</span>}
        </div>
      </div>
      {(appearance || personality) && (
        <dl className="cm-namebubble-fields">
          {appearance && (
            <>
              <dt>{text('外貌', 'Appearance')}</dt>
              <dd>{appearance}</dd>
            </>
          )}
          {personality && (
            <>
              <dt>{text('性格', 'Personality')}</dt>
              <dd>{personality}</dd>
            </>
          )}
        </dl>
      )}
      <div className="cm-namebubble-actions">
        {showBack && <Button variant="text" size="sm" onClick={onBack}>{text('返回', 'Back')}</Button>}
        <Button variant="text" size="sm" onClick={openCast}>{text('打开角色页', 'Open in Cast')}</Button>
      </div>
    </div>
  )
}

/**
 * 正文人名点击后的迷你档案：单人直接展示；同名多人先选候选。
 */
export default function CharacterNameBubble({
  name,
  characterIds,
  top,
  left,
  inkThemeName,
  onClose,
}: CharacterNameBubbleProps) {
  const text = useLocaleStore(s => s.text)
  const locale = useLocaleStore(s => s.locale)
  const characters = useCharacterStore(s => s.characters)
  const uniqueIds = useMemo(() => [...new Set(characterIds.filter(Boolean))], [characterIds])
  const [pickedId, setPickedId] = useState<string | null>(uniqueIds.length === 1 ? uniqueIds[0]! : null)

  const candidates = useMemo(() => uniqueIds.map(id => {
    const card = characters.find(item => item.characterId === id)
    const role = card ? getCharacterRoleLabels(card.role) : null
    return {
      characterId: id,
      label: card?.name?.trim() || name,
      role: role ? (locale === 'en-US' ? role.enUS : role.zhCN) : '',
      suffix: shortId(id),
    }
  }), [uniqueIds, characters, name, locale])

  return (
    <div
      role="dialog"
      aria-label={text('角色速览', 'Character preview')}
      className="paper-ink cm-namebubble"
      data-theme={inkThemeName}
      style={{ top, left }}
      onMouseDown={event => event.preventDefault()}
    >
      {pickedId ? (
        <ProfileBody
          characterId={pickedId}
          showBack={uniqueIds.length > 1}
          onBack={() => setPickedId(null)}
          onClose={onClose}
        />
      ) : (
        <div className="cm-namebubble-body">
          <p className="cm-namebubble-pick-title">
            {text(`「${name}」对应多名角色`, `“${name}” matches more than one character`)}
          </p>
          <ul className="cm-namebubble-candidates">
            {candidates.map(item => (
              <li key={item.characterId}>
                <button type="button" className="cm-namebubble-candidate" onClick={() => setPickedId(item.characterId)}>
                  <strong>{item.label}</strong>
                  <span>{item.role}{item.role ? ' · ' : ''}{item.suffix}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="cm-namebubble-actions">
            <Button variant="text" size="sm" onClick={onClose}>{text('关闭', 'Close')}</Button>
          </div>
        </div>
      )}
    </div>
  )
}
