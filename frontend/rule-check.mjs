// 规则自检：用 vite 的 SSR 能力直接跑 TS 服务层，不经过浏览器。
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' })
const svc = await vite.ssrLoadModule('/src/api/trace-service.ts')
const store = await vite.ssrLoadModule('/src/data/trace-store.ts')
const local = await vite.ssrLoadModule('/src/api/local-service.ts')

const {
  listLatestBatches,
  batchProgress,
  getBatch,
  createBatch,
  reviseBatch,
  advanceBatch,
  scanOutbound,
  scanReturn,
  reportVerification,
  addCustomer,
  finishedqcTraceCell,
  formatTraceCode,
  resetTraceLedger,
} = svc

const C1 = '华东医药连锁'
const S1 = '扫码员-王磊'
const C2 = '省人民医院药剂科'
const S2 = '扫码员-李静'

let passed = 0
function check(name, cond) {
  if (!cond) throw new Error('FAIL: ' + name)
  passed++
  console.log('✓', name)
}

resetTraceLedger()

// 1. 最新版口径：大箱-DX-0001 只露出 V2。
const latest = listLatestBatches().map((b) => b.batchNo + ':V' + b.version)
check('只取最新一版', latest.includes('大箱-DX-0001:V2') && !latest.some((x) => x.endsWith(':V1') && x.startsWith('大箱')))

// 2. 老次序流转：倒序、跳序拒收。
const b2 = listLatestBatches().find((b) => b.batchNo === '大箱-DX-0001')
check('倒序拒收', advanceBatch(b2.id, '在库').ok === false)
check('跳序拒收', advanceBatch(b2.id, '待赋码').ok === false)
check('终态不可再动', advanceBatch(b2.id, '在库').ok === false && advanceBatch(b2.id, '已出库').ok === false)

// 3. 同一枚追溯码重复出库只算一次（种子里 100005 有重复流水）。
const p2 = batchProgress(b2)
check('重复出库只算一次', p2.outboundTouched === 20 && p2.verified === 20)

// 4. 成品检验同源：CP20260901 → 已核销；台账与清单函数一致。
const cell = finishedqcTraceCell('CP20260901')
check('核销状态两处同源', cell.status === '已核销' && cell.batchNos.includes('大箱-DX-0001') && cell.detail.includes('20/20'))
check('未建档批号为空', finishedqcTraceCell('CP-NONE').status === '—')

// 5. 越界、状态不符挡回：现场再扫一枚越界码 + 一枚未出库码。
const b4 = listLatestBatches().find((b) => b.batchNo === '小盒-XH-0001')
const r1 = reportVerification(b4.id, 'TM-XH-000899999', C1, S1)
check('越界核销整单挡回', r1.ok === false)
const b5seed = listLatestBatches().find((b) => b.batchNo === '小盒-XH-0002')
const r2 = reportVerification(b4.id, formatTraceCode('TM-XH', 800011), C1, S1)
check('不在本批码段不能核销', r2.ok === false)
check('待赋码批次不能核销', reportVerification(b5seed.id, formatTraceCode('TM-XH', 800011), C1, S1).ok === false)
check('重复核销超限挡回', reportVerification(b4.id, formatTraceCode('TM-XH', 800004), C1, S1).ok === false)
const r3 = scanOutbound(b4.id, formatTraceCode('TM-XH', 800001), C1, S1)
check('重复出库只算一次（现场）', r3.ok === false)

// 6. 客户与扫码人一一对应。
check('未登记客户挡回', scanOutbound(b4.id, 'TM-XH-000800008', '野客户', S1).ok === false)
check('客户扫码人不对应挡回', scanOutbound(b4.id, 'TM-XH-000800008', C1, S2).ok === false)
check('客户重复绑定挡回', addCustomer(C1, '扫码员-新人').ok === false)
check('扫码人重复绑定挡回', addCustomer('新客户', S1).ok === false)

// 7. 退货回库必须再扫一次，主状态不倒退。
const before = getBatch(b4.id).status
const rr = scanReturn(b4.id, formatTraceCode('TM-XH', 800006), C1, S1)
check('退货回库接受', rr.ok === true)
check('退货主状态不回退', getBatch(b4.id).status === before)
const back = scanOutbound(b4.id, formatTraceCode('TM-XH', 800006), C2, S2)
check('退货后重新出库需再扫', back.ok === true)
// 状态回到已出库，可核销
reportVerification(b4.id, formatTraceCode('TM-XH', 800006), C2, S2)

// 8. 码段按规格分批、超限挡回。
const big = createBatch({ productName: '试', productBatchNo: 'CP-T', packSpec: '大箱', codeCount: 21 })
check('单批超限挡回', big.ok === false)
const ok1 = createBatch({ productName: '试', productBatchNo: 'CP-T', packSpec: '大箱', codeCount: 5 })
check('大箱新码段接续 100021', ok1.ok && getBatch(ok1.batch.id).codeStart === 100021)
const ok2 = createBatch({ productName: '试', productBatchNo: 'CP-T', packSpec: '中盒', codeCount: 3 })
check('中盒码段独立接续 400013', ok2.ok && getBatch(ok2.batch.id).codeStart === 400013)

// 9. 未扫干净不能整批出库。
const b3 = listLatestBatches().find((b) => b.batchNo === '中盒-ZH-0001')
check('没扫干净挡整批出库', advanceBatch(b3.id, '已出库').ok === false)

// 10. 修订新版：老版归档、码段带走、老版只读。
const rev = reviseBatch(b3.id, { productName: '阿莫西林胶囊（修订）', productBatchNo: 'CP20260902', remark: '订正' })
check('修订出新版本', rev.ok === true && rev.batch.version === 2)
check('老版只读', reviseBatch(b3.id, { productName: 'x', productBatchNo: 'x', remark: '' }).ok === false)
check('码与流水带到新版', batchProgress(rev.batch).outboundTouched === 7)

// 11. 从待赋码走完整顺序：入库→扫完→整批出库→核销→结案，倒序仍拒收。
const b5 = listLatestBatches().find((b) => b.batchNo === '小盒-XH-0002')
check('待赋码不能跳到已出库', advanceBatch(b5.id, '已出库').ok === false)
check('确认入库', advanceBatch(b5.id, '在库').ok === true)
const codes = Array.from({ length: 6 }, (_, i) => formatTraceCode('TM-XH', 800011 + i)).join(' ')
const so = scanOutbound(b5.id, codes, C1, S1)
check('整段扫码出库', so.ok && so.accepted === 6)
check('扫完可整批出库', advanceBatch(b5.id, '已出库').ok === true)
// 重复扫其中一枚，不计数
const dup = scanOutbound(b5.id, formatTraceCode('TM-XH', 800011), C1, S1)
check('已出库批次重复码挡回', dup.ok === false)
const vr = reportVerification(b5.id, codes, C1, S1)
check('全量核销', vr.ok && vr.accepted === 6)
check('全核销自动结案', getBatch(b5.id).status === '已核销')
check('结案后倒序拒收', advanceBatch(b5.id, '已出库').ok === false)

// 12. 清单导出含追溯两列。
const csv = local.exportFinishedqcWithTrace().content
check('CSV 含赋码批次列', csv.includes('赋码批次') && csv.includes('大箱-DX-0001') && csv.includes('已核销'))

console.log(`\n全部 ${passed} 条规则自检通过`)
await vite.close()
