/// <reference types="vite/client" />

// Vite 注入的环境变量（见 .env.example）
interface ImportMetaEnv {
  readonly VITE_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
