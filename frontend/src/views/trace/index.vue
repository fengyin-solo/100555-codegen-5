<template>
  <section class="page trace-page">
    <header class="page-head">
      <div>
        <h2>追溯码赋码与出入库扫码台账</h2>
        <p class="page-desc">
          一批码从赋码建档走到出入库核销：码段按包装规格分批，发货客户与扫码人一一绑定，
          退货回库再扫一次，状态按老次序流转，重复出库只算一次。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="resetAll">重置示例台账</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>

    <!-- 赋码批次台账 -->
    <section class="trace-block">
      <div class="block-head">
        <h3>一、赋码批次台账（口径只取最新一版）</h3>
        <button class="btn primary" type="button" @click="showCreate = !showCreate">
          {{ showCreate ? '收起建档' : '赋码建档' }}
        </button>
      </div>

      <form v-if="showCreate" class="create-form" @submit.prevent="submitCreate">
        <label class="filter-item">
          <span>产品名称</span>
          <input v-model="createForm.productName" placeholder="如：注射用头孢曲松钠" />
        </label>
        <label class="filter-item">
          <span>产品批号（关联成品检验）</span>
          <input v-model="createForm.productBatchNo" placeholder="如：CP20260920" />
        </label>
        <label class="filter-item">
          <span>包装规格（码段按此分批）</span>
          <select v-model="createForm.packSpec">
            <option v-for="spec in packSpecs" :key="spec.spec" :value="spec.spec">
              {{ spec.spec }}（单批上限 {{ spec.maxCount }} 枚）
            </option>
          </select>
        </label>
        <label class="filter-item">
          <span>赋码数量</span>
          <input v-model.number="createForm.codeCount" type="number" min="1" />
        </label>
        <label class="filter-item grow">
          <span>备注</span>
          <input v-model="createForm.remark" placeholder="可选" />
        </label>
        <button class="btn primary" type="submit">生成码段建档</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th>赋码批次</th>
            <th>产品</th>
            <th>产品批号</th>
            <th>包装规格</th>
            <th>码段</th>
            <th>出库进度</th>
            <th>核销进度</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="batch in latestBatches" :key="batch.id">
            <tr>
              <td>
                <button class="link" type="button" @click="toggleDetail(batch.id)">
                  {{ batch.batchNo }}
                </button>
                <span class="version-tag">V{{ batch.version }}</span>
              </td>
              <td>{{ batch.productName }}</td>
              <td>{{ batch.productBatchNo }}</td>
              <td>{{ batch.packSpec }}</td>
              <td class="code-range">
                {{ formatCode(batch.codePrefix, batch.codeStart) }}<br />
                ～{{ formatCode(batch.codePrefix, batch.codeEnd) }}
              </td>
              <td>
                <div class="bar"><span :style="{ width: pct(batch, 'out') + '%' }"></span></div>
                <small>{{ progressOf(batch).outboundTouched }}/{{ batch.codeCount }} 已扫，余 {{ progressOf(batch).untouched }}</small>
              </td>
              <td>
                <div class="bar ok"><span :style="{ width: pct(batch, 'verify') + '%' }"></span></div>
                <small>{{ progressOf(batch).verified }}/{{ batch.codeCount }} 已核销<template v-if="progressOf(batch).returned"> · 退库 {{ progressOf(batch).returned }}</template></small>
              </td>
              <td><span class="status-pill" :data-status="batch.status">{{ batch.status }}</span></td>
              <td class="row-actions">
                <button
                  v-if="batch.status === '待赋码'"
                  class="link"
                  type="button"
                  @click="advance(batch.id, '在库')"
                >确认入库</button>
                <button
                  v-if="batch.status === '在库'"
                  class="link"
                  type="button"
                  @click="advance(batch.id, '已出库')"
                >整批出库</button>
                <span v-if="batch.status === '已出库'" class="muted-hint">扫码核销齐套后自动结案</span>
                <button
                  v-if="batch.status === '在库' || batch.status === '已出库'"
                  class="link"
                  type="button"
                  @click="openScan(batch, '出库扫码')"
                >出库扫码</button>
                <button
                  v-if="batch.status === '已出库'"
                  class="link"
                  type="button"
                  @click="openScan(batch, '退货回库')"
                >退货回库</button>
                <button
                  v-if="batch.status === '已出库'"
                  class="link"
                  type="button"
                  @click="openScan(batch, '核销上报')"
                >逐码核销</button>
                <button class="link" type="button" @click="openRevise(batch)">修订新版</button>
              </td>
            </tr>
            <tr v-if="detailId === batch.id">
              <td colspan="9" class="detail-cell">
                <div class="detail-grid">
                  <div>
                    <h4>码明细（{{ codesOf(batch).length }} 枚）</h4>
                    <div class="code-list">
                      <span
                        v-for="item in codesOf(batch)"
                        :key="item.code"
                        class="code-chip"
                        :data-status="item.status"
                        :title="item.customer ? '客户：' + item.customer : ''"
                      >
                        {{ shortCode(item.code) }} · {{ item.status }}
                      </span>
                    </div>
                  </div>
                  <div>
                    <h4>版本沿革</h4>
                    <ul class="version-list">
                      <li v-for="ver in versionsOf(batch.batchNo)" :key="ver.id">
                        <strong>V{{ ver.version }}</strong>
                        <span :class="{ archived: !ver.isLatest }">{{ ver.isLatest ? '当前版本' : '已归档' }}</span>
                        <em>{{ ver.productName }} / {{ ver.productBatchNo }}</em>
                        <small>{{ ver.remark }}</small>
                      </li>
                    </ul>
                  </div>
                </div>
              </td>
            </tr>
          </template>
          <tr v-if="!latestBatches.length">
            <td colspan="9" class="empty-state">还没有赋码批次，先建档生成码段</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 出入库扫码 -->
    <section class="trace-block">
      <div class="block-head">
        <h3>二、出入库扫码（退货回库必须再扫一次）</h3>
        <div class="tab-row">
          <button
            v-for="tab in scanTabs"
            :key="tab"
            class="tab"
            :class="{ active: scanForm.action === tab }"
            type="button"
            @click="scanForm.action = tab"
          >{{ tab }}</button>
        </div>
      </div>
      <form class="scan-form" @submit.prevent="submitScan">
        <label class="filter-item">
          <span>赋码批次</span>
          <select v-model="scanForm.batchId">
            <option v-for="batch in scannableBatches" :key="batch.id" :value="batch.id">
              {{ batch.batchNo }} V{{ batch.version }}（{{ batch.status }}）
            </option>
          </select>
        </label>
        <label class="filter-item">
          <span>发货客户</span>
          <select v-model="scanForm.customer" @change="syncScanner">
            <option value="" disabled>请选择客户</option>
            <option v-for="item in customers" :key="item.id" :value="item.customer">{{ item.customer }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>扫码人（按对照自动带出）</span>
          <input v-model="scanForm.scanner" readonly placeholder="选择客户后自动对应" />
        </label>
        <label class="filter-item grow">
          <span>追溯码（可多枚，空格/逗号/换行分隔；重复扫、越界自动挡回）</span>
          <textarea v-model="scanForm.codes" rows="2" placeholder="TM-DX-000100001"></textarea>
        </label>
        <button class="btn primary" type="submit">{{ scanForm.action }}</button>
      </form>
      <div v-if="lastScan" class="scan-result" :class="{ bad: !lastScan.ok }">
        <strong>{{ lastScan.message }}</strong>
        <ul v-if="lastScan.detail.length">
          <li v-for="item in lastScan.detail" :key="item.code" :class="{ reject: !item.accepted }">
            {{ item.code }} — {{ item.accepted ? '✓' : '✕' }} {{ item.note }}
          </li>
        </ul>
      </div>
    </section>

    <!-- 扫码流水台账 -->
    <section class="trace-block">
      <div class="block-head">
        <h3>三、扫码流水台账（发哪家、谁扫的、核到哪一步）</h3>
        <label class="filter-item inline">
          <span>按批次过滤</span>
          <select v-model="scanFilterBatch">
            <option value="">全部批次</option>
            <option v-for="batch in allBatches" :key="batch.id" :value="batch.id">
              {{ batch.batchNo }} V{{ batch.version }}
            </option>
          </select>
        </label>
      </div>
      <table class="data-table">
        <thead>
          <tr><th>时间</th><th>批次</th><th>动作</th><th>追溯码</th><th>发货客户</th><th>扫码人</th><th>结果</th><th>说明</th></tr>
        </thead>
        <tbody>
          <tr v-for="row in filteredScans" :key="row.id" :class="{ reject: !row.accepted }">
            <td>{{ formatTime(row.scannedAt) }}</td>
            <td>{{ row.batchNo }}</td>
            <td>{{ row.action }}</td>
            <td>{{ shortCode(row.code) }}</td>
            <td>{{ row.customer }}</td>
            <td>{{ row.scanner }}</td>
            <td>{{ row.accepted ? '接受' : '挡回' }}</td>
            <td>{{ row.note }}</td>
          </tr>
          <tr v-if="!filteredScans.length">
            <td colspan="8" class="empty-state">暂无扫码流水</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 客户对照 -->
    <section class="trace-block">
      <div class="block-head"><h3>四、发货客户 ↔ 扫码人对照（一一对应）</h3></div>
      <form class="filter-bar" @submit.prevent="submitCustomer">
        <label class="filter-item">
          <span>发货客户</span>
          <input v-model="customerForm.customer" placeholder="客户全称" />
        </label>
        <label class="filter-item">
          <span>扫码人</span>
          <input v-model="customerForm.scanner" placeholder="如：扫码员-张三" />
        </label>
        <button class="btn primary" type="submit">绑定对照</button>
      </form>
      <table class="data-table">
        <thead><tr><th>发货客户</th><th>唯一扫码人</th></tr></thead>
        <tbody>
          <tr v-for="item in customers" :key="item.id">
            <td>{{ item.customer }}</td>
            <td>{{ item.scanner }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <p v-if="message" class="page-foot" :class="{ 'error-text': !messageOk }">{{ message }}</p>

    <!-- 修订新版弹层 -->
    <div v-if="reviseTarget" class="modal-mask" @click.self="reviseTarget = null">
      <div class="modal">
        <h3>修订新版：{{ reviseTarget.batchNo }} V{{ reviseTarget.version }}</h3>
        <p class="page-desc">码段、包装规格、状态都不变，只改登记信息；保存后本版归档，新版成为唯一口径。</p>
        <form class="filter-bar" @submit.prevent="submitRevise">
          <label class="filter-item grow">
            <span>产品名称</span>
            <input v-model="reviseForm.productName" />
          </label>
          <label class="filter-item grow">
            <span>产品批号</span>
            <input v-model="reviseForm.productBatchNo" />
          </label>
          <label class="filter-item grow">
            <span>修订说明</span>
            <input v-model="reviseForm.remark" />
          </label>
          <button class="btn primary" type="submit">生成新版</button>
          <button class="btn ghost" type="button" @click="reviseTarget = null">取消</button>
        </form>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  addCustomer,
  advanceBatch,
  batchProgress,
  createBatch,
  formatTraceCode,
  listCodesForBatch,
  listCustomers,
  listLatestBatches,
  listBatchVersions,
  listScans,
  reportVerification,
  resetTraceLedger,
  reviseBatch,
  scanOutbound,
  scanReturn,
  traceOverviewCards,
} from '@/api/trace-service'
import { PACK_SPECS } from '@/data/trace-seed'
import { traceState } from '@/data/trace-store'
import type { ScanResult, TraceBatch, TraceBatchStatus, TraceScan, TraceScanAction } from '@/data/trace-types'

const packSpecs = PACK_SPECS
const scanTabs: TraceScanAction[] = ['出库扫码', '退货回库', '核销上报']

const latestBatches = ref<TraceBatch[]>([])
const allBatches = ref<TraceBatch[]>([])
const customers = ref(listCustomers())
const scans = ref<TraceScanRow[]>([])
const cards = ref(traceOverviewCards())

const showCreate = ref(false)
const detailId = ref<number | null>(null)
const scanFilterBatch = ref<number | ''>('')
const message = ref('')
const messageOk = ref(true)
const lastScan = ref<ScanResult | null>(null)
const reviseTarget = ref<TraceBatch | null>(null)

const createForm = reactive({
  productName: '',
  productBatchNo: '',
  packSpec: '大箱',
  codeCount: 10,
  remark: '',
})

const scanForm = reactive<{ action: TraceScanAction; batchId: number | ''; customer: string; scanner: string; codes: string }>({
  action: '出库扫码',
  batchId: '',
  customer: '',
  scanner: '',
  codes: '',
})

const customerForm = reactive({ customer: '', scanner: '' })
const reviseForm = reactive({ productName: '', productBatchNo: '', remark: '' })

type TraceScanRow = TraceScan
type ProgressRow = ReturnType<typeof batchProgress>
const progressCache = new Map<number, ProgressRow>()

function reload(keepMessage = false) {
  const state = traceState()
  allBatches.value = [...state.batches].reverse()
  latestBatches.value = listLatestBatches()
  customers.value = listCustomers()
  scans.value = listScans().map((row) => ({ ...row }))
  cards.value = traceOverviewCards()
  progressCache.clear()
  if (!keepMessage) message.value = ''
}

const scannableBatches = computed(() =>
  latestBatches.value.filter((batch) => batch.status !== '待赋码' && batch.status !== '已核销'),
)

const filteredScans = computed(() =>
  scanFilterBatch.value === ''
    ? scans.value
    : scans.value.filter((row) => row.batchId === scanFilterBatch.value),
)

function notify(text: string, okFlag = true) {
  message.value = text
  messageOk.value = okFlag
}

function progressOf(batch: TraceBatch): ProgressRow {
  const cached = progressCache.get(batch.id)
  if (cached) return cached
  const row = batchProgress(batch)
  progressCache.set(batch.id, row)
  return row
}

function codesOf(batch: TraceBatch) {
  return listCodesForBatch(batch)
}

function versionsOf(batchNo: string) {
  return listBatchVersions(batchNo)
}

function pct(batch: TraceBatch, kind: 'out' | 'verify'): number {
  const p = progressOf(batch)
  const value = kind === 'out' ? p.outboundTouched : p.verified
  return batch.codeCount === 0 ? 0 : Math.round((value / batch.codeCount) * 100)
}

function formatCode(prefix: string, n: number) {
  return formatTraceCode(prefix, n)
}

function shortCode(code: string) {
  return code.replace(/0+(?=\d+$)/, '')
}

function formatTime(iso: string) {
  return iso.replace('T', ' ').slice(0, 16)
}

function toggleDetail(id: number) {
  detailId.value = detailId.value === id ? null : id
}

function submitCreate() {
  const result = createBatch({ ...createForm })
  notify(result.message, result.ok)
  if (result.ok) {
    showCreate.value = false
    Object.assign(createForm, { productName: '', productBatchNo: '', packSpec: '大箱', codeCount: 10, remark: '' })
    reload(true)
  }
}

function advance(id: number, target: TraceBatchStatus) {
  const result = advanceBatch(id, target)
  notify(result.message, result.ok)
  reload(true)
}

function openScan(batch: TraceBatch, action: TraceScanAction) {
  scanForm.action = action
  scanForm.batchId = batch.id
  lastScan.value = null
  const block = document.querySelector<HTMLElement>('.scan-form')
  block?.scrollIntoView({ behavior: 'smooth' })
}

function syncScanner() {
  const pair = customers.value.find((item) => item.customer === scanForm.customer)
  scanForm.scanner = pair?.scanner ?? ''
}

function submitScan() {
  if (scanForm.batchId === '') {
    notify('请选择赋码批次', false)
    return
  }
  const args = [Number(scanForm.batchId), scanForm.codes, scanForm.customer, scanForm.scanner] as const
  const result =
    scanForm.action === '出库扫码'
      ? scanOutbound(...args)
      : scanForm.action === '退货回库'
        ? scanReturn(...args)
        : reportVerification(...args)
  lastScan.value = result
  notify(result.message, result.ok)
  if (result.accepted > 0) scanForm.codes = ''
  reload(true)
}

function submitCustomer() {
  const result = addCustomer(customerForm.customer, customerForm.scanner)
  notify(result.message, result.ok)
  if (result.ok) {
    customerForm.customer = ''
    customerForm.scanner = ''
    reload(true)
  }
}

function openRevise(batch: TraceBatch) {
  reviseTarget.value = batch
  reviseForm.productName = batch.productName
  reviseForm.productBatchNo = batch.productBatchNo
  reviseForm.remark = batch.remark
}

function submitRevise() {
  if (!reviseTarget.value) return
  const result = reviseBatch(reviseTarget.value.id, { ...reviseForm })
  notify(result.message, result.ok)
  reviseTarget.value = null
  reload(true)
}

function resetAll() {
  resetTraceLedger()
  lastScan.value = null
  reload()
  notify('示例台账已重置')
}

onMounted(() => reload())
</script>

<style scoped>
.trace-block {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 16px;
}
.block-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  gap: 12px;
  flex-wrap: wrap;
}
.block-head h3 {
  font-size: 15px;
  margin: 0;
}
.create-form,
.scan-form {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: flex-end;
  margin-bottom: 12px;
  padding: 10px;
  background: #f8fafc;
  border-radius: 6px;
}
.filter-item.grow {
  flex: 1 1 220px;
}
.filter-item.inline {
  display: flex;
  align-items: center;
  gap: 8px;
}
textarea {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  font: inherit;
}
select,
input {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 8px;
  font: inherit;
}
.code-range {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
}
.version-tag {
  display: inline-block;
  margin-left: 6px;
  font-size: 11px;
  color: var(--brand);
  background: #eaf1fe;
  border-radius: 4px;
  padding: 0 6px;
}
.muted-hint {
  font-size: 12px;
  color: var(--muted);
}
.bar {
  width: 140px;
  height: 6px;
  background: #e5eaf1;
  border-radius: 999px;
  overflow: hidden;
}
.bar span {
  display: block;
  height: 100%;
  background: var(--brand);
}
.bar.ok span {
  background: #12a150;
}
.bar + small {
  color: var(--muted);
  font-size: 11px;
}
.status-pill {
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  background: #eef2f7;
}
.status-pill[data-status='在库'] { background: #e6f4ff; color: #0b6bcb; }
.status-pill[data-status='已出库'] { background: #fff4e5; color: #b54d00; }
.status-pill[data-status='已核销'] { background: #e8f7ef; color: #12805c; }
.status-pill[data-status='待赋码'] { background: #f2f4f7; color: #667085; }
.detail-cell {
  background: #f8fafc;
}
.detail-grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 16px;
}
.detail-grid h4 {
  margin: 0 0 8px;
  font-size: 13px;
}
.code-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.code-chip {
  font-size: 11px;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 6px;
  background: #fff;
}
.code-chip[data-status='已出库'] { border-color: #f5b27b; background: #fff7ef; }
.code-chip[data-status='已核销'] { border-color: #7fd0a6; background: #f0fbf5; }
.code-chip[data-status='已退库'] { border-color: #f0a8a8; background: #fef3f3; }
.version-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.version-list li {
  display: grid;
  grid-template-columns: auto auto 1fr;
  gap: 4px 8px;
  font-size: 12px;
}
.version-list .archived {
  color: var(--muted);
}
.version-list em {
  font-style: normal;
  color: var(--muted);
}
.version-list small {
  grid-column: 1 / -1;
  color: var(--muted);
}
.tab-row {
  display: flex;
  gap: 4px;
}
.tab {
  border: 1px solid var(--border);
  background: #fff;
  border-radius: 6px;
  padding: 4px 12px;
  cursor: pointer;
  font-size: 13px;
}
.tab.active {
  background: var(--brand);
  color: #fff;
  border-color: var(--brand);
}
.scan-result {
  border: 1px solid #b7e4c7;
  background: #f0fbf5;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 13px;
  max-height: 200px;
  overflow: auto;
}
.scan-result.bad {
  border-color: #f0a8a8;
  background: #fef3f3;
}
.scan-result ul {
  margin: 6px 0 0;
  padding-left: 18px;
}
.scan-result li.reject {
  color: #b42318;
}
tr.reject td {
  background: #fff7f7;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(16, 24, 40, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal {
  background: #fff;
  border-radius: 8px;
  padding: 16px;
  width: 560px;
  max-width: 92vw;
}
.modal h3 {
  margin: 0 0 6px;
}
</style>
