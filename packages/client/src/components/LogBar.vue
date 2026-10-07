<script setup lang="ts">
import { ref } from 'vue';

/**
 * 战报条：默认收起只显示最新一条，点击展开最近 20 条。
 * （报告 P1-4：logs 数据早已存在但模板零渲染，吃碰杠/技能/错误全无处可见）
 */
defineProps<{ logs: string[] }>();

const open = ref(false);
</script>

<template>
  <div v-if="logs.length" class="log-bar" @click="open = !open">
    <span class="log-line">📜 {{ logs[0] }}</span>
    <div v-if="open" class="log-list">
      <div v-for="(l, i) in logs.slice(0, 20)" :key="i">{{ l }}</div>
    </div>
  </div>
</template>
