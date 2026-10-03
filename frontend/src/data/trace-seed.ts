import type { TraceBatch, TraceScanEvent } from './trace-types'
import { formatCode } from './trace-types'

// 追溯台账独立存放：赋码批次（含历史版本）与扫码流水各一把锁，互不串号。
export const TRACE_BATCH_KEY = 'pharma-cleanroom:trace-batches'
export const TRACE_EVENT_KEY = 'pharma-cleanroom:trace-events'

function sampleBatch(partial: Partial<TraceBatch> & Pick<TraceBatch,
  'batchNo' | 'version' | 'productName' | 'productBatchNo' | 'packageSpec' |
  'codeStart' | 'codeEnd' | 'codePrefix' | 'codeWidth' | 'customer' | 'scanner'>): TraceBatch {
  return {
    status: '赋码建档',
    inboundCodes: [],
    outboundCodes: [],
    writeoffCodes: [],
    returnedCodes: [],
    createdAt: '2026-09-20 09:00',
    ...partial,
  }
}

function seqCodes(prefix: string, width: number, from: number, to: number): string[] {
  const list: string[] = []
  for (let i = from; i <= to; i += 1) list.push(formatCode(prefix, i, width))
  return list
}

// 示例一：10 盒装码段全部入库、部分出库部分核销，演示“核销到哪一步”。
const batchA = sampleBatch({
  batchNo: 'FM2026092001',
  version: 1,
  productName: '阿莫西林胶囊（示例）',
  productBatchNo: 'CP2026091801',
  packageSpec: '10 盒/中盒',
  codeStart: 1,
  codeEnd: 10,
  codePrefix: '812345600',
  codeWidth: 4,
  customer: '九州通医药（示例客户）',
  scanner: '王出库',
  status: '核销中',
  createdAt: '2026-09-20 09:12',
  inboundCodes: seqCodes('812345600', 4, 1, 10),
  outboundCodes: seqCodes('812345600', 4, 1, 6),
  writeoffCodes: seqCodes('812345600', 4, 1, 3),
})

// 示例二：已出库且已核销后退货 2 枚，演示“退货回库再扫一次”与部分退货。
const batchB = sampleBatch({
  batchNo: 'FM2026092102',
  version: 2,
  productName: '布洛芬片（示例）',
  productBatchNo: 'CP2026091902',
  packageSpec: '20 盒/箱',
  codeStart: 101,
  codeEnd: 106,
  codePrefix: '812345600',
  codeWidth: 4,
  customer: '国控药房（示例客户）',
  scanner: '李扫码',
  status: '部分退货',
  createdAt: '2026-09-22 14:30',
  inboundCodes: seqCodes('812345600', 4, 101, 106),
  outboundCodes: seqCodes('812345600', 4, 101, 106),
  writeoffCodes: seqCodes('812345600', 4, 101, 106),
  returnedCodes: seqCodes('812345600', 4, 105, 106),
})

// 示例三：建档后发现码段规格有误，升版到 V2，V1 作废——口径只留最新一版。
const batchCOld = sampleBatch({
  batchNo: 'FM2026092503',
  version: 1,
  productName: '维生素 C 片（示例）',
  productBatchNo: 'CP2026092403',
  packageSpec: '12 盒/箱（误填）',
  codeStart: 201,
  codeEnd: 212,
  codePrefix: '812345600',
  codeWidth: 4,
  customer: '漱玉平民（示例客户）',
  scanner: '张码工',
  status: '已作废',
  createdAt: '2026-09-25 08:40',
})
const batchC = sampleBatch({
  batchNo: 'FM2026092503',
  version: 2,
  productName: '维生素 C 片（示例）',
  productBatchNo: 'CP2026092403',
  packageSpec: '24 盒/箱',
  codeStart: 301,
  codeEnd: 312,
  codePrefix: '812345600',
  codeWidth: 4,
  customer: '漱玉平民（示例客户）',
  scanner: '张码工',
  createdAt: '2026-09-25 10:05',
})

export const TRACE_SEED_BATCHES: TraceBatch[] = [batchA, batchB, batchCOld, batchC]

export const TRACE_SEED_EVENTS: TraceScanEvent[] = [
  {
    id: 1,
    batchNo: 'FM2026092001',
    version: 1,
    kind: '入库',
    codes: seqCodes('812345600', 4, 1, 10),
    operator: '赵入库',
    customer: '',
    time: '2026-09-21 10:02',
    note: '成品入库整段扫齐',
  },
  {
    id: 2,
    batchNo: 'FM2026092001',
    version: 1,
    kind: '出库',
    codes: seqCodes('812345600', 4, 1, 6),
    operator: '王出库',
    customer: '九州通医药（示例客户）',
    time: '2026-09-23 15:20',
    note: '发九州通 6 中盒',
  },
  {
    id: 3,
    batchNo: 'FM2026092001',
    version: 1,
    kind: '核销',
    codes: seqCodes('812345600', 4, 1, 3),
    operator: '核销岗',
    customer: '',
    time: '2026-09-24 09:40',
    note: '客户回传核销 3 枚',
  },
  {
    id: 4,
    batchNo: 'FM2026092102',
    version: 2,
    kind: '入库',
    codes: seqCodes('812345600', 4, 101, 106),
    operator: '赵入库',
    customer: '',
    time: '2026-09-22 15:00',
    note: '',
  },
  {
    id: 5,
    batchNo: 'FM2026092102',
    version: 2,
    kind: '出库',
    codes: seqCodes('812345600', 4, 101, 106),
    operator: '李扫码',
    customer: '国控药房（示例客户）',
    time: '2026-09-24 11:10',
    note: '',
  },
  {
    id: 6,
    batchNo: 'FM2026092102',
    version: 2,
    kind: '核销',
    codes: seqCodes('812345600', 4, 101, 106),
    operator: '核销岗',
    customer: '',
    time: '2026-09-26 16:00',
    note: '整批核销',
  },
  {
    id: 7,
    batchNo: 'FM2026092102',
    version: 2,
    kind: '退货回库',
    codes: seqCodes('812345600', 4, 105, 106),
    operator: '退货验收岗',
    customer: '国控药房（示例客户）',
    time: '2026-09-28 10:30',
    note: '客户退回 2 盒，回库重新扫码',
  },
]
