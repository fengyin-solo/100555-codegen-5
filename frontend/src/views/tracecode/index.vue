<template>
  <section class="page" data-module="tracecode">
    <header class="page-head">
      <div>
        <h2>追溯码赋码与出入库扫码台账</h2>
        <p class="page-desc">
          一批码从赋码建档 → 入库扫码 → 出库扫码 → 核销，退货回库再扫一次。码段按包装规格分批，
          发货客户与扫码人一一对应；状态按老次序向前流转，倒序拒收；同一枚追溯码重复出库只算一次。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">赋码建档</button>
        <button class="btn" type="button" @click="exportLedger()">导出台账</button>
        <button class="btn ghost" type="button" @click="resetAll">恢复示例</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>赋码批次/成品批号/客户/扫码人</span>
        <input v-model="keyword" placeholder="按关键字检索最新版批次" style="width: 240px" />
      </label>
      <label class="filter-item">
        <span>批次状态</span>
        <select v-model="statusFilter">
          <option value="">全部</option>
          <option v-for="s in batchStatuses" :key="s" :value="s">{{ s }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>赋码批次</th>
          <th>版本</th>
          <th>产品/成品批号</th>
          <th>包装规格</th>
          <th>码段</th>
          <th>发货客户/扫码人</th>
          <th>入库</th>
          <th>出库</th>
          <th>核销</th>
          <th>退货</th>
          <th>批次状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in filteredBatches" :key="`${row.batchNo}-V${row.version}`">
          <td>{{ row.batchNo }}</td>
          <td>V{{ row.version }}</td>
          <td>{{ row.productName }}<br /><span class="muted">{{ row.productBatchNo }}</span></td>
          <td>{{ row.packageSpec }}</td>
          <td class="mono">{{ codeRangeText(row) }}<br /><span class="muted">共 {{ codeTotal(row) }} 枚</span></td>
          <td>{{ row.customer }}<br /><span class="muted">扫码：{{ row.scanner }}</span></td>
          <td>{{ row.inboundCodes.length }}/{{ codeTotal(row) }}</td>
          <td>{{ row.outboundCodes.length }}/{{ codeTotal(row) }}</td>
          <td>
            <span :class="writeoffClass(row)">{{ writeoffText(row) }}</span>
          </td>
          <td>{{ row.returnedCodes.length }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openScan(row, '入库')">入库扫码</button>
            <button class="link" type="button" @click="openScan(row, '出库')">出库扫码</button>
            <button class="link" type="button" @click="openScan(row, '核销')">核销</button>
            <button class="link" type="button" @click="openScan(row, '退货回库')">退货回库</button>
            <button class="link" type="button" @click="openVersion(row)">新版建档</button>
            <button class="link danger" type="button" @click="voidRow(row)">作废</button>
            <button class="link" type="button" @click="toggleVersions(row)">{{ versionOpen[row.batchNo] ? '收起版本' : '版本' }}</button>
          </td>
        </tr>
        <tr v-if="!filteredBatches.length">
          <td :colspan="12" class="empty-state">暂无符合条件的赋码批次，可先「赋码建档」</td>
        </tr>
      </tbody>
    </table>

    <div v-for="row in versionRows" :key="`v-${row.batchNo}`" class="version-panel">
      <strong>「{{ row.batchNo }}」全部版本（台账口径只留最新一版，旧版仅留痕）：</strong>
      <ul>
        <li v-for="v in versionsOf(row.batchNo)" :key="v.version">
          V{{ v.version }} · {{ v.packageSpec }} · {{ codeRangeText(v) }} · {{ v.status }} · 建档于 {{ v.createdAt }}
          <span v-if="v.version === row.version" class="muted">（最新版）</span>
        </li>
      </ul>
    </div>

    <h3 class="section-title">扫码流水（出入库扫码台账）</h3>
    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>流水类型</span>
        <select v-model="eventKindFilter">
          <option value="">全部</option>
          <option v-for="k in scanKinds" :key="k" :value="k">{{ k }}</option>
        </select>
      </label>
      <button class="btn" type="button" @click="reload">刷新</button>
    </form>
    <table class="data-table">
      <thead>
        <tr>
          <th>#</th>
          <th>赋码批次</th>
          <th>版本</th>
          <th>类型</th>
          <th>本次码数</th>
          <th>追溯码</th>
          <th>扫码人</th>
          <th>发货客户</th>
          <th>扫码时间</th>
          <th>备注</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in filteredEvents" :key="e.id">
          <td>{{ e.id }}</td>
          <td>{{ e.batchNo }}</td>
          <td>V{{ e.version }}</td>
          <td>{{ e.kind }}</td>
          <td>{{ e.codes.length }}</td>
          <td class="mono codes-cell">{{ e.codes.join(' ') }}</td>
          <td>{{ e.operator }}</td>
          <td>{{ e.customer || '—' }}</td>
          <td>{{ e.time }}</td>
          <td>{{ e.note || '—' }}</td>
        </tr>
        <tr v-if="!filteredEvents.length">
          <td :colspan="10" class="empty-state">暂无扫码流水</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>核销状态与「成品检验」清单共用同一口径（trace-service.qcWriteoffRows），两处拿到的是同一套。</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>

    <!-- 赋码建档 -->
    <div v-if="createOpen" class="modal-mask" @click.self="createOpen = false">
      <form class="modal" @submit.prevent="submitCreate">
        <h3>赋码建档</h3>
        <div class="form-grid">
          <label><span>赋码批次号</span><input v-model="createForm.batchNo" placeholder="如 FM2026100301" /></label>
          <label><span>产品名称</span><input v-model="createForm.productName" /></label>
          <label><span>成品批号</span><input v-model="createForm.productBatchNo" placeholder="核销结果落到成品检验清单的匹配批号" /></label>
          <label><span>包装规格（码段按规格分批）</span><input v-model="createForm.packageSpec" placeholder="如 20 盒/箱" /></label>
          <label><span>码前缀</span><input v-model="createForm.codePrefix" placeholder="如 812345600" /></label>
          <label><span>码位宽</span><input v-model.number="createForm.codeWidth" type="number" min="1" max="10" /></label>
          <label><span>码段起（流水号）</span><input v-model.number="createForm.codeStart" type="number" min="1" /></label>
          <label><span>码段止（流水号）</span><input v-model.number="createForm.codeEnd" type="number" min="1" /></label>
          <label><span>发货客户</span><input v-model="createForm.customer" /></label>
          <label><span>出库扫码人</span><input v-model="createForm.scanner" /></label>
        </div>
        <p class="form-hint">建档即「赋码建档」状态；同前缀码段不得与其他在档批次重叠；同一客户/扫码人在所有在档批次间一一对应。</p>
        <div class="modal-actions">
          <button class="btn primary" type="submit">建档</button>
          <button class="btn ghost" type="button" @click="createOpen = false">取消</button>
        </div>
      </form>
    </div>

    <!-- 扫码（入库/出库/核销/退货回库） -->
    <div v-if="scanOpen" class="modal-mask" @click.self="scanOpen = false">
      <form class="modal wide" @submit.prevent="submitScanForm">
        <h3>{{ scanForm.kind }} · {{ scanForm.batchNo }} V{{ scanForm.version }}</h3>
        <div class="form-grid">
          <label>
            <span>扫码人</span>
            <input v-model="scanForm.operator" :placeholder="scanForm.kind === '出库' ? `须为绑定扫码人：${scanForm.boundScanner}` : '扫码人工号/姓名'" />
          </label>
          <label v-if="scanForm.kind === '出库' || scanForm.kind === '退货回库'">
            <span>{{ scanForm.kind === '出库' ? '发货客户' : '退货客户' }}</span>
            <input v-model="scanForm.customer" :placeholder="`须为绑定客户：${scanForm.boundCustomer}`" />
          </label>
          <label class="full">
            <span>追溯码（空格/逗号/换行分隔，单次最多 500 枚；重复码自动去重）</span>
            <textarea v-model="scanForm.rawCodes" rows="4" placeholder="扫描枪逐枚录入，支持粘贴批量码"></textarea>
          </label>
          <label class="full"><span>备注</span><input v-model="scanForm.note" /></label>
        </div>
        <p class="form-hint">{{ scanHint }}</p>
        <div class="modal-actions">
          <button class="btn primary" type="submit">入账</button>
          <button class="btn ghost" type="button" @click="scanOpen = false">取消</button>
        </div>
      </form>
    </div>

    <!-- 新版建档 -->
    <div v-if="versionOpenModal" class="modal-mask" @click.self="versionOpenModal = false">
      <form class="modal" @submit.prevent="submitVersionForm">
        <h3>新版建档 · {{ versionForm.batchNo }} V{{ versionForm.fromVersion }} → V{{ versionForm.fromVersion + 1 }}</h3>
        <p class="form-hint">只改需要纠偏的口径（如包装规格/码段）；旧版立即作废留痕，台账与核销状态只认最新版。码已出库的批次不允许升版。</p>
        <div class="form-grid">
          <label><span>包装规格</span><input v-model="versionForm.packageSpec" /></label>
          <label><span>码前缀</span><input v-model="versionForm.codePrefix" /></label>
          <label><span>码位宽</span><input v-model.number="versionForm.codeWidth" type="number" min="1" max="10" /></label>
          <label><span>码段起</span><input v-model.number="versionForm.codeStart" type="number" /></label>
          <label><span>码段止</span><input v-model.number="versionForm.codeEnd" type="number" /></label>
        </div>
        <div class="modal-actions">
          <button class="btn primary" type="submit">升版建档</button>
          <button class="btn ghost" type="button" @click="versionOpenModal = false">取消</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  createBatch,
  createVersion,
  downloadTraceLedger,
  listBatches,
  listEvents,
  listVersions,
  qcWriteoffRows,
  resetTrace,
  submitScan,
  traceStats,
  voidBatch,
} from '@/api/trace-service'
import { BATCH_STATUSES, SCAN_KINDS, batchWriteoffStatus, formatCode } from '@/data/trace-types'
import type { CreateBatchInput } from '@/api/trace-service'
import type { BatchStatus, ScanKind, TraceBatch, TraceScanEvent } from '@/data/trace-types'

const batchStatuses = BATCH_STATUSES
const scanKinds = SCAN_KINDS

const batches = ref<TraceBatch[]>([])
const events = ref<TraceScanEvent[]>([])
const keyword = ref('')
const statusFilter = ref('')
const eventKindFilter = ref('')
const message = ref('')
const messageOk = ref(true)
const versionOpen = reactive<Record<string, boolean>>({})

const statCards = ref([
  { label: '在档赋码批次（最新版）', value: 0 },
  { label: '待入库码', value: 0 },
  { label: '待核销码（已出库未核销）', value: 0 },
  { label: '退货回库码', value: 0 },
  { label: '已作废历史版本', value: 0 },
  { label: '扫码流水总数', value: 0 },
])

function flash(text: string, ok = true) {
  message.value = text
  messageOk.value = ok
}

const filteredBatches = computed(() => {
  const kw = keyword.value.trim()
  return batches.value.filter((b) => {
    if (statusFilter.value && b.status !== statusFilter.value) return false
    if (!kw) return true
    return [b.batchNo, b.productName, b.productBatchNo, b.packageSpec, b.customer, b.scanner]
      .some((v) => v.includes(kw))
  })
})

const filteredEvents = computed(() =>
  events.value.filter((e) => !eventKindFilter.value || e.kind === eventKindFilter.value),
)

const versionRows = computed(() => batches.value.filter((b) => versionOpen[b.batchNo]))

const statusSummary = computed(() =>
  batchStatuses.map((status: BatchStatus) => ({
    status,
    count: batches.value.filter((b) => b.status === status).length,
  })),
)

function codeTotal(row: TraceBatch): number {
  return row.codeEnd - row.codeStart + 1
}
function codeRangeText(row: TraceBatch): string {
  return `${formatCode(row.codePrefix, row.codeStart, row.codeWidth)} ~ ${formatCode(row.codePrefix, row.codeEnd, row.codeWidth)}`
}
function writeoffText(row: TraceBatch): string {
  return `${batchWriteoffStatus(row)} ${row.writeoffCodes.length}/${row.outboundCodes.length}`
}
function writeoffClass(row: TraceBatch): string {
  const s = batchWriteoffStatus(row)
  return s === '已核销' ? 'ok-text' : s === '核销中' ? 'warn-text' : 'muted'
}
function versionsOf(batchNo: string): TraceBatch[] {
  return listVersions(batchNo)
}

function refreshStats() {
  const s = traceStats()
  statCards.value = [
    { label: '在档赋码批次（最新版）', value: s.latestBatches },
    { label: '待入库码', value: s.inboundPending },
    { label: '待核销码（已出库未核销）', value: s.writeoffPending },
    { label: '退货回库码', value: s.returned },
    { label: '已作废历史版本', value: s.voidedVersions },
    { label: '扫码流水总数', value: s.events },
  ]
}

function reload() {
  batches.value = listBatches()
  events.value = listEvents()
  refreshStats()
  // 引用一次同一套核销口径，确保成品检验页与本页永远同步的是同一份函数结果。
  void qcWriteoffRows()
}
function resetFilters() {
  keyword.value = ''
  statusFilter.value = ''
  eventKindFilter.value = ''
}
function toggleVersions(row: TraceBatch) {
  versionOpen[row.batchNo] = !versionOpen[row.batchNo]
}
function exportLedger() {
  downloadTraceLedger()
}
function resetAll() {
  resetTrace()
  Object.keys(versionOpen).forEach((k) => delete versionOpen[k])
  reload()
  flash('已恢复为示例数据')
}
function voidRow(row: TraceBatch) {
  const result = voidBatch(row.batchNo)
  flash(result.message, result.ok)
  if (result.ok) reload()
}

// ---- 建档弹窗 ----
const createOpen = ref(false)
const createForm = ref<CreateBatchInput>({
  batchNo: '', productName: '', productBatchNo: '', packageSpec: '',
  codeStart: 1, codeEnd: 100, codePrefix: '812345600', codeWidth: 4,
  customer: '', scanner: '',
})
function openCreate() {
  createForm.value = {
    batchNo: '', productName: '', productBatchNo: '', packageSpec: '',
    codeStart: 1, codeEnd: 100, codePrefix: '812345600', codeWidth: 4,
    customer: '', scanner: '',
  }
  createOpen.value = true
}
function submitCreate() {
  const result = createBatch(createForm.value)
  flash(result.message, result.ok)
  if (result.ok) {
    createOpen.value = false
    reload()
  }
}

// ---- 扫码弹窗 ----
const scanOpen = ref(false)
const scanForm = reactive({
  batchNo: '', version: 1, kind: '入库' as ScanKind,
  rawCodes: '', operator: '', customer: '', note: '',
  boundScanner: '', boundCustomer: '',
})
const scanHint = computed(() => {
  switch (scanForm.kind) {
    case '入库': return '只收「已赋码」阶段的码；越界码（不属于本批次码段）整批挡回。'
    case '出库': return '只收「已入库」阶段的码；客户与扫码人须与建档绑定一致；同一枚码重复出库只算一次，重复枚自动跳过。'
    case '核销': return '只收「已出库」阶段的码；核销状态只在 未核销/核销中/已核销 三档之间按序推进，越界或超限挡回。'
    case '退货回库': return '退货回库必须再扫一次：只收已出库（含已核销）的码，扫码记入流水并把批次带向部分退货/退货回库。'
    default: return ''
  }
})
function openScan(row: TraceBatch, kind: ScanKind) {
  Object.assign(scanForm, {
    batchNo: row.batchNo, version: row.version, kind,
    rawCodes: '', operator: kind === '出库' ? row.scanner : '', customer: kind === '出库' ? row.customer : '', note: '',
    boundScanner: row.scanner, boundCustomer: row.customer,
  })
  scanOpen.value = true
}
function submitScanForm() {
  const result = submitScan(scanForm.batchNo, {
    kind: scanForm.kind,
    rawCodes: scanForm.rawCodes,
    operator: scanForm.operator,
    customer: scanForm.customer,
    note: scanForm.note,
  })
  flash(result.message, result.ok)
  if (result.ok) {
    scanOpen.value = false
    reload()
  }
}

// ---- 升版弹窗 ----
const versionOpenModal = ref(false)
const versionForm = reactive({
  batchNo: '', fromVersion: 1, packageSpec: '', codePrefix: '812345600',
  codeWidth: 4, codeStart: 1, codeEnd: 100,
})
function openVersion(row: TraceBatch) {
  Object.assign(versionForm, {
    batchNo: row.batchNo, fromVersion: row.version, packageSpec: row.packageSpec,
    codePrefix: row.codePrefix, codeWidth: row.codeWidth, codeStart: row.codeStart, codeEnd: row.codeEnd,
  })
  versionOpenModal.value = true
}
function submitVersionForm() {
  const result = createVersion(versionForm.batchNo, {
    packageSpec: versionForm.packageSpec,
    codePrefix: versionForm.codePrefix,
    codeWidth: versionForm.codeWidth,
    codeStart: versionForm.codeStart,
    codeEnd: versionForm.codeEnd,
  })
  flash(result.message, result.ok)
  if (result.ok) {
    versionOpenModal.value = false
    reload()
  }
}

onMounted(reload)
</script>

<style scoped>
.muted { color: var(--muted); font-size: 12px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
.ok-text { color: #067647; }
.warn-text { color: #b54708; }
.danger { color: #b42318; }
.codes-cell { max-width: 260px; word-break: break-all; }
.section-title { margin: 22px 0 8px; font-size: 15px; }
.version-panel { margin-top: 8px; padding: 8px 12px; background: #fff; border: 1px dashed var(--border); border-radius: 6px; font-size: 13px; }
.version-panel ul { margin: 6px 0 0; padding-left: 18px; }
.modal-mask { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); display: flex; align-items: center; justify-content: center; z-index: 20; }
.modal { background: #fff; border-radius: 10px; padding: 18px 20px; width: 560px; max-height: 88vh; overflow: auto; }
.modal.wide { width: 680px; }
.modal h3 { margin: 0 0 12px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
.form-grid label span { display: block; font-size: 12px; color: var(--muted); margin-bottom: 2px; }
.form-grid input, .form-grid textarea, .form-grid select { width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; font: inherit; }
.form-grid .full { grid-column: 1 / -1; }
.form-hint { font-size: 12px; color: var(--muted); margin: 10px 0; }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
</style>
