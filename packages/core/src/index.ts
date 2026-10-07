export * from './sha256';
export * from './types';
export * from './actions';
export * from './effects';
export * from './scoring';
export * from './skills';
export * from './generals';
export * from './engine';
export * from './ai';
export * from './tenpai';
export * from './agari';
export * from './yaku';
export * from './shanten';
export * from './rules';
export * from './replay';

// riichi-core 纯 TS 模块（命名空间导出避免 toString/isValid 等命名冲突）
export * as pai from './pai/pai';
export * as mentsu from './pai/mentsu';
export * as packedMentsu from './pai/packed-mentsu';
export * as packedSuite from './pai/packed-suite';
export * as paiUtil from './pai/util';
export * as wall from './pai/wall';
export * as decomp from './pai/decomp/index';
export { TenpaiType } from './pai/decomp/tenpai-type';
export type { TenpaiDecomp, TenpaiDecompSet } from './pai/decomp/index';
