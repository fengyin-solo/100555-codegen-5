<template>
  <section class="page" data-module="finishedqc">
    <header class="page-head">
      <div>
        <h2>成品检验管理</h2>
        <p class="page-desc">维护成品检验报告，围绕检验编号、产品批号、检验项目、标准规定做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记成品检验报告</button>
        <button class="btn" type="button" @click="exportRows">导出成品检验清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
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
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>追溯核销</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            <template v-if="traceCell(row[columns[1]])">
              <span :class="traceCell(row[columns[1]])?.className">{{ traceCell(row[columns[1]])?.label }}</span>
              <div class="trace-sub">{{ traceCell(row[columns[1]])?.detail }}</div>
            </template>
            <span v-else class="trace-empty">无追溯批次</span>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无成品检验数据，可先登记成品检验报告</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条成品检验记录；「追溯核销」列与追溯码台账同源（trace-service.qcWriteoffRows），两处核销状态为同一套</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { qcWriteoffRows } from '@/api/trace-service'
import type { QcWriteoffRow } from '@/api/trace-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('finishedqc')
const columns = ["检验编号", "产品批号", "检验项目", "标准规定", "检验结果", "判定结论", "检验人", "检验状态"]
const actions = ["提交检验", "判定合格", "判定不合格"]
const statuses = ["待检验", "检验中", "已合格", "不合格"]
const stats = [{"label": "待检验批次", "value": 0}, {"label": "检验中批次", "value": 0}, {"label": "不合格批次数", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

// 核销状态两处拿到的为同一套：这里直接按成品批号查追溯台账的统一口径，不另存一份。
const traceMap = new Map<string, QcWriteoffRow>()

function traceCell(productBatchNo: unknown): { label: string; detail: string; className: string } | null {
  const hit = traceMap.get(String(productBatchNo ?? ''))
  if (!hit) return null
  const className = hit.writeoff === '已核销' ? 'trace-ok' : hit.writeoff === '核销中' ? 'trace-warn' : 'trace-todo'
  return {
    label: hit.writeoff,
    detail: `${hit.batchNo} V${hit.version} · 核销 ${hit.writeoffCount}/${hit.outbound}` +
      (hit.returned > 0 ? ` · 退 ${hit.returned}` : ''),
    className,
  }
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '成品检验报告登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    traceMap.clear()
    for (const row of qcWriteoffRows()) traceMap.set(row.productBatchNo, row)
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '成品检验列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.trace-ok { color: #067647; font-weight: 600; }
.trace-warn { color: #b54708; font-weight: 600; }
.trace-todo { color: var(--muted); }
.trace-sub { font-size: 12px; color: var(--muted); }
.trace-empty { color: #94a3b8; font-size: 12px; }
</style>
