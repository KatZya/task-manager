import { beforeEach, describe, expect, it } from 'vitest'
import { createLocalStorageDriver, sanitizeState } from './local'
import { STORAGE_KEY, STORAGE_VERSION } from '../constants'

const validTask = {
  id: 't1',
  text: 'Buy milk',
  done: false,
  due: '2026-11-20',
  priority: 'high',
  tags: ['shopping'],
}

const validState = {
  version: STORAGE_VERSION,
  user: 'kirill@example.com',
  theme: 'dark',
  lists: [{ id: 'l1', title: 'Home', icon: 'home', closed: false, tasks: [validTask] }],
}

describe('sanitizeState', () => {
  it('returns a valid state unchanged', () => {
    const result = sanitizeState(validState, 'light')
    expect(result).toEqual(validState)
  })

  it('returns null for garbage input', () => {
    expect(sanitizeState(null, 'light')).toBeNull()
    expect(sanitizeState('nope', 'light')).toBeNull()
    expect(sanitizeState({}, 'light')).toBeNull()
    expect(sanitizeState({ lists: 'not-an-array' }, 'light')).toBeNull()
  })

  it('accepts the legacy v1/v2 shape without theme and applies the fallback', () => {
    const legacy = { user: 'a@b.c', lists: validState.lists }
    const result = sanitizeState(legacy, 'dark')
    expect(result.theme).toBe('dark')
    expect(result.version).toBe(STORAGE_VERSION)
  })

  it('drops tasks without text and lists without title', () => {
    const messy = {
      lists: [
        { id: 'l1', title: 'Ok', icon: 'home', tasks: [{ id: 'x', text: '' }, null, validTask] },
        { id: 'l2', title: '', icon: 'home', tasks: [] },
      ],
    }
    const result = sanitizeState(messy, 'light')
    expect(result.lists).toHaveLength(1)
    expect(result.lists[0].tasks).toHaveLength(1)
    expect(result.lists[0].tasks[0].id).toBe('t1')
  })

  it('normalizes tags: trims, strips #, dedupes case-insensitively, caps the count', () => {
    const state = {
      lists: [
        {
          id: 'l1',
          title: 'Home',
          icon: 'home',
          tasks: [
            {
              ...validTask,
              tags: [' #Work ', 'work', 'HOME', 'home', 'a', 'b', 'c', 'd', 'e', 'overflow'],
            },
          ],
        },
      ],
    }
    const tags = sanitizeState(state, 'light').lists[0].tasks[0].tags
    expect(tags).toEqual(['Work', 'HOME', 'a', 'b', 'c', 'd'])
  })

  it('rejects invalid dates, priorities and icons', () => {
    const state = {
      lists: [
        {
          id: 'l1',
          title: 'Home',
          icon: 'not-an-icon',
          tasks: [{ ...validTask, due: '20.11.2026', priority: 'urgent' }],
        },
      ],
    }
    const result = sanitizeState(state, 'light')
    expect(result.lists[0].icon).toBe('list')
    expect(result.lists[0].tasks[0].due).toBeNull()
    expect(result.lists[0].tasks[0].priority).toBeNull()
  })

  it('keeps emoji icons and built-in icon keys', () => {
    const state = {
      lists: [
        { id: 'l1', title: 'Emoji', icon: '🏠', tasks: [] },
        { id: 'l2', title: 'EmojiSeq', icon: '👨‍👩‍👧', tasks: [] },
        { id: 'l3', title: 'BuiltIn', icon: 'music', tasks: [] },
      ],
    }
    const result = sanitizeState(state, 'light')
    expect(result.lists.map((list) => list.icon)).toEqual(['🏠', '👨‍👩‍👧', 'music'])
  })

  it('keeps the closed flag and defaults it to false', () => {
    const state = {
      lists: [
        { id: 'l1', title: 'Done stuff', icon: 'home', closed: true, tasks: [] },
        { id: 'l2', title: 'Open stuff', icon: 'home', tasks: [] },
      ],
    }
    const result = sanitizeState(state, 'light')
    expect(result.lists.map((list) => list.closed)).toEqual([true, false])
  })
})

describe('localStorage driver', () => {
  beforeEach(() => localStorage.clear())

  it('returns null when nothing is stored', async () => {
    const driver = createLocalStorageDriver('light', 'user-1')
    expect(await driver.load()).toBeNull()
  })

  it('round-trips state under a per-user key', async () => {
    const driver = createLocalStorageDriver('light', 'user-1')
    await driver.save(validState)

    expect(localStorage.getItem(`${STORAGE_KEY}:user-1`)).toBeTruthy()
    expect(await createLocalStorageDriver('light', 'user-1').load()).toEqual(validState)
    // Another user sees nothing.
    expect(await createLocalStorageDriver('light', 'user-2').load()).toBeNull()
  })

  it('falls back to the legacy shared key', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(validState))
    const driver = createLocalStorageDriver('light', 'user-1')
    expect(await driver.load()).toEqual(validState)
  })

  it('returns null instead of throwing on corrupted JSON', async () => {
    localStorage.setItem(`${STORAGE_KEY}:user-1`, '{broken json')
    const driver = createLocalStorageDriver('light', 'user-1')
    expect(await driver.load()).toBeNull()
  })
})
