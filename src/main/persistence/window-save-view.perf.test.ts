// Fleet-scale cost of one renderer layout patch (title change, tab add) in windowViewPatchForMain.

import { performance } from 'node:perf_hooks'
import { expect, it } from 'vitest'
import type { WorkspaceSessionState } from '../../shared/workspace-session/workspace-session-state-types'
import {
  addWorkspace,
  emptySession
} from '../../shared/workspace-layout/persistence/workspace-layout-session.test-fixture'
import { windowViewPatchForMain } from './window-save-view'
import { windowViewPatchForMain as referencePatch } from './window-save-view-reference.scratch'

const leafId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function fleet(count: number): WorkspaceSessionState {
  const session = emptySession()
  session.unifiedTabs = {}
  for (let i = 0; i < count; i++) {
    const key = `repo-${i % 40}::/Users/dev/w${i}`
    addWorkspace(session, key, [
      {
        id: `g${i}`,
        tabs: [
          { id: `t${i}a`, leaves: [[leafId(2 * i), `pty-${i}a`]] },
          { id: `t${i}b`, leaves: [[leafId(2 * i + 1), `pty-${i}b`]] },
          { id: `c${i}`, kind: 'editor' }
        ]
      }
    ])
    session.lastVisitedAtByWorktreeId = { ...session.lastVisitedAtByWorktreeId, [key]: i }
  }
  return session
}

function titlePatch(stored: WorkspaceSessionState, index: number) {
  const key = Object.keys(stored.tabsByWorktree)[index]!
  const tabsByWorktree = structuredClone(stored.tabsByWorktree)
  tabsByWorktree[key]![0]!.title = `⠋ agent working ${index}`
  return { tabsByWorktree }
}

function measure(
  run: typeof windowViewPatchForMain,
  stored: WorkspaceSessionState,
  patchFor: (i: number) => object,
  runs: number
) {
  const patches = Array.from({ length: runs }, (_, i) => patchFor(i))
  let cloned = 0
  const clone = globalThis.structuredClone
  globalThis.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
    cloned += JSON.stringify(value)?.length ?? 0
    return clone(value, options)
  }) as typeof structuredClone
  try {
    run(stored, patches[0]!, null)
    cloned = 0
    const started = performance.now()
    let out = 0
    for (const patch of patches) {
      out += JSON.stringify(run(stored, patch, null)).length
    }
    const ms = (performance.now() - started) / runs
    return { ms, clonedBytes: cloned / runs, patchInBytes: JSON.stringify(patches[0]).length, outBytes: out / runs }
  } finally {
    globalThis.structuredClone = clone
  }
}

it('reports one layout patch at fleet scale', { timeout: 600_000 }, () => {
  for (const count of [1000, 2000]) {
    const stored = fleet(count)
    const sessionBytes = JSON.stringify(stored).length
    for (const [impl, run] of [['main', referencePatch], ['scoped', windowViewPatchForMain]] as const) {
      const title = measure(run, stored, (i) => titlePatch(stored, (i * 37) % count), 20)
      console.log(
        JSON.stringify({ impl, workspaces: count, sessionBytes, case: 'title', ...title, msPerSecAt6PerSec: title.ms * 6 })
      )
      expect(title.ms).toBeGreaterThan(0)
    }
  }
})
