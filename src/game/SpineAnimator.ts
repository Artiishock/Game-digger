/**
 * SpineAnimator — загружает скелет DeepRush_Items и раздаёт
 * анимированные инстансы для монет, золота, алмазов, бомб и камней.
 *
 * Использование:
 *   await SpineAnimator.load()      — вызвать 1 раз при старте
 *   SpineAnimator.createItem(type)  — контейнер с анимацией (или null если не загружен)
 *   SpineAnimator.tick(dt)          — в основном тике, dt в секундах
 *   SpineAnimator.ready             — true если skeleton загружен
 */

import * as PIXI from 'pixi.js'
import { Spine, TextureAtlas } from 'pixi-spine'
import { SkeletonJson, AtlasAttachmentLoader } from '@pixi-spine/runtime-4.1'
import type { EventType } from '../rgs/client'
import { TILE } from './Tileworld'

// ─── Маппинг EventType → имя анимации ────────────────────────────────────────

const ANIM_MAP: Partial<Record<EventType, string>> = {
  COIN:    'coin_idle',
  GOLD:    'gold/gold_idle',
  DIAMOND: 'diamond_idle',
  BOMB:    'bomb_idle',
  STONE:   'rock/rock_idle',
}

// Анимации персонажа
export const CHAR_ANIM = {
  idle:          'character_idle',
  action:        'character_action',
  tornadoShow:   'tornado_show',
  tornadoIdle:   'tornado_idle',
}

// Анимации камня по стадиям
export const ROCK_ANIM = {
  idle:   'rock/rock_idle',
  state1: 'rock/rock_state1',
  state2: 'rock/rock_state2',
  action: 'rock/rock_action',
}

// Анимации золота по стадиям
export const GOLD_ANIM = {
  idle:   'gold/gold_idle',
  state2: 'gold/gold_state2',
  state3: 'gold/gold_state3',
  action: 'gold/gold_action',
}

export const DIRT_ANIM = {
  show: 'dirt_show',
  idle: 'dirt_idle',
}

// Длительность финальной action-анимации (фиксированная)
export const BREAK_ACTION_DURATION = 1.0

// ─── Масштаб: Spine-юниты → пиксели ──────────────────────────────────────────
// coin в Spine ≈ 480 ед. при scale=1, coin_main.scaleX=0.5 → ~240 ед.
// Нам нужно ~50px → scale ≈ 0.20

const ITEM_SCALE: Partial<Record<EventType, number>> = {
  COIN:    0.22,
  GOLD:    0.08,
  DIAMOND: 0.22,
  BOMB:    0.18,
  STONE:   0.08,
}

// Компенсация смещения origin-кости в Spine-скелете.
// coin_main: x=-1368.4 от origin → монета рендерится левее центра контейнера.
// Прибавляем -offset * scale, чтобы визуал совпал с позицией gfx.
const ITEM_SPINE_OFFSET: Partial<Record<EventType, { x: number; y: number }>> = {
  COIN: { x: -1368.4, y: 0 },  // coin_main.x в Spine-единицах
}

// ─── SpineAnimator ────────────────────────────────────────────────────────────

// Слоты с дефолтными аттачментами которые должны быть скрыты для каждой анимации.
// Spine при loop восстанавливает дефолт на 1 кадр — мы принудительно обнуляем их после update().
// Сгенерировано из DeepRush_Items.json на основе слотов с null в t=0 keyframe.
const ANIM_NULL_SLOTS: Record<string, string[]> = {
  'coin_idle': ['body','bomb_body','bomb_flare_particle1','bomb_flare_particle2','bomb_flare_particle3','bomb_flare_particle4','bomb_flare_particle5','bomb_flare_particle6','bomb_flare_particle7','bomb_flare_particle8','bomb_flare_particle9','bomb_flare_particle10','bomb_flare_particle11','bomb_flare_particle12','bomb_fuse','bomb_red_light','bomb_red_light_add','bomb_star','bomb_top','bomb_white_dot','character_arm_R','character_arm_R2','character_body','character_glasses','character_hat','character_head','character_leg_R','character_leg_R2','char_drill_body','char_drill_nose','diamond_back_bot1','diamond_back_bot2','diamond_back_bot3','diamond_back_top1','diamond_back_top2','diamond_back_top3','diamond_back_top4','diamond_back_top5','diamond_front_bot1','diamond_front_bot2','diamond_front_bot3','diamond_front_top','diamond_front_top1','diamond_front_top2','diamond_front_top3','diamond_front_top4','diamond_front_top5','dirt_body','dirt_body_rocks','dirt_body_rocks2','dirt_rock1','dirt_rock2','dirt_rock3','dirt_rock4','dirt_rock6','dirt_rock7','dirt_rock8','dirt_rock9','dirt_rock10','dirt_rock11','dirt_rock13','drill_rocks_L1','drill_rocks_L2','drill_rocks_R1','drill_rocks_R2','drill_stripe1','drill_stripe2','drill_stripe3','drill_stripe4','drill_stripe5','drill_stripe6','drill_stripe7','drill_stripe8','rock_part1','rock_part2','rock_part3','rock_part4','rock_part5','rock_part6','rock_part7','rock_part8','rock_part9','rock_part10','rock_part11','rock_part12','tornado1','tornado2','tornado3','tornado4','tornado5','tornado6','tornado7','tornado8','tornado9','tornado10','tornado11','tornado12','tornado13','tornado14','tornado_dot1','tornado_dot2','tornado_dot3','tornado_dot4','tornado_dot5'],
  'gold/gold_idle': ['bomb_body','bomb_flare_particle1','bomb_flare_particle2','bomb_flare_particle3','bomb_flare_particle4','bomb_flare_particle5','bomb_flare_particle6','bomb_flare_particle7','bomb_flare_particle8','bomb_flare_particle9','bomb_flare_particle10','bomb_flare_particle11','bomb_flare_particle12','bomb_fuse','bomb_red_light','bomb_red_light_add','bomb_star','bomb_top','bomb_white_dot','character_arm_R','character_arm_R2','character_body','character_glasses','character_hat','character_head','character_leg_R','character_leg_R2','char_drill_body','char_drill_nose','coin_back','coin_back2','coin_front','coin_front2','diamond_back_bot1','diamond_back_bot2','diamond_back_bot3','diamond_back_top1','diamond_back_top2','diamond_back_top3','diamond_back_top4','diamond_back_top5','diamond_front_bot1','diamond_front_bot2','diamond_front_bot3','diamond_front_top','diamond_front_top1','diamond_front_top2','diamond_front_top3','diamond_front_top4','diamond_front_top5','dirt_body','dirt_body_rocks','dirt_body_rocks2','dirt_rock1','dirt_rock2','dirt_rock3','dirt_rock4','dirt_rock6','dirt_rock7','dirt_rock8','dirt_rock9','dirt_rock10','dirt_rock11','dirt_rock13','drill_rocks_L1','drill_rocks_L2','drill_rocks_R1','drill_rocks_R2','drill_stripe1','drill_stripe2','drill_stripe3','drill_stripe4','drill_stripe5','drill_stripe6','drill_stripe7','drill_stripe8','rock_part1','rock_part2','rock_part3','rock_part4','rock_part5','rock_part6','rock_part7','rock_part8','rock_part9','rock_part10','rock_part11','rock_part12','side_left','side_right','tornado1','tornado2','tornado3','tornado4','tornado5','tornado6','tornado7','tornado8','tornado9','tornado10','tornado11','tornado12','tornado13','tornado14','tornado_dot1','tornado_dot2','tornado_dot3','tornado_dot4','tornado_dot5'],
  'gold/gold_state2': ['bomb_body','bomb_flare_particle1','bomb_flare_particle2','bomb_flare_particle3','bomb_flare_particle4','bomb_flare_particle5','bomb_flare_particle6','bomb_flare_particle7','bomb_flare_particle8','bomb_flare_particle9','bomb_flare_particle10','bomb_flare_particle11','bomb_flare_particle12','bomb_fuse','bomb_red_light','bomb_red_light_add','bomb_star','bomb_top','bomb_white_dot','character_arm_R','character_arm_R2','character_body','character_glasses','character_hat','character_head','character_leg_R','character_leg_R2','char_drill_body','char_drill_nose','coin_back','coin_back2','coin_front','coin_front2','diamond_back_bot1','diamond_back_bot2','diamond_back_bot3','diamond_back_top1','diamond_back_top2','diamond_back_top3','diamond_back_top4','diamond_back_top5','diamond_front_bot1','diamond_front_bot2','diamond_front_bot3','diamond_front_top','diamond_front_top1','diamond_front_top2','diamond_front_top3','diamond_front_top4','diamond_front_top5','dirt_body','dirt_body_rocks','dirt_body_rocks2','dirt_rock1','dirt_rock2','dirt_rock3','dirt_rock4','dirt_rock6','dirt_rock7','dirt_rock8','dirt_rock9','dirt_rock10','dirt_rock11','dirt_rock13','drill_rocks_L1','drill_rocks_L2','drill_rocks_R1','drill_rocks_R2','drill_stripe1','drill_stripe2','drill_stripe3','drill_stripe4','drill_stripe5','drill_stripe6','drill_stripe7','drill_stripe8','rock_part1','rock_part2','rock_part3','rock_part4','rock_part5','rock_part6','rock_part7','rock_part8','rock_part9','rock_part10','rock_part11','rock_part12','side_left','side_right','tornado1','tornado2','tornado3','tornado4','tornado5','tornado6','tornado7','tornado8','tornado9','tornado10','tornado11','tornado12','tornado13','tornado14','tornado_dot1','tornado_dot2','tornado_dot3','tornado_dot4','tornado_dot5'],
  'gold/gold_state3': ['bomb_body','bomb_flare_particle1','bomb_flare_particle2','bomb_flare_particle3','bomb_flare_particle4','bomb_flare_particle5','bomb_flare_particle6','bomb_flare_particle7','bomb_flare_particle8','bomb_flare_particle9','bomb_flare_particle10','bomb_flare_particle11','bomb_flare_particle12','bomb_fuse','bomb_red_light','bomb_red_light_add','bomb_star','bomb_top','bomb_white_dot','character_arm_R','character_arm_R2','character_body','character_glasses','character_hat','character_head','character_leg_R','character_leg_R2','char_drill_body','char_drill_nose','coin_back','coin_back2','coin_front','coin_front2','diamond_back_bot1','diamond_back_bot2','diamond_back_bot3','diamond_back_top1','diamond_back_top2','diamond_back_top3','diamond_back_top4','diamond_back_top5','diamond_front_bot1','diamond_front_bot2','diamond_front_bot3','diamond_front_top','diamond_front_top1','diamond_front_top2','diamond_front_top3','diamond_front_top4','diamond_front_top5','dirt_body','dirt_body_rocks','dirt_body_rocks2','dirt_rock1','dirt_rock2','dirt_rock3','dirt_rock4','dirt_rock6','dirt_rock7','dirt_rock8','dirt_rock9','dirt_rock10','dirt_rock11','dirt_rock13','drill_rocks_L1','drill_rocks_L2','drill_rocks_R1','drill_rocks_R2','drill_stripe1','drill_stripe2','drill_stripe3','drill_stripe4','drill_stripe5','drill_stripe6','drill_stripe7','drill_stripe8','side_left','side_right','tornado1','tornado2','tornado3','tornado4','tornado5','tornado6','tornado7','tornado8','tornado9','tornado10','tornado11','tornado12','tornado13','tornado14','tornado_dot1','tornado_dot2','tornado_dot3','tornado_dot4','tornado_dot5'],
  'gold/gold_action': ['body','bomb_body','bomb_flare_particle1','bomb_flare_particle2','bomb_flare_particle3','bomb_flare_particle4','bomb_flare_particle5','bomb_flare_particle6','bomb_flare_particle7','bomb_flare_particle8','bomb_flare_particle9','bomb_flare_particle10','bomb_flare_particle11','bomb_flare_particle12','bomb_fuse','bomb_red_light','bomb_red_light_add','bomb_star','bomb_top','bomb_white_dot','character_arm_R','character_arm_R2','character_body','character_glasses','character_hat','character_head','character_leg_R','character_leg_R2','char_drill_body','char_drill_nose','coin_back','coin_back2','coin_front','coin_front2','diamond_back_bot1','diamond_back_bot2','diamond_back_bot3','diamond_back_top1','diamond_back_top2','diamond_back_top3','diamond_back_top4','diamond_back_top5','diamond_front_bot1','diamond_front_bot2','diamond_front_bot3','diamond_front_top','diamond_front_top1','diamond_front_top2','diamond_front_top3','diamond_front_top4','diamond_front_top5','dirt_body','dirt_body_rocks','dirt_body_rocks2','dirt_rock1','dirt_rock2','dirt_rock3','dirt_rock4','dirt_rock6','dirt_rock7','dirt_rock8','dirt_rock9','dirt_rock10','dirt_rock11','dirt_rock13','drill_rocks_L1','drill_rocks_L2','drill_rocks_R1','drill_rocks_R2','drill_stripe1','drill_stripe2','drill_stripe3','drill_stripe4','drill_stripe5','drill_stripe6','drill_stripe7','drill_stripe8','side_left','side_right','tornado1','tornado2','tornado3','tornado4','tornado5','tornado6','tornado7','tornado8','tornado9','tornado10','tornado11','tornado12','tornado13','tornado14','tornado_dot1','tornado_dot2','tornado_dot3','tornado_dot4','tornado_dot5'],
  'rock/rock_idle': ['bomb_body','bomb_flare_particle1','bomb_flare_particle2','bomb_flare_particle3','bomb_flare_particle4','bomb_flare_particle5','bomb_flare_particle6','bomb_flare_particle7','bomb_flare_particle8','bomb_flare_particle9','bomb_flare_particle10','bomb_flare_particle11','bomb_flare_particle12','bomb_fuse','bomb_red_light','bomb_red_light_add','bomb_star','bomb_top','bomb_white_dot','character_arm_R','character_arm_R2','character_body','character_glasses','character_hat','character_head','character_leg_R','character_leg_R2','char_drill_body','char_drill_nose','coin_back','coin_back2','coin_front','coin_front2','diamond_back_bot1','diamond_back_bot2','diamond_back_bot3','diamond_back_top1','diamond_back_top2','diamond_back_top3','diamond_back_top4','diamond_back_top5','diamond_front_bot1','diamond_front_bot2','diamond_front_bot3','diamond_front_top','diamond_front_top1','diamond_front_top2','diamond_front_top3','diamond_front_top4','diamond_front_top5','dirt_body','dirt_body_rocks','dirt_body_rocks2','dirt_rock1','dirt_rock2','dirt_rock3','dirt_rock4','dirt_rock6','dirt_rock7','dirt_rock8','dirt_rock9','dirt_rock10','dirt_rock11','dirt_rock13','drill_rocks_L1','drill_rocks_L2','drill_rocks_R1','drill_rocks_R2','drill_stripe1','drill_stripe2','drill_stripe3','drill_stripe4','drill_stripe5','drill_stripe6','drill_stripe7','drill_stripe8','rock_part1','rock_part2','rock_part3','rock_part4','rock_part5','rock_part6','rock_part7','rock_part8','rock_part9','rock_part10','rock_part11','rock_part12','side_left','side_right','tornado1','tornado2','tornado3','tornado4','tornado5','tornado6','tornado7','tornado8','tornado9','tornado10','tornado11','tornado12','tornado13','tornado14','tornado_dot1','tornado_dot2','tornado_dot3','tornado_dot4','tornado_dot5'],
  'rock/rock_state1': ['bomb_body','bomb_flare_particle1','bomb_flare_particle2','bomb_flare_particle3','bomb_flare_particle4','bomb_flare_particle5','bomb_flare_particle6','bomb_flare_particle7','bomb_flare_particle8','bomb_flare_particle9','bomb_flare_particle10','bomb_flare_particle11','bomb_flare_particle12','bomb_fuse','bomb_red_light','bomb_red_light_add','bomb_star','bomb_top','bomb_white_dot','character_arm_R','character_arm_R2','character_body','character_glasses','character_hat','character_head','character_leg_R','character_leg_R2','char_drill_body','char_drill_nose','coin_back','coin_back2','coin_front','coin_front2','diamond_back_bot1','diamond_back_bot2','diamond_back_bot3','diamond_back_top1','diamond_back_top2','diamond_back_top3','diamond_back_top4','diamond_back_top5','diamond_front_bot1','diamond_front_bot2','diamond_front_bot3','diamond_front_top','diamond_front_top1','diamond_front_top2','diamond_front_top3','diamond_front_top4','diamond_front_top5','dirt_body','dirt_body_rocks','dirt_body_rocks2','dirt_rock1','dirt_rock2','dirt_rock3','dirt_rock4','dirt_rock6','dirt_rock7','dirt_rock8','dirt_rock9','dirt_rock10','dirt_rock11','dirt_rock13','drill_rocks_L1','drill_rocks_L2','drill_rocks_R1','drill_rocks_R2','drill_stripe1','drill_stripe2','drill_stripe3','drill_stripe4','drill_stripe5','drill_stripe6','drill_stripe7','drill_stripe8','rock_part1','rock_part2','rock_part3','rock_part4','rock_part5','rock_part6','rock_part7','rock_part8','rock_part9','rock_part10','rock_part11','rock_part12','side_left','side_right','tornado1','tornado2','tornado3','tornado4','tornado5','tornado6','tornado7','tornado8','tornado9','tornado10','tornado11','tornado12','tornado13','tornado14','tornado_dot1','tornado_dot2','tornado_dot3','tornado_dot4','tornado_dot5'],
  'rock/rock_state2': ['bomb_body','bomb_flare_particle1','bomb_flare_particle2','bomb_flare_particle3','bomb_flare_particle4','bomb_flare_particle5','bomb_flare_particle6','bomb_flare_particle7','bomb_flare_particle8','bomb_flare_particle9','bomb_flare_particle10','bomb_flare_particle11','bomb_flare_particle12','bomb_fuse','bomb_red_light','bomb_red_light_add','bomb_star','bomb_top','bomb_white_dot','character_arm_R','character_arm_R2','character_body','character_glasses','character_hat','character_head','character_leg_R','character_leg_R2','char_drill_body','char_drill_nose','coin_back','coin_back2','coin_front','coin_front2','diamond_back_bot1','diamond_back_bot2','diamond_back_bot3','diamond_back_top1','diamond_back_top2','diamond_back_top3','diamond_back_top4','diamond_back_top5','diamond_front_bot1','diamond_front_bot2','diamond_front_bot3','diamond_front_top','diamond_front_top1','diamond_front_top2','diamond_front_top3','diamond_front_top4','diamond_front_top5','dirt_body','dirt_body_rocks','dirt_body_rocks2','dirt_rock1','dirt_rock2','dirt_rock3','dirt_rock4','dirt_rock6','dirt_rock7','dirt_rock8','dirt_rock9','dirt_rock10','dirt_rock11','dirt_rock13','drill_rocks_L1','drill_rocks_L2','drill_rocks_R1','drill_rocks_R2','drill_stripe1','drill_stripe2','drill_stripe3','drill_stripe4','drill_stripe5','drill_stripe6','drill_stripe7','drill_stripe8','side_left','side_right','tornado1','tornado2','tornado3','tornado4','tornado5','tornado6','tornado7','tornado8','tornado9','tornado10','tornado11','tornado12','tornado13','tornado14','tornado_dot1','tornado_dot2','tornado_dot3','tornado_dot4','tornado_dot5'],
  'rock/rock_action': ['bomb_body','bomb_flare_particle1','bomb_flare_particle2','bomb_flare_particle3','bomb_flare_particle4','bomb_flare_particle5','bomb_flare_particle6','bomb_flare_particle7','bomb_flare_particle8','bomb_flare_particle9','bomb_flare_particle10','bomb_flare_particle11','bomb_flare_particle12','bomb_fuse','bomb_red_light','bomb_red_light_add','bomb_star','bomb_top','bomb_white_dot','character_arm_R','character_arm_R2','character_body','character_glasses','character_hat','character_head','character_leg_R','character_leg_R2','char_drill_body','char_drill_nose','coin_back','coin_back2','coin_front','coin_front2','diamond_back_bot1','diamond_back_bot2','diamond_back_bot3','diamond_back_top1','diamond_back_top2','diamond_back_top3','diamond_back_top4','diamond_back_top5','diamond_front_bot1','diamond_front_bot2','diamond_front_bot3','diamond_front_top','diamond_front_top1','diamond_front_top2','diamond_front_top3','diamond_front_top4','diamond_front_top5','dirt_body','dirt_body_rocks','dirt_body_rocks2','dirt_rock1','dirt_rock2','dirt_rock3','dirt_rock4','dirt_rock6','dirt_rock7','dirt_rock8','dirt_rock9','dirt_rock10','dirt_rock11','dirt_rock13','drill_rocks_L1','drill_rocks_L2','drill_rocks_R1','drill_rocks_R2','drill_stripe1','drill_stripe2','drill_stripe3','drill_stripe4','drill_stripe5','drill_stripe6','drill_stripe7','drill_stripe8','side_left','side_right','tornado1','tornado2','tornado3','tornado4','tornado5','tornado6','tornado7','tornado8','tornado9','tornado10','tornado11','tornado12','tornado13','tornado14','tornado_dot1','tornado_dot2','tornado_dot3','tornado_dot4','tornado_dot5'],
  'diamond_idle': ['body','bomb_body','bomb_flare_particle1','bomb_flare_particle2','bomb_flare_particle3','bomb_flare_particle4','bomb_flare_particle5','bomb_flare_particle6','bomb_flare_particle7','bomb_flare_particle8','bomb_flare_particle9','bomb_flare_particle10','bomb_flare_particle11','bomb_flare_particle12','bomb_fuse','bomb_red_light','bomb_red_light_add','bomb_star','bomb_top','bomb_white_dot','character_arm_R','character_arm_R2','character_body','character_glasses','character_hat','character_head','character_leg_R','character_leg_R2','char_drill_body','char_drill_nose','coin_back','coin_back2','coin_front','coin_front2','diamond_front_top1','diamond_front_top2','diamond_front_top3','diamond_front_top4','diamond_front_top5','dirt_body','dirt_body_rocks','dirt_body_rocks2','dirt_rock1','dirt_rock2','dirt_rock3','dirt_rock4','dirt_rock6','dirt_rock7','dirt_rock8','dirt_rock9','dirt_rock10','dirt_rock11','dirt_rock13','drill_rocks_L1','drill_rocks_L2','drill_rocks_R1','drill_rocks_R2','drill_stripe1','drill_stripe2','drill_stripe3','drill_stripe4','drill_stripe5','drill_stripe6','drill_stripe7','drill_stripe8','rock_part1','rock_part2','rock_part3','rock_part4','rock_part5','rock_part6','rock_part7','rock_part8','rock_part9','rock_part10','rock_part11','rock_part12','side_left','side_right','tornado1','tornado2','tornado3','tornado4','tornado5','tornado6','tornado7','tornado8','tornado9','tornado10','tornado11','tornado12','tornado13','tornado14','tornado_dot1','tornado_dot2','tornado_dot3','tornado_dot4','tornado_dot5'],
  'bomb_idle': ['body','character_arm_R','character_arm_R2','character_body','character_glasses','character_hat','character_head','character_leg_R','character_leg_R2','char_drill_body','char_drill_nose','coin_back','coin_back2','coin_front','coin_front2','diamond_back_bot1','diamond_back_bot2','diamond_back_bot3','diamond_back_top1','diamond_back_top2','diamond_back_top3','diamond_back_top4','diamond_back_top5','diamond_front_bot1','diamond_front_bot2','diamond_front_bot3','diamond_front_top','diamond_front_top1','diamond_front_top2','diamond_front_top3','diamond_front_top4','diamond_front_top5','dirt_body','dirt_body_rocks','dirt_body_rocks2','dirt_rock1','dirt_rock2','dirt_rock3','dirt_rock4','dirt_rock6','dirt_rock7','dirt_rock8','dirt_rock9','dirt_rock10','dirt_rock11','dirt_rock13','drill_rocks_L1','drill_rocks_L2','drill_rocks_R1','drill_rocks_R2','drill_stripe1','drill_stripe2','drill_stripe3','drill_stripe4','drill_stripe5','drill_stripe6','drill_stripe7','drill_stripe8','rock_part1','rock_part2','rock_part3','rock_part4','rock_part5','rock_part6','rock_part7','rock_part8','rock_part9','rock_part10','rock_part11','rock_part12','side_left','side_right','tornado1','tornado2','tornado3','tornado4','tornado5','tornado6','tornado7','tornado8','tornado9','tornado10','tornado11','tornado12','tornado13','tornado14','tornado_dot1','tornado_dot2','tornado_dot3','tornado_dot4','tornado_dot5'],
  'character_idle': ['body','bomb_body','bomb_flare_particle1','bomb_flare_particle2','bomb_flare_particle3','bomb_flare_particle4','bomb_flare_particle5','bomb_flare_particle6','bomb_flare_particle7','bomb_flare_particle8','bomb_flare_particle9','bomb_flare_particle10','bomb_flare_particle11','bomb_flare_particle12','bomb_fuse','bomb_red_light','bomb_red_light_add','bomb_star','bomb_top','bomb_white_dot','coin_back','coin_back2','coin_front','coin_front2','diamond_back_bot1','diamond_back_bot2','diamond_back_bot3','diamond_back_top1','diamond_back_top2','diamond_back_top3','diamond_back_top4','diamond_back_top5','diamond_front_bot1','diamond_front_bot2','diamond_front_bot3','diamond_front_top','diamond_front_top1','diamond_front_top2','diamond_front_top3','diamond_front_top4','diamond_front_top5','dirt_body','dirt_body_rocks','dirt_body_rocks2','dirt_rock1','dirt_rock2','dirt_rock3','dirt_rock4','dirt_rock6','dirt_rock7','dirt_rock8','dirt_rock9','dirt_rock10','dirt_rock11','dirt_rock13','rock_part1','rock_part2','rock_part3','rock_part4','rock_part5','rock_part6','rock_part7','rock_part8','rock_part9','rock_part10','rock_part11','rock_part12','side_left','side_right','tornado1','tornado2','tornado3','tornado4','tornado5','tornado6','tornado7','tornado8','tornado9','tornado10','tornado11','tornado12','tornado13','tornado14','tornado_dot1','tornado_dot2','tornado_dot3','tornado_dot4','tornado_dot5'],
  'character_action': ['body','bomb_body','bomb_flare_particle1','bomb_flare_particle2','bomb_flare_particle3','bomb_flare_particle4','bomb_flare_particle5','bomb_flare_particle6','bomb_flare_particle7','bomb_flare_particle8','bomb_flare_particle9','bomb_flare_particle10','bomb_flare_particle11','bomb_flare_particle12','bomb_fuse','bomb_red_light','bomb_red_light_add','bomb_star','bomb_top','bomb_white_dot','character_arm_R','character_arm_R2','character_body','character_glasses','character_head','character_leg_R','char_drill_body','coin_back','coin_back2','coin_front','coin_front2','diamond_back_bot1','diamond_back_bot2','diamond_back_bot3','diamond_back_top1','diamond_back_top2','diamond_back_top3','diamond_back_top4','diamond_back_top5','diamond_front_bot1','diamond_front_bot2','diamond_front_bot3','diamond_front_top','diamond_front_top1','diamond_front_top2','diamond_front_top3','diamond_front_top4','diamond_front_top5','dirt_body','dirt_body_rocks','dirt_body_rocks2','dirt_rock1','dirt_rock2','dirt_rock3','dirt_rock4','dirt_rock6','dirt_rock7','dirt_rock8','dirt_rock9','dirt_rock10','dirt_rock11','dirt_rock13','rock_part1','rock_part2','rock_part3','rock_part4','rock_part5','rock_part6','rock_part7','rock_part8','rock_part9','rock_part10','rock_part11','rock_part12','side_left','side_right','tornado1','tornado2','tornado3','tornado4','tornado5','tornado6','tornado7','tornado8','tornado9','tornado10','tornado11','tornado12','tornado13','tornado14','tornado_dot1','tornado_dot2','tornado_dot3','tornado_dot4','tornado_dot5'],
  'tornado_idle': ['body','bomb_body','bomb_flare_particle1','bomb_flare_particle2','bomb_flare_particle3','bomb_flare_particle4','bomb_flare_particle5','bomb_flare_particle6','bomb_flare_particle7','bomb_flare_particle8','bomb_flare_particle9','bomb_flare_particle10','bomb_flare_particle11','bomb_flare_particle12','bomb_fuse','bomb_red_light','bomb_red_light_add','bomb_star','bomb_top','bomb_white_dot','character_arm_R','character_arm_R2','character_body','character_glasses','character_hat','character_head','character_leg_R','character_leg_R2','char_drill_body','coin_back','coin_back2','coin_front','coin_front2','diamond_back_bot1','diamond_back_bot2','diamond_back_bot3','diamond_back_top1','diamond_back_top2','diamond_back_top3','diamond_back_top4','diamond_back_top5','diamond_front_bot1','diamond_front_bot2','diamond_front_bot3','diamond_front_top','diamond_front_top1','diamond_front_top2','diamond_front_top3','diamond_front_top4','diamond_front_top5','dirt_body','dirt_body_rocks','dirt_body_rocks2','dirt_rock1','dirt_rock2','dirt_rock3','dirt_rock4','dirt_rock6','dirt_rock7','dirt_rock8','dirt_rock9','dirt_rock10','dirt_rock11','dirt_rock13','drill_rocks_L2','drill_rocks_R2','rock_part1','rock_part2','rock_part3','rock_part4','rock_part5','rock_part6','rock_part7','rock_part8','rock_part9','rock_part10','rock_part11','rock_part12','side_left','side_right'],
  'tornado_show': ['body','bomb_body','bomb_flare_particle1','bomb_flare_particle2','bomb_flare_particle3','bomb_flare_particle4','bomb_flare_particle5','bomb_flare_particle6','bomb_flare_particle7','bomb_flare_particle8','bomb_flare_particle9','bomb_flare_particle10','bomb_flare_particle11','bomb_flare_particle12','bomb_fuse','bomb_red_light','bomb_red_light_add','bomb_star','bomb_top','bomb_white_dot','character_arm_R','character_arm_R2','character_body','character_glasses','character_hat','character_head','character_leg_R','character_leg_R2','char_drill_body','coin_back','coin_back2','coin_front','coin_front2','diamond_back_bot1','diamond_back_bot2','diamond_back_bot3','diamond_back_top1','diamond_back_top2','diamond_back_top3','diamond_back_top4','diamond_back_top5','diamond_front_bot1','diamond_front_bot2','diamond_front_bot3','diamond_front_top','diamond_front_top1','diamond_front_top2','diamond_front_top3','diamond_front_top4','diamond_front_top5','dirt_body','dirt_body_rocks','dirt_body_rocks2','dirt_rock1','dirt_rock2','dirt_rock3','dirt_rock4','dirt_rock6','dirt_rock7','dirt_rock8','dirt_rock9','dirt_rock10','dirt_rock11','dirt_rock13','rock_part1','rock_part2','rock_part3','rock_part4','rock_part5','rock_part6','rock_part7','rock_part8','rock_part9','rock_part10','rock_part11','rock_part12','side_left','side_right'],
  'dirt_idle': ['body','bomb_body','bomb_flare_particle1','bomb_flare_particle2','bomb_flare_particle3','bomb_flare_particle4','bomb_flare_particle5','bomb_flare_particle6','bomb_flare_particle7','bomb_flare_particle8','bomb_flare_particle9','bomb_flare_particle10','bomb_flare_particle11','bomb_flare_particle12','bomb_fuse','bomb_red_light','bomb_red_light_add','bomb_star','bomb_top','bomb_white_dot','character_arm_R','character_arm_R2','character_body','character_glasses','character_hat','character_head','character_leg_R','character_leg_R2','char_drill_body','char_drill_nose','coin_back','coin_back2','coin_front','coin_front2','diamond_back_bot1','diamond_back_bot2','diamond_back_bot3','diamond_back_top1','diamond_back_top2','diamond_back_top3','diamond_back_top4','diamond_back_top5','diamond_front_bot1','diamond_front_bot2','diamond_front_bot3','diamond_front_top','diamond_front_top1','diamond_front_top2','diamond_front_top3','diamond_front_top4','diamond_front_top5','drill_rocks_L1','drill_rocks_L2','drill_rocks_R1','drill_rocks_R2','drill_stripe1','drill_stripe2','drill_stripe3','drill_stripe4','drill_stripe5','drill_stripe6','drill_stripe7','drill_stripe8','rock_part1','rock_part2','rock_part3','rock_part4','rock_part5','rock_part6','rock_part7','rock_part8','rock_part9','rock_part10','rock_part11','rock_part12','side_left','side_right','tornado1','tornado2','tornado3','tornado4','tornado5','tornado6','tornado7','tornado8','tornado9','tornado10','tornado11','tornado12','tornado13','tornado14','tornado_dot1','tornado_dot2','tornado_dot3','tornado_dot4','tornado_dot5'],
  'dirt_show': ['body','bomb_body','bomb_flare_particle1','bomb_flare_particle2','bomb_flare_particle3','bomb_flare_particle4','bomb_flare_particle5','bomb_flare_particle6','bomb_flare_particle7','bomb_flare_particle8','bomb_flare_particle9','bomb_flare_particle10','bomb_flare_particle11','bomb_flare_particle12','bomb_fuse','bomb_red_light','bomb_red_light_add','bomb_star','bomb_top','bomb_white_dot','character_arm_R','character_arm_R2','character_body','character_glasses','character_hat','character_head','character_leg_R','character_leg_R2','char_drill_body','char_drill_nose','coin_back','coin_back2','coin_front','coin_front2','diamond_back_bot1','diamond_back_bot2','diamond_back_bot3','diamond_back_top1','diamond_back_top2','diamond_back_top3','diamond_back_top4','diamond_back_top5','diamond_front_bot1','diamond_front_bot2','diamond_front_bot3','diamond_front_top','diamond_front_top1','diamond_front_top2','diamond_front_top3','diamond_front_top4','diamond_front_top5','drill_rocks_L1','drill_rocks_L2','drill_rocks_R1','drill_rocks_R2','drill_stripe1','drill_stripe2','drill_stripe3','drill_stripe4','drill_stripe5','drill_stripe6','drill_stripe7','drill_stripe8','rock_part1','rock_part2','rock_part3','rock_part4','rock_part5','rock_part6','rock_part7','rock_part8','rock_part9','rock_part10','rock_part11','rock_part12','side_left','side_right','tornado1','tornado2','tornado3','tornado4','tornado5','tornado6','tornado7','tornado8','tornado9','tornado10','tornado11','tornado12','tornado13','tornado14','tornado_dot1','tornado_dot2','tornado_dot3','tornado_dot4','tornado_dot5'],
}

export class SpineAnimator {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static _skeletonData: any = null
  private static _loading: Promise<boolean> | null = null
  private static _instances: Spine[] = []
  // Spine слоты которые нужно держать null для каждого инстанса (по имени анимации)
  private static _instanceNullSlots: Map<Spine, any[]> = new Map()
  private static _coinDebugFrame = 0

  // ── Загрузка ────────────────────────────────────────────────────────────────

  static load(): Promise<boolean> {
    if (!this._loading) this._loading = this._doLoad()
    return this._loading
  }

  private static async _doLoad(): Promise<boolean> {
    try {
      const [atlasText, spineJson, texture] = await Promise.all([
        fetch('./DeepRush_Items.atlas.txt').then(r => {
          if (!r.ok) throw new Error(`Atlas not found (${r.status})`)
          return r.text()
        }),
        fetch('./DeepRush_Items.json').then(r => {
          if (!r.ok) throw new Error(`Spine JSON not found (${r.status})`)
          return r.json()
        }),
        PIXI.Texture.fromURL('./DeepRush_Items.png'),
      ])

      const atlas = new TextureAtlas(
        atlasText,
        (_path: string, cb: (t: PIXI.BaseTexture) => void) => cb(texture.baseTexture),
      )

      // pixi-spine ships runtime-4.1 only; Spine 4.2 JSON is backwards-compatible.
      // Patch the version so the loader accepts the file.
      if (typeof spineJson.skeleton?.spine === 'string' &&
          spineJson.skeleton.spine.startsWith('4.2')) {
        spineJson.skeleton.spine = '4.1.24'
      }

      const skelJson = new SkeletonJson(new AtlasAttachmentLoader(atlas))
      skelJson.scale = 1
      this._skeletonData = skelJson.readSkeletonData(spineJson)

      console.log('[SpineAnimator] ✓ Loaded OK')
      return true
    } catch (e) {
      console.warn('[SpineAnimator] Failed to load:', e)
      return false
    }
  }

  // ── Фабрики ──────────────────────────────────────────────────────────────────

  /** Создать анимированный Spine-спрайт для пикапа */
  static createItem(type: EventType): Spine | null {
    const animName = ANIM_MAP[type]
    if (!animName) return null
    const scale = ITEM_SCALE[type] ?? 0.20
    const spine = this._make(animName, scale)
    if (spine) {
      const off = ITEM_SPINE_OFFSET[type]
      if (off) {
        spine.x = -off.x * scale  // компенсируем смещение кости
        spine.y = -off.y * scale
      }
    }
    return spine
  }

  /** Создать Spine-персонажа (character_idle / character_action) */
  static createCharacter(scale = 0.30): Spine | null {
    return this._make(CHAR_ANIM.idle, scale)
  }

  /** Создать эффект грязи в точке входа (dirt_show → dirt_idle) */
  static createDirt(scale = 0.30): Spine | null {
    return this._make(DIRT_ANIM.show, scale)
  }

  /** Тикнуть один конкретный инстанс напрямую (для персонажа) */
  static tickOne(inst: Spine | null, dt: number): void {
    if (!inst || (inst as any).destroyed) return
    try { inst.update(dt) } catch { /* ignore */ }
  }

  // ── Управление анимацией ────────────────────────────────────────────────────

  static setAnimation(inst: Spine | null, animName: string, loop = true): void {
    if (!inst || (inst as any).destroyed) return
    try {
      const cur = (inst.state as any).tracks?.[0]
      if (cur?.animation?.name === animName) return
      if (inst.spineData.findAnimation(animName)) {
        inst.state.setAnimation(0, animName, loop)
        this._refreshNullSlots(inst, animName)
      }
    } catch { /* ignore */ }
  }

  /** Запустить анимацию на произвольном треке (для слоёв, напр. грязь на track 1) */
  static setAnimationOnTrack(inst: Spine | null, track: number, animName: string, loop = true): void {
    if (!inst || (inst as any).destroyed) return
    try {
      const cur = (inst.state as any).tracks?.[track]
      if (cur?.animation?.name === animName) return
      if (inst.spineData.findAnimation(animName)) {
        inst.state.setAnimation(track, animName, loop)
      }
    } catch { /* ignore */ }
  }

  static setAnimationSyncedTo(inst: Spine | null, animName: string, totalSeconds: number): void {
    if (!inst || (inst as any).destroyed) return
    try {
      const anim = inst.spineData.findAnimation(animName)
      if (!anim) return
      const animDuration = anim.duration
      const timeScale = animDuration > 0 ? animDuration / Math.max(totalSeconds, 0.1) : 1
      inst.state.setAnimation(0, animName, true)
      const track = (inst.state as any).tracks?.[0]
      if (track) track.timeScale = timeScale
      this._refreshNullSlots(inst, animName)
    } catch { /* ignore */ }
  }

  private static _refreshNullSlots(inst: Spine, animName: string): void {
    const slotNames = ANIM_NULL_SLOTS[animName]
    if (slotNames) {
      const slotObjects = slotNames
        .map(name => inst.skeleton.findSlot(name))
        .filter(Boolean)
      this._instanceNullSlots.set(inst, slotObjects)
    } else {
      this._instanceNullSlots.delete(inst)
    }
  }

  /** Удалить из пула тиков */
  static remove(inst: Spine | null): void {
    if (!inst) return
    const i = this._instances.indexOf(inst)
    if (i >= 0) this._instances.splice(i, 1)
    this._instanceNullSlots.delete(inst)
  }

  /** Тикать все инстансы. Вызывать каждый кадр, dt в секундах. */
  static tick(dt: number): void {
    this._instances = this._instances.filter(inst => {
      if (!inst || (inst as any).destroyed) return false
      try {
        inst.update(dt)

        // Принудительно обнуляем слоты чужих объектов которые Spine восстанавливает при loop
        const nullSlots = this._instanceNullSlots.get(inst)
        if (nullSlots) {
          for (const slot of nullSlots) slot.attachment = null
        }

        // Эмулируем Transform Constraint "coin_scale_CTRL" который pixi-spine не поддерживает:
        // coin_scale_control.scaleY → применяется к coin_front_scale и coin_back_scale
        const curAnim = (inst.state as any).tracks?.[0]?.animation?.name ?? ''
        if (curAnim === 'coin_idle' || curAnim === 'coin_action') {
          this._applyCoinConstraint(inst)
        }

      } catch { /* ignore */ }
      return true
    })
  }

  /**
   * Эмулирует Transform Constraints которые pixi-spine не поддерживает:
   *   coin_scale_CTRL — coin_scale_control.scaleY → coin_front_scale + coin_back_scale
   *   coin_side_CTRL  — coin_side_control.scaleY  → coin_back_rotate
   *
   * Физика сжатия: coin_front_scale имеет rotation=90° в coin_main.
   * Из-за этого scaleY сжимает монету ГОРИЗОНТАЛЬНО (вращение вокруг вертикальной оси):
   *   world_x = f(FSY * ly)  — меняется с FSY
   *   world_y = f(lx)        — НЕ зависит от FSY
   *
   * Проблема coin_side: mesh весит на костях [31]/[33] через squish-chain.
   * При FSY=0.01 горизонтальный размер меша → ~1px → ребро невидимо.
   *
   * Решение: SIDE_SCALE = 0.15 — порог смены фазы:
   *   • FSY монетных костей никогда не опускается ниже SIDE_SCALE
   *   • Ребро появляется при sy < SIDE_SCALE с FSY = SIDE_SCALE
   *   • Переход бесшовный: монета сжата до 15% → ребро с теми же 15% → seamless
   */
  private static readonly SIDE_SCALE = 0.15

  private static _applyCoinConstraint(inst: Spine): void {
    try {
      const skel = inst.skeleton
      const ctrl       = skel.findBone('coin_scale_control')
      const frontScale = skel.findBone('coin_front_scale')
      const backScale  = skel.findBone('coin_back_scale')
      if (!ctrl || !frontScale || !backScale) return

      const sy       = ctrl.scaleY
      const showSide = sy < SpineAnimator.SIDE_SCALE

      // coin_scale_CTRL эмуляция: при ребре — фиксируем на SIDE_SCALE
      frontScale.scaleY = showSide ? SpineAnimator.SIDE_SCALE : sy
      backScale.scaleY  = showSide ? SpineAnimator.SIDE_SCALE : sy

      // coin_side_CTRL эмуляция
      const sideCtrl   = skel.findBone('coin_side_control')
      const backRotate = skel.findBone('coin_back_rotate')
      if (sideCtrl && backRotate) backRotate.scaleY = sideCtrl.scaleY

      skel.updateWorldTransform()

      // Управление attachment-ами
      const slotFront = skel.findSlot('coin_front')
      const slotBack  = skel.findSlot('coin_back')
      const slotL     = skel.findSlot('side_left')
      const slotR     = skel.findSlot('side_right')

      if (showSide) {
        if (slotFront) slotFront.attachment = null
        if (slotBack)  slotBack.attachment  = null
        const skin = skel.data.defaultSkin
        const idx  = skel.data.findSlot('side_left')?.index ?? -1
        const att  = idx >= 0 ? skin.getAttachment(idx, 'coin_side') : null
        if (slotL) slotL.attachment = att ?? null
        if (slotR) slotR.attachment = att ?? null
      } else {
        if (slotL) slotL.attachment = null
        if (slotR) slotR.attachment = null
      }

      // slot.color.a — не работает надёжно: PIXI рендер-луп вызывает updateTransform()
      // который перестраивает меши с оригинальными цветами из анимации.
      // Форсируем alpha напрямую на PIXI slotContainers — это уровень отображения,
      // он не перезаписывается Spine-таймлайном.
      const containers = (inst as any).slotContainers as PIXI.Container[] | undefined
      if (containers) {
        const coinSlotNames = ['coin_front', 'coin_back', 'coin_front2', 'coin_back2', 'side_left', 'side_right']
        for (let i = 0; i < skel.slots.length; i++) {
          const slotName = skel.slots[i].data.name
          if (coinSlotNames.includes(slotName) && containers[i]) {
            containers[i].alpha = 1.0
          }
        }
      }

    } catch (e) {
      console.warn('[SpineAnimator] _applyCoinConstraint error:', e)
    }
  }

  static get ready(): boolean { return !!this._skeletonData }

  // ── Внутреннее ───────────────────────────────────────────────────────────────

  private static _make(animName: string, scale: number): Spine | null {
    if (!this._skeletonData) return null
    try {
      const spine = new Spine(this._skeletonData)
      if (spine.spineData.findAnimation(animName)) {
        spine.state.setAnimation(0, animName, true)
      }
      spine.scale.set(scale)
      spine.autoUpdate = false   // ручное управление через tick()

      // Кэшируем объекты слотов которые нужно держать null для этой анимации
      const slotNames = ANIM_NULL_SLOTS[animName]
      if (slotNames) {
        const slotObjects = slotNames
          .map(name => spine.skeleton.findSlot(name))
          .filter(Boolean)
        this._instanceNullSlots.set(spine, slotObjects)
      }

      // Применяем первый кадр и сразу обнуляем слоты
      spine.update(0)
      const nullSlots = this._instanceNullSlots.get(spine)
      if (nullSlots) for (const slot of nullSlots) slot.attachment = null

      this._instances.push(spine)
      return spine
    } catch (e) {
      console.warn('[SpineAnimator] _make failed:', animName, e)
      return null
    }
  }
}

/** Хитбокс пикапа в пикселях на основе масштаба */
export function getSpineItemSize(type: EventType): { w: number; h: number } {
  const s = ITEM_SCALE[type] ?? 0.20
  // Spine-радиус ≈ 240 ед. → * scale = размер в пикселях
  const px = 240 * s * 0.5
  return { w: Math.max(px, TILE * 0.8), h: Math.max(px, TILE * 0.8) }
}