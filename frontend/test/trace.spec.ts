
import { assert } from './assert.ts'
import {
  createBatch, createVersion, voidBatch, submitScan, listBatches, listVersions,
  listEvents, qcWriteoffRows, resetTrace, guardWriteoffStatus, guardBatchTransition,
  traceStats,
} from '../src/api/trace-service.ts'

function range(prefix: string, width: number, from: number, to: number) {
  const out: string[] = []
  for (let i = from; i <= to; i++) out.push(prefix + String(i).padStart(width, '0'))
  return out
}

resetTrace() // 先回到示例数据，再清掉存储重建
localStorage.clear()

// 1. 建档：码段按包装规格分批
let r = createBatch({
  batchNo: 'FM-T1', productName: '测试药', productBatchNo: 'CP-T1', packageSpec: '10 盒/箱',
  codeStart: 1, codeEnd: 10, codePrefix: '900000000', codeWidth: 4,
  customer: '客户甲', scanner: '扫码员A',
})
assert(r.ok, '1.1 建档成功')
assert(listBatches().some(b => b.batchNo === 'FM-T1' && b.version === 1 && b.status === '赋码建档'), '1.2 初始状态=赋码建档')

// 码段重叠挡回
r = createBatch({
  batchNo: 'FM-T2', productName: '测试药', productBatchNo: 'CP-T2', packageSpec: '10 盒/箱',
  codeStart: 5, codeEnd: 15, codePrefix: '900000000', codeWidth: 4,
  customer: '客户乙', scanner: '扫码员B',
})
assert(!r.ok && r.message.includes('重叠'), '1.3 码段重叠挡回: ' + r.message)

// 客户-扫码人一一对应：同客户换人挡回
r = createBatch({
  batchNo: 'FM-T3', productName: '测试药', productBatchNo: 'CP-T3', packageSpec: '20 盒/箱',
  codeStart: 101, codeEnd: 110, codePrefix: '900000000', codeWidth: 4,
  customer: '客户甲', scanner: '扫码员X',
})
assert(!r.ok && r.message.includes('一一对应'), '1.4 一客多人挡回: ' + r.message)
// 同人多客挡回
r = createBatch({
  batchNo: 'FM-T3', productName: '测试药', productBatchNo: 'CP-T3', packageSpec: '20 盒/箱',
  codeStart: 101, codeEnd: 110, codePrefix: '900000000', codeWidth: 4,
  customer: '客户丙', scanner: '扫码员A',
})
assert(!r.ok && r.message.includes('一一对应'), '1.5 一人多客挡回: ' + r.message)
// 合规第二批次
r = createBatch({
  batchNo: 'FM-T3', productName: '测试药', productBatchNo: 'CP-T3', packageSpec: '20 盒/箱',
  codeStart: 101, codeEnd: 110, codePrefix: '900000000', codeWidth: 4,
  customer: '客户乙', scanner: '扫码员B',
})
assert(r.ok, '1.6 不同客户/扫码人且码段不重叠可建档')

// 2. 入库扫码
const codes1 = range('900000000', 4, 1, 10)
r = submitScan('FM-T1', { kind: '入库', rawCodes: codes1.join(' '), operator: '入库员' })
assert(r.ok && r.data!.accepted.length === 10, '2.1 整段入库成功')
assert(listBatches().find(b => b.batchNo === 'FM-T1')!.status === '入库完成', '2.2 批次=入库完成')
// 倒序：重复入库挡回
r = submitScan('FM-T1', { kind: '入库', rawCodes: codes1[0], operator: '入库员' })
assert(!r.ok && r.message.includes('越界'), '2.3 重复入库（倒序）挡回: ' + r.message)
// 越界码：别的批次码段
r = submitScan('FM-T1', { kind: '入库', rawCodes: '9000000000101', operator: '入库员' })
assert(!r.ok && r.message.includes('不属于批次'), '2.4 码越界挡回: ' + r.message)

// 3. 出库：客户/扫码人校验 + 重复出库只算一次
// 错误扫码人
r = submitScan('FM-T1', { kind: '出库', rawCodes: codes1[0], operator: '扫码员Z', customer: '客户甲' })
assert(!r.ok && r.message.includes('无权扫出库'), '3.1 非绑定扫码人挡回: ' + r.message)
// 错误客户
r = submitScan('FM-T1', { kind: '出库', rawCodes: codes1[0], operator: '扫码员A', customer: '客户乙' })
assert(!r.ok && r.message.includes('发货客户'), '3.2 非绑定客户挡回: ' + r.message)
// 正常出库 1-6
r = submitScan('FM-T1', { kind: '出库', rawCodes: codes1.slice(0, 6).join(','), operator: '扫码员A', customer: '客户甲' })
assert(r.ok && r.data!.accepted.length === 6, '3.3 出库 6 枚成功')
// 同一枚码重复出库：跳过只算一次，不报错
r = submitScan('FM-T1', { kind: '出库', rawCodes: [codes1[0], codes1[1], codes1[6]].join(','), operator: '扫码员A', customer: '客户甲' })
assert(r.ok && r.data!.accepted.length === 1 && r.data!.skipped.length === 2, '3.4 重复出库 2 枚跳过、新码 1 枚入账')
const b = listBatches().find(x => x.batchNo === 'FM-T1')!
assert(new Set(b.outboundCodes).size === b.outboundCodes.length && b.outboundCodes.length === 7, '3.5 出库码去重后共 7 枚')
// 未入库先出库（码 8 未出库状态是已入库可以；拿批次 T3 全新批次测出库）
r = submitScan('FM-T3', { kind: '出库', rawCodes: '9000000000101', operator: '扫码员B', customer: '客户乙' })
assert(!r.ok && r.message.includes('需要「已入库」'), '3.6 未入库先出库挡回: ' + r.message)

// 4. 核销：老次序 + 三档核销状态
r = submitScan('FM-T1', { kind: '核销', rawCodes: codes1.slice(0, 3).join(' '), operator: '核销岗' })
assert(r.ok, '4.1 核销 3 枚成功')
const qc = qcWriteoffRows().find(x => x.productBatchNo === 'CP-T1')!
assert(qc.writeoff === '核销中' && qc.writeoffCount === 3 && qc.outbound === 7, '4.2 成品检验口径核销中 3/7')
// 核销未出库的码挡回（码 9 还在库）
r = submitScan('FM-T1', { kind: '核销', rawCodes: codes1[8], operator: '核销岗' })
assert(!r.ok && r.message.includes('需要「已出库」'), '4.3 核销在库码挡回: ' + r.message)
// guardWriteoffStatus 越界
assert(!guardWriteoffStatus('已对账').ok, '4.4 核销状态越界挡回')
assert(guardWriteoffStatus('已核销').ok, '4.5 合法核销状态放行')
// 全部出库码核销 → 已核销
r = submitScan('FM-T1', { kind: '核销', rawCodes: codes1.slice(3, 7).join(' '), operator: '核销岗' })
assert(r.ok && listBatches().find(x => x.batchNo === 'FM-T1')!.status === '已核销', '4.6 出清核销后批次=已核销')
assert(qcWriteoffRows().find(x => x.productBatchNo === 'CP-T1')!.writeoff === '已核销', '4.7 成品检验口径=已核销')

// 5. 退货回库必须再扫一次
// 未出库的码退货挡回
r = submitScan('FM-T1', { kind: '退货回库', rawCodes: codes1[9], operator: '验收岗', customer: '客户甲' })
assert(!r.ok && r.message.includes('越界'), '5.1 在库码退货挡回: ' + r.message)
// 已核销码退货 2 枚 → 部分退货
r = submitScan('FM-T1', { kind: '退货回库', rawCodes: codes1.slice(0, 2).join(' '), operator: '验收岗', customer: '客户甲' })
assert(r.ok && listBatches().find(x => x.batchNo === 'FM-T1')!.status === '部分退货', '5.2 已核销码退货再扫→部分退货')
// 退货流水单独可查
assert(listEvents({ kind: '退货回库' }).some(e => e.batchNo === 'FM-T1' && e.codes.length === 2), '5.3 退货流水留痕')
// 退货是末档终态：退货码倒序重新出库拒收（要再发货须另建批次）
r = submitScan('FM-T1', { kind: '出库', rawCodes: codes1[0], operator: '扫码员A', customer: '客户甲' })
assert(!r.ok && r.message.includes('已退货'), '5.4 退货码倒序重新出库拒收: ' + r.message)

// 6. 超限挡回
const tooMany = Array.from({ length: 501 }, (_, i) => '900000000' + String(900000 + i).padStart(4, '0'))
r = submitScan('FM-T3', { kind: '入库', rawCodes: tooMany.join(' '), operator: '入库员' })
assert(!r.ok && r.message.includes('超过单次'), '6.1 单次超 500 枚挡回: ' + r.message)
// 整批原子性：本次没有任何码入账
assert(listBatches().find(x => x.batchNo === 'FM-T3')!.inboundCodes.length === 0, '6.2 超限挡回后零入账')

// 7. 新版建档：只留最新一版，旧版作废留痕；已出库的不能升版
r = createVersion('FM-T1', { packageSpec: '12 盒/箱' })
assert(!r.ok && r.message.includes('出库'), '7.1 已有出库码的批次不能升版: ' + r.message)
r = createVersion('FM-T3', { packageSpec: '24 盒/箱（更正）' })
assert(r.ok, '7.2 未出库批次可升版: ' + r.message)
const latest = listBatches().find(x => x.batchNo === 'FM-T3')!
assert(latest.version === 2 && latest.packageSpec.includes('24'), '7.3 口径只留最新 V2')
const versions = listVersions('FM-T3')
assert(versions.length === 2 && versions[1].status === '已作废' && versions[0].version === 2, '7.4 旧 V1 作废留痕')
// listBatches 默认每批次号只出一条
assert(listBatches().filter(x => x.batchNo === 'FM-T3').length === 1, '7.5 默认列表每批次只一条最新版')

// 8. 状态倒序守卫
assert(!guardBatchTransition('已核销', '出库中').ok, '8.1 已核销→出库中 倒序拒收')
assert(guardBatchTransition('赋码建档', '入库中').ok, '8.2 正向流转放行')
// 作废后扫码挡回
r = voidBatch('FM-T3')
assert(r.ok, '8.3 作废成功')
r = submitScan('FM-T3', { kind: '入库', rawCodes: '9000000000301', operator: '入库员' })
assert(!r.ok && r.message.includes('已作废'), '8.4 作废批次扫码挡回')

// 9. 扫码流水与统计
assert(listEvents().filter(e => e.batchNo === 'FM-T1').length >= 5, '9.1 FM-T1 流水齐全')
const s = traceStats()
assert(s.writeoffPending >= 0 && s.returned >= 2, '9.2 统计含退货码')
// 已作废批次不出现在成品检验核销口径
assert(!qcWriteoffRows().some(x => x.batchNo === 'FM-T3'), '9.3 作废批次不落到成品检验清单')

console.log('\n全部追溯台账口径用例通过 ✔')
