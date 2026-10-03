import { buildTraceSeed } from './trace-seed'
import type { TraceState } from './trace-types'

// 追溯台账单独开一卷 localStorage，不和通用模块的清单混在一起。
const STORAGE_KEY = 'pharma-cleanroom:trace-ledger'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function formatCode(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(9, '0')}`
}

/**
 * 加载时归一：一批码全部核销了，批次主状态就应停在「已核销」。
 * 历史缓存里若停在「已出库」，读到时顺手纠正，保证两处口径一致。
 */
function normalize(state: TraceState): TraceState {
  for (const batch of state.batches) {
    if (batch.status !== '已出库') continue
    let verified = 0
    for (let n = batch.codeStart; n <= batch.codeEnd; n++) {
      const record = state.codes.find((item) => item.code === formatCode(batch.codePrefix, n))
      if (record?.status === '已核销') verified += 1
    }
    if (verified === batch.codeCount) {
      batch.status = '已核销'
    }
  }
  return state
}

function readStorage(): TraceState {
  const fallback = normalize(buildTraceSeed())
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    // 旧缓存缺字段时用种子补齐，避免版本升级后字段读不出来。
    const parsed = JSON.parse(raw) as Partial<TraceState>
    const seed = buildTraceSeed()
    return normalize({
      batches: parsed.batches ?? seed.batches,
      codes: parsed.codes ?? seed.codes,
      scans: parsed.scans ?? seed.scans,
      customers: parsed.customers ?? seed.customers,
      seq: { ...seed.seq, ...(parsed.seq ?? {}) },
    })
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: TraceState | null = null

export function traceState(): TraceState {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function saveTraceState(state: TraceState): void {
  cache = state
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }
}

export function updateTraceState(mutate: (draft: TraceState) => void): TraceState {
  const next = clone(traceState())
  mutate(next)
  saveTraceState(next)
  return next
}

export function resetTraceState(): TraceState {
  const fresh = normalize(buildTraceSeed())
  saveTraceState(fresh)
  return fresh
}

export function traceStorageKey(): string {
  return STORAGE_KEY
}
