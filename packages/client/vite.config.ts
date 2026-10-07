import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [vue()],
  build: {
    // ★ 牌面 SVG 每个 6~18KB（最大 17.8KB）：全量内联，首屏 37 个请求 → 0
    assetsInlineLimit: 20480,
  },
  server: {
    port: 5173,
    host: true,
  },
});
