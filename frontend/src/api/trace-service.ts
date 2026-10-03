import { TRACE_SEED_BATCHES, TRACE_SEED_EVENTS, TRACE_BATCH_KEY, TRACE_EVENT_KEY } from '@/data/trace-seed'
import {
  BATCH_STATUSES,
  CODE_STAGES,
  MAX_SCAN_CODES,
  WRITEOFF_STATUSES,
  batchWriteoffStatus,
  formatCode,
  stageOfCode,
  summarizeBatchStatus,
} from '@/data/trace-types'
import type {
  BatchStatus,
  CodeStage,
  ScanKind,
  TraceBatch,
  TraceResult,
  TraceScanEvent,
  WriteoffStatus,
} from '@/data/trace-types'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) return clone(fallback)
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
}

let batchCache: TraceBatch[] | null = null
let eventCache: TraceScanEvent[] | null = null

function allBatches(): TraceBatch[] {
  if (batchCache === null) batchCache = readJson(TRACE_BATCH_KEY, TRACE_SEED_BATCHES)
  return batchCache
}

function allEvents(): TraceScanEvent[] {
  if (eventCache === null) eventCache = readJson(TRACE_EVENT_KEY, TRACE_SEED_EVENTS)
  return eventCache
}

function persistBatches(rows: TraceBatch[]): void {
  batchCache = rows
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(TRACE_BATCH_KEY, JSON.stringify(rows))
  }
}

function persistEvents(rows: TraceScanEvent[]): void {
  eventCache = rows
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(TRACE_EVENT_KEY, JSON.stringify(rows))
  }
}

export function resetTrace(): void {
  batchCache = null
  eventCache = null
  persistBatches(clone(TRACE_SEED_BATCHES))
  persistEvents(clone(TRACE_SEED_EVENTS))
}

// ---- 查询口径 ----------------------------------------------------------------

/** 批次状态以码集合为单一事实来源：除显式「已作废」外，读取时一律按码集合重新汇总，避免存量脏状态。 */
function normalizeStatus(batch: TraceBatch): BatchStatus {
  if (batch.status === '已作废') return '已作废'
  return summarizeBatchStatus(batch)
}

/** 赋码批次口径统一成只留最新一版：默认查询只出每个批次号的最大版本。 */
export function listBatches({ onlyLatest = true }: { onlyLatest?: boolean } = {}): TraceBatch[] {
  const rows = allBatches()
  const picked = onlyLatest
    ? [...rows]
        .filter((b) => {
          const maxVersion = Math.max(...rows.filter((x) => x.batchNo === b.batchNo).map((x) => x.version))
          return b.version === maxVersion
        })
    : [...rows]
  return clone(picked.map((b) => ({ ...b, status: normalizeStatus(b) }))).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )
}

export function listVersions(batchNo: string): TraceBatch[] {
  return clone(
    allBatches()
      .filter((b) => b.batchNo === batchNo)
      .sort((a, b) => b.version - a.version)
      .map((b) => ({ ...b, status: normalizeStatus(b) })),
  )
}

function findLatest(batchNo: string): TraceBatch | undefined {
  return allBatches()
    .filter((b) => b.batchNo === batchNo)
    .sort((a, b) => b.version - a.version)[0]
}

/** 取最新版并把存量脏状态自愈为码集合口径；显式作废不覆盖。 */
function findLatestNormalized(batchNo: string): TraceBatch | undefined {
  const row = findLatest(batchNo)
  if (!row) return undefined
  return { ...row, status: normalizeStatus(row) }
}

export function listEvents(filters: { batchNo?: string; kind?: string } = {}): TraceScanEvent[] {
  return clone(
    allEvents()
      .filter((e) => (!filters.batchNo || e.batchNo === filters.batchNo))
      .filter((e) => (!filters.kind || e.kind === filters.kind))
      .sort((a, b) => b.id - a.id),
  )
}

export type QcWriteoffRow = {
  productBatchNo: string
  batchNo: string
  version: number
  productName: string
  customer: string
  scanner: string
  writeoff: WriteoffStatus
  total: number
  inbound: number
  outbound: number
  writeoffCount: number
  returned: number
}

/** 成品检验清单拿到的核销状态就从这里取；追溯台账页面也是同一函数，同一套口径。 */
export function qcWriteoffRows(): QcWriteoffRow[] {
  return listBatches()
    .filter((b) => b.status !== '已作废')
    .map((b) => ({
      productBatchNo: b.productBatchNo,
      batchNo: b.batchNo,
      version: b.version,
      productName: b.productName,
      customer: b.customer,
      scanner: b.scanner,
      writeoff: batchWriteoffStatus(b),
      total: b.codeEnd - b.codeStart + 1,
      inbound: b.inboundCodes.length,
      outbound: b.outboundCodes.length,
      writeoffCount: b.writeoffCodes.length,
      returned: b.returnedCodes.length,
    }))
}

export function writeoffStatusByProductBatch(productBatchNo: string): WriteoffStatus | '' {
  const hit = qcWriteoffRows().find((row) => row.productBatchNo === productBatchNo)
  return hit ? hit.writeoff : ''
}

// ---- 校验口径：越界 / 超限 / 倒序一律挡回 -----------------------------------

/** 核销状态越界挡回：不是三档枚举里的值，任何页面都不许写。 */
export function guardWriteoffStatus(status: string): TraceResult<WriteoffStatus> {
  if (!(WRITEOFF_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, message: `核销状态「${status}」越界，只允许：${WRITEOFF_STATUSES.join(' / ')}` }
  }
  return { ok: true, message: '', data: status as WriteoffStatus }
}

/** 状态按老次序流转：目标序位必须在当前之后；倒序、平调一律拒收。 */
export function guardBatchTransition(current: BatchStatus, next: BatchStatus): TraceResult {
  const from = BATCH_STATUSES.indexOf(current)
  const to = BATCH_STATUSES.indexOf(next)
  if (to < 0) return { ok: false, message: `批次状态「${next}」越界，不在登记状态内` }
  if (to < from) return { ok: false, message: `状态不可倒序流转：「${current}」不能退回「${next}」` }
  return { ok: true, message: '' }
}

function parseCodes(raw: string): string[] {
  const parts = raw.split(/[\s,，;；、]+/).map((s) => s.trim()).filter(Boolean)
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const code of parts) {
    if (!seen.has(code)) {
      seen.add(code)
      ordered.push(code)
    }
  }
  return ordered
}

function expectedCodes(batch: TraceBatch): Set<string> {
  const set = new Set<string>()
  for (let seq = batch.codeStart; seq <= batch.codeEnd; seq += 1) {
    set.add(formatCode(batch.codePrefix, seq, batch.codeWidth))
  }
  return set
}

// 各扫码动作要求追溯码当前所处的阶段（老次序的前一档）。
const REQUIRED_STAGE: Record<ScanKind, CodeStage> = {
  入库: '已赋码',
  出库: '已入库',
  核销: '已出库',
  退货回库: '已出库',
}
// 退货回库再扫一次：货可能在客户核销后才退回，已出库、已核销都收；已退货的不能重复退。
const RETURN_ACCEPT_STAGES: CodeStage[] = ['已出库', '已核销']

// ---- 建档 / 升版 / 作废 -------------------------------------------------------

export type CreateBatchInput = {
  batchNo: string
  productName: string
  productBatchNo: string
  packageSpec: string
  codeStart: number
  codeEnd: number
  codePrefix: string
  codeWidth: number
  customer: string
  scanner: string
}

function validateBatchShape(input: CreateBatchInput): TraceResult {
  const required: [string, string][] = [
    ['赋码批次号', input.batchNo],
    ['产品名称', input.productName],
    ['成品批号', input.productBatchNo],
    ['包装规格', input.packageSpec],
    ['码前缀', input.codePrefix],
    ['发货客户', input.customer],
    ['扫码人', input.scanner],
  ]
  for (const [label, value] of required) {
    if (!value || !value.trim()) return { ok: false, message: `${label}不能为空` }
  }
  if (!Number.isInteger(input.codeStart) || !Number.isInteger(input.codeEnd) || input.codeStart <= 0) {
    return { ok: false, message: '码段起止必须是正整数' }
  }
  if (input.codeEnd < input.codeStart) return { ok: false, message: '码段止不能小于码段起' }
  if (input.codeEnd - input.codeStart + 1 > 100000) {
    return { ok: false, message: '单批码段超过 100000 枚上限，请按包装规格拆批建档' }
  }
  if (!Number.isInteger(input.codeWidth) || input.codeWidth <= 0 || input.codeWidth > 10) {
    return { ok: false, message: '码位宽需为 1-10 的整数' }
  }
  return { ok: true, message: '' }
}

/** 发货客户与扫码人一一对应、码段不得与其他在档批次重叠：在所有最新版有效批次之间校验。 */
function assertBindingAndRange(input: CreateBatchInput, excludeBatchNo = ''): TraceResult {
  const rows = listBatches().filter((b) => b.status !== '已作废' && b.batchNo !== excludeBatchNo)
  for (const row of rows) {
    if (row.customer === input.customer && row.scanner !== input.scanner) {
      return { ok: false, message: `发货客户与扫码人一一对应：客户「${input.customer}」已绑定扫码人「${row.scanner}」，不能再绑别人` }
    }
    if (row.scanner === input.scanner && row.customer !== input.customer) {
      return { ok: false, message: `发货客户与扫码人一一对应：扫码人「${input.scanner}」已绑定客户「${row.customer}」，不能再发别家` }
    }
    if (row.codePrefix === input.codePrefix && !(input.codeEnd < row.codeStart || input.codeStart > row.codeEnd)) {
      return { ok: false, message: `码段与在档批次「${row.batchNo} V${row.version}」重叠，一枚码只能归一个赋码批次` }
    }
  }
  return { ok: true, message: '' }
}

export function createBatch(input: CreateBatchInput): TraceResult<TraceBatch> {
  const shape = validateBatchShape(input)
  if (!shape.ok) return shape
  if (findLatest(input.batchNo.trim())) {
    return { ok: false, message: `批次号「${input.batchNo}」已建档，改规格请走「新版建档」升版` }
  }
  const binding = assertBindingAndRange(input)
  if (!binding.ok) return binding

  const batch: TraceBatch = {
    ...input,
    batchNo: input.batchNo.trim(),
    version: 1,
    status: '赋码建档',
    inboundCodes: [],
    outboundCodes: [],
    writeoffCodes: [],
    returnedCodes: [],
    createdAt: nowText(),
  }
  persistBatches([...allBatches(), batch])
  return { ok: true, message: `赋码批次 ${batch.batchNo} V1 已建档（${batch.packageSpec}，${batch.codeEnd - batch.codeStart + 1} 枚）`, data: clone(batch) }
}

/** 新版建档：老版作废留痕，口径上只留最新一版。码已出库的批次不允许升版。 */
export function createVersion(batchNo: string, changes: Partial<CreateBatchInput>): TraceResult<TraceBatch> {
  const latest = findLatestNormalized(batchNo)
  if (!latest) return { ok: false, message: `没有找到赋码批次「${batchNo}」` }
  if (latest.status === '已作废') return { ok: false, message: `批次「${batchNo}」最新版已作废，不能再升版` }
  if (latest.outboundCodes.length > 0) {
    return { ok: false, message: `批次「${batchNo}」已有 ${latest.outboundCodes.length} 枚出库，码在外不能升版，请新建批次号` }
  }
  const merged: CreateBatchInput = {
    batchNo: latest.batchNo,
    productName: changes.productName ?? latest.productName,
    productBatchNo: changes.productBatchNo ?? latest.productBatchNo,
    packageSpec: changes.packageSpec ?? latest.packageSpec,
    codeStart: changes.codeStart ?? latest.codeStart,
    codeEnd: changes.codeEnd ?? latest.codeEnd,
    codePrefix: changes.codePrefix ?? latest.codePrefix,
    codeWidth: changes.codeWidth ?? latest.codeWidth,
    customer: changes.customer ?? latest.customer,
    scanner: changes.scanner ?? latest.scanner,
  }
  const shape = validateBatchShape(merged)
  if (!shape.ok) return shape
  const binding = assertBindingAndRange(merged, batchNo)
  if (!binding.ok) return binding

  const rows = allBatches()
  const oldIndex = rows.findIndex((b) => b === latest || (b.batchNo === latest.batchNo && b.version === latest.version))
  if (oldIndex >= 0) rows[oldIndex] = { ...rows[oldIndex], status: '已作废' }
  const next: TraceBatch = {
    ...merged,
    version: latest.version + 1,
    status: '赋码建档',
    inboundCodes: [],
    outboundCodes: [],
    writeoffCodes: [],
    returnedCodes: [],
    createdAt: nowText(),
  }
  persistBatches([...rows, next])
  return { ok: true, message: `批次 ${batchNo} 已升版至 V${next.version}，旧版作废留痕，台账口径只认最新版`, data: clone(next) }
}

/** 作废批次：货已发出的批次挡回，已作废/已退货回库的终态也不许再动。 */
export function voidBatch(batchNo: string): TraceResult {
  const latest = findLatestNormalized(batchNo)
  if (!latest) return { ok: false, message: `没有找到赋码批次「${batchNo}」` }
  if (latest.status === '已作废') return { ok: false, message: '批次已是「已作废」，不用重复操作' }
  if (latest.outboundCodes.length > 0) {
    return { ok: false, message: `已有 ${latest.outboundCodes.length} 枚码出库，不能作废，按退货流程收回` }
  }
  const rows = allBatches()
  const index = rows.findIndex((b) => b.batchNo === latest.batchNo && b.version === latest.version)
  rows[index] = { ...rows[index], status: '已作废' }
  persistBatches(rows)
  return { ok: true, message: `批次 ${batchNo} V${latest.version} 已作废` }
}

// ---- 扫码台账 ----------------------------------------------------------------

export type ScanInput = {
  kind: ScanKind
  rawCodes: string
  operator: string
  customer?: string
  note?: string
}

export function submitScan(batchNo: string, input: ScanInput): TraceResult<{ accepted: string[]; skipped: string[] }> {
  const latest = findLatestNormalized(batchNo)
  if (!latest) return { ok: false, message: `没有找到赋码批次「${batchNo}」` }
  if (latest.status === '已作废') return { ok: false, message: `批次「${batchNo}」最新版已作废，停止扫码` }

  const codes = parseCodes(input.rawCodes)
  if (codes.length === 0) return { ok: false, message: '请先扫入追溯码' }
  if (codes.length > MAX_SCAN_CODES) {
    return { ok: false, message: `本次扫码 ${codes.length} 枚，超过单次 ${MAX_SCAN_CODES} 枚上限，超限挡回` }
  }
  if (!input.operator || !input.operator.trim()) {
    return { ok: false, message: input.kind === '出库' ? '出库必须登记扫码人' : '必须登记扫码人' }
  }
  const operator = input.operator.trim()
  const customer = (input.customer ?? '').trim()

  if (input.kind === '出库') {
    if (!customer) return { ok: false, message: '出库必须登记发货客户' }
    if (operator !== latest.scanner) {
      return { ok: false, message: `本批次绑定扫码人为「${latest.scanner}」，「${operator}」无权扫出库（客户与扫码人一一对应）` }
    }
    if (customer !== latest.customer) {
      return { ok: false, message: `本批次发货客户为「${latest.customer}」，不能发给「${customer}」（客户与扫码人一一对应）` }
    }
  }
  if (input.kind === '退货回库' && !customer) {
    return { ok: false, message: '退货回库必须登记退货客户' }
  }

  const segment = expectedCodes(latest)
  const foreign = codes.filter((c) => !segment.has(c))
  if (foreign.length > 0) {
    return { ok: false, message: `码越界：${foreign.slice(0, 5).join('、')}${foreign.length > 5 ? ' 等' : ''} 不属于批次「${batchNo} V${latest.version}」的码段` }
  }

  const required = REQUIRED_STAGE[input.kind]
  const accepted: string[] = []
  const skipped: string[] = []
  const badStage: { code: string; stage: CodeStage }[] = []
  for (const code of codes) {
    const stage = stageOfCode(latest, code)
    if (input.kind === '退货回库') {
      // 退货回库再扫一次：货可能在客户核销后才退回，已出库、已核销都收；已退货的重复退只跳过。
      if (stage === '已退货') {
        skipped.push(code)
      } else if (!RETURN_ACCEPT_STAGES.includes(stage)) {
        badStage.push({ code, stage })
      } else {
        accepted.push(code)
      }
      continue
    }
    if (stage !== required) {
      if (input.kind === '出库' && (stage === '已出库' || stage === '已核销')) {
        // 同一枚追溯码重复出库只算一次：货还在外面，跳过并在结果里点明。
        skipped.push(code)
      } else {
        // 含「已退货」：退货是老次序末档，倒序重新出库拒收，要再发货请另建批次。
        badStage.push({ code, stage })
      }
      continue
    }
    accepted.push(code)
  }
  if (badStage.length > 0) {
    if (input.kind === '出库' && badStage.some((x) => x.stage === '已退货')) {
      return { ok: false, message: `状态按老次序流转、倒序拒收：${badStage.filter((x) => x.stage === '已退货').map((x) => x.code).slice(0, 5).join('、')} 已退货回库，不能再扫出库；需要再发货请另建赋码批次，整批挡回未入账` }
    }
    const detail = badStage.slice(0, 5).map((x) => `${x.code}（当前：${x.stage}）`).join('、')
    const need = input.kind === '退货回库' ? '已出库 或 已核销' : required
    return { ok: false, message: `扫码状态越界，需要「${need}」：${detail}${badStage.length > 5 ? ' 等' : ''}，整批挡回未入账` }
  }
  if (accepted.length === 0) {
    return { ok: false, message: `本次 ${codes.length} 枚均为重复/越界码，没有可入账的码；重复出库同一枚码只算一次` }
  }

  const rows = allBatches()
  const index = rows.findIndex((b) => b.batchNo === latest.batchNo && b.version === latest.version)
  const batch = { ...rows[index] }
  // 各阶段码集合一律取并集：退货后重新出库不会重复计数，重复入库/核销也不会把一枚码记两遍。
  const union = (base: string[]) => [...new Set([...base, ...accepted])]
  if (input.kind === '入库') batch.inboundCodes = union(batch.inboundCodes)
  if (input.kind === '出库') batch.outboundCodes = union(batch.outboundCodes)
  if (input.kind === '核销') batch.writeoffCodes = union(batch.writeoffCodes)
  if (input.kind === '退货回库') batch.returnedCodes = union(batch.returnedCodes)

  // 码段总量是硬上限：任何阶段都不允许扫出比码段更多的码。
  for (const bucket of [batch.inboundCodes, batch.outboundCodes, batch.writeoffCodes, batch.returnedCodes]) {
    if (new Set(bucket).size > segment.size) {
      return { ok: false, message: '扫码数量超过码段总量，超限挡回，未入账' }
    }
  }

  // before 用码集合归一化后的状态：把存量脏状态自愈到当前真实阶段，再校验老次序。
  const before = normalizeStatus(batch)
  const nextStatus = summarizeBatchStatus(batch)
  batch.status = nextStatus
  // 状态按老次序流转：汇总序位倒退一律拒收，同序位（如核销中继续核销）允许。
  if (nextStatus !== before) {
    const guard = guardBatchTransition(before, nextStatus)
    if (!guard.ok) return { ok: false, message: `${guard.message}，整批挡回未入账` }
  }
  rows[index] = batch
  persistBatches(rows)

  const events = allEvents()
  const event: TraceScanEvent = {
    id: events.reduce((max, e) => Math.max(max, e.id), 0) + 1,
    batchNo: latest.batchNo,
    version: latest.version,
    kind: input.kind,
    codes: accepted,
    operator,
    customer,
    time: nowText(),
    note: (input.note ?? '').trim(),
  }
  persistEvents([...events, event])

  const suffix = skipped.length > 0 ? `；重复出库跳过 ${skipped.length} 枚（同一枚码只算一次）` : ''
  return {
    ok: true,
    message: `${batchNo} V${latest.version} ${input.kind}入账 ${accepted.length} 枚，批次状态「${before}」→「${nextStatus}」${suffix}`,
    data: { accepted, skipped },
  }
}

// ---- 指标与导出 ---------------------------------------------------------------

export type TraceStats = {
  latestBatches: number
  voidedVersions: number
  inboundPending: number
  outboundPending: number
  writeoffPending: number
  returned: number
  events: number
}

export function traceStats(): TraceStats {
  const latest = listBatches()
  const active = latest.filter((b) => b.status !== '已作废')
  const all = allBatches()
  return {
    latestBatches: active.length,
    voidedVersions: all.filter((b) => b.status === '已作废').length,
    inboundPending: active.reduce((sum, b) => sum + (b.codeEnd - b.codeStart + 1 - b.inboundCodes.length), 0),
    outboundPending: active.reduce((sum, b) => sum + b.inboundCodes.filter((c) => !b.outboundCodes.includes(c) && !b.returnedCodes.includes(c)).length, 0),
    writeoffPending: active.reduce((sum, b) => sum + b.outboundCodes.filter((c) => !b.writeoffCodes.includes(c)).length, 0),
    returned: active.reduce((sum, b) => sum + b.returnedCodes.length, 0),
    events: allEvents().length,
  }
}

export function exportTraceLedger(batchNo = ''): { filename: string; content: string } {
  const events = listEvents(batchNo ? { batchNo } : {})
  const header = ['流水号', '赋码批次', '版本', '扫码类型', '追溯码', '扫码人', '发货客户', '扫码时间', '备注']
  const lines = [header.join(',')]
  for (const e of events) {
    lines.push([e.id, e.batchNo, `V${e.version}`, e.kind, `"${e.codes.join(' ')}"`, e.operator, e.customer, e.time, e.note].join(','))
  }
  return {
    filename: batchNo ? `追溯码扫码台账-${batchNo}.csv` : '追溯码扫码台账.csv',
    content: `﻿${lines.join('\n')}`,
  }
}

export function downloadTraceLedger(batchNo = ''): void {
  const { filename, content } = exportTraceLedger(batchNo)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export const TRACE_STAGE_LABELS = CODE_STAGES
