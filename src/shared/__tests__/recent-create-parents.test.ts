import { describe, expect, it } from 'vitest'
import {
  listRecentCreateParentOptions,
  parentDirectoryOfProjectPath,
} from '../recent-create-parents'

describe('recent-create-parents', () => {
  it('takes parent directory from project path', () => {
    expect(parentDirectoryOfProjectPath('D:\\novels\\雨夜列车')).toBe('D:\\novels')
    expect(parentDirectoryOfProjectPath('D:/novels/雨夜列车/')).toBe('D:/novels')
    expect(parentDirectoryOfProjectPath('C:\\alone')).toBe('C:\\')
  })

  it('dedupes parents by key and keeps recent-first order', () => {
    const options = listRecentCreateParentOptions([
      { path: 'D:\\novels\\甲' },
      { path: 'D:\\novels\\乙' },
      { path: 'E:\\books\\丙' },
      { path: 'D:\\novels\\甲' },
    ], 8)
    expect(options.map(item => item.label)).toEqual(['novels', 'books'])
    expect(options[0]?.projectPath).toBe('D:\\novels\\甲')
    expect(options[1]?.projectPath).toBe('E:\\books\\丙')
  })

  it('disambiguates identical basenames', () => {
    const options = listRecentCreateParentOptions([
      { path: 'D:\\work\\novels\\甲' },
      { path: 'E:\\archive\\novels\\乙' },
    ])
    expect(options).toHaveLength(2)
    expect(options[0]?.label).toContain('novels')
    expect(options[1]?.label).toContain('novels')
    expect(options[0]?.label).not.toBe('novels')
    expect(options[0]?.label).not.toBe(options[1]?.label)
  })

  it('caps option count', () => {
    const recent = Array.from({ length: 12 }, (_, index) => ({
      path: `D:\\p${index}\\book`,
    }))
    expect(listRecentCreateParentOptions(recent, 3)).toHaveLength(3)
  })
})
