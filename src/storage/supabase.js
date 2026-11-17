import { supabase } from '../lib/supabaseClient'
import { createLocalStorageDriver, sanitizeState } from './local'
import { STORAGE_VERSION } from '../constants'

/**
 * Supabase driver. Lists and tasks live in Postgres (RLS limits every query
 * to the signed-in user); the whole snapshot is also mirrored to localStorage
 * as an offline cache and theme store.
 *
 * Sync strategy: the app keeps the full state, so save() upserts the whole
 * snapshot and then deletes rows that disappeared. Upsert-before-delete keeps
 * a failed sync from losing data. Fine at personal-planner scale.
 *
 * Contract (same as every driver):
 *   load(): Promise<object | null>
 *   save(state): Promise<void> — never rejects
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NIL_UUID = '00000000-0000-0000-0000-000000000000'

export function createSupabaseDriver(fallbackTheme, userId) {
  // localStorage mirror: instant cache, offline fallback, stores the theme.
  const local = createLocalStorageDriver(fallbackTheme, userId)
  // App-generated ids from before the DB era ('home', 'h1', …) are not valid
  // uuids — map them to the uuids assigned on first upload.
  const idMap = new Map()

  const dbId = (appId) => {
    if (UUID_RE.test(appId)) return appId
    if (!idMap.has(appId)) idMap.set(appId, crypto.randomUUID())
    return idMap.get(appId)
  }

  async function fetchState() {
    const { data: lists, error: listsError } = await supabase
      .from('lists')
      .select('id, title, icon, position, is_closed')
      .order('position', { ascending: true })
    if (listsError) throw listsError

    const { data: tasks, error: tasksError } = await supabase
      .from('tasks')
      .select('id, list_id, text, done, due, priority, tags, position')
      .order('position', { ascending: true })
    if (tasksError) throw tasksError

    const tasksByList = new Map()
    for (const task of tasks ?? []) {
      if (!tasksByList.has(task.list_id)) tasksByList.set(task.list_id, [])
      tasksByList.get(task.list_id).push({
        id: task.id,
        text: task.text,
        done: task.done,
        due: task.due, // Postgres date comes back as 'YYYY-MM-DD'
        priority: task.priority,
        tags: task.tags ?? [],
      })
    }

    return (lists ?? []).map((list) => ({
      id: list.id,
      title: list.title,
      icon: list.icon,
      closed: Boolean(list.is_closed),
      tasks: tasksByList.get(list.id) ?? [],
    }))
  }

  /** One-time copy of local data into an empty remote account. */
  async function migrate(localState) {
    for (const [listIndex, list] of localState.lists.entries()) {
      const listId = dbId(list.id)
      const { error: listError } = await supabase.from('lists').insert({
        id: listId,
        user_id: userId,
        title: list.title,
        icon: list.icon,
        is_closed: Boolean(list.closed),
        position: listIndex,
      })
      if (listError) throw listError

      if (list.tasks.length > 0) {
        const { error: tasksError } = await supabase.from('tasks').insert(
          list.tasks.map((task, taskIndex) => ({
            id: dbId(task.id),
            list_id: listId,
            text: task.text,
            done: task.done,
            due: task.due,
            priority: task.priority,
            tags: task.tags,
            position: taskIndex,
          }))
        )
        if (tasksError) throw tasksError
      }
    }
  }

  async function syncRemote(state) {
    const listIds = state.lists.map((list) => dbId(list.id))
    const taskIds = state.lists.flatMap((list) => list.tasks.map((task) => dbId(task.id)))

    // 1. Upsert lists.
    if (state.lists.length > 0) {
      const { error } = await supabase.from('lists').upsert(
        state.lists.map((list, index) => ({
          id: dbId(list.id),
          user_id: userId,
          title: list.title,
          icon: list.icon,
          is_closed: Boolean(list.closed),
          position: index,
        }))
      )
      if (error) throw error
    }

    // 2. Upsert tasks.
    const taskRows = state.lists.flatMap((list) =>
      list.tasks.map((task, index) => ({
        id: dbId(task.id),
        list_id: dbId(list.id),
        text: task.text,
        done: task.done,
        due: task.due,
        priority: task.priority,
        tags: task.tags,
        position: index,
      }))
    )
    if (taskRows.length > 0) {
      const { error } = await supabase.from('tasks').upsert(taskRows)
      if (error) throw error
    }

    // 3. Delete rows that no longer exist in the state.
    const { error: tasksError } = await supabase
      .from('tasks')
      .delete()
      .not('id', 'in', taskIds.length > 0 ? `(${taskIds.join(',')})` : `(${NIL_UUID})`)
    if (tasksError) throw tasksError

    const { error: listsError } = await supabase
      .from('lists')
      .delete()
      .not('id', 'in', listIds.length > 0 ? `(${listIds.join(',')})` : `(${NIL_UUID})`)
    if (listsError) throw listsError
  }

  return {
    async load() {
      const localState = await local.load()

      let remoteLists
      try {
        remoteLists = await fetchState()
      } catch (error) {
        console.warn('[storage] Remote load failed, using local cache', error)
        return localState
      }

      // Empty account + local data → one-time migration into the DB.
      if (remoteLists.length === 0 && localState?.lists?.length > 0) {
        try {
          await migrate(localState)
          remoteLists = await fetchState()
        } catch (error) {
          console.warn('[storage] Migration failed, using local cache', error)
          return localState
        }
      }

      if (remoteLists.length === 0 && !localState) return null

      const raw = {
        version: STORAGE_VERSION,
        user: localState?.user ?? null,
        theme: localState?.theme ?? fallbackTheme,
        lists: remoteLists,
      }
      return sanitizeState(raw, fallbackTheme)
    },

    async save(state) {
      // Local mirror first — the UI is never blocked by the network.
      await local.save(state)
      try {
        await syncRemote(state)
      } catch (error) {
        console.warn('[storage] Remote sync failed; data is safe locally', error)
      }
    },
  }
}
