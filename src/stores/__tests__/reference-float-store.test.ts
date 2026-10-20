import { beforeEach, describe, expect, it } from 'vitest'
import { useReferenceFloatStore } from '../reference-float-store'

beforeEach(() => {
  useReferenceFloatStore.setState({ windows: [], topZ: 12000 })
})

describe('reference-float-store', () => {
  it('opens stackable windows and brings duplicates to front', () => {
    const { open, bringToFront, close } = useReferenceFloatStore.getState()
    open({
      kind: 'character',
      subjectId: 'a',
      title: '主角',
      imageUrl: 'data:image/png;base64,aaa',
    })
    open({
      kind: 'character',
      subjectId: 'b',
      title: '配角',
      imageUrl: 'data:image/png;base64,bbb',
    })
    expect(useReferenceFloatStore.getState().windows).toHaveLength(2)
    const firstZ = useReferenceFloatStore.getState().windows[0]!.zIndex
    bringToFront(useReferenceFloatStore.getState().windows[0]!.id)
    expect(useReferenceFloatStore.getState().windows[0]!.zIndex).toBeGreaterThan(firstZ)

    open({
      kind: 'character',
      subjectId: 'a',
      title: '主角',
      imageUrl: 'data:image/png;base64,aaa',
    })
    expect(useReferenceFloatStore.getState().windows).toHaveLength(2)

    close(useReferenceFloatStore.getState().windows[0]!.id)
    expect(useReferenceFloatStore.getState().windows).toHaveLength(1)
  })
})
