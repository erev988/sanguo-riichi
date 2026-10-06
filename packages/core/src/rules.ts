// ============================================================================
// 规则配置（可在建房时覆盖）
// ============================================================================

export interface Rules {
  /** 每人初始点数 */
  initialScore: number;
  /** 返点 / 终局线：半庄（南 4 局）结束若无人达到则该分数，进入延长战（西场） */
  origin: number;
  /**
   * 切上满贯（kiriage mangan）：
   * - false（默认）：仅「4 番 40 符以上 / 3 番 70 符以上」为满贯
   * - true：额外「4 番 30 符 / 3 番 60 符」也按满贯计算
   */
  kiriageMangan: boolean;
}

/** 本作默认规则（带技能 → 点数波动大，故初始 3 万、返点 4 万） */
export const DEFAULT_RULES: Rules = {
  initialScore: 30000,
  origin: 40000,
  kiriageMangan: false,
};

export function resolveRules(over?: Partial<Rules>): Rules {
  return { ...DEFAULT_RULES, ...over };
}
