<script setup lang="ts">
import type { Tile } from '@sanguo/core';
import TileSprite from './TileSprite.vue';

/** 左上角信息位：宝牌指示牌 + 供托 + 场供 + 音效开关（样式见 styles/legacy.css） */
defineProps<{
  doraIndicators: Tile[];
  riichiSticks: number;
  honba: number;
  soundOn: boolean;
}>();

const emit = defineEmits<{ 'update:soundOn': [value: boolean] }>();
</script>

<template>
  <div class="corner">
    <span class="corner-label">宝牌</span>
    <span class="corner-tiles">
      <TileSprite v-for="(t, i) in doraIndicators" :key="i" :tile="t" :size="26" />
    </span>
    <span class="corner-sep" />
    <span class="corner-label">供托</span>
    <span class="corner-val">{{ riichiSticks * 1000 }}</span>
    <span class="corner-sep" />
    <span class="corner-label">场供</span>
    <span class="corner-val">{{ honba * 300 }}</span>
    <span v-if="honba > 0" class="corner-sub">{{ honba }} 本场</span>
    <button
      class="mini sound-toggle"
      :title="soundOn ? '关闭音效' : '开启音效'"
      @click="emit('update:soundOn', !soundOn)"
    >
      {{ soundOn ? '🔊' : '🔇' }}
    </button>
  </div>
</template>
