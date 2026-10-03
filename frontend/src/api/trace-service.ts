import { CODE_CEILING, PACK_SPECS, specByName } from '../data/trace-seed'
import { resetTraceState, traceState, updateTraceState } from '../data/trace-store'
import type {
  CodeCheck,
  ScanResult,
  TraceBatch,
  TraceBatchStatus,
  TraceCode,
  TraceCodeStatus,
  TraceCustomer,
  TraceScan,
  TraceScanAction,
  TraceState,
} from '../data/trace-types'

// 状态老次序：台账流转、成品检验清单聚合都拿它当唯一口径。
const STATUS_ORDER: Record<TraceBatchStatus, number> = {
  待赋码: 0,
  在库: 1,
  已出库: 2,
  已核销: 3,
}

function now(): string {
  return new Date().toISOString()
}

export function formatTraceCode(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(9, '0')}`
}

function parseTraceCode(code: string): { prefix: string; seq: number } | null {
  const matched = /^([A-Za-z]+-[A-Za-z]+)-(\d{1,9})$/.exec(code.trim())
  if (!matched) {
    return null
  }
  return { prefix: matched[1], seq: Number(matched[2]) }
}

function ok(message: string, detail: CodeCheck[], accepted: number): ScanResult {
  return { ok: true, message, accepted, rejected: detail.length - accepted, detail }
}

function fail(message: string, detail: CodeCheck[] = [], accepted = 0): ScanResult {
  return { ok: false, message, accepted, rejected: detail.length - accepted, detail }
}

// ---------- 查询 ----------

/** 日常口径：每个业务批次号只留最新一版，老版本不进台账、不进统计。 */
export function listLatestBatches(): TraceBatch[] {
  return traceState().batches.filter((batch) => batch.isLatest)
}

export function listBatchVersions(batchNo: string): TraceBatch[] {
  return traceState()
    .batches.filter((batch) => batch.batchNo === batchNo)
    .sort((a, b) => b.version - a.version)
}

export function getBatch(id: number): TraceBatch | undefined {
  return traceState().batches.find((batch) => batch.id === id)
}

export function listCustomers(): TraceCustomer[] {
  return traceState().customers
}

export function listScans(batchId?: number): TraceScan[] {
  const rows = traceState().scans
  return (batchId ? rows.filter((item) => item.batchId === batchId) : rows).slice().reverse()
}

function findCode(state: TraceState, code: string): TraceCode | undefined {
  return state.codes.find((item) => item.code === code)
}

/** 展开一批码的全量明细：没落记录的码默认还在库。 */
export function listCodesForBatch(batch: TraceBatch): Array<{
  code: string
  status: TraceCodeStatus
  customer: string
  updatedAt: string
}> {
  const state = traceState()
  const rows: ReturnType<typeof listCodesForBatch> = []
  for (let n = batch.codeStart; n <= batch.codeEnd; n++) {
    const code = formatTraceCode(batch.codePrefix, n)
    const record = findCode(state, code)
    rows.push({
      code,
      status: record?.status ?? '在库',
      customer: record?.customer ?? '',
      updatedAt: record?.updatedAt ?? '',
    })
  }
  return rows
}

export type BatchProgress = {
  total: number
  /** 出库扫码被接受过的去重码数：看这一批扫没扫干净。 */
  outboundTouched: number
  untouched: number
  /** 当前还在外头（已出库未核销）。 */
  currentOut: number
  returned: number
  verified: number
}

export function batchProgress(batch: TraceBatch): BatchProgress {
  const state = traceState()
  const touched = new Set<string>()
  for (const scan of state.scans) {
    if (scan.batchId === batch.id && scan.action === '出库扫码' && scan.accepted) {
      touched.add(scan.code)
    }
  }
  let currentOut = 0
  let returned = 0
  let verified = 0
  for (let n = batch.codeStart; n <= batch.codeEnd; n++) {
    const record = findCode(state, formatTraceCode(batch.codePrefix, n))
    if (record?.status === '已出库') currentOut += 1
    if (record?.status === '已退库') returned += 1
    if (record?.status === '已核销') verified += 1
  }
  return {
    total: batch.codeCount,
    outboundTouched: touched.size,
    untouched: batch.codeCount - touched.size,
    currentOut,
    returned,
    verified,
  }
}

/**
 * 成品检验清单用的追溯口径：按产品批号聚合最新版批次。
 * 扫码台账和清单两处拿到的永远是这一套函数算出的结果。
 */
export type FinishedqcTraceCell = {
  batchNos: string[]
  status: TraceBatchStatus | '—'
  statusText: string
  detail: string
}

export function finishedqcTraceCell(productBatchNo: string): FinishedqcTraceCell {
  const batches = listLatestBatches().filter((batch) => batch.productBatchNo === productBatchNo)
  if (batches.length === 0) {
    return { batchNos: [], status: '—', statusText: '—', detail: '未建追溯台账' }
  }
  const top = batches.reduce((a, b) => (STATUS_ORDER[a.status] >= STATUS_ORDER[b.status] ? a : b))
  const progress = batches.map(batchProgress)
  const verified = progress.reduce((sum, item) => sum + item.verified, 0)
  const total = progress.reduce((sum, item) => sum + item.total, 0)
  return {
    batchNos: batches.map((batch) => batch.batchNo),
    status: top.status,
    statusText: top.status,
    detail: `核销 ${verified}/${total} 枚`,
  }
}

export function traceOverviewCards(): Array<{ label: string; value: number }> {
  const batches = listLatestBatches()
  const count = (status: TraceBatchStatus) => batches.filter((batch) => batch.status === status).length
  const customers = traceState().customers.length
  return [
    { label: '赋码批次（最新版）', value: batches.length },
    { label: '在库批次', value: count('在库') },
    { label: '已出库批次', value: count('已出库') },
    { label: '已核销批次', value: count('已核销') },
    { label: '发货客户对照', value: customers },
  ]
}

// ---------- 建档与修订 ----------

export type CreateBatchInput = {
  productName: string
  productBatchNo: string
  packSpec: string
  codeCount: number
  remark?: string
}

export function createBatch(input: CreateBatchInput): { ok: boolean; message: string; batch?: TraceBatch } {
  const productName = input.productName.trim()
  const productBatchNo = input.productBatchNo.trim()
  if (!productName || !productBatchNo) {
    return { ok: false, message: '产品名称与产品批号都要填写' }
  }
  const pack = specByName(input.packSpec)
  if (!pack) {
    return { ok: false, message: `包装规格只支持：${PACK_SPECS.map((item) => item.spec).join('、')}` }
  }
  if (!Number.isInteger(input.codeCount) || input.codeCount <= 0) {
    return { ok: false, message: '赋码数量得是正整数' }
  }
  // 超限挡回：单批不能超过该包装规格的码段容量。
  if (input.codeCount > pack.maxCount) {
    return { ok: false, message: `${pack.spec}单批最多赋码 ${pack.maxCount} 枚，${input.codeCount} 枚超限` }
  }

  let result: { ok: boolean; message: string; batch?: TraceBatch } = { ok: false, message: '' }
  updateTraceState((draft) => {
    // 码段按包装规格各自连续：从该规格所有版本批次的最大尾码往后接，修订不换段所以旧版也算。
    const sameSpec = draft.batches.filter((batch) => batch.packSpec === pack.spec)
    const maxEnd = sameSpec.reduce((max, batch) => Math.max(max, batch.codeEnd), 0)
    const start = maxEnd === 0 ? undefined : maxEnd + 1
    const codeStart = start ?? (pack.spec === '大箱' ? 100001 : pack.spec === '中盒' ? 400001 : 800001)
    const codeEnd = codeStart + input.codeCount - 1
    if (codeEnd > CODE_CEILING) {
      result = { ok: false, message: `码段将越过全局上限 ${CODE_CEILING}，挡回` }
      return
    }
    const seq = new Set(sameSpec.map((batch) => batch.batchNo)).size + 1
    const id = draft.seq.batch + 1
    const batch: TraceBatch = {
      id,
      batchNo: `${pack.prefix}-${String(seq).padStart(4, '0')}`,
      version: 1,
      isLatest: true,
      productName,
      productBatchNo,
      packSpec: pack.spec,
      codePrefix: pack.codePrefix,
      codeStart,
      codeEnd,
      codeCount: input.codeCount,
      status: '待赋码',
      remark: input.remark?.trim() ?? '',
      createdAt: now(),
    }
    draft.batches.push(batch)
    draft.seq.batch = id
    result = { ok: true, message: `已建档 ${batch.batchNo}，码段 ${formatTraceCode(pack.codePrefix, codeStart)} ～ ${formatTraceCode(pack.codePrefix, codeEnd)}`, batch }
  })
  return result
}

/** 修订建档：另起一版，老版归档；码段、包装规格、当前状态都沿用，只改登记信息。 */
export function reviseBatch(
  id: number,
  patch: { productName: string; productBatchNo: string; remark: string },
): { ok: boolean; message: string; batch?: TraceBatch } {
  const current = getBatch(id)
  if (!current) {
    return { ok: false, message: '没有找到这一批' }
  }
  if (!current.isLatest) {
    return { ok: false, message: '赋码批次口径只留最新一版，老版本不能再修订' }
  }
  if (!patch.productName.trim() || !patch.productBatchNo.trim()) {
    return { ok: false, message: '产品名称与产品批号都要填写' }
  }
  let result: { ok: boolean; message: string; batch?: TraceBatch } = { ok: false, message: '' }
  updateTraceState((draft) => {
    const old = draft.batches.find((batch) => batch.id === id)
    if (!old || !old.isLatest) {
      result = { ok: false, message: '该版本已不是最新版，修订挡回' }
      return
    }
    old.isLatest = false
    const newId = draft.seq.batch + 1
    const revised: TraceBatch = {
      ...old,
      id: newId,
      version: old.version + 1,
      isLatest: true,
      productName: patch.productName.trim(),
      productBatchNo: patch.productBatchNo.trim(),
      remark: patch.remark.trim(),
      createdAt: now(),
      revisedFrom: old.id,
    }
    draft.batches.push(revised)
    draft.seq.batch = newId
    // 已经记在老版本名下的码与流水整段带到新版，码没变，账不能断。
    for (const code of draft.codes) {
      if (code.batchId === old.id) code.batchId = newId
    }
    for (const scan of draft.scans) {
      if (scan.batchId === old.id) scan.batchId = newId
    }
    result = { ok: true, message: `${revised.batchNo} V${revised.version} 已成为最新版，V${old.version} 归档`, batch: revised }
  })
  return result
}

// ---------- 批次主状态流转 ----------

/** 老次序向前一步：倒序、跳步、跨版本一律挡回。 */
export function advanceBatch(id: number, target: TraceBatchStatus): { ok: boolean; message: string } {
  const batch = getBatch(id)
  if (!batch) {
    return { ok: false, message: '没有找到这一批' }
  }
  if (!batch.isLatest) {
    return { ok: false, message: '只对最新一版操作，老版本只读' }
  }
  const currentIndex = STATUS_ORDER[batch.status]
  const targetIndex = STATUS_ORDER[target]
  if (targetIndex <= currentIndex) {
    return { ok: false, message: `状态只能按老次序向前走，${batch.status} 不能倒回「${target}」` }
  }
  if (targetIndex !== currentIndex + 1) {
    return { ok: false, message: `不能从「${batch.status}」跳到「${target}」，得一步步流转` }
  }

  if (target === '已出库') {
    const progress = batchProgress(batch)
    if (progress.untouched > 0) {
      return { ok: false, message: `还有 ${progress.untouched} 枚码没扫出库，先扫干净再整批出库` }
    }
  }
  if (target === '已核销') {
    const progress = batchProgress(batch)
    const pending = batch.codeCount - progress.verified
    if (pending > 0) {
      return { ok: false, message: `还有 ${pending} 枚码没核销，不能结案` }
    }
  }

  updateTraceState((draft) => {
    const row = draft.batches.find((item) => item.id === id)
    if (row) row.status = target
  })
  return { ok: true, message: `${batch.batchNo} 已流转为「${target}」` }
}

/** 内部用：码全核销后自动把批次结案到「已核销」，只走相邻一步，绝不倒序。 */
function autoCloseIfFullyVerified(draft: TraceState): void {
  for (const batch of draft.batches) {
    if (batch.status !== '已出库') continue
    let verified = 0
    for (let n = batch.codeStart; n <= batch.codeEnd; n++) {
      const record = draft.codes.find((item) => item.code === formatTraceCode(batch.codePrefix, n))
      if (record?.status === '已核销') verified += 1
    }
    if (verified === batch.codeCount) {
      batch.status = '已核销'
    }
  }
}

// ---------- 出入库扫码 ----------

/** 发货客户与扫码人一一对应：两边都得在对照表里且互相绑定。 */
function assertPair(
  draft: TraceState,
  customer: string,
  scanner: string,
): { ok: boolean; message: string } {
  const byCustomer = draft.customers.find((item) => item.customer === customer)
  if (!byCustomer) {
    return { ok: false, message: `客户「${customer}」还没登记发货对照` }
  }
  if (byCustomer.scanner !== scanner) {
    return { ok: false, message: `「${customer}」绑定的扫码人是${byCustomer.scanner}，${scanner}不能扫` }
  }
  const byScanner = draft.customers.find((item) => item.scanner === scanner)
  if (!byScanner || byScanner.customer !== customer) {
    return { ok: false, message: `扫码人「${scanner}」已对应其他客户，一一对应不能串` }
  }
  return { ok: true, message: '' }
}

function splitCodes(raw: string): string[] {
  return raw
    .split(/[\s,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function classifyCode(
  draft: TraceState,
  batch: TraceBatch,
  code: string,
  action: TraceScanAction,
  seen: Set<string>,
): CodeCheck {
  const parsed = parseTraceCode(code)
  if (!parsed) {
    return { code, accepted: false, note: '码格式不对，不是本台账追溯码' }
  }
  const inRange = parsed.prefix === batch.codePrefix && parsed.seq >= batch.codeStart && parsed.seq <= batch.codeEnd
  // 越界挡回：前缀不符或数字段不在本批区间。
  if (!inRange) {
    return { code, accepted: false, note: '码段越界，不在本批赋码区间' }
  }
  // 同一枚码在同一次提交里重复扫，只算一次。
  if (seen.has(code)) {
    return { code, accepted: false, note: '本次提交重复扫码，只算一次' }
  }

  const record = findCode(draft, code)
  const status: TraceCodeStatus = record?.status ?? '在库'

  if (action === '出库扫码') {
    if (status === '已核销') return { code, accepted: false, note: '该码已核销，不能再出库' }
    if (status === '已出库') return { code, accepted: false, note: '重复出库，同一枚码只算一次' }
    // 在库、已退库（退货回库后再发）都接受。
    return { code, accepted: true, note: status === '已退库' ? '退货回库后重新出库' : '正常出库' }
  }

  if (action === '退货回库') {
    if (status === '已核销') return { code, accepted: false, note: '该码已核销，不能退货回库' }
    if (status === '已退库') return { code, accepted: false, note: '已在库，重复退货' }
    if (status !== '已出库') return { code, accepted: false, note: '该码还没出库，无货可退' }
    return { code, accepted: true, note: '退货回库，再扫确认' }
  }

  // 核销上报：状态越界、超限都挡回。
  if (status === '已核销') return { code, accepted: false, note: '重复核销，超出一次限额' }
  if (status !== '已出库') return { code, accepted: false, note: '该码尚未出库，不能核销' }
  return { code, accepted: true, note: '核销成功' }
}

function runScan(
  batchId: number,
  action: TraceScanAction,
  rawCodes: string,
  customer: string,
  scanner: string,
): ScanResult {
  const batch = getBatch(batchId)
  if (!batch) {
    return fail('没有找到这一批')
  }
  if (!batch.isLatest) {
    return fail('只对最新一版扫码，老版本只读')
  }
  if (action === '出库扫码' && batch.status !== '在库' && batch.status !== '已出库') {
    return fail(`批次处于「${batch.status}」，还不能出库扫码`)
  }
  if (action === '退货回库' && batch.status !== '在库' && batch.status !== '已出库') {
    return fail(`批次处于「${batch.status}」，没有在途货物可退`)
  }
  if (action === '核销上报' && batch.status !== '已出库') {
    return fail(`批次处于「${batch.status}」，得先整批出库才能核销`)
  }

  const codes = splitCodes(rawCodes)
  if (codes.length === 0) {
    return fail('请先扫入追溯码')
  }

  const pair = assertPair(traceState(), customer.trim(), scanner.trim())
  if (!pair.ok) {
    return fail(pair.message)
  }

  const detail: CodeCheck[] = []
  const seen = new Set<string>()
  for (const code of codes) {
    const check = classifyCode(traceState(), batch, code, action, seen)
    detail.push(check)
    // 无论接受与否，同一枚码第二次出现就算本次重复，不再重复判状态。
    seen.add(code)
  }

  const acceptedCount = detail.filter((item) => item.accepted).length
  if (acceptedCount === 0) {
    // 一枚都没过，整单挡回，不留状态，只留拒收痕迹。
    updateTraceState((draft) => {
      for (const item of detail) {
        draft.scans.push({
          id: draft.seq.scan + 1,
          batchId: batch.id,
          batchNo: batch.batchNo,
          action,
          code: item.code,
          customer: customer.trim(),
          scanner: scanner.trim(),
          accepted: false,
          note: item.note,
          scannedAt: now(),
        })
        draft.seq.scan += 1
      }
    })
    return fail(`全部 ${detail.length} 枚被挡回，台账未改动`, detail)
  }

  updateTraceState((draft) => {
    for (const item of detail) {
      if (item.accepted) {
        const record = findCode(draft, item.code)
        const nextStatus: TraceCodeStatus =
          action === '出库扫码' ? '已出库' : action === '退货回库' ? '已退库' : '已核销'
        if (record) {
          record.status = nextStatus
          record.customer = action === '退货回库' ? '' : customer.trim()
          record.updatedAt = now()
        } else {
          draft.codes.push({
            code: item.code,
            batchId: batch.id,
            status: nextStatus,
            customer: action === '退货回库' ? '' : customer.trim(),
            updatedAt: now(),
          })
        }
      }
      draft.scans.push({
        id: draft.seq.scan + 1,
        batchId: batch.id,
        batchNo: batch.batchNo,
        action,
        code: item.code,
        customer: customer.trim(),
        scanner: scanner.trim(),
        accepted: item.accepted,
        note: item.note,
        scannedAt: now(),
      })
      draft.seq.scan += 1
    }
    // 码全核销时批次自动结案；出库与退货都不自动回退批次状态。
    if (action === '核销上报') {
      autoCloseIfFullyVerified(draft)
    }
  })

  const progress = batchProgress(batch)
  const rejected = detail.length - acceptedCount
  const head =
    action === '出库扫码'
      ? `出库 ${acceptedCount} 枚，本批已扫 ${progress.outboundTouched}/${progress.total}，还剩 ${progress.untouched} 枚没扫`
      : action === '退货回库'
        ? `退货回库 ${acceptedCount} 枚（批次主状态不回退），当前库内 ${progress.returned} 枚`
        : `核销 ${acceptedCount} 枚，累计 ${progress.verified}/${progress.total}${
          getBatch(batch.id)?.status === '已核销' ? '，已全部核销，批次自动结案' : ''
        }`
  return ok(rejected > 0 ? `${head}；另有 ${rejected} 枚挡回` : head, detail, acceptedCount)
}

export const scanOutbound = (batchId: number, rawCodes: string, customer: string, scanner: string): ScanResult =>
  runScan(batchId, '出库扫码', rawCodes, customer, scanner)

export const scanReturn = (batchId: number, rawCodes: string, customer: string, scanner: string): ScanResult =>
  runScan(batchId, '退货回库', rawCodes, customer, scanner)

export const reportVerification = (batchId: number, rawCodes: string, customer: string, scanner: string): ScanResult =>
  runScan(batchId, '核销上报', rawCodes, customer, scanner)

// ---------- 客户/扫码人对照 ----------

export function addCustomer(customer: string, scanner: string): { ok: boolean; message: string } {
  const name = customer.trim()
  const person = scanner.trim()
  if (!name || !person) {
    return { ok: false, message: '客户与扫码人都要填写' }
  }
  let message = ''
  updateTraceState((draft) => {
    if (draft.customers.some((item) => item.customer === name)) {
      message = `客户「${name}」已绑定扫码人，一一对应不能再配`
      return
    }
    if (draft.customers.some((item) => item.scanner === person)) {
      message = `扫码人「${person}」已对应其他客户，不能一对多`
      return
    }
    const id = draft.seq.customer + 1
    draft.customers.push({ id, customer: name, scanner: person })
    draft.seq.customer = id
    message = `已绑定：${name} ↔ ${person}`
  })
  return { ok: message.startsWith('已绑定'), message }
}

export function resetTraceLedger(): void {
  resetTraceState()
}
