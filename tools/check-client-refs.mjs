#!/usr/bin/env node
/**
 * 前端引用完整性检查（防「模板/脚本引用了不存在的标识符」这类回归）
 *
 * 背景：vite build 不做类型检查，模板里 @click="不存在的函数" 依然构建成功，
 *      但运行时抛 ReferenceError。本脚本做源码级校验，可在 CI 中拦住同类问题。
 *
 * 用法：node tools/check-client-refs.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** 扫描全部 .vue（含 components/），避免新增子组件漏检 */
import { readdirSync } from 'node:fs';
const files = ['packages/client/src/App.vue'];
const compDir = 'packages/client/src/components';
try {
  for (const f of readdirSync(path.join(root, compDir))) {
    if (f.endsWith('.vue')) files.push(`${compDir}/${f}`);
  }
} catch {
  /* ignore */
}

const RESERVED = new Set([
  'true', 'false', 'null', 'undefined', 'new', 'typeof', 'in', 'of', 'instanceof', 'void', 'delete',
  'if', 'else', 'return', 'function', 'class', 'const', 'let', 'var', 'await', 'async', 'this',
  'Math', 'Date', 'JSON', 'Number', 'String', 'Boolean', 'Array', 'Object', 'Map', 'Set', 'Promise',
  'console', 'window', 'document', 'location', 'navigator', 'globalThis', 'setTimeout', 'setInterval',
  'clearTimeout', 'clearInterval', 'parseInt', 'parseFloat', 'isNaN', 'encodeURIComponent', 'crypto',
  'Infinity', 'NaN', 'Symbol', 'Error', 'RegExp', 'Uint8Array', 'DataView', 'TextEncoder',
  'key', 'index', 'item', 'val', 'value', 'e', 'ev', 'event', '$event', 't', 'i', 'x', 'y', 's', 'p', 'm', 'n', 'd',
]);

let failed = 0;

for (const rel of files) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) continue;
  const src = fs.readFileSync(full, 'utf8');
  const scriptMatch = src.match(/<script setup[^>]*>([\s\S]*?)<\/script>/);
  const templateMatch = src.match(/<template>([\s\S]*)<\/template>/);
  if (!scriptMatch || !templateMatch) continue;
  const script = scriptMatch[1];
  const template = templateMatch[1];

  // ---- 收集 script 中定义的顶层标识符 ----
  const defined = new Set();
  const patterns = [
    /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
    /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
    /^\s*(?:const|let|var)\s*\{([^}]+)\}\s*=/gm,
    /^\s*(?:const|let|var)\s*\[([^\]]+)\]\s*=/gm,
    /^\s*(?:interface|type|class|enum)\s+([A-Za-z_$][\w$]*)/gm,
    /^\s*import\s+(?:type\s+)?\{([^}]+)\}\s+from/gm,
    /^\s*import\s+([A-Za-z_$][\w$]*)\s+from/gm,
  ];
  // defineProps<{...}> / defineEmits<{...}> 中的字段名视为已定义
  for (const m of script.matchAll(/define(?:Props|Emits)<([\s\S]*?)>\s*\(/g)) {
    for (const f of m[1].matchAll(/([A-Za-z_$][\w$]*)\s*\??\s*:/g)) defined.add(f[1]);
  }
  for (const re of patterns) {
    for (const m of script.matchAll(re)) {
      const body = m[1];
      for (const raw of body.split(',')) {
        const name = raw.trim().split(':')[0]?.trim().split(/\s+as\s+/).pop();
        if (name && /^[A-Za-z_$][\w$]*$/.test(name)) defined.add(name);
      }
    }
  }

  // ---- 收集模板中引用的标识符 ----
  const refs = new Map(); // name -> 首次出现的上下文
  const exprSources = [
    ...[...template.matchAll(/\{\{([\s\S]*?)\}\}/g)].map((m) => m[1]),
    ...[...template.matchAll(/(?:@|:|v-)[\w:.-]+\s*=\s*"([^"]*)"/g)].map((m) => m[1]),
  ];
  for (const expr of exprSources) {
    // 去掉字符串字面量，避免把文案里的词当标识符
    const cleaned = expr.replace(/'[^']*'/g, ' ').replace(/"[^"]*"/g, ' ').replace(/`[^`]*`/g, ' ');
    for (const m of cleaned.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*(?=[.([]|\b)/g)) {
      const name = m[1];
      const after = cleaned.slice(m.index + m[0].length);
      if (/^\s*:/.test(after)) continue; // 对象字面量的键名，不是引用
      if (RESERVED.has(name) || defined.has(name)) continue;
      if (!refs.has(name)) refs.set(name, expr.trim().slice(0, 70));
    }
  }

  // v-for 局部变量（形如 v-for="(a, b) in list"）不算未定义
  for (const m of template.matchAll(/v-for\s*=\s*"\s*\(?([^)]*?)\)?\s+in\s+/g)) {
    for (const v of m[1].split(',')) {
      const nm = v.trim().split(/\s+/)[0];
      if (nm) refs.delete(nm);
    }
  }

  // 模板里作为组件标签使用的名字不算（PascalCase 组件）
  for (const name of [...refs.keys()]) {
    if (/^[A-Z]/.test(name)) refs.delete(name);
  }

  if (refs.size === 0) {
    console.log(`✅ ${rel}：模板引用的标识符全部有定义`);
  } else {
    failed += refs.size;
    console.log(`❌ ${rel}：发现 ${refs.size} 个可能未定义的引用`);
    for (const [name, ctx] of refs) console.log(`   · ${name}  ←  ${ctx}`);
  }
}

// 关键链路断言（防止 connectOnly / sendJoin 这类再次丢失）
const app = fs.readFileSync(path.join(root, 'packages/client/src/App.vue'), 'utf8');
const mustHave = ['net.connect(', 'function connectOnly', 'function sendJoin', 'function handleMsg'];
for (const token of mustHave) {
  const n = (app.match(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  if (n !== 1) {
    console.log(`❌ 关键链路断言失败：期望 ${token} 出现 1 次，实际 ${n} 次`);
    failed++;
  }
}
if (failed === 0) console.log('✅ 关键链路断言通过（连接 / 入座 / 消息处理）');

process.exit(failed === 0 ? 0 : 1);
