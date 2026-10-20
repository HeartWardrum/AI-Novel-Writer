import { Facet, RangeSetBuilder, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import {
  buildCharacterNameIndex,
  findCharacterNameMatches,
  type CharacterNameEntry,
  type CharacterNameIndex,
} from '../../shared/character-name-match'

export type CharacterNameActivate = (info: {
  name: string
  characterIds: readonly string[]
  rect: DOMRect
}) => void

const emptyIndex: CharacterNameIndex = Object.freeze({
  names: Object.freeze([] as string[]),
  idsByName: new Map(),
})

export const characterNameIndexFacet = Facet.define<CharacterNameIndex, CharacterNameIndex>({
  combine: values => values[values.length - 1] ?? emptyIndex,
})

export const characterNameActivateFacet = Facet.define<CharacterNameActivate | null, CharacterNameActivate | null>({
  combine: values => values.find(value => value != null) ?? null,
})

function buildDecorations(view: EditorView): DecorationSet {
  const index = view.state.facet(characterNameIndexFacet)
  if (index.names.length === 0) return Decoration.none
  const builder = new RangeSetBuilder<Decoration>()
  const matches = view.visibleRanges.flatMap(({ from, to }) =>
    findCharacterNameMatches(view.state.doc.sliceString(from, to), index, from))
  matches.sort((a, b) => a.from - b.from || a.to - b.to)
  for (const match of matches) {
    builder.add(match.from, match.to, Decoration.mark({
      class: 'cm-character-name',
      attributes: { 'data-character-name': match.name },
    }))
  }
  return builder.finish()
}

const characterNamePlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view)
  }

  update(update: ViewUpdate) {
    if (
      update.docChanged
      || update.viewportChanged
      || update.startState.facet(characterNameIndexFacet) !== update.state.facet(characterNameIndexFacet)
    ) {
      this.decorations = buildDecorations(update.view)
    }
  }
}, {
  decorations: plugin => plugin.decorations,
  eventHandlers: {
    mousedown(event, view) {
      const target = event.target
      if (!(target instanceof Element)) return false
      const mark = target.closest('.cm-character-name')
      if (!mark || !view.dom.contains(mark)) return false
      const name = mark.getAttribute('data-character-name')
      if (!name) return false
      const index = view.state.facet(characterNameIndexFacet)
      const characterIds = index.idsByName.get(name)
      if (!characterIds?.length) return false
      const activate = view.state.facet(characterNameActivateFacet)
      if (!activate) return false
      event.preventDefault()
      event.stopPropagation()
      activate({ name, characterIds, rect: mark.getBoundingClientRect() })
      return true
    },
  },
})

const characterNameTheme = EditorView.baseTheme({
  '.cm-character-name': {
    cursor: 'pointer',
    borderRadius: '2px',
    boxDecorationBreak: 'clone',
    WebkitBoxDecorationBreak: 'clone',
  },
})

/** Prose-only: highlight formal roster names and report clicks. */
export function characterNameHighlight(
  entries: readonly CharacterNameEntry[],
  onActivate: CharacterNameActivate,
): Extension {
  const index = buildCharacterNameIndex(entries)
  if (index.names.length === 0) return []
  return [
    characterNameIndexFacet.of(index),
    characterNameActivateFacet.of(onActivate),
    characterNamePlugin,
    characterNameTheme,
  ]
}
