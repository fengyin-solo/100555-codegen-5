/** 追溯码赋码与出入库扫码台账的类型。独立于通用模块元数据，规则在 trace-service 里集中校验。 */

/** 赋码批次主状态，按这个老次序向前流转，倒序、跳序一律拒收。 */
export const TRACE_BATCH_STATUSES = ['待赋码', '在库', '已出库', '已核销'] as const
export type TraceBatchStatus = (typeof TRACE_BATCH_STATUSES)[number]

/** 单枚追溯码的核销状态。扫码台账、赋码台账、成品检验清单两处取的都是这一套。 */
export const TRACE_CODE_STATUSES = ['在库', '已出库', '已退库', '已核销'] as const
export type TraceCodeStatus = (typeof TRACE_CODE_STATUSES)[number]

/** 出入库扫码动作。 */
export const TRACE_SCAN_ACTIONS = ['出库扫码', '退货回库', '核销上报'] as const
export type TraceScanAction = (typeof TRACE_SCAN_ACTIONS)[number]

export type PackSpec = {
  /** 包装规格名称，码段按这个分批。 */
  spec: string
  /** 批次号前缀，例如 大箱-DX。 */
  prefix: string
  /** 追溯码前缀，例如 TM-DX。 */
  codePrefix: string
  /** 该规格一段码默认放多少枚，同时也是单批赋码上限。 */
  maxCount: number
}

/** 赋码批次（同一业务批次号会因修订出现多版，只有最新一版参与日常口径）。 */
export type TraceBatch = {
  id: number
  /** 业务批次号，规格前缀加序号，修订不改号。 */
  batchNo: string
  /** 版本号，从 1 起；同一 batchNo 只有 isLatest 的一版生效。 */
  version: number
  isLatest: boolean
  productName: string
  productBatchNo: string
  packSpec: string
  codePrefix: string
  /** 码段数字段，左闭右闭。码段按包装规格各自连续分批。 */
  codeStart: number
  codeEnd: number
  codeCount: number
  status: TraceBatchStatus
  remark: string
  createdAt: string
  /** 从旧版修订而来时记录原批次 id。 */
  revisedFrom?: number
}

/**
 * 单枚追溯码台账。只给发生过动作的码建记录，没落记录的码默认「在库」，
 * 这样赋码数量大也不用把整段码全量落库。
 */
export type TraceCode = {
  code: string
  batchId: number
  status: TraceCodeStatus
  /** 当前持有客户，出库记上、退货清掉。 */
  customer: string
  updatedAt: string
}

/** 扫码流水：每一次扫码都留痕，包括重复扫、越界被挡回的。 */
export type TraceScan = {
  id: number
  batchId: number
  batchNo: string
  action: TraceScanAction
  code: string
  /** 发货客户与扫码人一一对应，扫码时按对照关系落人。 */
  customer: string
  scanner: string
  accepted: boolean
  /** 拒收或重复时写明原因，对账时一眼能看出有没有扫干净。 */
  note: string
  scannedAt: string
}

/** 发货客户与扫码人一一对应（双向唯一）。 */
export type TraceCustomer = {
  id: number
  customer: string
  scanner: string
}

export type TraceState = {
  batches: TraceBatch[]
  codes: TraceCode[]
  scans: TraceScan[]
  customers: TraceCustomer[]
  seq: { batch: number; scan: number; customer: number }
}

export type CodeCheck = {
  code: string
  accepted: boolean
  note: string
}

export type ScanResult = {
  ok: boolean
  message: string
  accepted: number
  rejected: number
  detail: CodeCheck[]
}
