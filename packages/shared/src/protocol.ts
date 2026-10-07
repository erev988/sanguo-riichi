import type { Action, GameEffect, GameState, Rules, SeatConfig, SeatInfo } from '@sanguo/core';
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
  /** 会话令牌（断线复座用；由服务器下发，见 welcome.token） */
  token?: string;
  /** 房间密码（房主设置了密码时才需要） */
  password?: string;
}

const RulesSchema = z
  .object({
    initialScore: z.number().int().min(1000).max(1000000).optional(),
    origin: z.number().int().min(1000).max(1000000).optional(),
    kiriageMangan: z.boolean().optional(),
  })
  .optional();

/** 创建房间 */
export interface CreatePayload {
  roomId: string;
  name: string;
  generalId: string;
  password?: string;
  rules?: Partial<Rules>;
}

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
  /** 创建房间并作为房主入座（房间已存在则报 room-exists） */
  z.object({
    t: z.literal('create'),
    payload: z.object({
      roomId: z.string().min(1).max(32),
      name: z.string().min(1).max(16),
      generalId: z.string().max(32),
      password: z.string().max(32).optional(),
      rules: RulesSchema,
    }),
  }),
  z.object({ t: z.literal('act'), action: ActionSchema, seq: z.number().int().nonnegative() }),
  z.object({ t: z.literal('snapshot'), seq: z.number().int().nonnegative() }),
  /** 房主：用当前人数开局（空位自动补 AI） */
  z.object({ t: z.literal('start') }),
  /** 房主：添加一个 AI 占位 */
  z.object({ t: z.literal('addAI') }),
  /** 未开局时更换武将（入座后在大厅选将） */
  z.object({ t: z.literal('pickGeneral'), generalId: z.string().max(32) }),
  /** 快速匹配（仅真人，凑满 4 人自动开局，不补 AI） */
  z.object({
    t: z.literal('match'),
    name: z.string().min(1).max(16),
    generalId: z.string().max(32),
  }),
  /** 取消匹配 */
  z.object({ t: z.literal('cancelMatch') }),
  /** 玩家为本局贡献的随机数（参与定牌，防止服务器单方面决定牌序） */
  z.object({ t: z.literal('clientSeed'), seed: z.string().regex(/^[0-9a-f]{8,64}$/i) }),
  /** 查询房间列表 */
  z.object({ t: z.literal('rooms') }),
  /** 获取本房最近一局回放 */
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
      /** 是否为本次创建的房间 */
      created?: boolean;
      /** 服务器下发的会话令牌（CSPRNG 生成，用于断线复座；客户端需保存） */
      token?: string;
    }
  /** 房间成员状态（供大厅显示人数/AI 数、开始按钮） */
  | { t: 'room'; members: RoomMemberInfo[]; hostSeat: number; started: boolean }
  | { t: 'rooms'; rooms: RoomInfo[] }
  /** 整场对局结束（与每局的 gameEnded 区分：那个只是本局结束） */
  | { t: 'matchEnded'; scores: number[] }
  /** 匹配中（尚未凑满 4 名真人） */
  | { t: 'matching'; waiting: number }
  /** 服务器对本局种子（+盐）的承诺哈希：开局前公布，局后可用公开值验证未被篡改 */
  | { t: 'seedCommit'; commit: string }
  | { t: 'events'; effects: GameEffect[]; revision: number; /** 当前行动家座位（客户端据此高亮与放行出牌） */ current?: number }
  | { t: 'snapshot'; state: GameState }
  | { t: 'error'; code: string; /** 人类可读的补充说明（如非法动作的具体原因） */ message?: string; seq?: number }
  | { t: 'pong' };

export { type Action, type GameEffect, type GameState, type SeatInfo, type Rules, type SeatConfig };