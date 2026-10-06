import type { Skill } from './skills';
import {
  baolian,
  ganglie,
  jianying,
  renjie,
  tuxi,
  wanglie,
  wangzun,
  wusheng,
  zhiheng,
} from './skills';

export type Faction = 'wei' | 'shu' | 'wu' | 'qun';

export interface General {
  id: string;
  name: string;
  faction: Faction;
  desc: string;
  /** 每个武将 1 套技能（可含多个，按 priority 依次结算） */
  skills: Skill[];
}

export const GENERAL_GUANYU: General = {
  id: 'gen-guanyu',
  name: '关羽',
  faction: 'shu',
  desc: '技能「武圣」：胡牌时每个万字面子 +1 番。',
  skills: [wusheng],
};

export const GENERAL_JUshou: General = {
  id: 'gen-jushou',
  name: '沮授',
  faction: 'qun',
  desc: '技能「渐营」：当你连续三张打出一类牌（同一花色或字牌）时，和牌加 1 番，可累计。',
  skills: [jianying],
};

export const GENERAL_SIMAYI: General = {
  id: 'gen-simayi',
  name: '司马懿',
  faction: 'wei',
  desc: '技能「忍戒」：荒牌流局结束时其余三家各付你 2000 点。',
  skills: [renjie],
};

export const GENERAL_ZHANGLIAO: General = {
  id: 'gen-zhangliao',
  name: '张辽',
  faction: 'wei',
  desc: '技能「突袭」：有人吃 / 碰 / 杠时，该玩家付你 500 点。',
  skills: [tuxi],
};

export const GENERAL_YUANSHU: General = {
  id: 'gen-yuanshu',
  name: '袁术',
  faction: 'qun',
  desc:
    '技能「妄尊」：你**先制立直**（场上第一个立直）时，其他人无法立直；' +
    '此后**其他人**和牌时，该和牌者须付你 1000 点（你自己和牌不触发，番数结算照常）。',
  skills: [wangzun],
};

export const GENERAL_DONGZHUO: General = {
  id: 'gen-dongzhuo',
  name: '董卓',
  faction: 'qun',
  desc:
    '技能「暴敛」：和牌时按已打出牌数改番（≤8 张 +3；9~12 张 +1；>12 张 -2，下限 0）。' +
    '流局时你若听牌：不管别人听不听，所有人各付你 2000（且其他听牌者收不到罚符）；' +
    '你若未听牌：其他人正常结算，你额外付 2000 给听牌者。',
  skills: [baolian],
};

export const GENERAL_SUNQUAN: General = {
  id: 'gen-sunquan',
  name: '孙权',
  faction: 'wu',
  desc: '技能「制衡」：和牌手牌中有索子一气通贯（123s + 456s + 789s）时，和牌加 3 番。',
  skills: [zhiheng],
};

export const GENERAL_CHENDAO: General = {
  id: 'gen-chendao',
  name: '陈到',
  faction: 'shu',
  desc: '技能「往烈」：本局中你每有一张打出的牌被鸣走（被吃/碰/杠），你付出点数时减 1000（最低 0）。',
  skills: [wanglie],
};

export const GENERAL_XIAHOUDUN: General = {
  id: 'gen-xiahoudun',
  name: '夏侯惇',
  faction: 'wei',
  desc: '技能「刚烈」：你打出的牌不可以被吃 / 碰 / 杠。',
  skills: [ganglie],
};

export const ALL_GENERALS: General[] = [
  GENERAL_GUANYU,
  GENERAL_JUshou,
  GENERAL_SIMAYI,
  GENERAL_ZHANGLIAO,
  GENERAL_YUANSHU,
  GENERAL_DONGZHUO,
  GENERAL_SUNQUAN,
  GENERAL_CHENDAO,
  GENERAL_XIAHOUDUN,
];

export function generalById(id: string): General | undefined {
  return ALL_GENERALS.find((g) => g.id === id);
}
