import { useEffect, useRef, useState } from 'react'
import {
  Home,
  Search,
  Music,
  Radio,
  Smile,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
  MoreHorizontal,
  Check,
  LogOut,
  Trash2,
  ListTodo,
  Maximize2,
  Undo2,
  RotateCcw,
  CalendarDays,
  GripVertical,
  SlidersHorizontal,
  Moon,
  Sun,
  Shield,
  Mail,
} from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  STORAGE_VERSION,
  MAX_TITLE,
  MAX_TASK,
  MAX_TAGS,
  MAX_TAG,
  PRIORITIES,
  ICON_KEYS,
} from './constants'
import { getStorageDriver } from './storage'
import { supabase } from './lib/supabaseClient'
import AdminPanel from './AdminPanel'

const UNDO_TIMEOUT = 6000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PRIORITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High' }
const STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'done', label: 'Done' },
  { id: 'overdue', label: 'Overdue' },
]

/* ---------------- DATE HELPERS ---------------- */

const pad2 = (value) => String(value).padStart(2, '0')

function dateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function todayKey() {
  return dateKey(new Date())
}

function shiftDateKey(key, days) {
  const [year, month, day] = key.split('-').map(Number)
  return dateKey(new Date(year, month - 1, day + days))
}

function parseDateKey(key) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function formatDue(key) {
  const date = parseDateKey(key)
  const options = { month: 'short', day: 'numeric' }
  if (date.getFullYear() !== new Date().getFullYear()) options.year = 'numeric'
  return date.toLocaleDateString('en-US', options)
}

function dueLabel(due) {
  const today = todayKey()
  if (due === today) return 'Today'
  if (due === shiftDateKey(today, 1)) return 'Tomorrow'
  return formatDue(due)
}

function isOverdue(task) {
  return Boolean(task.due) && !task.done && task.due < todayKey()
}

/* ---------------- TAGS ---------------- */

function normalizeTags(values) {
  const seen = new Set()
  const tags = []
  for (const value of values) {
    if (typeof value !== 'string') continue
    const tag = value.trim().replace(/^#+/, '').slice(0, MAX_TAG)
    if (!tag) continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
    if (tags.length >= MAX_TAGS) break
  }
  return tags
}

function parseTags(value) {
  return normalizeTags(value.split(','))
}

/* ---------------- SEED DATA ---------------- */

function createSeedLists() {
  const today = todayKey()
  return [
    {
      id: 'home',
      title: 'Home',
      icon: 'home',
      tasks: [
        {
          id: 'h1',
          text: 'Cleaning the house',
          done: false,
          due: today,
          priority: 'medium',
          tags: ['home'],
        },
        {
          id: 'h2',
          text: 'Wash the dishes',
          done: false,
          due: shiftDateKey(today, -1),
          priority: null,
          tags: ['home', 'kitchen'],
        },
      ],
    },
    {
      id: 'school',
      title: 'School',
      icon: 'search',
      tasks: [
        {
          id: 's1',
          text: 'Do homework',
          done: false,
          due: shiftDateKey(today, 1),
          priority: 'high',
          tags: ['school'],
        },
      ],
    },
    {
      id: 'workout',
      title: 'Workout',
      icon: 'music',
      tasks: [
        {
          id: 'w1',
          text: 'Buy a gym membership',
          done: false,
          due: shiftDateKey(today, 2),
          priority: 'medium',
          tags: ['health'],
        },
        {
          id: 'w2',
          text: 'Buy training shorts',
          done: false,
          due: null,
          priority: 'low',
          tags: ['shopping'],
        },
      ],
    },
    {
      id: 'programming',
      title: 'Programming',
      icon: 'radio',
      tasks: [
        { id: 'p1', text: 'Arrays', done: true, due: null, priority: null, tags: ['study'] },
        {
          id: 'p2',
          text: 'Cycles',
          done: false,
          due: shiftDateKey(today, 3),
          priority: 'high',
          tags: ['study', 'code'],
        },
      ],
    },
    {
      id: 'gaming',
      title: 'Gaming',
      icon: 'smile',
      tasks: [
        {
          id: 'g1',
          text: 'Build a house in minecraft',
          done: false,
          due: null,
          priority: null,
          tags: ['fun'],
        },
      ],
    },
  ]
}

const iconMap = {
  home: Home,
  search: Search,
  music: Music,
  radio: Radio,
  smile: Smile,
  list: ListTodo,
}

const iconChoices = ICON_KEYS

const systemTheme = () =>
  window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function createInitialState() {
  return {
    version: STORAGE_VERSION,
    user: null,
    theme: systemTheme(),
    lists: createSeedLists(),
  }
}

/* ---------------- APP ROOT ---------------- */

const SAVE_DEBOUNCE_MS = 400

export default function App() {
  // undefined = session not resolved yet; null = signed out
  const [session, setSession] = useState(undefined)
  // null = still loading from the storage driver
  const [state, setState] = useState(null)
  // undefined = loading; null = no profile (blocked screen guard falls back to "active")
  const [profile, setProfile] = useState(undefined)
  const [adminOpen, setAdminOpen] = useState(false)
  const [changeEmailOpen, setChangeEmailOpen] = useState(false)
  // 'default' | 'recovery' — recovery is entered from the reset-password email link
  const [authFlow, setAuthFlow] = useState('default')
  const pendingSave = useRef(null)
  const userId = session?.user?.id ?? null

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setAuthFlow('recovery')
      if (event === 'SIGNED_OUT') setAuthFlow('default')
      setSession(next)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Load this user's data once the session is known; reset on sign-out.
  useEffect(() => {
    if (!userId) {
      setState(null)
      setProfile(undefined)
      return
    }
    let cancelled = false

    supabase
      .from('profiles')
      .select('role, is_blocked')
      .eq('id', userId)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) console.warn('[auth] profile unavailable', error)
        setProfile(data ?? null)
      })

    const driver = getStorageDriver(systemTheme(), userId)
    driver
      .load()
      .then((saved) => {
        if (cancelled) return
        const base = saved ?? createInitialState()
        setState({ ...base, user: session?.user?.email ?? base.user })
      })
      .catch(() => {
        if (!cancelled) setState(createInitialState())
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  // Debounced persistence: groups rapid mutations into one save and keeps
  // the UI contract identical when the driver becomes a network call.
  useEffect(() => {
    if (!state || !userId) return
    const driver = getStorageDriver(systemTheme(), userId)
    pendingSave.current = { driver, state }
    const timer = setTimeout(() => {
      pendingSave.current = null
      driver.save(state)
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [state, userId])

  // Flush any pending save when the tab is closed or reloaded.
  useEffect(() => {
    const flush = () => {
      if (pendingSave.current) pendingSave.current.driver.save(pendingSave.current.state)
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  useEffect(() => {
    if (!state) return
    const root = document.documentElement
    root.dataset.theme = state.theme
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', state.theme === 'dark' ? '#0f172a' : '#63a1fd')
  }, [state])

  if (session === undefined || (session && (!state || profile === undefined))) {
    return (
      <main className="screen-login">
        <h1 className="brand-title">Task Manager</h1>
        <p className="login-subtitle" role="status">
          Loading…
        </p>
      </main>
    )
  }

  if (!session) {
    return <Login />
  }

  // The user arrived via the password-reset email link: force the new-password
  // form before anything else.
  if (authFlow === 'recovery') {
    return <ResetPassword onDone={() => setAuthFlow('default')} />
  }

  if (profile?.is_blocked) {
    return (
      <main className="screen-login">
        <h1 className="brand-title">Task Manager</h1>
        <div className="login-card">
          <h2 className="login-title">Account blocked</h2>
          <p className="login-subtitle">
            Your account has been blocked by an administrator. If you think this is a mistake,
            contact them directly.
          </p>
          <button className="btn btn-dark btn-block" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </main>
    )
  }

  return (
    <>
      <Dashboard
        state={state}
        setState={setState}
        profile={profile}
        onOpenAdmin={() => setAdminOpen(true)}
        onChangeEmail={() => setChangeEmailOpen(true)}
        onLogout={() => supabase.auth.signOut()}
        onToggleTheme={() =>
          setState((s) => ({ ...s, theme: s.theme === 'dark' ? 'light' : 'dark' }))
        }
      />
      {adminOpen && profile?.role === 'admin' && (
        <AdminPanel currentUserId={userId} onClose={() => setAdminOpen(false)} />
      )}
      {changeEmailOpen && (
        <ChangeEmailModal currentEmail={state.user} onClose={() => setChangeEmailOpen(false)} />
      )}
    </>
  )
}

/* ---------------- SHARED HOOKS ---------------- */

/**
 * Accessibility for modal dialogs: initial focus, focus trap, Escape to close,
 * body scroll lock and focus restoration on unmount.
 */
function useDialog(onClose, initialFocusRef) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const previouslyFocused = document.activeElement
    const selector =
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const getItems = () =>
      Array.from(node.querySelectorAll(selector)).filter((el) => el.offsetParent !== null)

    const initial = initialFocusRef?.current ?? getItems()[0]
    initial?.focus()

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const items = getItems()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
  }, [initialFocusRef])

  return ref
}

/* ---------------- LOGIN SCREEN ---------------- */

function Login() {
  const [mode, setMode] = useState('signin') // 'signin' | 'signup' | 'reset'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    const value = email.trim()
    if (!EMAIL_RE.test(value)) {
      setError('Please enter a valid email address')
      return
    }

    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (mode === 'reset') {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(
          value.toLowerCase(),
          { redirectTo: window.location.origin }
        )
        if (authError) throw authError
        setNotice('If this email is registered, we sent a password reset link.')
        return
      }

      if (password.length < 6) {
        setError('Password must be at least 6 characters')
        setBusy(false)
        return
      }

      if (mode === 'signup') {
        const { data, error: authError } = await supabase.auth.signUp({
          email: value.toLowerCase(),
          password,
        })
        if (authError) throw authError
        // No session = the project requires email confirmation.
        if (!data.session) {
          setNotice('Check your inbox — we sent you a confirmation link.')
        }
        // Otherwise onAuthStateChange picks up the session automatically.
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: value.toLowerCase(),
          password,
        })
        if (authError) throw authError
      }
    } catch (authError) {
      setError(authError.message ?? 'Authentication failed')
    } finally {
      setBusy(false)
    }
  }

  const switchMode = (next) => {
    setMode(next)
    setError('')
    setNotice('')
  }

  return (
    <main className="screen-login">
      <h1 className="brand-title">Task Manager</h1>
      <form className="login-card" onSubmit={submit} noValidate>
        <h2 className="login-title">
          {mode === 'signup'
            ? 'Create an account'
            : mode === 'reset'
              ? 'Reset your password'
              : 'Welcome back'}
        </h2>
        <p className="login-subtitle">
          {mode === 'signup'
            ? 'Enter your email and password to sign up'
            : mode === 'reset'
              ? 'Enter your email and we will send you a reset link'
              : 'Sign in with your email and password'}
        </p>

        <div className="login-field">
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            placeholder="email@domain.com"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              setError('')
            }}
            className={error ? 'input-error' : ''}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'login-error' : undefined}
          />
          {mode !== 'reset' && (
            <input
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              placeholder="Password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                setError('')
              }}
              className={error ? 'input-error' : ''}
              aria-label="Password"
            />
          )}
          {error && (
            <span className="input-error-text" id="login-error" role="alert">
              {error}
            </span>
          )}
          {notice && (
            <span className="input-notice-text" role="status">
              {notice}
            </span>
          )}
        </div>

        <button type="submit" className="btn btn-dark btn-block" disabled={busy}>
          {busy
            ? 'Please wait…'
            : mode === 'signup'
              ? 'Sign up with email'
              : mode === 'reset'
                ? 'Send reset link'
                : 'Sign in with email'}
        </button>

        <p className="login-terms">
          {mode === 'signup' && (
            <>
              Already have an account?{' '}
              <button type="button" className="btn-link-inline" onClick={() => switchMode('signin')}>
                Sign in
              </button>
            </>
          )}
          {mode === 'signin' && (
            <>
              No account yet?{' '}
              <button type="button" className="btn-link-inline" onClick={() => switchMode('signup')}>
                Sign up
              </button>
              {' · '}
              <button type="button" className="btn-link-inline" onClick={() => switchMode('reset')}>
                Forgot password?
              </button>
            </>
          )}
          {mode === 'reset' && (
            <>
              Remembered it?{' '}
              <button type="button" className="btn-link-inline" onClick={() => switchMode('signin')}>
                Back to sign in
              </button>
            </>
          )}
        </p>

        {mode !== 'reset' && (
          <p className="login-terms">
            By clicking continue, you agree to our Terms of Service and Privacy Policy
          </p>
        )}
      </form>
    </main>
  )
}

/* ---------------- RESET PASSWORD SCREEN ---------------- */

function ResetPassword({ onDone }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }

    setBusy(true)
    setError('')
    try {
      const { error: authError } = await supabase.auth.updateUser({ password })
      if (authError) throw authError
      onDone()
    } catch (authError) {
      setError(authError.message ?? 'Could not update the password')
      setBusy(false)
    }
  }

  return (
    <main className="screen-login">
      <h1 className="brand-title">Task Manager</h1>
      <form className="login-card" onSubmit={submit} noValidate>
        <h2 className="login-title">Set a new password</h2>
        <p className="login-subtitle">Enter a new password for your account</p>

        <div className="login-field">
          <input
            type="password"
            autoComplete="new-password"
            placeholder="New password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              setError('')
            }}
            className={error ? 'input-error' : ''}
            aria-label="New password"
            autoFocus
          />
          <input
            type="password"
            autoComplete="new-password"
            placeholder="Repeat new password"
            value={confirm}
            onChange={(event) => {
              setConfirm(event.target.value)
              setError('')
            }}
            className={error ? 'input-error' : ''}
            aria-label="Repeat new password"
          />
          {error && (
            <span className="input-error-text" role="alert">
              {error}
            </span>
          )}
        </div>

        <button type="submit" className="btn btn-dark btn-block" disabled={busy}>
          {busy ? 'Please wait…' : 'Update password'}
        </button>
      </form>
    </main>
  )
}

/* ---------------- DASHBOARD ---------------- */

function Dashboard({ state, setState, profile, onOpenAdmin, onChangeEmail, onLogout, onToggleTheme }) {
  const [addListOpen, setAddListOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [openListId, setOpenListId] = useState(null)
  const [focusedListId, setFocusedListId] = useState(null)
  const [listToDelete, setListToDelete] = useState(null)
  const [undo, setUndo] = useState(null)
  const [details, setDetails] = useState(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('any')
  const [tagFilter, setTagFilter] = useState('any')
  const [activeTask, setActiveTask] = useState(null)

  const undoTimer = useRef(null)
  const focusTimer = useRef(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  useEffect(() => {
    return () => {
      clearTimeout(undoTimer.current)
      clearTimeout(focusTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!undo) return
    clearTimeout(undoTimer.current)
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_TIMEOUT)
    return () => clearTimeout(undoTimer.current)
  }, [undo])

  /* ----- data mutations ----- */

  const toggleTask = (listId, taskId) =>
    setState((s) => ({
      ...s,
      lists: s.lists.map((list) =>
        list.id === listId
          ? {
              ...list,
              tasks: list.tasks.map((task) =>
                task.id === taskId ? { ...task, done: !task.done } : task
              ),
            }
          : list
      ),
    }))

  const addList = ({ title, tasks, icon }) =>
    setState((s) => ({
      ...s,
      lists: [
        ...s.lists,
        {
          id: makeId(),
          title: title.slice(0, MAX_TITLE),
          icon: icon ?? 'list',
          tasks: tasks.map((text) => ({
            id: makeId(),
            text,
            done: false,
            due: null,
            priority: null,
            tags: [],
          })),
        },
      ],
    }))

  const addTask = (listId, text) => {
    setState((s) => ({
      ...s,
      lists: s.lists.map((list) =>
        list.id === listId
          ? {
              ...list,
              tasks: [
                ...list.tasks,
                { id: makeId(), text: text.slice(0, MAX_TASK), done: false, due: null, priority: null, tags: [] },
              ],
            }
          : list
      ),
    }))
    // A new task has no priority/tags and is active, so it would be hidden by
    // most filters. Clear them to show the result of the action.
    if (hasFilters) resetFilters()
  }

  const renameList = (listId, title) =>
    setState((s) => ({
      ...s,
      lists: s.lists.map((list) => (list.id === listId ? { ...list, title } : list)),
    }))

  const updateTask = (listId, taskId, text) =>
    setState((s) => ({
      ...s,
      lists: s.lists.map((list) =>
        list.id === listId
          ? {
              ...list,
              tasks: list.tasks.map((task) =>
                task.id === taskId ? { ...task, text: text.slice(0, MAX_TASK) } : task
              ),
            }
          : list
      ),
    }))

  const updateTaskDetails = (listId, taskId, patch) =>
    setState((s) => ({
      ...s,
      lists: s.lists.map((list) =>
        list.id === listId
          ? {
              ...list,
              tasks: list.tasks.map((task) =>
                task.id === taskId ? { ...task, ...patch } : task
              ),
            }
          : list
      ),
    }))

  const deleteTask = (listId, taskId) => {
    const list = state.lists.find((item) => item.id === listId)
    const index = list ? list.tasks.findIndex((task) => task.id === taskId) : -1
    if (!list || index < 0) return

    setState((s) => ({
      ...s,
      lists: s.lists.map((item) =>
        item.id === listId
          ? { ...item, tasks: item.tasks.filter((task) => task.id !== taskId) }
          : item
      ),
    }))
    setUndo({ listId, task: list.tasks[index], index })
  }

  const undoDelete = () => {
    if (!undo) return
    const { listId, task, index } = undo
    setState((s) => ({
      ...s,
      lists: s.lists.map((list) =>
        list.id === listId
          ? { ...list, tasks: [...list.tasks.slice(0, index), task, ...list.tasks.slice(index)] }
          : list
      ),
    }))
    setUndo(null)
  }

  const confirmDeleteList = () => {
    if (!listToDelete) return
    const id = listToDelete.id
    setState((s) => ({ ...s, lists: s.lists.filter((list) => list.id !== id) }))
    if (openListId === id) setOpenListId(null)
    if (details?.listId === id) setDetails(null)
    if (undo?.listId === id) setUndo(null)
    setListToDelete(null)
  }

  const resetData = () => {
    setState((current) => ({ ...current, lists: createSeedLists() }))
    setUndo(null)
    setDetails(null)
    setOpenListId(null)
    setQuery('')
    setStatus('all')
    setPriorityFilter('any')
    setTagFilter('any')
  }

  /* ----- filters ----- */

  const allTags = [...new Set(state.lists.flatMap((list) => list.tasks.flatMap((task) => task.tags)))].sort(
    (a, b) => a.localeCompare(b)
  )
  const activeTag = allTags.includes(tagFilter) ? tagFilter : 'any'
  const q = query.trim().toLowerCase()
  const hasFilters = Boolean(q) || status !== 'all' || priorityFilter !== 'any' || activeTag !== 'any'

  const visibleLists = state.lists
    .map((list) => {
      const titleMatch = Boolean(q) && list.title.toLowerCase().includes(q)
      const tasks = list.tasks.filter((task) => {
        if (status === 'active' && task.done) return false
        if (status === 'done' && !task.done) return false
        if (status === 'overdue' && !isOverdue(task)) return false
        if (priorityFilter !== 'any' && task.priority !== priorityFilter) return false
        if (activeTag !== 'any' && !task.tags.includes(activeTag)) return false
        if (!q) return true
        return (
          titleMatch ||
          task.text.toLowerCase().includes(q) ||
          task.tags.some((tag) => tag.toLowerCase().includes(q))
        )
      })
      return {
        list,
        tasks,
        done: list.tasks.filter((task) => task.done).length,
        total: list.tasks.length,
      }
    })
    .filter((item) => !hasFilters || item.tasks.length > 0)

  const resetFilters = () => {
    setQuery('')
    setStatus('all')
    setPriorityFilter('any')
    setTagFilter('any')
  }

  /* ----- navigation ----- */

  const highlightCard = (listId) => {
    const node = document.getElementById(`card-${listId}`)
    if (!node) return
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    node.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' })
    setFocusedListId(listId)
    clearTimeout(focusTimer.current)
    focusTimer.current = setTimeout(() => setFocusedListId(null), 1800)
  }

  const scrollToCard = (listId) => {
    const isVisible = visibleLists.some((item) => item.list.id === listId)
    if (isVisible) {
      highlightCard(listId)
    } else {
      resetFilters()
      setTimeout(() => highlightCard(listId), 60)
    }
  }

  const openDetails = (listId, taskId) => {
    setOpenListId(null)
    setDetails({ listId, taskId })
  }

  /* ----- drag & drop ----- */

  const handleDragStart = ({ active }) => {
    const list = state.lists.find((item) => item.id === active.data.current?.listId)
    const task = list?.tasks.find((item) => item.id === active.id)
    setActiveTask(task ? { ...task, listTitle: list.title } : null)
  }

  const handleDragEnd = ({ active, over }) => {
    setActiveTask(null)
    if (!over) return

    const fromListId = active.data.current?.listId
    const toListId = over.data.current?.listId
    if (!fromListId || !toListId) return

    const fromList = state.lists.find((list) => list.id === fromListId)
    const toList = state.lists.find((list) => list.id === toListId)
    if (!fromList || !toList) return

    const toIndex =
      over.data.current.type === 'task'
        ? toList.tasks.findIndex((task) => task.id === over.id)
        : toList.tasks.length
    if (toIndex < 0) return

    if (fromListId === toListId) {
      const fromIndex = fromList.tasks.findIndex((task) => task.id === active.id)
      if (fromIndex < 0 || fromIndex === toIndex) return
      setState((s) => ({
        ...s,
        lists: s.lists.map((list) =>
          list.id === fromListId ? { ...list, tasks: arrayMove(list.tasks, fromIndex, toIndex) } : list
        ),
      }))
      return
    }

    setState((s) => {
      const moving = s.lists
        .find((list) => list.id === fromListId)
        ?.tasks.find((task) => task.id === active.id)
      if (!moving) return s
      return {
        ...s,
        lists: s.lists.map((list) => {
          if (list.id === fromListId) {
            return { ...list, tasks: list.tasks.filter((task) => task.id !== active.id) }
          }
          if (list.id === toListId) {
            const next = [...list.tasks]
            next.splice(Math.min(toIndex, next.length), 0, moving)
            return { ...list, tasks: next }
          }
          return list
        }),
      }
    })
  }

  const activeList = state.lists.find((list) => list.id === openListId)
  const detailsList = details ? state.lists.find((list) => list.id === details.listId) : null
  const detailsTask = detailsList?.tasks.find((task) => task.id === details.taskId)
  const sidebarWidth = sidebarOpen ? 281 : 64

  return (
    <div className="app" style={{ '--sidebar-width': `${sidebarWidth}px` }}>
      <Sidebar
        lists={state.lists}
        user={state.user}
        theme={state.theme}
        profile={profile}
        onOpenAdmin={onOpenAdmin}
        onChangeEmail={onChangeEmail}
        onToggleTheme={onToggleTheme}
        onLogout={onLogout}
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((value) => !value)}
        onOpenList={scrollToCard}
        onReset={resetData}
      />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveTask(null)}
      >
        <main className="main">
          <h1 className="brand-title brand-title-app">Task Manager</h1>

          {state.lists.length > 0 && (
            <Toolbar
              query={query}
              onQueryChange={setQuery}
              status={status}
              onStatusChange={setStatus}
              priority={priorityFilter}
              onPriorityChange={setPriorityFilter}
              tag={activeTag}
              onTagChange={setTagFilter}
              tags={allTags}
              hasFilters={hasFilters}
              onReset={resetFilters}
            />
          )}

          {state.lists.length === 0 ? (
            <div className="empty-state">
              <ListTodo size={40} strokeWidth={1.75} aria-hidden="true" />
              <h2>No lists yet</h2>
              <p>Create your first list to start tracking tasks.</p>
              <button className="btn btn-blue" onClick={() => setAddListOpen(true)}>
                Create a list
              </button>
            </div>
          ) : hasFilters && visibleLists.length === 0 ? (
            <div className="empty-state">
              <Search size={40} strokeWidth={1.75} aria-hidden="true" />
              <h2>Nothing found</h2>
              <p>Try another search or reset the filters.</p>
              <button className="btn btn-blue" onClick={resetFilters}>
                Reset filters
              </button>
            </div>
          ) : (
            <div className="cards-grid">
              {visibleLists.map((item) => (
                <TaskCard
                  key={item.list.id}
                  list={item.list}
                  tasks={item.tasks}
                  done={item.done}
                  total={item.total}
                  focused={focusedListId === item.list.id}
                  sortable={!hasFilters}
                  onToggle={toggleTask}
                  onRequestDelete={setListToDelete}
                  onAddTask={addTask}
                  onRename={renameList}
                  onUpdateTask={updateTask}
                  onDeleteTask={deleteTask}
                  onOpenList={setOpenListId}
                  onOpenDetails={openDetails}
                />
              ))}
              <button className="add-list-card" onClick={() => setAddListOpen(true)}>
                + Add list...
              </button>
            </div>
          )}
        </main>

        <DragOverlay dropAnimation={null}>
          {activeTask ? (
            <div className="drag-preview">
              <span className="drag-preview-text">{activeTask.text}</span>
              <span className="drag-preview-list">{activeTask.listTitle}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {activeList && (
        <ListModal
          list={activeList}
          onClose={() => setOpenListId(null)}
          onToggle={toggleTask}
          onAddTask={addTask}
          onUpdateTask={updateTask}
          onDeleteTask={deleteTask}
          onOpenDetails={openDetails}
        />
      )}

      {detailsTask && (
        <TaskDetailsModal
          task={detailsTask}
          listId={details.listId}
          onClose={() => setDetails(null)}
          onSave={(patch) => {
            updateTaskDetails(details.listId, details.taskId, patch)
            setDetails(null)
          }}
        />
      )}

      {addListOpen && (
        <AddListModal
          onClose={() => setAddListOpen(false)}
          onSave={(data) => {
            addList(data)
            setAddListOpen(false)
            resetFilters()
          }}
        />
      )}

      {listToDelete && (
        <ConfirmDialog
          title="Delete list?"
          message={`“${listToDelete.title}” and its ${countLabel(
            listToDelete.tasks.length,
            'task'
          )} will be permanently deleted.`}
          confirmLabel="Delete list"
          onConfirm={confirmDeleteList}
          onCancel={() => setListToDelete(null)}
        />
      )}

      {undo && (
        <div className="toast" role="status" aria-live="polite">
          <span className="toast-text">Task deleted</span>
          <button className="toast-action" onClick={undoDelete}>
            <Undo2 size={14} strokeWidth={2.5} aria-hidden="true" />
            Undo
          </button>
          <button className="toast-close" onClick={() => setUndo(null)} aria-label="Dismiss">
            <X size={14} strokeWidth={2.5} />
          </button>
        </div>
      )}
    </div>
  )
}

function countLabel(count, singular) {
  return `${count} ${singular}${count === 1 ? '' : 's'}`
}

/* ---------------- TOOLBAR ---------------- */

function Toolbar({
  query,
  onQueryChange,
  status,
  onStatusChange,
  priority,
  onPriorityChange,
  tag,
  onTagChange,
  tags,
  hasFilters,
  onReset,
}) {
  return (
    <div className="toolbar">
      <div className="search-box">
        <Search size={18} strokeWidth={2} className="search-icon" aria-hidden="true" />
        <input
          type="search"
          placeholder="Search tasks, tags or lists..."
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          aria-label="Search tasks, tags or lists"
        />
        {query && (
          <button className="search-clear" onClick={() => onQueryChange('')} aria-label="Clear search">
            <X size={14} strokeWidth={2.5} />
          </button>
        )}
      </div>

      <div className="status-chips" role="group" aria-label="Filter tasks by status">
        {STATUS_FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`chip${status === item.id ? ' chip-active' : ''}`}
            aria-pressed={status === item.id}
            onClick={() => onStatusChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="toolbar-selects">
        <span className="select-wrap">
          <select
            className="toolbar-select"
            value={priority}
            onChange={(event) => onPriorityChange(event.target.value)}
            aria-label="Filter by priority"
          >
            <option value="any">Any priority</option>
            <option value="high">High priority</option>
            <option value="medium">Medium priority</option>
            <option value="low">Low priority</option>
          </select>
          <ChevronDown size={16} strokeWidth={2} className="select-chevron" aria-hidden="true" />
        </span>

        <span className="select-wrap">
          <select
            className="toolbar-select"
            value={tag}
            onChange={(event) => onTagChange(event.target.value)}
            aria-label="Filter by tag"
          >
            <option value="any">All tags</option>
            {tags.map((item) => (
              <option key={item} value={item}>
                #{item}
              </option>
            ))}
          </select>
          <ChevronDown size={16} strokeWidth={2} className="select-chevron" aria-hidden="true" />
        </span>

        {hasFilters && (
          <button type="button" className="toolbar-reset" onClick={onReset}>
            Reset
          </button>
        )}
      </div>
    </div>
  )
}

/* ---------------- SIDEBAR ---------------- */

function Sidebar({ lists, user, theme, profile, onOpenAdmin, onChangeEmail, onToggleTheme, onLogout, open, onToggle, onOpenList, onReset }) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(
    () => window.matchMedia?.('(min-width: 901px)').matches ?? true
  )
  const popoverRef = useRef(null)
  const moreRef = useRef(null)

  useEffect(() => {
    const close = (event) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target)) {
        setSettingsOpen(false)
      }
      if (moreRef.current && !moreRef.current.contains(event.target)) {
        setMoreOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  useEffect(() => {
    if (!settingsOpen && !moreOpen) return
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      setSettingsOpen(false)
      setMoreOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [settingsOpen, moreOpen])

  return (
    <aside className={`sidebar${open ? '' : ' sidebar-collapsed'}`}>
      <div className="sidebar-top">
        {open && <div className="sidebar-logo">Task Manager</div>}
        <button
          className="sidebar-toggle"
          onClick={onToggle}
          aria-label={open ? 'Hide sidebar' : 'Show sidebar'}
          aria-expanded={open}
          title={open ? 'Hide sidebar' : 'Show sidebar'}
        >
          {open ? (
            <ChevronLeft size={20} strokeWidth={2} />
          ) : (
            <ChevronRight size={20} strokeWidth={2} />
          )}
        </button>
      </div>

      <div className="sidebar-section">
        <button
          className="menu-item menu-item-header"
          onClick={() => setMenuOpen((value) => !value)}
          aria-expanded={menuOpen}
          aria-label="Task lists"
          title={menuOpen ? 'Hide lists' : 'Show lists'}
        >
          <ChevronDown
            size={20}
            strokeWidth={2}
            className={`menu-chevron${menuOpen ? '' : ' menu-chevron-closed'}`}
            aria-hidden="true"
          />
          <span className="menu-header-text">TASKS LIST</span>
        </button>
        <div className={`sidebar-menu-wrap${menuOpen ? '' : ' sidebar-menu-closed'}`}>
          <nav className="sidebar-menu-items" aria-label="Task lists">
            {lists.map((list) => {
              const Icon = iconMap[list.icon] ?? ListTodo
              return (
                <button
                  key={list.id}
                  className="menu-item"
                  onClick={() => onOpenList(list.id)}
                  title={list.title}
                >
                  <Icon size={20} strokeWidth={2} aria-hidden="true" />
                  <span>{list.title}</span>
                </button>
              )
            })}
          </nav>
        </div>
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-avatar" title={user}>
          {user.charAt(0).toUpperCase()}
        </div>
        <div className="sidebar-footer-actions">
          <div className="settings-wrap" ref={popoverRef}>
            <button
              className="btn btn-blue"
              onClick={() => {
                setSettingsOpen((value) => !value)
                setMoreOpen(false)
              }}
              aria-expanded={settingsOpen}
              aria-haspopup="true"
            >
              Settings
            </button>
            {settingsOpen && (
              <div className="settings-popover">
                <div className="settings-user" title={user}>
                  {user}
                </div>
                <button className="settings-popover-item" onClick={onToggleTheme}>
                  {theme === 'dark' ? (
                    <Sun size={16} aria-hidden="true" />
                  ) : (
                    <Moon size={16} aria-hidden="true" />
                  )}
                  {theme === 'dark' ? 'Light theme' : 'Dark theme'}
                </button>
                {profile?.role === 'admin' && (
                  <button
                    className="settings-popover-item"
                    onClick={() => {
                      setSettingsOpen(false)
                      onOpenAdmin()
                    }}
                  >
                    <Shield size={16} aria-hidden="true" /> Admin panel
                  </button>
                )}
                <button
                  className="settings-popover-item"
                  onClick={() => {
                    setSettingsOpen(false)
                    onChangeEmail()
                  }}
                >
                  <Mail size={16} aria-hidden="true" /> Change email
                </button>
                <button
                  className="settings-popover-item"
                  onClick={() => {
                    setSettingsOpen(false)
                    onLogout()
                  }}
                >
                  <LogOut size={16} aria-hidden="true" /> Log out
                </button>
              </div>
            )}
          </div>

          <div className="settings-wrap" ref={moreRef}>
            <button
              className="btn btn-gray btn-icon"
              aria-label="More options"
              aria-expanded={moreOpen}
              aria-haspopup="true"
              onClick={() => {
                setMoreOpen((value) => !value)
                setSettingsOpen(false)
              }}
            >
              <MoreHorizontal size={20} strokeWidth={2} />
            </button>
            {moreOpen && (
              <div className="settings-popover more-popover">
                <button
                  className="settings-popover-item"
                  onClick={() => {
                    setMoreOpen(false)
                    setResetOpen(true)
                  }}
                >
                  <RotateCcw size={16} aria-hidden="true" /> Reset demo data
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {resetOpen && (
        <ConfirmDialog
          title="Reset data?"
          message="All current lists and tasks will be replaced with the demo set. This cannot be undone."
          confirmLabel="Reset data"
          onConfirm={() => {
            onReset()
            setResetOpen(false)
          }}
          onCancel={() => setResetOpen(false)}
        />
      )}
    </aside>
  )
}

/* ---------------- TASK CARD ---------------- */

function TaskCard({
  list,
  tasks,
  done,
  total,
  focused,
  sortable,
  onToggle,
  onRequestDelete,
  onAddTask,
  onRename,
  onUpdateTask,
  onDeleteTask,
  onOpenList,
  onOpenDetails,
}) {
  const Icon = iconMap[list.icon] ?? ListTodo
  const [isEditing, setIsEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(list.title)
  const [newTask, setNewTask] = useState('')
  const cancelledTitle = useRef(false)

  useEffect(() => setDraftTitle(list.title), [list.title])

  const commitTitle = () => {
    if (cancelledTitle.current) {
      cancelledTitle.current = false
      setDraftTitle(list.title)
      setIsEditing(false)
      return
    }
    const title = draftTitle.trim()
    if (title && title !== list.title) onRename(list.id, title)
    else setDraftTitle(list.title)
    setIsEditing(false)
  }

  const submitTask = (event) => {
    event.preventDefault()
    const text = newTask.trim()
    if (!text) return
    onAddTask(list.id, text)
    setNewTask('')
  }

  return (
    <section
      className={`task-card${focused ? ' task-card-focus' : ''}`}
      id={`card-${list.id}`}
      aria-label={list.title}
    >
      <div className="task-card-header">
        {isEditing ? (
          <input
            className="task-card-title-input"
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitTitle()
              if (event.key === 'Escape') {
                cancelledTitle.current = true
                setDraftTitle(list.title)
                setIsEditing(false)
              }
            }}
            maxLength={MAX_TITLE}
            autoFocus
            aria-label="List name"
          />
        ) : (
          <h3 className="task-card-title">
            <button
              type="button"
              className="task-card-title-button"
              onClick={() => {
                cancelledTitle.current = false
                setIsEditing(true)
              }}
              title="Click to rename"
            >
              <Icon size={18} strokeWidth={2} className="task-card-title-icon" aria-hidden="true" />
              {list.title}
            </button>
          </h3>
        )}

        <div className="task-card-actions">
          {total > 0 && (
            <span className="task-card-progress" title={`${done} of ${total} tasks done`}>
              {done}/{total}
              <span className="sr-only"> tasks done</span>
            </span>
          )}
          <button
            type="button"
            className="card-action"
            onClick={() => onOpenList(list.id)}
            aria-label={`Open ${list.title}`}
            title="Open list"
          >
            <Maximize2 size={15} strokeWidth={2} />
          </button>
          <button
            type="button"
            className="card-action card-action-danger"
            onClick={() => onRequestDelete(list)}
            aria-label={`Delete ${list.title}`}
            title="Delete list"
          >
            <Trash2 size={15} strokeWidth={2} />
          </button>
        </div>
      </div>

      <TaskItems
        listId={list.id}
        tasks={tasks}
        sortable={sortable}
        onToggle={onToggle}
        onUpdateTask={onUpdateTask}
        onDeleteTask={onDeleteTask}
        onOpenDetails={onOpenDetails}
      />

      <form className="add-task-form" onSubmit={submitTask}>
        <span className="task-dot task-dot-static" aria-hidden="true" />
        <input
          type="text"
          placeholder="Add task..."
          value={newTask}
          onChange={(event) => setNewTask(event.target.value)}
          maxLength={MAX_TASK}
          aria-label={`Add task to ${list.title}`}
        />
      </form>
    </section>
  )
}

/* ---------------- TASK ITEMS ---------------- */

function TaskItems({ listId, tasks, sortable, onToggle, onUpdateTask, onDeleteTask, onOpenDetails }) {
  if (tasks.length === 0) {
    return sortable ? (
      <EmptyDropArea listId={listId} />
    ) : (
      <p className="task-list-empty">No tasks yet — add the first one below.</p>
    )
  }

  const rows = tasks.map((task) =>
    sortable ? (
      <SortableTaskRow
        key={task.id}
        task={task}
        listId={listId}
        onToggle={onToggle}
        onUpdateTask={onUpdateTask}
        onDeleteTask={onDeleteTask}
        onOpenDetails={onOpenDetails}
      />
    ) : (
      <TaskRow
        key={task.id}
        task={task}
        listId={listId}
        onToggle={onToggle}
        onUpdateTask={onUpdateTask}
        onDeleteTask={onDeleteTask}
        onOpenDetails={onOpenDetails}
      />
    )
  )

  if (!sortable) return <ul className="task-list">{rows}</ul>

  return (
    <SortableTaskArea listId={listId} tasks={tasks}>
      {rows}
    </SortableTaskArea>
  )
}

function SortableTaskArea({ listId, tasks, children }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `list-${listId}`,
    data: { type: 'list', listId },
  })

  return (
    <ul ref={setNodeRef} className={`task-list${isOver ? ' task-list-over' : ''}`}>
      <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </ul>
  )
}

function EmptyDropArea({ listId }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `list-${listId}`,
    data: { type: 'list', listId },
  })

  return (
    <p ref={setNodeRef} className={`task-list-empty${isOver ? ' task-list-over' : ''}`}>
      No tasks yet — drag one here or add below.
    </p>
  )
}

function SortableTaskRow(props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.task.id,
    data: { type: 'task', listId: props.listId },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <TaskRow
      {...props}
      drag={{ attributes, listeners, setNodeRef, style, isDragging }}
    />
  )
}

function TaskRow({ task, listId, onToggle, onUpdateTask, onDeleteTask, onOpenDetails, drag }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(task.text)
  const cancelled = useRef(false)

  const startEditing = () => {
    cancelled.current = false
    setDraft(task.text)
    setEditing(true)
  }

  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false
      setEditing(false)
      return
    }
    const text = draft.trim()
    if (text && text !== task.text) onUpdateTask(listId, task.id, text)
    setEditing(false)
  }

  return (
    <li
      ref={drag?.setNodeRef}
      style={drag?.style}
      className={`task-item${task.done ? ' task-item-done' : ''}${
        drag?.isDragging ? ' task-item-dragging' : ''
      }`}
    >
      <button
        type="button"
        className={`task-dot${task.done ? ' task-dot-done' : ''}`}
        onClick={() => onToggle(listId, task.id)}
        aria-pressed={task.done}
        aria-label={task.done ? `Mark “${task.text}” as not done` : `Mark “${task.text}” as done`}
      >
        {task.done && <Check size={8} strokeWidth={3.5} aria-hidden="true" />}
      </button>

      <div className="task-main">
        {editing ? (
          <input
            className="task-edit-input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                event.currentTarget.blur()
              }
              if (event.key === 'Escape') {
                cancelled.current = true
                setEditing(false)
              }
            }}
            maxLength={MAX_TASK}
            autoFocus
            aria-label="Task text"
          />
        ) : (
          <button
            type="button"
            className="task-text"
            onClick={startEditing}
            title="Click to edit"
          >
            {task.text}
          </button>
        )}

        {!editing && <TaskMeta task={task} />}
      </div>

      <div className="task-actions">
        {drag && (
          <button
            type="button"
            className="task-action task-grip"
            {...drag.attributes}
            {...drag.listeners}
            aria-label={`Reorder ${task.text}`}
            title="Drag to reorder"
          >
            <GripVertical size={14} strokeWidth={2} />
          </button>
        )}
        {onOpenDetails && (
          <button
            type="button"
            className="task-action"
            onClick={() => onOpenDetails(listId, task.id)}
            aria-label={`Details for “${task.text}”`}
            title="Task details"
          >
            <SlidersHorizontal size={14} strokeWidth={2} />
          </button>
        )}
        <button
          type="button"
          className="task-action task-delete"
          onClick={() => onDeleteTask(listId, task.id)}
          aria-label={`Delete “${task.text}”`}
          title="Delete task"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>
    </li>
  )
}

function TaskMeta({ task }) {
  if (!task.due && !task.priority && task.tags.length === 0) return null

  const overdue = isOverdue(task)
  const isToday = task.due === todayKey()

  return (
    <div className="task-meta">
      {task.due && (
        <span
          className={`task-due${overdue ? ' task-due-overdue' : ''}${
            !overdue && isToday ? ' task-due-today' : ''
          }`}
        >
          <CalendarDays size={12} strokeWidth={2} aria-hidden="true" />
          {overdue ? `Overdue · ${formatDue(task.due)}` : dueLabel(task.due)}
        </span>
      )}
      {task.priority && (
        <span className={`task-priority task-priority-${task.priority}`}>
          <span className="priority-dot" aria-hidden="true" />
          {PRIORITY_LABELS[task.priority]}
        </span>
      )}
      {task.tags.map((tag) => (
        <span className="task-tag" key={tag}>
          #{tag}
        </span>
      ))}
    </div>
  )
}

/* ---------------- ADD LIST MODAL ---------------- */

function AddListModal({ onClose, onSave }) {
  const [name, setName] = useState('')
  const [tasks, setTasks] = useState([''])
  const [icon, setIcon] = useState('list')
  const nameRef = useRef(null)
  const taskRefs = useRef([])
  const dialogRef = useDialog(onClose, nameRef)

  const updateTask = (index, value) =>
    setTasks((items) => items.map((item, i) => (i === index ? value : item)))

  const insertTaskAfter = (index) => {
    setTasks((items) => {
      const next = [...items]
      next.splice(index + 1, 0, '')
      return next
    })
    setTimeout(() => taskRefs.current[index + 1]?.focus(), 0)
  }

  const removeTask = (index) => {
    if (tasks.length === 1) {
      updateTask(0, '')
      return
    }
    setTasks((items) => items.filter((_, i) => i !== index))
    setTimeout(() => taskRefs.current[Math.max(0, index - 1)]?.focus(), 0)
  }

  const onTaskKeyDown = (index, event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      insertTaskAfter(index)
    }
    if (event.key === 'Backspace' && tasks[index] === '') {
      event.preventDefault()
      removeTask(index)
    }
  }

  const canSave = name.trim().length > 0 && tasks.some((task) => task.trim())

  const save = () => {
    if (!canSave) return
    onSave({
      title: name.trim(),
      tasks: tasks.map((task) => task.trim()).filter(Boolean),
      icon,
    })
  }

  return (
    <div className="modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="modal-card add-list-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-list-title"
        ref={dialogRef}
      >
        <h2 className="sr-only" id="add-list-title">
          Create a new list
        </h2>

        <input
          ref={nameRef}
          className="modal-name"
          type="text"
          placeholder="List name..."
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              taskRefs.current[0]?.focus()
            }
          }}
          maxLength={MAX_TITLE}
          aria-label="List name"
        />

        <div className="modal-tasks">
          {tasks.map((task, index) => (
            <div key={index} className="modal-task-row">
              <span className="task-dot task-dot-static" aria-hidden="true" />
              <input
                ref={(el) => {
                  taskRefs.current[index] = el
                }}
                type="text"
                placeholder={index === 0 ? 'Task' : ''}
                value={task}
                onChange={(event) => updateTask(index, event.target.value)}
                onKeyDown={(event) => onTaskKeyDown(index, event)}
                maxLength={MAX_TASK}
                aria-label={`Task ${index + 1}`}
              />
              <button
                type="button"
                className="modal-task-remove"
                onClick={() => removeTask(index)}
                aria-label={`Remove task ${index + 1}`}
                title="Remove"
              >
                <X size={14} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>

        <div className="modal-icons" role="group" aria-label="List icon">
          <span className="modal-icons-label">Icon</span>
          {iconChoices.map((key) => {
            const Icon = iconMap[key] ?? ListTodo
            return (
              <button
                key={key}
                type="button"
                className={`modal-icon-btn${icon === key ? ' modal-icon-selected' : ''}`}
                onClick={() => setIcon(key)}
                aria-label={`Icon ${key}`}
                aria-pressed={icon === key}
                title={key}
              >
                <Icon size={18} strokeWidth={2} />
              </button>
            )
          })}
        </div>

        <div className="modal-footer">
          <button className="btn btn-blue" onClick={save} disabled={!canSave}>
            Save list
          </button>
          <button className="btn btn-link" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------------- LIST MODAL ---------------- */

function ListModal({ list, onClose, onToggle, onAddTask, onUpdateTask, onDeleteTask, onOpenDetails }) {
  const [newTask, setNewTask] = useState('')
  const dialogRef = useDialog(onClose)
  const Icon = iconMap[list.icon] ?? ListTodo

  const done = list.tasks.filter((task) => task.done).length
  const total = list.tasks.length

  const submitTask = (event) => {
    event.preventDefault()
    const text = newTask.trim()
    if (!text) return
    onAddTask(list.id, text)
    setNewTask('')
  }

  return (
    <div className="modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="modal-card list-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="list-modal-title"
        ref={dialogRef}
      >
        <div className="list-modal-header">
          <div>
            <h2 className="list-modal-title" id="list-modal-title">
              <Icon size={22} strokeWidth={2} aria-hidden="true" />
              {list.title}
            </h2>
            <p className="list-modal-meta">
              {done} of {total} completed
            </p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={20} strokeWidth={2} />
          </button>
        </div>

        <TaskItems
          listId={list.id}
          tasks={list.tasks}
          onToggle={onToggle}
          onUpdateTask={onUpdateTask}
          onDeleteTask={onDeleteTask}
          onOpenDetails={onOpenDetails}
        />

        <form className="add-task-form" onSubmit={submitTask}>
          <span className="task-dot task-dot-static" aria-hidden="true" />
          <input
            type="text"
            placeholder="Add task..."
            value={newTask}
            onChange={(event) => setNewTask(event.target.value)}
            maxLength={MAX_TASK}
            aria-label="Add task"
          />
        </form>
      </div>
    </div>
  )
}

/* ---------------- TASK DETAILS MODAL ---------------- */

function TaskDetailsModal({ task, listId, onClose, onSave }) {
  const [text, setText] = useState(task.text)
  const [due, setDue] = useState(task.due ?? '')
  const [priority, setPriority] = useState(task.priority ?? 'none')
  const [tagsInput, setTagsInput] = useState(task.tags.join(', '))
  const textRef = useRef(null)
  const dialogRef = useDialog(onClose, textRef)

  const tags = parseTags(tagsInput)
  const canSave = text.trim().length > 0

  const save = () => {
    if (!canSave) return
    onSave({
      text: text.trim().slice(0, MAX_TASK),
      due: due || null,
      priority: priority === 'none' ? null : priority,
      tags,
    })
  }

  return (
    <div className="modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="modal-card task-details-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="details-title"
        ref={dialogRef}
      >
        <div className="list-modal-header">
          <h2 className="details-title" id="details-title">
            Task details
          </h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={20} strokeWidth={2} />
          </button>
        </div>

        <label className="field">
          <span className="field-label">Task</span>
          <input
            ref={textRef}
            className="text-input"
            type="text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={MAX_TASK}
          />
        </label>

        <div className="details-row">
          <label className="field">
            <span className="field-label">Due date</span>
            <input
              className="text-input"
              type="date"
              value={due}
              onChange={(event) => setDue(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn btn-gray details-clear"
            onClick={() => setDue('')}
            disabled={!due}
          >
            Clear
          </button>
        </div>

        <div className="field">
          <span className="field-label" id="priority-label">
            Priority
          </span>
          <div className="priority-options" role="group" aria-labelledby="priority-label">
            {['none', ...PRIORITIES].map((value) => (
              <button
                key={value}
                type="button"
                className={`priority-option${priority === value ? ' priority-option-active' : ''}`}
                aria-pressed={priority === value}
                onClick={() => setPriority(value)}
              >
                {value !== 'none' && (
                  <span className={`priority-dot priority-dot-${value}`} aria-hidden="true" />
                )}
                {value === 'none' ? 'None' : PRIORITY_LABELS[value]}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span className="field-label">Tags</span>
          <input
            className="text-input"
            type="text"
            value={tagsInput}
            onChange={(event) => setTagsInput(event.target.value)}
            placeholder="work, design"
            maxLength={120}
          />
          <span className="field-hint">Comma-separated, up to {MAX_TAGS} tags</span>
        </label>

        {tags.length > 0 && (
          <div className="details-tags">
            {tags.map((tag) => (
              <span className="task-tag" key={tag}>
                #{tag}
              </span>
            ))}
          </div>
        )}

        <div className="modal-footer">
          <button className="btn btn-blue" onClick={save} disabled={!canSave}>
            Save
          </button>
          <button className="btn btn-link" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------------- CHANGE EMAIL MODAL ---------------- */

function ChangeEmailModal({ currentEmail, onClose }) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)
  const dialogRef = useDialog(onClose, inputRef)

  const submit = async (event) => {
    event.preventDefault()
    const value = email.trim().toLowerCase()
    if (!EMAIL_RE.test(value)) {
      setError('Please enter a valid email address')
      return
    }
    if (value === currentEmail) {
      setError('This is already your current email')
      return
    }

    setBusy(true)
    setError('')
    try {
      const { error: authError } = await supabase.auth.updateUser({ email: value })
      if (authError) throw authError
      setNotice(
        'Confirmation link sent to the new address. The email will change after you click it.'
      )
    } catch (authError) {
      setError(authError.message ?? 'Could not change the email')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="modal-card confirm-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-email-title"
        ref={dialogRef}
      >
        <h2 className="confirm-title" id="change-email-title">
          Change email
        </h2>
        <p className="confirm-text">
          Current email: <strong>{currentEmail}</strong>
        </p>
        <form className="login-field" onSubmit={submit} noValidate>
          <input
            ref={inputRef}
            className={`text-input${error ? ' input-error' : ''}`}
            type="email"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            placeholder="new-email@domain.com"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              setError('')
            }}
            aria-invalid={Boolean(error)}
            aria-label="New email"
          />
          {error && (
            <span className="input-error-text" role="alert">
              {error}
            </span>
          )}
          {notice && (
            <span className="input-notice-text" role="status">
              {notice}
            </span>
          )}
          <div className="confirm-actions">
            <button type="button" className="btn btn-gray" onClick={onClose}>
              Close
            </button>
            <button type="submit" className="btn btn-blue" disabled={busy}>
              {busy ? 'Sending…' : 'Send confirmation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ---------------- CONFIRM DIALOG ---------------- */

function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }) {
  const dialogRef = useDialog(onCancel)

  return (
    <div className="modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <div
        className="modal-card confirm-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-text"
        ref={dialogRef}
      >
        <h2 className="confirm-title" id="confirm-title">
          {title}
        </h2>
        <p className="confirm-text" id="confirm-text">
          {message}
        </p>
        <div className="confirm-actions">
          <button className="btn btn-gray" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
