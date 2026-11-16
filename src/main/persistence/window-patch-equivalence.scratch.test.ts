// Scratch: scoped windowViewPatchForMain must equal main's full join for every patch shape.

import { expect, it } from 'vitest'
import type { WorkspaceSessionState } from '../../shared/workspace-session/workspace-session-state-types'
import { addWorkspace } from '../../shared/workspace-layout/persistence/workspace-layout-session.test-fixture'
import { WORKSPACE_LAYOUT_PROFILES } from '../../shared/workspace-layout/persistence/workspace-layout-profile.test-fixture'
import { windowViewPatchForMain } from './window-save-view'
import { windowViewPatchForMain as referencePatch } from './window-save-view-reference.scratch'
import { scopeWindowPatch } from './window-patch-workspace-scope'

const leafId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function withFleet(session: WorkspaceSessionState, count: number): WorkspaceSessionState {
  for (let i = 0; i < count; i++) {
    const key = `repo-${i % 5}::/Users/dev/w${i}`
    addWorkspace(session, key, [
      {
        id: `g${i}`,
        tabs: [
          { id: `t${i}a`, leaves: [[leafId(10 + 2 * i), `pty-${i}a`]] },
          { id: `t${i}b`, leaves: [[leafId(11 + 2 * i), `pty-${i}b`], [leafId(900 + i)]] },
          { id: `c${i}`, kind: 'editor' }
        ]
      }
    ])
    session.lastVisitedAtByWorktreeId = { ...session.lastVisitedAtByWorktreeId, [key]: i }
  }
  return session
}

type Mutation = (s: WorkspaceSessionState, key: string, other: string) => object
const c = <T>(v: T): T => structuredClone(v)

const MUTATIONS: Record<string, Mutation> = {
  title: (s, key) => {
    const tabsByWorktree = c(s.tabsByWorktree)
    if (tabsByWorktree[key]?.[0]) tabsByWorktree[key][0].title = 'changed title'
    return { tabsByWorktree }
  },
  unchanged: (s) => ({ tabsByWorktree: c(s.tabsByWorktree), unifiedTabs: c(s.unifiedTabs) }),
  reordered: (s) => ({
    tabsByWorktree: Object.fromEntries(Object.entries(c(s.tabsByWorktree)).toReversed())
  }),
  addTab: (s, key) => {
    const tabsByWorktree = c(s.tabsByWorktree)
    const unifiedTabs = c(s.unifiedTabs ?? {})
    const tabGroups = c(s.tabGroups ?? {})
    const terminalLayoutsByTabId = c(s.terminalLayoutsByTabId)
    const group = tabGroups[key]?.[0]
    if (!group) return {}
    const id = 'new-tab-1'
    tabsByWorktree[key] = [
      ...(tabsByWorktree[key] ?? []),
      { id, ptyId: 'new-pty', worktreeId: key, title: 'New', customTitle: null, color: null, sortOrder: 9, createdAt: 5 }
    ]
    unifiedTabs[key] = [
      ...(unifiedTabs[key] ?? []),
      { id, entityId: id, contentType: 'terminal', label: 'New', groupId: group.id, worktreeId: key, sortOrder: 9, createdAt: 5, customLabel: null, color: null }
    ]
    group.tabOrder.push(id)
    terminalLayoutsByTabId[id] = {
      root: { type: 'leaf', leafId: leafId(5000) },
      activeLeafId: leafId(5000),
      expandedLeafId: null,
      ptyIdsByLeafId: { [leafId(5000)]: 'new-pty' }
    }
    return { tabsByWorktree, unifiedTabs, tabGroups, terminalLayoutsByTabId }
  },
  closeTab: (s, key) => {
    const row = s.tabsByWorktree[key]?.[0]
    if (!row) return {}
    const tabsByWorktree = c(s.tabsByWorktree)
    const unifiedTabs = c(s.unifiedTabs ?? {})
    const tabGroups = c(s.tabGroups ?? {})
    const terminalLayoutsByTabId = c(s.terminalLayoutsByTabId)
    tabsByWorktree[key] = tabsByWorktree[key]!.filter((r) => r.id !== row.id)
    unifiedTabs[key] = (unifiedTabs[key] ?? []).filter((e) => e.entityId !== row.id)
    for (const g of tabGroups[key] ?? []) g.tabOrder = g.tabOrder.filter((id) => id !== row.id)
    delete terminalLayoutsByTabId[row.id]
    return { tabsByWorktree, unifiedTabs, tabGroups, terminalLayoutsByTabId }
  },
  moveTab: (s, key, other) => {
    const row = s.tabsByWorktree[key]?.[0]
    const target = s.tabGroups?.[other]?.[0]
    if (!row || !target) return {}
    const tabsByWorktree = c(s.tabsByWorktree)
    const unifiedTabs = c(s.unifiedTabs ?? {})
    const tabGroups = c(s.tabGroups ?? {})
    tabsByWorktree[key] = tabsByWorktree[key]!.filter((r) => r.id !== row.id)
    tabsByWorktree[other] = [...(tabsByWorktree[other] ?? []), { ...row, worktreeId: other }]
    const entry = (unifiedTabs[key] ?? []).find((e) => e.entityId === row.id)
    unifiedTabs[key] = (unifiedTabs[key] ?? []).filter((e) => e.entityId !== row.id)
    if (entry) unifiedTabs[other] = [...(unifiedTabs[other] ?? []), { ...entry, worktreeId: other, groupId: target.id }]
    for (const g of tabGroups[key] ?? []) g.tabOrder = g.tabOrder.filter((id) => id !== (entry?.id ?? row.id))
    tabGroups[other]![0]!.tabOrder.push(entry?.id ?? row.id)
    return { tabsByWorktree, unifiedTabs, tabGroups }
  },
  viewAndLayout: (s, key) => {
    const tabGroups = c(s.tabGroups ?? {})
    const group = tabGroups[key]?.[0]
    if (group) group.activeTabId = group.tabOrder.at(-1) ?? null
    return {
      tabGroups,
      activeGroupIdByWorktree: { ...s.activeGroupIdByWorktree, [key]: group?.id ?? 'x' },
      activeTabIdByWorktree: { ...s.activeTabIdByWorktree, [key]: group?.tabOrder.at(-1) ?? null },
      activeTabId: group?.tabOrder.at(-1) ?? null
    }
  },
  visitedEmpty: (s, key) => {
    const tabsByWorktree = c(s.tabsByWorktree)
    delete tabsByWorktree[key]
    return { tabsByWorktree, lastVisitedAtByWorktreeId: { ...s.lastVisitedAtByWorktreeId, [key]: 99 } }
  },
  duplicateRow: (s, key, other) => {
    const row = s.tabsByWorktree[other]?.[0]
    if (!row) return {}
    const tabsByWorktree = c(s.tabsByWorktree)
    tabsByWorktree[key] = [...(tabsByWorktree[key] ?? []), { ...row, title: 'dup' }]
    return { tabsByWorktree }
  },
  splitPane: (s, key) => {
    const row = s.tabsByWorktree[key]?.[0]
    if (!row) return {}
    const terminalLayoutsByTabId = c(s.terminalLayoutsByTabId)
    const layout = terminalLayoutsByTabId[row.id]
    if (!layout?.root) return {}
    layout.root = { type: 'split', direction: 'vertical', ratio: 0.5, first: layout.root, second: { type: 'leaf', leafId: leafId(7000) } }
    return { terminalLayoutsByTabId }
  },
  sleeping: (s, key) => {
    const row = s.tabsByWorktree[key]?.[0]
    const layout = row ? s.terminalLayoutsByTabId[row.id] : undefined
    const leaf = layout?.root?.type === 'leaf' ? layout.root.leafId : undefined
    if (!row || !leaf) return {}
    return {
      sleepingAgentSessionsByPaneKey: {
        ...s.sleepingAgentSessionsByPaneKey,
        [`${row.id}:${leaf}`]: {
          paneKey: `${row.id}:${leaf}`, tabId: row.id, worktreeId: key, agent: 'claude',
          providerSession: { key: 'session_id', id: 'sess' }, prompt: 'p', state: 'done',
          capturedAt: 1, updatedAt: 1, origin: 'quit'
        }
      },
      tabsByWorktree: c(s.tabsByWorktree)
    }
  },
  unknownLayout: (s) => ({
    terminalLayoutsByTabId: { ...c(s.terminalLayoutsByTabId), 'nobody-tab': { root: null, activeLeafId: null, expandedLeafId: null } }
  })
}

it('matches main for every patch shape, profile and workspace', () => {
  let cases = 0
  let scoped = 0
  const orderDiffs: string[] = []
  for (const profile of WORKSPACE_LAYOUT_PROFILES) {
    const stored = withFleet(profile.build(), 12)
    const keys = Object.keys(stored.tabsByWorktree)
    for (const [name, mutate] of Object.entries(MUTATIONS)) {
      for (const [index, key] of keys.entries()) {
        const other = keys[(index + 3) % keys.length]!
        const patch = mutate(c(stored), key, other)
        if (Object.keys(patch).length === 0) continue
        const expected = referencePatch(c(stored), c(patch), profile.hostId)
        const actual = windowViewPatchForMain(c(stored), c(patch), profile.hostId)
        expect(actual, `${profile.name} ${name} ${key}`).toEqual(expected)
        if (JSON.stringify(actual) !== JSON.stringify(expected)) orderDiffs.push(`${profile.name} ${name} ${key}`)
        cases++
        if (scopeWindowPatch(stored, { ...stored, ...patch }, Object.keys(patch))) scoped++
      }
    }
  }
  console.log(JSON.stringify({ cases, scoped, orderDiffs: orderDiffs.length, sample: orderDiffs.slice(0, 5) }))
})
