/** Formal roster name entry used for manuscript highlighting (no aliases). */
export interface CharacterNameEntry {
  characterId: string
  name: string
}

export interface CharacterNameMatch {
  from: number
  to: number
  name: string
  characterIds: readonly string[]
}

export interface CharacterNameIndex {
  /** Unique formal names, longest first. */
  readonly names: readonly string[]
  readonly idsByName: ReadonlyMap<string, readonly string[]>
}

const ASCII_NAME = /^[A-Za-z0-9_]+$/u
const WORD_CHAR = /[A-Za-z0-9_]/u

/** Build a longest-first index from formal roster names (aliases excluded). */
export function buildCharacterNameIndex(entries: readonly CharacterNameEntry[]): CharacterNameIndex {
  const idsByName = new Map<string, string[]>()
  for (const entry of entries) {
    const name = entry.name.trim()
    const characterId = entry.characterId?.trim()
    if (!name || !characterId) continue
    const list = idsByName.get(name)
    if (list) {
      if (!list.includes(characterId)) list.push(characterId)
    } else {
      idsByName.set(name, [characterId])
    }
  }
  const names = [...idsByName.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b))
  return { names, idsByName }
}

function hasAsciiWordBoundary(text: string, from: number, to: number): boolean {
  if (from > 0 && WORD_CHAR.test(text[from - 1]!)) return false
  if (to < text.length && WORD_CHAR.test(text[to]!)) return false
  return true
}

function matchesAt(text: string, index: number, name: string): boolean {
  if (!text.startsWith(name, index)) return false
  if (ASCII_NAME.test(name)) return hasAsciiWordBoundary(text, index, index + name.length)
  return true
}

/**
 * Scan `text` for non-overlapping formal-name matches.
 * Longer names win at each position; English/digit names require word boundaries.
 * `fromOffset` is added to every match's from/to (for document-absolute ranges).
 */
export function findCharacterNameMatches(
  text: string,
  index: CharacterNameIndex,
  fromOffset = 0,
): CharacterNameMatch[] {
  if (!text || index.names.length === 0) return []
  const matches: CharacterNameMatch[] = []
  let cursor = 0
  while (cursor < text.length) {
    let hit: CharacterNameMatch | null = null
    for (const name of index.names) {
      if (matchesAt(text, cursor, name)) {
        const ids = index.idsByName.get(name)
        if (!ids?.length) continue
        hit = {
          from: fromOffset + cursor,
          to: fromOffset + cursor + name.length,
          name,
          characterIds: ids,
        }
        break
      }
    }
    if (hit) {
      matches.push(hit)
      cursor += hit.name.length
    } else {
      cursor += 1
    }
  }
  return matches
}
