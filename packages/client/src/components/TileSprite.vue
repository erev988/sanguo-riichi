<script setup lang="ts">
import type { Tile } from '@sanguo/core';
import { computed } from 'vue';

// 素材：mahjong_graphic（M+ 字体授权，可自由使用/修改；详见 assets/tiles/LICENSE.txt）
const modules = import.meta.glob('../assets/tiles/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** 内部编码（0-37）→ 素材文件名：0=赤5m, 1-9 数牌, 10=赤5p…, 31-37 字牌 → 1z-7z */
function tileFile(t: Tile): string {
  if (t <= 9) return `${t}m`;
  if (t <= 19) return `${t - 10}p`;
  if (t <= 29) return `${t - 20}s`;
  return `${t - 30}z`;
}

const props = defineProps<{
  /** 牌面编码；背面牌（back）可不传 */
  tile?: Tile;
  /** 高度（px），宽度按标准比例 19:26 自动算 */
  size?: number;
  /** 变暗（弃牌等次要信息） */
  dim?: boolean;
  /** 横置（副露 / 立直宣言牌） */
  rotated?: boolean;
  /** 手牌背面 */
  back?: boolean;
}>();

const src = computed(() =>
  props.back ? undefined : modules[`../assets/tiles/${tileFile(props.tile ?? 0)}.svg`],
);
const h = computed(() => props.size ?? 42);
const w = computed(() => Math.round((h.value * 19) / 26));
</script>

<template>
  <span
    class="tile"
    :class="{ dim, rotated, back }"
    :style="{ height: `${h}px`, width: rotated ? `${h}px` : `${w}px` }"
  >
    <img v-if="!back && src" :src="src" :alt="String(tile)" draggable="false" />
    <span v-else-if="back" class="tile-back" />
    <span v-else class="tile-blank" />
  </span>
</template>

<style scoped>
/* 牌底：由本作自己渲染（象牙白 + 微凸质感），素材 SVG 只提供牌面图案 */
.tile {
  display: inline-block;
  flex: none;
  line-height: 0;
  position: relative;
  border-radius: 4px;
  background: linear-gradient(168deg, #f6f0e2 0%, #e8dfca 52%, #d9cdb4 100%);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.5) inset,
    0 -2px 3px rgba(80, 62, 40, 0.22) inset,
    0 2px 4px rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(120, 100, 70, 0.35);
  overflow: hidden;
}

.tile img {
  width: 100%;
  height: 100%;
  display: block;
  user-select: none;
}

.tile.rotated {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.tile.rotated img {
  position: absolute;
  width: auto;
  height: 100%;
  left: 50%;
  top: 0;
  transform: translateX(-50%) rotate(90deg);
}

.tile.dim {
  filter: saturate(0.82) brightness(0.92);
}

/* 牌背 */
.tile-back {
  display: block;
  position: absolute;
  inset: 0;
  border-radius: 4px;
  background: linear-gradient(160deg, #3f5d4a 0%, #2c4436 55%, #223528 100%);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}

/* 白板：仅牌底（素材缺 5z，空白恰合白板本义） */
.tile-blank {
  display: block;
  position: absolute;
  inset: 5px;
  border-radius: 2px;
  border: 1px solid rgba(120, 100, 70, 0.22);
}
</style>
