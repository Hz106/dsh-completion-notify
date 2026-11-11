/**
 * Completion alerts — a browser-half plugin.
 *
 * Watches the shared Session status source: when a conversation stops running
 * while you are not looking at it, it raises a desktop notification, plays a
 * soft chime, and (when the browser cannot show a native notification) shows an
 * in-app toast in the frame-wide overlay layer.
 *
 * It also contributes one row to Settings → General with the master switch,
 * the sound switch, and a "send a test alert" action.
 */
window.__ModuleLoader__.load({
  id: 'dsh-completion-notify',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const PACKAGE = 'dsh-completion-notify'
    const NS = 'completionNotify'
    const STORAGE_KEY = 'dsh.completion-notify.v1'
    const STYLE_ID = PACKAGE + '/styles.css'

    /** Class names owned by this plugin (never the host's hashed module names). */
    const C = {
      row: 'dshcn_row',
      text: 'dshcn_text',
      title: 'dshcn_title',
      description: 'dshcn_description',
      controls: 'dshcn_controls',
      inline: 'dshcn_inline',
      link: 'dshcn_link',
      feedback: 'dshcn_feedback',
      switch: 'dshcn_switch',
      thumb: 'dshcn_thumb',
      toast: 'dshcn_toast',
      toastBody: 'dshcn_toastBody',
      toastTitle: 'dshcn_toastTitle',
      toastText: 'dshcn_toastText',
      toastClose: 'dshcn_toastClose',
    }

    const CSS = `
.dshcn_row{border-bottom:.5px solid var(--dsw-alias-border-l2);display:flex;align-items:center;justify-content:space-between;gap:24px;padding:16px 0}
.dshcn_text{min-width:0}
.dshcn_title{font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary)}
.dshcn_description{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dshcn_controls{margin-top:10px;display:flex;align-items:center;gap:18px;flex-wrap:wrap}
.dshcn_inline{display:inline-flex;align-items:center;gap:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dshcn_state{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dshcn_state[data-tone=warn]{color:var(--dsw-alias-state-warn-primary)}
.dshcn_link{border:0;padding:0;background:none;font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-brand-primary);cursor:pointer;border-radius:4px}
.dshcn_link:hover{text-decoration:underline}
.dshcn_link:disabled{cursor:default;opacity:.5}
.dshcn_link:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
.dshcn_feedback{margin-top:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dshcn_feedback[data-tone=warn]{color:var(--dsw-alias-state-warn-primary)}
.dshcn_switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:999px;background:var(--dsw-alias-border-l3);cursor:pointer}
.dshcn_switch[aria-checked=true]{background:var(--dsw-alias-brand-primary)}
.dshcn_switch:disabled{cursor:default;opacity:.5}
.dshcn_switch:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
.dshcn_thumb{display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary-foreground);transition:transform .12s ease}
.dshcn_switch[aria-checked=false] .dshcn_thumb{background:var(--dsw-alias-switch-thumb)}
.dshcn_switch[aria-checked=true] .dshcn_thumb{transform:translate(16px)}
.dshcn_toast{position:fixed;right:20px;bottom:20px;z-index:60;pointer-events:auto;display:flex;align-items:flex-start;gap:10px;width:320px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px;cursor:pointer;animation:dshcn-in .16s ease-out}
.dshcn_toast:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-brand-primary));outline-offset:2px}
.dshcn_toastBody{min-width:0;flex:1 1 auto}
.dshcn_toastTitle{font-weight:600}
.dshcn_toastText{margin-top:2px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshcn_toastClose{flex:0 0 auto;width:20px;height:20px;padding:0;border:0;border-radius:6px;background:none;color:var(--dsw-alias-label-secondary);font:inherit;font-size:15px;line-height:20px;cursor:pointer}
.dshcn_toastClose:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
@keyframes dshcn-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.dshcn_toast{animation:none}.dshcn_thumb{transition:none}}
`

    /** Copy owned by this plugin; `meta` is read by the plugin inventory. */
    const zh = {
      'meta.title': '完成提醒',
      'meta.description': '会话在后台完成时发送桌面通知，点击通知即可回到该会话。',
      'settings.title': '完成提醒',
      'settings.description': '会话在后台完成时提示你：窗口内提示条 + 系统通知（可用时），点击可回到该会话。',
      'settings.sound': '提示音',
      'settings.banner': '应用内提示条',
      'settings.test': '发送测试提醒',
      'settings.permissionLine': '系统通知权限：{state}',
      'settings.permission.granted': '已允许',
      'settings.permission.default': '未授权',
      'settings.permission.denied': '已被拒绝',
      'settings.permission.unsupported': '当前环境不支持',
      'settings.testNative': '已发送：系统通知。',
      'settings.testInApp': '系统通知未能发出。',
      'settings.testError': '系统拒绝了这条通知。',
      'settings.testUnknown': '已提交，但系统 1.8 秒内没有确认展示（多半被系统通知设置拦截）。',
      'settings.testDenied': '系统通知被拒绝；请在系统设置中允许通知。',
      'settings.testUnsupported': '当前环境不支持系统通知。',
      'notify.meta': 'DeepSeek Harness · 已完成',
      'notify.body': '任务已完成',
      'notify.testTitle': '完成提醒测试',
      'notify.testBody': '看到这条提醒，说明完成提醒已经生效。',
      'toast.close': '关闭提醒',
    }
    const en = {
      'meta.title': 'Completion Alerts',
      'meta.description': 'Sends a desktop notification when a conversation finishes in the background; click it to return to that session.',
      'settings.title': 'Completion alerts',
      'settings.description': 'Alert you when a conversation finishes in the background: an in-app banner plus a system notification when available. Click it to return.',
      'settings.sound': 'Sound',
      'settings.banner': 'In-app banner',
      'settings.test': 'Send a test alert',
      'settings.permissionLine': 'System notifications: {state}',
      'settings.permission.granted': 'allowed',
      'settings.permission.default': 'not requested',
      'settings.permission.denied': 'blocked',
      'settings.permission.unsupported': 'unavailable here',
      'settings.testNative': 'Sent: system notification.',
      'settings.testInApp': 'The system notification could not be delivered.',
      'settings.testError': 'The system rejected that notification.',
      'settings.testUnknown': 'Submitted, but the system did not confirm showing it within 1.8s (often blocked by notification settings).',
      'settings.testDenied': 'System notifications are blocked; allow them in your system settings.',
      'settings.testUnsupported': 'This environment cannot show system notifications.',
      'notify.meta': 'DeepSeek Harness · Done',
      'notify.body': 'Task complete.',
      'notify.testTitle': 'Completion alert test',
      'notify.testBody': 'If you can see this, completion alerts are working.',
      'toast.close': 'Dismiss alert',
    }

    /** Insert this package's stylesheet once; the loader drops tags owned by the entry. */
    function injectStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]') !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = PACKAGE
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    /** Plain observable value shared by the toast and the Settings row. */
    function createStore(initial) {
      let value = initial
      const listeners = new Set()
      return {
        getSnapshot: () => value,
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        set(next) {
          const resolved = typeof next === 'function' ? next(value) : next
          if (resolved === value) return
          value = resolved
          for (const listener of [...listeners]) {
            try {
              listener()
            } catch (error) {
              console.error('completion-notify: subscriber failed', error)
            }
          }
        },
      }
    }

    /** Snapshot source passed to a slot's `hooks` face; the framework builds the hook. */
    function storeSource(store) {
      return {
        getSnapshot: () => store.getSnapshot(),
        subscribe: (listener) => store.subscribe(listener),
      }
    }

    const DEFAULT_SETTINGS = Object.freeze({ enabled: true, sound: true, banner: false })

    function readSettings() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (raw === null || raw === '') return { ...DEFAULT_SETTINGS }
        const parsed = JSON.parse(raw)
        return {
          enabled: parsed.enabled !== false,
          sound: parsed.sound !== false,
          banner: parsed.banner === true,
        }
      } catch (error) {
        return { ...DEFAULT_SETTINGS }
      }
    }

    function writeSettings(settings) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
      } catch (error) {
        console.warn('completion-notify: settings are not persisted', error)
      }
    }

    function notificationConstructor() {
      if (typeof window === 'undefined') return undefined
      const ctor = window.Notification
      return typeof ctor === 'function' ? ctor : undefined
    }

    /** 'granted' | 'denied' | 'default' | 'unsupported'. */
    function permissionState() {
      const ctor = notificationConstructor()
      if (ctor === undefined) return 'unsupported'
      const state = ctor.permission
      return state === 'granted' || state === 'denied' ? state : 'default'
    }

    /** Ask for permission; only a user gesture should call this. */
    function requestPermission() {
      const ctor = notificationConstructor()
      if (ctor === undefined) return Promise.resolve('unsupported')
      if (ctor.permission === 'granted') return Promise.resolve('granted')
      if (ctor.permission === 'denied') return Promise.resolve('denied')
      try {
        return Promise.resolve(ctor.requestPermission()).then(
          (value) => (value === 'granted' ? 'granted' : 'denied'),
          () => 'denied',
        )
      } catch (error) {
        return Promise.resolve('denied')
      }
    }

    /** Show one native notification; returns false when the platform cannot. */
    function showNativeNotification(title, body, onClick, onSettled) {
      const ctor = notificationConstructor()
      if (ctor === undefined || ctor.permission !== 'granted') return false
      try {
        const notification = new ctor(title, { body, silent: true, tag: 'dsh-completion-notify' })
        if (typeof onSettled === 'function') {
          notification.onshow = () => onSettled('shown')
          notification.onerror = () => onSettled('error')
        }
        notification.onclick = () => {
          try {
            window.focus()
          } catch (error) {
            /* focus is best effort */
          }
          try {
            if (typeof onClick === 'function') onClick()
          } catch (error) {
            console.error('completion-notify: notification action failed', error)
          }
          try {
            notification.close()
          } catch (error) {
            /* already closed */
          }
        }
        return true
      } catch (error) {
        console.warn('completion-notify: native notification failed', error)
        return false
      }
    }

    /** Is this page running inside the Desktop shell (dsh-app://app)? */
    function isDesktopShell() {
      return typeof window !== 'undefined' && window.dshDesktop !== undefined
    }

    /** POST to one Host route of this package; returns whether it was accepted. */
    function postHost(path, payload) {
      try {
        return window
          .fetch(path, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-completion-notify': '1' },
            body: JSON.stringify(payload ?? {}),
          })
          .then((response) => response.ok || response.status === 204)
          .catch(() => false)
      } catch (error) {
        return Promise.resolve(false)
      }
    }

    /** The shell paints `data-ds-dark-theme` on <body> for the dark palette. */
    function isDarkTheme() {
      try {
        if (typeof document !== 'undefined' && document.body !== null) {
          if (document.body.hasAttribute('data-ds-dark-theme')) return true
        }
        return (
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-color-scheme: dark)').matches
        )
      } catch (error) {
        return false
      }
    }

    /**
     * Ask the Host half to draw the completion card. Electron renderer
     * notifications are dropped by Windows for this app (no AppUserModelID), so
     * the desktop shell routes alerts through the Host's own card renderer.
     */
    function requestHostToast(alert) {
      return postHost('/completion-notify/toast', {
        sessionId: typeof alert.sessionId === 'string' ? alert.sessionId : '',
        title: alert.title,
        meta: alert.meta,
        fallback: alert.body,
        dark: isDarkTheme(),
      })
    }

    /** One activation ping: proves the page reaches the Host route. */
    function reportActivation() {
      return postHost('/completion-notify/ping', { at: Date.now(), dark: isDarkTheme() })
    }

    /** Soft two-tone chime synthesized with Web Audio; failures are silent. */
    let audioContext
    function playChime() {
      try {
        const Ctor = window.AudioContext || window.webkitAudioContext
        if (typeof Ctor !== 'function') return
        if (audioContext === undefined || audioContext.state === 'closed') audioContext = new Ctor()
        const context = audioContext
        const ring = () => {
          const start = context.currentTime + 0.02
          for (const tone of [
            [880, 0],
            [1318.5, 0.14],
          ]) {
            const frequency = tone[0]
            const offset = tone[1]
            const oscillator = context.createOscillator()
            const gain = context.createGain()
            oscillator.type = 'sine'
            oscillator.frequency.setValueAtTime(frequency, start + offset)
            gain.gain.setValueAtTime(0.0001, start + offset)
            gain.gain.exponentialRampToValueAtTime(0.09, start + offset + 0.012)
            gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.34)
            oscillator.connect(gain)
            gain.connect(context.destination)
            oscillator.start(start + offset)
            oscillator.stop(start + offset + 0.36)
          }
        }
        if (context.state === 'suspended') context.resume().then(ring, () => {})
        else ring()
      } catch (error) {
        /* audio is an enhancement, never a failure */
      }
    }

    function BellIcon() {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: 16,
          height: 16,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          style: { flex: '0 0 auto', marginTop: '1px' },
        },
        h('path', { d: 'M18 9a6 6 0 1 0-12 0c0 4-1.4 5.6-2 6h16c-.6-.4-2-2-2-6Z' }),
        h('path', { d: 'M10 19a2 2 0 0 0 4 0' }),
      )
    }

    function Switch({ checked, label, onChange }) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': checked ? 'true' : 'false',
          'aria-label': label,
          className: C.switch,
          onClick: () => onChange(!checked),
        },
        h('span', { className: C.thumb, 'aria-hidden': true }),
      )
    }

    function SettingsRow({ t, useCompletionSettings, setCompletionSettings, sendTestAlert }) {
      const settings = useCompletionSettings((value) => value)
      const [feedback, setFeedback] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [, setPermissionEpoch] = React.useState(0)
      const permission = permissionState()

      const onTest = () => {
        if (busy) return
        setBusy(true)
        setFeedback(null)
        Promise.resolve()
          .then(sendTestAlert)
          .then(
            (outcome) => setFeedback(outcome),
            () => setFeedback('settings.testInApp'),
          )
          .finally(() => {
            setBusy(false)
            setPermissionEpoch((value) => value + 1)
          })
      }

      const onToggle = (next) => {
        setCompletionSettings({ enabled: next })
        if (!next || permission !== 'default') return
        Promise.resolve(requestPermission()).then(
          () => setPermissionEpoch((value) => value + 1),
          () => setPermissionEpoch((value) => value + 1),
        )
      }

      const controls = settings.enabled
        ? h(
            'div',
            { className: C.controls },
            h(
              'span',
              { className: C.inline },
              h('span', null, t('settings.sound')),
              h(Switch, {
                checked: settings.sound,
                label: t('settings.sound'),
                onChange: (next) => setCompletionSettings({ sound: next }),
              }),
            ),
            h(
              'span',
              { className: C.inline },
              h('span', null, t('settings.banner')),
              h(Switch, {
                checked: settings.banner,
                label: t('settings.banner'),
                onChange: (next) => setCompletionSettings({ banner: next }),
              }),
            ),
            h(
              'button',
              { type: 'button', className: C.link, disabled: busy, onClick: onTest },
              t('settings.test'),
            ),
            h(
              'span',
              { className: C.state, 'data-tone': permission === 'granted' ? undefined : 'warn' },
              t('settings.permissionLine', {
                state: t('settings.permission.' + permission),
              }),
            ),
          )
        : null

      return h(
        'div',
        { className: C.row },
        h(
          'div',
          { className: C.text },
          h('div', { className: C.title }, t('settings.title')),
          h('div', { className: C.description }, t('settings.description')),
          controls,
          feedback === null
            ? null
            : h(
                'div',
                {
                  className: C.feedback,
                  role: 'status',
                  'data-tone': feedback === 'settings.testNative' ? undefined : 'warn',
                },
                t(feedback),
              ),
        ),
        h(Switch, {
          checked: settings.enabled,
          label: t('settings.title'),
          onChange: onToggle,
        }),
      )
    }

    function apply(ctx) {
      injectStyles()

      const settingsStore = createStore(readSettings())
      const noticeStore = createStore(null)
      let noticeSeq = 0
      const lastAlertAt = new Map()

      ctx.effect(
        () =>
          ctx.locale.register(NS, {
            zh,
            en,
          }),
        'completion-notify: dictionaries',
      )
      const t = ctx.locale.bind(NS)

      /**
       * Chromium reports `default` until the page asks for permission; the
       * desktop shell answers the request without a prompt, so ask at
       * activation instead of waiting for a user gesture.
       */
      const grantPermission = () => {
        if (permissionState() !== 'default') return
        Promise.resolve(requestPermission()).catch(() => {})
      }
      if (typeof window !== 'undefined' && window.dshDesktop !== undefined) {
        grantPermission()
        reportActivation()
      }

      const openSession = (sessionId) => {
        try {
          const uiWorkspace = ctx.get('uiWorkspace')
          if (uiWorkspace === undefined) return
          uiWorkspace.openSession(sessionId)
        } catch (error) {
          console.warn('completion-notify: could not open the session', error)
        }
      }

      const publishNotice = (payload) => {
        noticeSeq += 1
        noticeStore.set({ ...payload, seq: noticeSeq })
      }

      const dismissNotice = (seq) => {
        const current = noticeStore.getSnapshot()
        if (current !== null && current.seq === seq) noticeStore.set(null)
      }

      /**
       * The Host card reports its click back through a small pending queue; poll
       * it while the card is alive so a click opens that conversation.
       */
      const watchForOpen = (sessionId) => {
        if (typeof window.fetch !== 'function') return
        if (typeof sessionId !== 'string' || sessionId === '') return
        const started = Date.now()
        const tick = () => {
          if (Date.now() - started > 15000) return
          window
            .fetch('/completion-notify/pending', {
              headers: { 'x-completion-notify': '1' },
              cache: 'no-store',
            })
            .then((response) => (response.ok ? response.json() : null))
            .then((data) => {
              if (data !== null && typeof data === 'object' && data.sessionId === sessionId) {
                openSession(sessionId)
                return
              }
              window.setTimeout(tick, 1200)
            })
            .catch(() => window.setTimeout(tick, 2000))
        }
        window.setTimeout(tick, 1200)
      }

      /** Deliver one alert: chime, the Host card, then the browser channel. */
      const dispatchAlert = (alert, onSettled) => {
        const settings = settingsStore.getSnapshot()
        if (!settings.enabled) return Promise.resolve('off')
        if (settings.sound) playChime()
        if (settings.banner) publishNotice(alert)
        const browserChannel = () => {
          if (permissionState() === 'default') grantPermission()
          const delivered = showNativeNotification(
            alert.title,
            alert.body,
            () => {
              if (typeof alert.sessionId === 'string') openSession(alert.sessionId)
            },
            onSettled,
          )
          return delivered ? 'native' : 'in-app'
        }
        if (isDesktopShell() && typeof window.fetch === 'function') {
          return requestHostToast(alert).then((delivered) => {
            if (!delivered) return browserChannel()
            watchForOpen(alert.sessionId)
            if (typeof onSettled === 'function') onSettled('shown')
            return 'native'
          })
        }
        return Promise.resolve(browserChannel())
      }

      const sendTestAlert = () => {
        if (isDesktopShell() && typeof window.fetch === 'function') {
          return requestHostToast({
            title: t('notify.testTitle'),
            body: t('notify.testBody'),
            meta: t('notify.meta'),
          }).then((delivered) => (delivered ? 'settings.testNative' : 'settings.testError'))
        }
        const ready =
          permissionState() === 'default' ? requestPermission() : Promise.resolve(permissionState())
        return ready.then((permission) => {
          if (permission === 'denied') return 'settings.testDenied'
          if (permission === 'unsupported') return 'settings.testUnsupported'
          return new Promise((resolve) => {
            let settled = false
            const finish = (outcome) => {
              if (settled) return
              settled = true
              resolve(outcome)
            }
            window.setTimeout(() => finish('settings.testUnknown'), 1800)
            dispatchAlert(
              {
                title: t('notify.testTitle'),
                body: t('notify.testBody'),
                sessionId: undefined,
              },
              (state) => finish(state === 'shown' ? 'settings.testNative' : 'settings.testError'),
            ).then((outcome) => {
              if (outcome !== 'native') finish('settings.testError')
            })
          })
        })
      }

      const completionSettingsSource = storeSource(settingsStore)
      const completionNoticeSource = storeSource(noticeStore)

      const setCompletionSettings = (patch) => {
        settingsStore.set((current) => {
          const next = { ...current, ...patch }
          writeSettings(next)
          return next
        })
      }

      ctx.slots.inject('settings.general.item', () =>
        ctx.slots.register(
          {
            name: 'settings.general.item',
            id: 'completion-notify',
            order: 18,
            locale: NS,
            inject: () => ({
              hooks: { completionSettings: completionSettingsSource },
              setCompletionSettings,
              sendTestAlert,
            }),
          },
          SettingsRow,
        ),
      )

      /**
       * The frame-wide half. It renders nothing unless the browser cannot show a
       * native notification, and it owns completion detection through the slot's
       * standard `useSessionStatus`/`useSessions` props.
       */
      const CompletionBridge = ({ useSessionStatus, useSessions, useCompletionNotice }) => {
        const statuses = useSessionStatus((value) => value)
        const byId = useSessions((list) => list.byId)
        const notice = useCompletionNotice((value) => value)
        const previous = React.useRef(null)
        const noticeSeqKey = notice === null ? null : notice.seq

        React.useEffect(() => {
          const before = previous.current
          previous.current = statuses
          if (before === null || before === statuses) return
          const focused =
            typeof document !== 'undefined' &&
            document.visibilityState === 'visible' &&
            document.hasFocus()
          const now = Date.now()
          for (const entry of statuses) {
            const sessionId = entry[0]
            const next = entry[1]
            const previousStatus = before.get(sessionId)
            const stopped =
              previousStatus !== undefined && previousStatus.running === true && next.running !== true
            const becameUnread =
              next.completionUnread === true &&
              !(previousStatus !== undefined && previousStatus.completionUnread === true)
            if (!stopped && !becameUnread) continue
            if (!becameUnread && focused) continue
            const summary = byId[sessionId]
            if (summary === undefined) continue
            if (summary.origin === 'subagent') continue
            const last = lastAlertAt.get(sessionId)
            if (last !== undefined && now - last < 3000) continue
            lastAlertAt.set(sessionId, now)
            dispatchAlert({
              title: summary.displayTitle || sessionId,
              body: t('notify.body'),
              meta: t('notify.meta'),
              sessionId,
            }).catch(() => {})
          }
        }, [statuses, byId])

        React.useEffect(() => {
          if (noticeSeqKey === null) return undefined
          const timer = window.setTimeout(() => dismissNotice(noticeSeqKey), 12000)
          return () => window.clearTimeout(timer)
        }, [noticeSeqKey])

        if (notice === null) return null

        const open = () => {
          if (typeof notice.sessionId === 'string' && notice.sessionId !== '') {
            openSession(notice.sessionId)
          }
          dismissNotice(notice.seq)
        }

        return h(
          'div',
          {
            className: C.toast,
            role: 'status',
            'aria-live': 'polite',
            tabIndex: 0,
            onClick: open,
            onKeyDown: (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                open()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                dismissNotice(notice.seq)
              }
            },
          },
          h(BellIcon, null),
          h(
            'div',
            { className: C.toastBody },
            h('div', { className: C.toastTitle }, notice.title),
            h('div', { className: C.toastText }, notice.body),
          ),
          h(
            'button',
            {
              type: 'button',
              className: C.toastClose,
              'aria-label': t('toast.close'),
              onClick: (event) => {
                event.stopPropagation()
                dismissNotice(notice.seq)
              },
            },
            '\u00d7',
          ),
        )
      }

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'completion-notify.bridge',
            order: 413,
            locale: NS,
            inject: () => ({ hooks: { completionNotice: completionNoticeSource } }),
          },
          CompletionBridge,
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply,
    }
  },
})
