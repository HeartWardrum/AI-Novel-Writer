/** Soft-draft NSFW markers: A wraps softened passages; B unlocks only the inners. */

export const NSFW_OPEN = '⟦NSFW⟧'
export const NSFW_CLOSE = '⟦/NSFW⟧'

export const NSFW_CONTEXT_BEFORE_CHARS = 300
export const NSFW_CONTEXT_AFTER_CHARS = 150

export interface NsfwSpan {
  /** Inclusive index of open marker in full text. */
  start: number
  /** Exclusive index after close marker. */
  end: number
  /** Text between markers (no tags). */
  inner: string
  /** Up to NSFW_CONTEXT_BEFORE_CHARS before the open marker. */
  before: string
  /** Up to NSFW_CONTEXT_AFTER_CHARS after the close marker. */
  after: string
}

export class NsfwMarkerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NsfwMarkerError'
  }
}

/**
 * Find non-nested NSFW spans. Throws if markers are unpaired or nested.
 */
export function findNsfwSpans(text: string): NsfwSpan[] {
  const spans: NsfwSpan[] = []
  let cursor = 0
  while (cursor < text.length) {
    const openAt = text.indexOf(NSFW_OPEN, cursor)
    if (openAt < 0) {
      if (text.includes(NSFW_CLOSE, cursor)) {
        throw new NsfwMarkerError('Unpaired NSFW close marker')
      }
      break
    }
    const innerStart = openAt + NSFW_OPEN.length
    const closeAt = text.indexOf(NSFW_CLOSE, innerStart)
    if (closeAt < 0) throw new NsfwMarkerError('Unpaired NSFW open marker')
    const nestedOpen = text.indexOf(NSFW_OPEN, innerStart)
    if (nestedOpen >= 0 && nestedOpen < closeAt) {
      throw new NsfwMarkerError('Nested NSFW markers are not allowed')
    }
    const end = closeAt + NSFW_CLOSE.length
    spans.push({
      start: openAt,
      end,
      inner: text.slice(innerStart, closeAt),
      before: text.slice(Math.max(0, openAt - NSFW_CONTEXT_BEFORE_CHARS), openAt),
      after: text.slice(end, Math.min(text.length, end + NSFW_CONTEXT_AFTER_CHARS)),
    })
    cursor = end
  }
  return spans
}

export function hasNsfwMarkers(text: string): boolean {
  return text.includes(NSFW_OPEN) || text.includes(NSFW_CLOSE)
}

/** Unmarked segments in order (length = spanCount + 1). */
export function unmarkedSegments(text: string): string[] {
  const spans = findNsfwSpans(text)
  const parts: string[] = []
  let cursor = 0
  for (const span of spans) {
    parts.push(text.slice(cursor, span.start))
    cursor = span.end
  }
  parts.push(text.slice(cursor))
  return parts
}

/** Replace each span's full marked region with replacement text (no markers). */
export function replaceNsfwSpans(text: string, replacements: readonly string[]): string {
  const spans = findNsfwSpans(text)
  if (spans.length !== replacements.length) {
    throw new NsfwMarkerError(
      `Expected ${spans.length} replacements, got ${replacements.length}`,
    )
  }
  let result = ''
  let cursor = 0
  for (let i = 0; i < spans.length; i += 1) {
    const span = spans[i]
    result += text.slice(cursor, span.start)
    result += replacements[i]
    cursor = span.end
  }
  result += text.slice(cursor)
  return result
}

/** Remove markers, keep inner text. */
export function stripNsfwMarkers(text: string): string {
  const spans = findNsfwSpans(text)
  if (spans.length === 0) {
    if (hasNsfwMarkers(text)) throw new NsfwMarkerError('Malformed NSFW markers')
    return text
  }
  return replaceNsfwSpans(text, spans.map(span => span.inner))
}

/**
 * After unlock, `after` must have no markers and every unmarked segment from
 * `before` must appear in order as anchors (gaps between them are unlocked text).
 */
export function assertUnmarkedRegionsUnchanged(before: string, after: string): void {
  if (hasNsfwMarkers(after)) {
    throw new NsfwMarkerError('Unlocked text still contains NSFW markers')
  }
  const parts = unmarkedSegments(before)
  if (parts.length === 1) {
    if (after !== parts[0]) {
      throw new NsfwMarkerError('Text outside NSFW markers was changed')
    }
    return
  }
  let pos = 0
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]
    if (i === 0) {
      if (after.slice(0, part.length) !== part) {
        throw new NsfwMarkerError('Text outside NSFW markers was changed')
      }
      pos = part.length
      continue
    }
    if (i === parts.length - 1) {
      if (after.length - part.length < pos || after.slice(after.length - part.length) !== part) {
        throw new NsfwMarkerError('Text outside NSFW markers was changed')
      }
      return
    }
    const idx = after.indexOf(part, pos)
    if (idx < pos) {
      throw new NsfwMarkerError('Text outside NSFW markers was changed')
    }
    pos = idx + part.length
  }
}
