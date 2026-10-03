<template>
  <section class="page" data-module="finishedqc">
    <header class="page-head">
      <div>
        <h2>成品检验管理</h2>
        <p class="page-desc">维护成品检验报告，围绕检验编号、产品批号、检验项目、标准规定做登记、筛选与状态流转；追溯码核销结果按产品批号落到本清单。</p>
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
          <th>赋码批次</th>
          <th>追溯核销状态</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ traceCell(row).batchNos.join('、') || '—' }}</td>
          <td>
            <span class="trace-status" :data-status="traceCell(row).status">{{ traceCell(row).statusText }}</span>
            <small class="trace-detail">{{ traceCell(row).detail }}</small>
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
          <td :colspan="columns.length + 4" class="empty-state">暂无成品检验数据，可先登记成品检验报告</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条成品检验记录；追溯核销状态与扫码台账同源</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadFinishedqcWithTrace,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { finishedqcTraceCell } from '@/api/trace-service'
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

// 同一套口径：追溯台账页面与本清单都调 finishedqcTraceCell。
function traceCell(row: EntryRow) {
  return finishedqcTraceCell(String(row['产品批号'] ?? ''))
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadFinishedqcWithTrace(filters.value)
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
.trace-status {
  display: inline-block;
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 12px;
  background: #eef2f7;
  margin-right: 4px;
}
.trace-status[data-status='在库'] { background: #e6f4ff; color: #0b6bcb; }
.trace-status[data-status='已出库'] { background: #fff4e5; color: #b54d00; }
.trace-status[data-status='已核销'] { background: #e8f7ef; color: #12805c; }
.trace-detail {
  color: var(--muted);
  font-size: 11px;
}
</style>
