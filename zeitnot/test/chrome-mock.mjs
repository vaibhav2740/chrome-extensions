// A small in-memory stand-in for the chrome.* APIs Zeitnot uses, for service worker and popup tests.

export function makeChrome({ withNotifications = false } = {}) {
  const store = {};
  const listeners = () => {
    const fns = [];
    return { addListener: (f) => fns.push(f), removeListener: (f) => fns.splice(fns.indexOf(f), 1), fns, fire: (...a) => Promise.all(fns.map((f) => f(...a))) };
  };
  const events = {
    installed: listeners(), startup: listeners(), alarm: listeners(), message: listeners(), storageChanged: listeners(),
    permissionsAdded: listeners(), notificationClicked: listeners(),
  };
  const alarms = new Map();
  const badge = { text: null, color: null, title: null, textColor: null };
  const created = [];
  const sent = [];
  const tabs = [];
  const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  const chrome = {
    runtime: {
      onInstalled: events.installed, onStartup: events.startup, onMessage: events.message,
      getURL: (p) => `chrome-extension://zeitnot/${p}`,
      sendMessage: async (msg) => {
        sent.push(msg);
        const replies = [];
        for (const f of events.message.fns) {
          const reply = await new Promise((resolve) => {
            let answered = false;
            const keep = f(msg, {}, (r) => { answered = true; resolve(r); });
            if (keep !== true && !answered) resolve(undefined);
          });
          if (reply !== undefined) replies.push(reply);
        }
        return replies[0];
      },
    },
    storage: {
      local: {
        get: async (keys) => {
          const list = Array.isArray(keys) ? keys : keys == null ? Object.keys(store) : [keys];
          return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, copy(store[k])]));
        },
        set: async (obj) => {
          const changes = {};
          for (const [k, v] of Object.entries(obj)) {
            changes[k] = { oldValue: copy(store[k]), newValue: copy(v) };
            store[k] = copy(v);
          }
          await events.storageChanged.fire(changes, 'local');
        },
        remove: async (keys) => { for (const k of [].concat(keys)) delete store[k]; },
      },
      onChanged: events.storageChanged,
    },
    alarms: {
      create: async (name, info) => { alarms.set(name, info); },
      get: async (name) => (alarms.has(name) ? { name, ...alarms.get(name) } : undefined),
      clear: async (name) => alarms.delete(name),
      onAlarm: events.alarm,
    },
    action: {
      setBadgeText: async ({ text }) => { badge.text = text; },
      setBadgeBackgroundColor: async ({ color }) => { badge.color = color; },
      setBadgeTextColor: async ({ color }) => { badge.textColor = color; },
      setTitle: async ({ title }) => { badge.title = title; },
    },
    permissions: { onAdded: events.permissionsAdded, contains: async () => withNotifications, request: async () => true },
    tabs: { create: async (o) => { tabs.push(o); } },
  };
  if (withNotifications) {
    chrome.notifications = {
      create: async (id, opts) => { created.push({ id, ...opts }); },
      clear: () => {},
      onClicked: events.notificationClicked,
    };
  }
  return { chrome, store, events, alarms, badge, created, sent, tabs };
}
