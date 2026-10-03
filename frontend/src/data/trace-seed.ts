import type { PackSpec, TraceState } from './trace-types'

// 码段按包装规格分批：每种规格一段独立号段、一个单批上限。
export const PACK_SPECS: PackSpec[] = [
  { spec: '大箱', prefix: '大箱-DX', codePrefix: 'TM-DX', maxCount: 20 },
  { spec: '中盒', prefix: '中盒-ZH', codePrefix: 'TM-ZH', maxCount: 12 },
  { spec: '小盒', prefix: '小盒-XH', codePrefix: 'TM-XH', maxCount: 10 },
]

export function specByName(spec: string): PackSpec | undefined {
  return PACK_SPECS.find((item) => item.spec === spec)
}

// 追溯码数字段全局天花板：再大的赋码量也不能越过这条线。
export const CODE_CEILING = 999_999_999

// 时间只用于演示台账先后，固定基准递增，保证种子每次长一样。
const BASE_TIME = new Date('2026-09-20T08:00:00').getTime()
let tick = 0
function t(minutes: number): string {
  return new Date(BASE_TIME + minutes * 60_000).toISOString()
}

function codeOf(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(9, '0')}`
}

/**
 * 示例台账：覆盖在库待扫、整批出完核销、部分出库、部分核销、待入库、
 * 退货回库、修订换版等各种对账场景。首次打开播种，之后浏览器改动优先。
 */
export function buildTraceSeed(): TraceState {
  const batches: TraceState['batches'] = [
    {
      id: 1,
      batchNo: '大箱-DX-0001',
      version: 1,
      isLatest: false,
      productName: '旧版产品名称（已被V2修订替换）',
      productBatchNo: 'CP20260901',
      packSpec: '大箱',
      codePrefix: 'TM-DX',
      codeStart: 100001,
      codeEnd: 100020,
      codeCount: 20,
      status: '已出库',
      remark: '老版口径，已归档不再使用',
      createdAt: t(0),
    },
    {
      id: 2,
      batchNo: '大箱-DX-0001',
      version: 2,
      isLatest: true,
      productName: '注射用头孢曲松钠',
      productBatchNo: 'CP20260901',
      packSpec: '大箱',
      codePrefix: 'TM-DX',
      codeStart: 100001,
      codeEnd: 100020,
      codeCount: 20,
      status: '已出库',
      remark: '修订建档：产品名称订正，码段不变',
      createdAt: t(5),
      revisedFrom: 1,
    },
    {
      id: 3,
      batchNo: '中盒-ZH-0001',
      version: 1,
      isLatest: true,
      productName: '阿莫西林胶囊',
      productBatchNo: 'CP20260902',
      packSpec: '中盒',
      codePrefix: 'TM-ZH',
      codeStart: 400001,
      codeEnd: 400012,
      codeCount: 12,
      status: '在库',
      remark: '出库扫了一半，看有没有扫干净',
      createdAt: t(10),
    },
    {
      id: 4,
      batchNo: '小盒-XH-0001',
      version: 1,
      isLatest: true,
      productName: '布洛芬缓释片',
      productBatchNo: 'CP20260903',
      packSpec: '小盒',
      codePrefix: 'TM-XH',
      codeStart: 800001,
      codeEnd: 800010,
      codeCount: 10,
      status: '已出库',
      remark: '部分核销，含一笔客户退货回库',
      createdAt: t(15),
    },
    {
      id: 5,
      batchNo: '小盒-XH-0002',
      version: 1,
      isLatest: true,
      productName: '对乙酰氨基酚片',
      productBatchNo: 'CP20260910',
      packSpec: '小盒',
      codePrefix: 'TM-XH',
      codeStart: 800011,
      codeEnd: 800016,
      codeCount: 6,
      status: '待赋码',
      remark: '刚建档，等成品检验合格后入库',
      createdAt: t(20),
    },
  ]

  const codes: TraceState['codes'] = []
  const scans: TraceState['scans'] = []
  let scanId = 1
  let minute = 30

  function put(code: string, batchId: number, status: TraceState['codes'][number]['status'], customer: string, at: string) {
    const existing = codes.find((item) => item.code === code)
    if (existing) {
      existing.status = status
      existing.customer = customer
      existing.updatedAt = at
    } else {
      codes.push({ code, batchId, status, customer, updatedAt: at })
    }
  }

  function scan(
    batchId: number,
    batchNo: string,
    action: TraceState['scans'][number]['action'],
    code: string,
    customer: string,
    scanner: string,
    accepted: boolean,
    note: string,
  ) {
    scans.push({
      id: scanId++,
      batchId,
      batchNo,
      action,
      code,
      customer,
      scanner,
      accepted,
      note,
      scannedAt: t(minute++),
    })
  }

  const C1 = '华东医药连锁'
  const C2 = '省人民医院药剂科'
  const C3 = '百济大药房'

  // 批次2（大箱-DX-0001 V2）：20 枚全部出库、全部核销。
  for (let n = 100001; n <= 100020; n++) {
    const c = codeOf('TM-DX', n)
    put(c, 2, '已出库', C1, t(minute))
    scan(2, '大箱-DX-0001', '出库扫码', c, C1, '扫码员-王磊', true, '正常出库')
  }
  // 同一枚码重复出库只算一次：留一条拒收流水。
  scan(2, '大箱-DX-0001', '出库扫码', codeOf('TM-DX', 100005), C1, '扫码员-王磊', false, '重复出库，仅计一次')
  // 越界码也挡回来。
  scan(2, '大箱-DX-0001', '出库扫码', codeOf('TM-DX', 100099), C1, '扫码员-王磊', false, '码段越界，不在本批赋码区间')
  for (let n = 100001; n <= 100020; n++) {
    const c = codeOf('TM-DX', n)
    put(c, 2, '已核销', C1, t(minute))
    scan(2, '大箱-DX-0001', '核销上报', c, C1, '扫码员-王磊', true, '下游核销成功')
  }

  // 批次3（中盒-ZH-0001）：出库 7/12，批次停在在库，剩 5 枚没扫干净。
  for (let n = 400001; n <= 400007; n++) {
    const c = codeOf('TM-ZH', n)
    put(c, 3, '已出库', C2, t(minute))
    scan(3, '中盒-ZH-0001', '出库扫码', c, C2, '扫码员-李静', true, '正常出库')
  }
  // 客户与扫码人不对应：按对照表这枚应是王磊，李静扫被挡回。
  scan(3, '中盒-ZH-0001', '出库扫码', codeOf('TM-ZH', 400008), C1, '扫码员-李静', false, '扫码人与该客户的绑定关系不符')

  // 批次4（小盒-XH-0001）：10 枚出库，其中 1 枚退货回库，4 枚核销。
  for (let n = 800001; n <= 800010; n++) {
    const c = codeOf('TM-XH', n)
    put(c, 4, '已出库', C3, t(minute))
    scan(4, '小盒-XH-0001', '出库扫码', c, C3, '扫码员-赵强', true, '正常出库')
  }
  put(codeOf('TM-XH', 800003), 4, '已退库', '', t(minute))
  scan(4, '小盒-XH-0001', '退货回库', codeOf('TM-XH', 800003), C3, '扫码员-赵强', true, '客户退货，回库再扫确认')
  // 退库的货再发一次，重新扫码出库，合法。
  put(codeOf('TM-XH', 800003), 4, '已出库', C2, t(minute))
  scan(4, '小盒-XH-0001', '出库扫码', codeOf('TM-XH', 800003), C2, '扫码员-李静', true, '退货回库后重新出库')
  for (const n of [800001, 800002, 800004, 800005]) {
    const c = codeOf('TM-XH', n)
    put(c, 4, '已核销', C3, t(minute))
    scan(4, '小盒-XH-0001', '核销上报', c, C3, '扫码员-赵强', true, '下游核销成功')
  }
  // 核销阶段越界与状态不对都挡回。
  scan(4, '小盒-XH-0001', '核销上报', codeOf('TM-XH', 899999), C3, '扫码员-赵强', false, '码段越界，不在本批赋码区间')
  scan(4, '小盒-XH-0001', '核销上报', codeOf('TM-XH', 800007), C3, '扫码员-赵强', false, '该码尚未出库，不能核销')

  const customers: TraceState['customers'] = [
    { id: 1, customer: C1, scanner: '扫码员-王磊' },
    { id: 2, customer: C2, scanner: '扫码员-李静' },
    { id: 3, customer: C3, scanner: '扫码员-赵强' },
  ]

  return {
    batches,
    codes,
    scans,
    customers,
    seq: { batch: 5, scan: scanId, customer: 3 },
  }
}
