import type { Action, GameEffect, GameState, ReplayData, Rules, SeatConfig, SeatInfo } from '@sanguo/core';
import { z } from 'zod';

// ============================================================================
// 前后端通信协议（zod 运行时校验 + 版本号）
// ============================================================================

/** 协议版本：不兼容变更时递增，客户端据此提示升级 */
export const PROTOCOL_VERSION = 1;

const TileSchema = z.number().int().min(0).max(37);
const SeatSchema = z.number().int().min(0).max(3);

/** 客户端动作（z.ZodType<Action> 约束：schema 与 core 类型必须一致） */
export const ActionSchema: z.ZodType<Action> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('draw') }),
  z.object({ type: z.literal('discard'), tile: TileSchema, riichi: z.boolean().optional() }),
  z.object({ type: z.literal('tsumo') }),
  z.object({ type: z.literal('ron'), player: SeatSchema, tile: TileSchema, from: SeatSchema }),
  z.object({ type: z.literal('ryukyoku') }),
  z.object({ type: z.literal('kyuushu') }),
  z.object({ type: z.literal('pass') }),
  z.object({ type: z.literal('chii'), player: SeatSchema, tile: TileSchema, tiles: z.tuple([TileSchema, TileSchema]) }),
  z.object({ type: z.literal('pon'), player: SeatSchema, tile: TileSchema }),
  z.object({ type: z.literal('kan'), player: SeatSchema, tile: TileSchema }),
  z.object({ type: z.literal('ankan'), player: SeatSchema, tile: TileSchema }),
  z.object({ type: z.literal('kakan'), player: SeatSchema, tile: TileSchema }),
]) as unknown as z.ZodType<Action>;

export interface JoinPayload {
  name: string;
  generalId: string;
  roomId: string;
  /** 房主可指定规则（首个加入者生效） */
  rules?: Partial<Rules>;
}

const RulesSchema = z
  .object({
    initialScore: z.number().int().min(1000).max(1000000).optional(),
    origin: z.number().int().min(1000).max(1000000).optional(),
    kiriageMangan: z.boolean().optional(),
  })
  .optional();

export const ClientMsgSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('join'),
    payload: z.object({
      name: z.string().min(1).max(16),
      generalId: z.string().max(32),
      roomId: z.string().min(1).max(32),
      rules: RulesSchema,
      /** 会话标识（重连凭此恢复原座位） */
      token: z.string().max(64).optional(),
      /** 房间密码（房主设置；加入时需匹配） */
      password: z.string().max(32).optional(),
    }),
  }),
  z.object({ t: z.literal('act'), action: ActionSchema, seq: z.number().int().nonnegative() }),
  z.object({ t: z.literal('snapshot'), seq: z.number().int().nonnegative() }),
  /** 房主：用当前人数开局（空位自动补 AI） */
  z.object({ t: z.literal('start') }),
  /** 房主：添加一个 AI 占位 */
  z.object({ t: z.literal('addAI') }),
  /** 查询房间列表 */
  z.object({ t: z.literal('rooms') }),
  /** 获取本房最近一局回放 */
  z.object({ t: z.literal('replay') }),
  z.object({ t: z.literal('ping') }),
]);

export type ClientMsg = z.infer<typeof ClientMsgSchema>;

export interface RoomMemberInfo {
  seat: number;
  name: string;
  isAI: boolean;
  generalId: string;
}

/** 房间列表条目 */
export interface RoomInfo {
  id: string;
  humans: number;
  ais: number;
  started: boolean;
  /** 是否设置了密码 */
  locked: boolean;
}

export type ServerMsg =
  | {
      t: 'welcome';
      roomId: string;
      seat: number;
      started: boolean;
      protocolVersion: number;
      /** 房间规则（房主指定） */
      rules: Rules;
      /** 是否为断线重连（座位已恢复） */
      rejoined?: boolean;
    }
  /** 房间成员状态（供大厅显示人数/AI 数、开始按钮） */
  | { t: 'room'; members: RoomMemberInfo[]; hostSeat: number; started: boolean }
  | { t: 'rooms'; rooms: RoomInfo[] }
  | { t: 'replay'; replay: ReplayData | null }
  | { t: 'events'; effects: GameEffect[]; revision: number }
  | { t: 'snapshot'; state: GameState }
  | { t: 'error'; code: string; seq?: number }
  | { t: 'pong' };

export { type Action, type GameEffect, type GameState, type SeatInfo, type Rules, type SeatConfig, type ReplayData };