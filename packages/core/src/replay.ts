import type { Action } from './actions';
import type { GameEffect } from './effects';
import { advanceRound, createGame, step } from './engine';
import { generalById } from './generals';
import type { Skill } from './skills';
import type { Rules } from './rules';
import type { GameState, RoundInfo, SeatConfig } from './types';

// ============================================================================
// 录像回放：引擎是「纯函数 + action 驱动」，因此只需记录动作序列即可完整重放
// ============================================================================

export interface ReplayAction {
  seat: number;
  action: Action;
}

export interface ReplayRound {
  round: RoundInfo;
  dealer: number;
  actions: ReplayAction[];
}

export interface ReplayData {
  id: string;
  roomId: string;
  createdAt: number;
  seats: SeatConfig[];
  rules: Rules;
  seed: number;
  rounds: ReplayRound[];
}

export interface ReplayStepMeta {
  roundIndex: number;
  stepIndex: number;
}

/**
 * 重放录像：按序推进引擎，逐步回调（state = 该步之后的状态）。
 * 客户端凭此本地回放（无需联网）；测试凭此校验录像可复现。
 * 默认按 `seats[].generalId` 还原武将技能；可用 opts.skillsOf 覆盖（测试/特殊模式）。
 */
export function replayGame(
  data: ReplayData,
  onStep?: (state: GameState, effects: GameEffect[], meta: ReplayStepMeta) => void,
  opts: { skillsOf?: (seat: number) => Skill[] } = {},
): GameState {
  const skillsOf =
    opts.skillsOf ?? ((seat: number) => generalById(data.seats[seat]?.generalId ?? '')?.skills ?? []);
  let s = createGame(data.seats, { seed: data.seed, rules: data.rules });
  data.rounds.forEach((round, ri) => {
    round.actions.forEach((ra, si) => {
      const r = step(s, ra.action, { skillsOf });
      s = r.state;
      onStep?.(s, r.effects, { roundIndex: ri, stepIndex: si });
    });
    if (s.phase === 'ended') s = advanceRound(s); // 局间：连庄/进庄
  });
  return s;
}
