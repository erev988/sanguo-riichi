import { createGame, type StepOptions } from '../src/engine';
import type { GameState, Meld } from '../src/types';

/** 造一局 4 人测试对局（每次调用都是全新状态） */
export function dummyState(): GameState {
  return createGame(
    [
      { name: 'A', generalId: 'gen-man', isAI: false },
      { name: 'B', generalId: 'gen-discard', isAI: false },
      { name: 'C', generalId: 'gen-ryukyoku', isAI: false },
      { name: 'D', generalId: 'gen-man', isAI: false },
    ],
    { seed: 42 },
  );
}

/** 无技能（用于只测基础规则） */
export function noSkills(): StepOptions {
  return { skillsOf: () => [] };
}

export function mentsu(type: Meld['type'], tiles: number[]): Meld {
  return { type, tiles };
}
