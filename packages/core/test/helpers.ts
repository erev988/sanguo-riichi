import { createGame, type StepOptions } from '../src/engine';
import type { GameState, Meld } from '../src/types';

/** 造一局 4 人测试对局（每次调用都是全新状态；关闭宝牌便于断言番数） */
export function dummyState(): GameState {
  const s = createGame(
    [
      { name: 'A', generalId: 'gen-guanyu', isAI: false },
      { name: 'B', generalId: 'gen-jushou', isAI: false },
      { name: 'C', generalId: 'gen-simayi', isAI: false },
      { name: 'D', generalId: 'gen-guanyu', isAI: false },
    ],
    { seed: 42 },
  );
  // 测试专注技能/规则：清空宝牌指示牌（宝牌另测）
  s.doraIndicators = [];
  s.uraIndicators = [];
  s.doraCount = 0;
  return s;
}

/** 无技能（用于只测基础规则） */
export function noSkills(): StepOptions {
  return { skillsOf: () => [] };
}

export function mentsu(type: Meld['type'], tiles: number[]): Meld {
  return { type, tiles };
}
