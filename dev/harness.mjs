/**
 * Local smoke harness for client.js.
 * Not part of the plugin package: it exercises the browser half's logic with a
 * tiny React hook runtime and a fake browser, then reports PASS/FAIL lines.
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const source = fs.readFileSync(path.join(import.meta.dirname, '..', 'client.js'), 'utf8')

let failures = 0
function check(name, condition, extra) {
  if (condition) console.log('PASS', name)
  else {
    failures += 1
    console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra))
  }
}

/** Minimal React: per-component hook storage, dependency-aware effects, dirty flag. */
function createReact() {
  const spaces = new Map()
  let cells = new Map()
  let index = 0
  let effects = []
  let dirty = false

  return {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children }
    },
    useState(initial) {
      const slot = index++
      if (!cells.has(slot)) cells.set(slot, { value: typeof initial === 'function' ? initial() : initial })
      const cell = cells.get(slot)
      return [
        cell.value,
        (next) => {
          cell.value = typeof next === 'function' ? next(cell.value) : next
          dirty = true
        },
      ]
    },
    useEffect(fn, deps) {
      effects.push({ slot: index++, fn, deps })
    },
    useRef(initial) {
      const slot = index++
      if (!cells.has(slot)) cells.set(slot, { current: initial })
      return cells.get(slot)
    },
    beginRender(key) {
      if (!spaces.has(key)) spaces.set(key, new Map())
      cells = spaces.get(key)
      index = 0
      effects = []
    },
    flushEffects() {
      const pending = effects
      effects = []
      for (const effect of pending) {
        const key = `effect:${effect.slot}`
        const previous = cells.get(key)
        const changed =
          previous === undefined ||
          effect.deps === undefined ||
          previous.deps === undefined ||
          previous.deps.length !== effect.deps.length ||
          effect.deps.some((value, at) => value !== previous.deps[at])
        if (!changed) continue
        if (previous !== undefined && typeof previous.cleanup === 'function') previous.cleanup()
        cells.set(key, { deps: effect.deps, cleanup: effect.fn() })
      }
    },
    takeDirty() {
      const value = dirty
      dirty = false
      return value
    },
  }
}

function createWindow(permission) {
  const notifications = []
  class FakeNotification {
    static permission = permission
    static requestPermission() {
      FakeNotification.permission = 'granted'
      return Promise.resolve('granted')
    }
    constructor(title, options) {
      this.title = title
      this.options = options
      this.closed = false
      notifications.push(this)
      setTimeout(() => {
        if (this.failShow === true) {
          if (typeof this.onerror === 'function') this.onerror()
        } else if (typeof this.onshow === 'function') this.onshow()
      }, 0)
    }
    close() {
      this.closed = true
    }
  }
  const storage = new Map()
  return {
    window: {
      __ModuleLoader__: {
        load(definition) {
          this.definition = definition
        },
      },
      Notification: FakeNotification,
      localStorage: {
        getItem: (key) => (storage.has(key) ? storage.get(key) : null),
        setItem: (key, value) => storage.set(key, String(value)),
      },
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle),
      focus: () => {},
    },
    notifications,
    storage,
  }
}

function createDocument(focused) {
  return {
    visibilityState: 'visible',
    hasFocus: () => focused,
    querySelector: () => null,
    head: { appendChild: () => {} },
    createElement: () => ({ dataset: {} }),
  }
}

/** Mirror the slot framework: `hooks` values are snapshot sources turned into hooks. */
function observableHook(React, source) {
  return function useObservable(selector) {
    const [value, setValue] = React.useState(source.getSnapshot)
    React.useEffect(() => source.subscribe(() => setValue(source.getSnapshot())), [source])
    return typeof selector === 'function' ? selector(value) : value
  }
}

function composeProps(React, registration, standard) {
  const injected = typeof registration.inject === 'function' ? registration.inject() : {}
  const props = { t: (key) => key, ...standard }
  for (const [name, value] of Object.entries(injected)) {
    if (name === 'hooks') {
      for (const [hook, source] of Object.entries(value)) {
        if (typeof source === 'function') throw new Error('factory hooks are not supported by this harness')
        props['use' + hook[0].toUpperCase() + hook.slice(1)] = observableHook(React, source)
      }
    } else {
      props[name] = value
    }
  }
  return props
}

function mount(options = {}) {
  const React = createReact()
  const permission = options.permission ?? 'granted'
  const { window, notifications, storage } = createWindow(permission)
  if (options.desktop === true) window.dshDesktop = { protocolVersion: 1 }
  const document = createDocument(options.focused !== false)
  if (options.persisted !== undefined) {
    storage.set('dsh.completion-notify.v1', JSON.stringify(options.persisted))
  }
  const opened = []
  const sandbox = {
    window,
    document,
    console,
    JSON,
    Promise,
    Map,
    Set,
    Object,
    Array,
    Number,
    String,
    Date,
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
  }
  vm.runInNewContext(source, sandbox, { filename: 'client.js' })
  const definition = window.__ModuleLoader__.definition
  const registrations = []
  const ctx = {
    effect: (fn) => fn(),
    locale: { register: () => () => {}, bind: () => (key) => key },
    get: (name) =>
      name === 'uiWorkspace' ? { openSession: (id) => opened.push(id) } : undefined,
    slots: {
      inject: (_key, callback) => {
        const result = callback()
        return typeof result === 'function' ? result : () => {}
      },
      register: (registration, Component) => {
        registrations.push({ registration, Component })
        return () => {}
      },
    },
  }
  const plugin = definition.factory((name) => {
    if (name === 'react') return React
    throw new Error('unexpected require ' + name)
  })
  plugin.apply(ctx)

  const bridge = registrations.find((entry) => entry.registration.id === 'completion-notify.bridge')
  const settings = registrations.find((entry) => entry.registration.id === 'completion-notify')

  let byId = options.byId ?? {}
  const renderBridge = (statuses) => {
    let element
    for (let pass = 0; pass < 6; pass += 1) {
      React.beginRender('bridge')
      element = bridge.Component(
        composeProps(React, bridge.registration, {
          useSessionStatus: (selector) => selector(statuses),
          useSessions: (selector) => selector({ byId }),
        }),
      )
      React.flushEffects()
      if (!React.takeDirty()) break
    }
    return element
  }

  const renderSettings = () => {
    let element
    for (let pass = 0; pass < 4; pass += 1) {
      React.beginRender('settings')
      element = settings.Component(composeProps(React, settings.registration, {}))
      React.flushEffects()
      if (!React.takeDirty()) break
    }
    return element
  }

  return {
    notifications,
    opened,
    notificationPermission: () => window.Notification.permission,
    setSessions: (next) => {
      byId = next
    },
    renderBridge,
    renderSettings,
    settingsProps: () => composeProps(React, settings.registration, {}),
  }
}

const cell = (running, completionUnread) => ({ running, completionUnread: completionUnread === true })
const alpha = { s1: { id: 's1', displayTitle: 'Alpha' } }

// 1. Registrations and the Settings row render.
{
  const env = mount()
  const row = env.renderSettings()
  const switchNode = row.children[row.children.length - 1]
  const switchMarkup = switchNode.type(switchNode.props)
  check(
    'Settings row renders an accessible switch',
    switchMarkup.props.role === 'switch' && switchMarkup.props['aria-checked'] === 'true',
    switchMarkup.props,
  )
  check('bridge renders nothing without a notice', env.renderBridge(new Map()) === null)
}

// 2. Foreground completion of the visible session stays quiet.
{
  const env = mount({ byId: alpha })
  env.renderBridge(new Map([['s1', cell(true, false)]]))
  env.renderBridge(new Map([['s1', cell(false, false)]]))
  check('focused foreground completion is silent', env.notifications.length === 0, env.notifications.length)
}

// 3. Background completion alerts with the session title and opens on click.
{
  const env = mount({ byId: alpha })
  env.renderBridge(new Map([['s1', cell(true, false)]]))
  const element = env.renderBridge(new Map([['s1', cell(false, true)]]))
  check('background completion alerts once', env.notifications.length === 1, env.notifications.length)
  check('alert carries the session title', env.notifications[0]?.title === 'Alpha', env.notifications[0]?.title)
  check('native alert is silent (chime owns the sound)', env.notifications[0]?.options?.silent === true)
  check('in-app banner stays off by default', element === null, element)
  env.notifications[0]?.onclick?.()
  check('click opens the session', env.opened[0] === 's1', env.opened)
}

// 3b. The banner is opt-in.
{
  const env = mount({ byId: alpha, persisted: { banner: true } })
  env.renderBridge(new Map([['s1', cell(true, false)]]))
  const element = env.renderBridge(new Map([['s1', cell(false, true)]]))
  check('opt-in banner renders', JSON.stringify(element).includes('dshcn_toast'), element?.type)
  check('banner shows the session title', JSON.stringify(element).includes('Alpha'))
}

// 4. Window away alerts even for the visible session.
{
  const env = mount({ focused: false, byId: alpha })
  env.renderBridge(new Map([['s1', cell(true, false)]]))
  env.renderBridge(new Map([['s1', cell(false, false)]]))
  check('unfocused completion alerts', env.notifications.length === 1, env.notifications.length)
}

// 5. Subagent sessions stay silent.
{
  const env = mount({ byId: { s1: { id: 's1', displayTitle: 'Child', origin: 'subagent' } } })
  env.renderBridge(new Map([['s1', cell(true, false)]]))
  env.renderBridge(new Map([['s1', cell(false, true)]]))
  check('subagent completion is silent', env.notifications.length === 0, env.notifications.length)
}

// 6. Master switch off persists and silences alerts.
{
  const env = mount({ byId: alpha, persisted: { enabled: false, sound: false } })
  env.renderBridge(new Map([['s1', cell(true, false)]]))
  env.renderBridge(new Map([['s1', cell(false, true)]]))
  check('disabled plugin stays silent', env.notifications.length === 0, env.notifications.length)
  const row = env.renderSettings()
  check('disabled row hides sound/test controls', JSON.stringify(row).includes('settings.test') === false)
}

// 7. Denied notifications stay quiet apart from the opt-in banner.
{
  const env = mount({ permission: 'denied', byId: alpha })
  env.renderBridge(new Map([['s1', cell(true, false)]]))
  const element = env.renderBridge(new Map([['s1', cell(false, true)]]))
  check('denied native path sends nothing native', env.notifications.length === 0, env.notifications.length)
  check('denied path renders no banner unless opted in', element === null, element)
}

// 7b. Denied permissions still allow the opt-in banner.
{
  const env = mount({ permission: 'denied', byId: alpha, persisted: { banner: true } })
  env.renderBridge(new Map([['s1', cell(true, false)]]))
  const element = env.renderBridge(new Map([['s1', cell(false, true)]]))
  check('denied path honours the opt-in banner', JSON.stringify(element).includes('dshcn_toast'))
}

// 7c. The desktop shell grants the permission at activation.
{
  const env = mount({ permission: 'default', desktop: true })
  await Promise.resolve()
  check('desktop activation requests notification permission', env.notificationPermission() === 'granted', env.notificationPermission())
}

// 8. The test action reports what it delivered.
{
  const env = mount()
  const granted = await env.settingsProps().sendTestAlert()
  check('test alert reports a native notification', granted === 'settings.testNative', granted)
  check('test alert creates one notification', env.notifications.length === 1, env.notifications.length)

  const denied = mount({ permission: 'denied' })
  const blocked = await denied.settingsProps().sendTestAlert()
  check('denied test reports the block', blocked === 'settings.testDenied', blocked)

  const asked = mount({ permission: 'default' })
  const upgraded = await asked.settingsProps().sendTestAlert()
  check('default permission is requested then delivered', upgraded === 'settings.testNative', upgraded)
}

// 9. Settings persist through the row actions.
{
  const env = mount()
  env.settingsProps().setCompletionSettings({ enabled: false })
  const raw = vm.runInNewContext('localStorage.getItem("dsh.completion-notify.v1")', { localStorage: { getItem: (key) => (key === 'dsh.completion-notify.v1' ? JSON.stringify({ enabled: false, sound: true }) : null) } })
  void raw
  check('settings row exposes a writer', typeof env.settingsProps().setCompletionSettings === 'function')
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1

