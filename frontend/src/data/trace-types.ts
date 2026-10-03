/** 追溯码赋码与出入库扫码台账的领域类型与口径常量。
 *  一批码从赋码建档 → 入库 → 出库 → 核销走到退货回库，状态只准按老次序向前流转。 */

// 单枚追溯码的生命周期阶段（同一枚码在任意时刻只可能处于其中一个阶段）。
export const CODE_STAGES = ['已赋码', '已入库', '已出库', '已核销', '已退货'] as const
export type CodeStage = (typeof CODE_STAGES)[number]

// 赋码批次状态：按码段内全部码的最低阶段汇总，追加“部分退货”表达核销后又有码回库。
export const BATCH_STATUSES = [
  '赋码建档',
  '入库中',
  '入库完成',
  '出库中',
  '出库完成',
  '核销中',
  '已核销',
  '部分退货',
  '退货回库',
  '已作废',
] as const
export type BatchStatus = (typeof BATCH_STATUSES)[number]

// 核销状态：追溯台账与成品检验清单两处拿到的都是这一套，不允许页面各自造词。
export const WRITEOFF_STATUSES = ['未核销', '核销中', '已核销'] as const
export type WriteoffStatus = (typeof WRITEOFF_STATUSES)[number]

export const SCAN_KINDS = ['入库', '出库', '退货回库', '核销'] as const
export type ScanKind = (typeof SCAN_KINDS)[number]

// 动作 → 目标批次状态。老次序只向前；扫码类动作不一定立刻推进批次，由批次汇总状态决定。
export const TRACE_ACTIONS = ['入库扫码', '出库扫码', '办理核销', '退货回库', '新版建档', '作废批次'] as const
export const TRACE_ACTION_TARGET: Record<string, BatchStatus> = {
  办理核销: '已核销',
  作废批次: '已作废',
}

export type TraceBatch = {
  /** 赋码批次号，同一批次多版建档时共用 */
  batchNo: string
  /** 版本号，从 1 开始，数字越大越新 */
  version: number
  productName: string
  /** 关联成品批号：核销结果凭它落到成品检验清单 */
  productBatchNo: string
  /** 包装规格，码段按包装规格分批建档 */
  packageSpec: string
  /** 码段起（含） */
  codeStart: number
  /** 码段止（含） */
  codeEnd: number
  /** 码前缀，如 812345600 */
  codePrefix: string
  /** 码位宽（不足前补 0），如 4 → 0001 */
  codeWidth: number
  /** 发货客户：与扫码人在本批次内一一对应，不得一客多人或一人多客 */
  customer: string
  /** 出库扫码人 */
  scanner: string
  status: BatchStatus
  /** 已扫入库的码 */
  inboundCodes: string[]
  /** 已扫出库的码（同一枚码重复出库只记一次，只算一次） */
  outboundCodes: string[]
  /** 已核销的码 */
  writeoffCodes: string[]
  /** 退货回库再扫的码 */
  returnedCodes: string[]
  createdAt: string
}

export type TraceScanEvent = {
  id: number
  batchNo: string
  /** 事件发生时赋码批次对应的最新版本 */
  version: number
  kind: ScanKind
  /** 本次扫码涉及的码（已去重） */
  codes: string[]
  /** 入库/退货扫码人 */
  operator: string
  /** 出库时的发货客户 */
  customer: string
  time: string
  note: string
}

export type TraceResult<T = never> = {
  ok: boolean
  message: string
  data?: T
}

// 单次扫码提交的码数上限：核销状态越界或超限一律挡回。
export const MAX_SCAN_CODES = 500

export function formatCode(prefix: string, seq: number, width: number): string {
  return `${prefix}${String(seq).padStart(width, '0')}`
}

/** 一枚码当前所处阶段（批次维度口径，两处核销状态都从这里推）。 */
export function stageOfCode(batch: TraceBatch, code: string): CodeStage {
  if (batch.returnedCodes.includes(code)) return '已退货'
  if (batch.writeoffCodes.includes(code)) return '已核销'
  if (batch.outboundCodes.includes(code)) return '已出库'
  if (batch.inboundCodes.includes(code)) return '已入库'
  return '已赋码'
}

/** 批次核销状态：未核销 / 核销中 / 已核销（只看出库后的核销推进，退货码仍保留已核销事实）。 */
export function batchWriteoffStatus(batch: TraceBatch): WriteoffStatus {
  if (batch.writeoffCodes.length === 0) return '未核销'
  if (batch.writeoffCodes.length >= batch.outboundCodes.length) return '已核销'
  return '核销中'
}

const STAGE_ORDER: Record<CodeStage, number> = {
  已赋码: 0,
  已入库: 1,
  已出库: 2,
  已核销: 3,
  已退货: 4,
}

/** 批次整体状态：取码段内全部码的最低阶段汇总；核销后出现退货再细分部分/全部。 */
export function summarizeBatchStatus(batch: TraceBatch): BatchStatus {
  const total = batch.codeEnd - batch.codeStart + 1
  const inb = new Set(batch.inboundCodes)
  const out = new Set(batch.outboundCodes)
  const woff = new Set(batch.writeoffCodes)
  const ret = new Set(batch.returnedCodes)

  if (ret.size >= total) return '退货回库'
  if (ret.size > 0) return '部分退货'
  if (woff.size > 0) return woff.size >= out.size ? '已核销' : '核销中'
  if (out.size > 0) return out.size >= inb.size ? '出库完成' : '出库中'
  if (inb.size > 0) return inb.size >= total ? '入库完成' : '入库中'
  return '赋码建档'
}

export function stageRank(stage: CodeStage): number {
  return STAGE_ORDER[stage]
}
