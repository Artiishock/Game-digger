import * as PIXI from 'pixi.js'
import { gameEngine }   from './GameEngine'
import { useGameStore } from '../store/gameStore'
import type { RoundEvent, EventType } from '../rgs/client'
import { TileWorld, TILE } from './Tileworld'
import { LavaSimulation } from './LavaSimulation'
import { SpineAnimator, CHAR_ANIM, getSpineItemSize } from './SpineAnimator'
import type { Spine } from 'pixi-spine'

// ─── Colors ───────────────────────────────────────────────────────────────────

const C = {
  skyDeep:0x1a3a5c, sky:0x5BA3DC, grass:0x7CB944, grassEdge:0x5a8a30,
  coin:0xFFD700, gold:0xFFB830, diamond:0x4ECDC4, bomb:0x222222,
  stone:0x888888, lava:0xFF4500, lavaGlow:0xFF8C00, bg:0x1A0E08,
  skin:0xF5CBA7, skinDk:0xD4A574, shirt:0x3498DB, shirtDk:0x2176AE,
  pants:0x2C3E50, boots:0x5D4037, helmet:0xFFB830, helmetRim:0xCC8800,
  lamp:0xFFFF99, axeShaft:0x6B4226, axeBlade:0xAAAAAA, axeShine:0xDDDDDD,
  dirtChunk:0x8B5E3C,
  particleColors:{
    COIN:0xFFD700,GOLD:0xFFB830,DIAMOND:0x4ECDC4,
    BOMB:0xFF4500,STONE:0x888888,LAVA:0xFF4500,HOME:0x7CFC00,
  } as Record<EventType,number>,
}

const CHAR_SPEED = 130
const IDLE_SPEED = 70
const COLL_R  = TILE * 0.5

// ─── SpineCharacter ───────────────────────────────────────────────────────────
// Заменяет прежний MinerCharacter. Интерфейс тот же: root, update(), destroy().

import { Spine as _Spine } from 'pixi-spine'

const CHAR_SCALE  = 0.18
const CHAR_Y_IDLE = -40   // смещение на поверхности (idle)
const CHAR_Y_RUN  =  70   // смещение в туннеле (running)
class SpineCharacter {
  root: PIXI.Container
  chunkParent: PIXI.Container | null = null
  private _spine: _Spine | null = null
  private _dirts: { g: PIXI.Graphics; vx: number; vy: number; life: number }[] = []

  constructor() {
    this.root = new PIXI.Container()
    const inst = SpineAnimator.createCharacter(CHAR_SCALE)
    if (inst) {
      inst.y = CHAR_Y_IDLE
      this.root.addChild(inst)
      this._spine = inst
    } else {
      SpineAnimator.load().then(() => {
        if ((this.root as any).destroyed) return
        this.root.removeChildren()
        const s = SpineAnimator.createCharacter(CHAR_SCALE)
        if (s) { s.y = CHAR_Y_IDLE; this.root.addChild(s); this._spine = s }
      })
    }
  }

  /** Переключить режим — idle (поверхность) или running (туннель) */
  setIdleMode(idle: boolean) {
    if (this._spine) this._spine.y = idle ? CHAR_Y_IDLE : CHAR_Y_RUN
  }

  update(dt: number, _spd: number, digging: boolean) {
    if (this._spine) {
      this._spine.y = digging ? CHAR_Y_RUN : CHAR_Y_IDLE
      SpineAnimator.setAnimation(this._spine, digging ? CHAR_ANIM.action : CHAR_ANIM.idle)
    }
    // Частицы грязи при копании
    if (digging && Math.random() < 0.04) this._dirt()

    this._dirts = this._dirts.filter(d => {
      d.life -= dt * 2.2
      if (d.life <= 0) { d.g.parent?.removeChild(d.g); d.g.destroy(); return false }
      d.g.x += d.vx * dt; d.g.y += d.vy * dt; d.vy += 320 * dt
      d.g.alpha = d.life; d.g.rotation += dt * 5; return true
    })
  }

  private _dirt() {
    const p = this.chunkParent ?? this.root.parent; if (!p) return
    const g = new PIXI.Graphics()
    const sz = Math.random() * 6 + 3
    g.beginFill(0x8B5E3C, 0.9); g.drawRoundedRect(-sz / 2, -sz / 2, sz, sz, 2); g.endFill()
    g.x = this.root.x + 18 + (Math.random() - 0.5) * 12; g.y = this.root.y + 8
    p.addChild(g)
    this._dirts.push({ g, vx: 50 + Math.random() * 60, vy: -(20 + Math.random() * 50), life: 1 })
  }

  destroy() {
    this._dirts.forEach(d => d.g.destroy())
    if (this._spine) SpineAnimator.remove(this._spine)
    this.root.destroy({ children: true })
  }
}


// ─── SpawnedObj ───────────────────────────────────────────────────────────────

interface SpawnedObj {
  type:     EventType
  gfx:      PIXI.Graphics
  spine:    Spine | null   // Spine-анимация пикапа (null если не загружен)
  worldX:   number
  worldY:   number
  collected:boolean
  terminal: boolean
  width:    number
  height:   number
}

// ─── ObjectSpawner ────────────────────────────────────────────────────────────

const SPAWN_INTERVAL  = TILE * 3
const TERMINAL_EVERY  = TILE * 60

class ObjectSpawner {
  private layer:     PIXI.Container
  private objects:   SpawnedObj[] = []
  private spawnedUpToY = 0
  private nextTerminalY = 0
  private seed:      number
  private drawPickup: (g:PIXI.Graphics, type:EventType) => void
  private drawHome:   (g:PIXI.Graphics, cx:number, cy:number) => void
  private drawLava:   (g:PIXI.Graphics, cx:number, cy:number) => void
  private getPickupSize: (type:EventType) => {w:number, h:number}
  private getHomeSize: () => {w:number, h:number}
  private getLavaSize: () => {w:number, h:number}
  private rgsEvents: RoundEvent[] = []
  private surfY:     number

  constructor(
    layer:PIXI.Container,
    seed:number,
    surfY:number,
    drawPickup:(g:PIXI.Graphics,t:EventType)=>void,
    drawHome:(g:PIXI.Graphics,cx:number,cy:number)=>void,
    drawLava:(g:PIXI.Graphics,cx:number,cy:number)=>void,
    getPickupSize:(type:EventType)=>{w:number, h:number},
    getHomeSize:()=>{w:number, h:number},
    getLavaSize:()=>{w:number, h:number},
  ){
    this.layer=layer; this.seed=seed; this.surfY=surfY
    this.drawPickup=drawPickup; this.drawHome=drawHome; this.drawLava=drawLava
    this.getPickupSize=getPickupSize; this.getHomeSize=getHomeSize; this.getLavaSize=getLavaSize
  }

  setRgsEvents(events:RoundEvent[], ppm:number){
    this.rgsEvents = events
    events.forEach((ev,i)=>{
      if(ev.type==='HOME'||ev.type==='LAVA') return
      const worldY = this.surfY + ev.depth*ppm
      this._spawnAt(ev.type, worldY, false)
    })
  }

  update(charX:number, charY:number, aheadPx:number){
    const genUpTo = charY + aheadPx
    let y = this.spawnedUpToY || charY
    while(y < genUpTo){
      y += SPAWN_INTERVAL
      const r = this._rng(y)
      if(r < 0.65){
        const type = this._pickType(y, this._rng(y^0xABC))
        this._spawnAt(type, y, false)
        // Иногда спавним дополнительный объект сбоку
        if(this._rng(y^0xBEEF) < 0.35) {
          this._spawnAt(this._pickType(y+1, this._rng(y^0xF00D)), y + SPAWN_INTERVAL * 0.5, false)
        }
      }
    }
    this.spawnedUpToY = Math.max(this.spawnedUpToY, y)

    if(!this.nextTerminalY) this.nextTerminalY = charY + TERMINAL_EVERY
    if(charY + aheadPx >= this.nextTerminalY){
      const won = this._rng(this.nextTerminalY^0xDEAD) < 0.6
      const type: EventType = won ? 'HOME' : 'LAVA'
      this._spawnAt(type, this.nextTerminalY, true)
      this.nextTerminalY += TERMINAL_EVERY
    }

    this.objects = this.objects.filter(o=>{
      if(o.collected) return false
      if(o.worldY < charY - TILE*15){
        SpineAnimator.remove(o.spine)
        this.layer.removeChild(o.gfx)
        o.gfx.destroy()
        return false
      }
      return true
    })
  }

  private _spawnAt(type:EventType, worldY:number, terminal:boolean){
    const xOff = (this._rng(worldY^0x1234) - 0.5) * TILE * 40
    const worldX = Math.round(xOff/TILE)*TILE

    const gfx = new PIXI.Graphics()
    let size = {w: TILE * 1.8, h: TILE * 1.8}

    if(type==='HOME') {
      this.drawHome(gfx, worldX, worldY)
      const homeSize = this.getHomeSize()
      size = { w: homeSize.w * 0.6, h: homeSize.h * 0.6 }
    }
    else if(type==='LAVA') {
      this.drawLava(gfx, worldX, worldY)
      size = this.getLavaSize()
    }
    else {
      // Пробуем Spine-анимацию; при неудаче — старая графика
      const spineInst = SpineAnimator.createItem(type)
      if (spineInst) {
        gfx.x = worldX; gfx.y = worldY
        gfx.addChild(spineInst)
        size = getSpineItemSize(type)
        this.layer.addChild(gfx)
        this.objects.push({type,gfx,spine:spineInst,worldX,worldY,collected:false,terminal,width:size.w,height:size.h})
        return
      }
      this.drawPickup(gfx, type)
      gfx.x=worldX; gfx.y=worldY
      const pickupSize = this.getPickupSize(type)
      size = { w: pickupSize.w * 0.55, h: pickupSize.h * 0.55 }
    }
    this.layer.addChild(gfx)
    this.objects.push({type,gfx,spine:null,worldX,worldY,collected:false,terminal,width:size.w,height:size.h})
  }

  private _pickType(y:number, r:number): EventType {
    const depth = y / (TILE*10)
    const bombChance = Math.min(0.3, 0.05 + depth*0.01)
    const stoneChance = Math.min(0.2, 0.03 + depth*0.008)
    if(r < 0.35)              return 'COIN'
    if(r < 0.35+bombChance)   return 'BOMB'
    if(r < 0.55+stoneChance)  return 'STONE'
    if(r < 0.70)              return 'GOLD'
    return 'DIAMOND'
  }

  private _rng(y:number): number {
    let s = ((y*73856093)^this.seed)>>>0
    s = Math.imul(1664525,s)+1013904223>>>0
    return s/0x100000000
  }

  checkCollisions(
    charX:number, charY:number,
    onCollect:(obj:SpawnedObj)=>void
  ){
    for(const o of this.objects){
      if(o.collected) continue
      const charLeft = charX - COLL_R
      const charRight = charX + COLL_R
      const charTop = charY - COLL_R
      const charBottom = charY + COLL_R
      const objLeft = o.worldX - o.width/2
      const objRight = o.worldX + o.width/2
      const objTop = o.worldY - o.height/2
      const objBottom = o.worldY + o.height/2
      if(charLeft < objRight && charRight > objLeft &&
         charTop < objBottom && charBottom > objTop){
        o.collected=true
        onCollect(o)
        break
      }
    }
  }

  reset(){
    this.objects.forEach(o=>{ SpineAnimator.remove(o.spine); if(o.gfx.parent) o.gfx.parent.removeChild(o.gfx); o.gfx.destroy() })
    this.objects=[]
    this.spawnedUpToY=0
    this.nextTerminalY=0
  }
}

// ─── Particles ────────────────────────────────────────────────────────────────

interface Particle{gfx:PIXI.Graphics;vx:number;vy:number;life:number}

// ─── GameRenderer ─────────────────────────────────────────────────────────────

export class GameRenderer {
  app:PIXI.Application
  private worldLayer:   PIXI.Container
  private objectsLayer: PIXI.Container  // ← объекты всегда поверх чанков
  private skyLayer:     PIXI.Container
  private minerLayer:   PIXI.Container = new PIXI.Container()
  private miner:SpineCharacter
  private spawner:ObjectSpawner|null=null
  private tunnelActive = false
  private W=0; private H=0
  private camX=0; private camY=0
  private tileWorld:TileWorld|null=null
  private worldSeed=0xdeadbeef
  private get surfY(){ return TILE }
  private get idleCamY(){ return this.surfY-this.H*0.70 }

  // Idle
  private idleActive=true
  private idleX=0; private idleDir=1; private _bounceT=0

  // Round
  private running=false
  private charX=0; private charY=0
  private charScreenY=0
  private multiplier=1; private depth=0; private distance=0
  private particles:Particle[]=[]
  private ppm=TILE*2
  private rgsQueue:RoundEvent[]=[]

  private _waypoints:number[]=[]
  private _waypointIdx=0
  private _ended=false
  // Случайная скорость спуска
  private _speedMult = 1.0        // текущий множитель скорости
  private _speedTarget = 1.0      // целевой множитель
  private _speedChangeTimer = 0   // таймер смены скорости

  // Stone breaking
  private stoneBreakActive = false;
  private stoneBreakRemainingTime = 0;
  private stoneBreakTotalDuration = 0;
  private stoneBreakStartMultiplier = 0;

  // Золотой самородок — останавливает персонажа, множитель растёт ×3/сек
  private goldBreakActive = false;
  private goldBreakRemainingTime = 0;
  private goldBreakTotalDuration = 0;
  private goldBreakStartMultiplier = 0;

  // Активный объект во время брейка (показываем action-анимацию)
  private _breakSpine: import('pixi-spine').Spine | null = null;
  private _breakGfx:   PIXI.Graphics | null = null;

  // Кэш текстур
  private _textures: Map<string, PIXI.Texture> = new Map()
  private _texturesLoading: Promise<void> | null = null

  // Пещеры
  private _lastCaveY = 0
  private _caveInterval = TILE * 15
  private _caveSeed = 0

  private activeLavas: Map<PIXI.Graphics, {renderer: any, wx: number, wy: number}> = new Map()
  private lavasCavePathUpdated: WeakSet<any> = new WeakSet()
  private lavaSimulation: LavaSimulation | null = null
  private _worldMask: PIXI.Graphics = new PIXI.Graphics()

  constructor(canvas:HTMLCanvasElement,w:number,h:number){
    this.W=w;this.H=h
    const dpr=Math.min(window.devicePixelRatio||1,2)
    canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr)
    const base:PIXI.IApplicationOptions={
      view:canvas,width:w,height:h,backgroundColor:C.bg,
      antialias:true,resolution:dpr,autoDensity:true,hello:false,
    } as any
    let app:PIXI.Application
    try{
      app=new PIXI.Application(base)
      const gl=(app.renderer as any).context?.gl
      if(gl?.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)===0){app.destroy(false);throw new Error('')}
    }catch{
      app=new PIXI.Application({...base,antialias:false,forceCanvas:true})
    }
    this.app=app
    this.skyLayer    = new PIXI.Container()
    this.worldLayer  = new PIXI.Container()
    this.objectsLayer= new PIXI.Container()  // ← между миром и персонажем

    // Порядок слоёв: мир (чанки) → объекты → небо (с маской, поверх чанков) → персонаж
    // skyLayer рисуется ПОВЕРХ чанков, но ограничен маской только до линии травы.
    // minerLayer идёт последним — персонаж всегда поверх неба и чанков.
    this.app.stage.addChild(this.worldLayer, this.objectsLayer, this.skyLayer, this.minerLayer)

    // Маска для skyLayer: небо видно только выше линии травы на экране
    this._worldMask = new PIXI.Graphics()
    this.app.stage.addChild(this._worldMask)
    this.skyLayer.mask = this._worldMask
    this._updateWorldMask(w, h)

    this.charScreenY=h*0.42
    this._buildSky()
    this._makeIdleWorld()
    this.miner=new SpineCharacter()
    this.miner.chunkParent=this.worldLayer
    this.idleX=0
    this.miner.root.x=this.idleX;this.miner.root.y=this.surfY
    this.minerLayer.addChild(this.miner.root)
    this.camX=this.idleX-w/2;this.camY=this.idleCamY
    this.worldLayer.x=-this.camX;   this.worldLayer.y=-this.camY
    this.objectsLayer.x=-this.camX; this.objectsLayer.y=-this.camY
    this.minerLayer.x=-this.camX;   this.minerLayer.y=-this.camY
    this._buildTunnel()
    this._loadTextures()
    SpineAnimator.load()
    this.app.ticker.add(this._tick.bind(this))
  }

  private _buildTunnel(){
    if (this.tileWorld) {
      this.tileWorld.renderer = this.app.renderer as PIXI.Renderer
      this.tileWorld.initMasks()
    }
  }

  private _updateTunnel(sx: number, sy: number){
    if (this.tileWorld) {
      this.tileWorld.scratchAt(sx, sy, this.camX, this.camY)
    }
  }

  private _showTunnel(){
    this.tunnelActive=true
    if(this.tileWorld){
      this.tileWorld.renderer=this.app.renderer as PIXI.Renderer
      this.tileWorld.showBg()
    }
  }
  private _hideTunnel(){
    this.tunnelActive=false
    if(this.tileWorld){
      this.tileWorld.resetScratch()
      this.tileWorld.hideBg()
    }
  }

  private _makeIdleWorld(){
    if(this.tileWorld){this.tileWorld.destroy();this.tileWorld=null}
    TileWorld.loadGrassTex().then(()=>{
      if(!this.app) return
      this.tileWorld=new TileWorld(this.worldLayer,this.worldSeed)
      this.tileWorld.renderer=this.app.renderer as PIXI.Renderer
      this.tileWorld.initMasks()
      this.tileWorld.update(-this.W*2,this.idleCamY,this.W*5,this.H*2)
      this._initLavaSimulation()
    })
  }

  private _initLavaSimulation() {
    if (this.lavaSimulation) {
      this.lavaSimulation.destroy()
      const old = this.lavaSimulation as any
      if (old.container?.parent) old.container.parent.removeChild(old.container)
      if (old.glowGfx?.parent)   old.glowGfx.parent.removeChild(old.glowGfx)
    }
    this.lavaSimulation = new LavaSimulation()
    const lava = this.lavaSimulation as any
    this.worldLayer.addChild(lava.glowGfx)
    this.worldLayer.addChild(lava.container)
    if (this.tileWorld) {
      this.tileWorld.lavaSimulation = this.lavaSimulation
    }
  }

  private _buildSky(){
    const bgTex = this._textures.get('bg')
    if (bgTex) {
      // TilingSprite — тайлим по горизонтали, занимаем 70% высоты
      const bgH = this.H * 0.70
      const tileH = bgTex.height * (this.W / bgTex.width)  // высота при масштабе по ширине
      const spr = new PIXI.TilingSprite(bgTex, this.W, Math.max(bgH, tileH))
      spr.tileScale.set(this.W / bgTex.width)
      spr.y = bgH - spr.height  // прижимаем низ к линии 70%
      spr.name = 'bgSprite'
      this.skyLayer.addChild(spr)
    } else {
      const s1=new PIXI.Graphics()
      s1.beginFill(C.skyDeep);s1.drawRect(0,0,this.W,this.H*0.50);s1.endFill()
      const s2=new PIXI.Graphics()
      s2.beginFill(C.sky);s2.drawRect(0,this.H*0.20,this.W,this.H*0.35);s2.endFill()
      this.skyLayer.addChild(s1,s2)
    }
  }

  // ─── Round ────────────────────────────────────────────────────────────────

  startRound(events:RoundEvent[],_spd:number){
    this.running=false;this.idleActive=false;this._ended=false
    this.multiplier=1;this.depth=0;this.distance=0
    this.particles=[]
    this.rgsQueue=[...events]
    this.stoneBreakActive = false;
    this.stoneBreakRemainingTime = 0;
    this.stoneBreakTotalDuration = 0;
    this.stoneBreakStartMultiplier = 0;
    this.goldBreakActive = false;
    this.goldBreakRemainingTime = 0;
    this.goldBreakTotalDuration = 0;
    this.goldBreakStartMultiplier = 0;
    this._destroyBreakObj();

    if(this.tileWorld){this.tileWorld.destroy();this.tileWorld=null}
    this.spawner?.reset()
    this.worldLayer.removeChildren()
    this.objectsLayer.removeChildren()  // ← чистим объекты

    const lastEv  = events[events.length-1]
    const depthM  = Math.max(lastEv.depth,50)
    this.ppm      = Math.max(TILE*2, Math.round((this.H*2.5)/depthM/TILE)*TILE)

    this.worldSeed= events.reduce((a,e,i)=>a^(e.depth*31+i*97),0x1337)
    TileWorld.loadGrassTex()
    this.tileWorld= new TileWorld(this.worldLayer,this.worldSeed)
    this.tileWorld.renderer=this.app.renderer as PIXI.Renderer
    this.tileWorld.initMasks()
    this._initLavaSimulation()

    this._waypoints=this._buildWaypoints(500)
    this._waypointIdx=0
    this._speedMult = 1.0; this._speedTarget = 1.0; this._speedChangeTimer = 0

    this.charX=0;this.charY=this.surfY
    this.camX=this.charX-this.W/2;this.camY=this.idleCamY
    this._lastCaveY = this.surfY + TILE * 3
    this._caveSeed  = this.worldSeed ^ 0xCAFE1234

    // ← Spawner теперь использует objectsLayer — объекты всегда над чанками
    this.spawner=new ObjectSpawner(
      this.objectsLayer,
      this.worldSeed,
      this.surfY,
      this._drawPickup.bind(this),
      this._drawHome.bind(this),
      this._drawLavaCave.bind(this),
      this._getPickupSize.bind(this),
      this._getHomeSize.bind(this),
      this._getLavaSize.bind(this),
    )
    this.spawner.setRgsEvents(events, this.ppm)

    this.tileWorld.update(this.camX,this.camY,this.W,this.H)
    this.minerLayer.addChild(this.miner.root)
    this.miner.chunkParent=this.worldLayer
    this.miner.root.x=this.charX;this.miner.root.y=this.charY
    this.miner.root.scale.x=1
    this.worldLayer.x=-this.camX;   this.worldLayer.y=-this.camY
    this.objectsLayer.x=-this.camX; this.objectsLayer.y=-this.camY
    this.minerLayer.x=-this.camX;   this.minerLayer.y=-this.camY
    this.miner.setIdleMode(false)
    // skyLayer visibility is managed dynamically in _tick based on camera depth
    this.skyLayer.visible = true
    this.running=true
  }

  private _buildWaypoints(n:number):number[]{
    const pts:number[]=[]
    let seed=this.worldSeed^0xABCDEF
    const rn=()=>{ seed=(Math.imul(1664525,seed)+1013904223)>>>0; return seed/0x100000000 }
    let px=0
    for(let i=0;i<n;i++){
      const dir=rn()<0.5?1:-1
      px+=dir*(TILE*2+rn()*TILE*5)
      px=Math.max(-TILE*14,Math.min(TILE*14,px))
      pts.push(Math.round(px/TILE)*TILE)
    }
    return pts
  }

  // ─── Draw helpers ─────────────────────────────────────────────────────────

  private async _loadTextures() {
    if (this._texturesLoading) return this._texturesLoading
    this._texturesLoading = (async () => {
      const names = ['coin', 'gold', 'diamond', 'bomba', 'stoun', 'home', 'bg']
      for (const name of names) {
        try {
          const tex = await PIXI.Texture.fromURL(`./${name}.png`)
          this._textures.set(name, tex)
        } catch (e) {
          console.warn(`[GameRenderer] Failed to load texture: ${name}.png`)
        }
      }
      // Перестраиваем небо с реальной текстурой после загрузки
      if (this.idleActive) {
        this.skyLayer.removeChildren()
        this._buildSky()
      }
    })()
    return this._texturesLoading
  }

  private _drawHome(gfx:PIXI.Graphics, cx:number, cy:number) {
    const tex = this._textures.get('home')
    if (tex) {
      const spr = new PIXI.Sprite(tex)
      spr.anchor.set(0.5, 0.5)
      spr.scale.set(0.3, 0.3)
      spr.x = cx; spr.y = cy
      gfx.addChild(spr)
    } else {
      gfx.beginFill(0x27AE60).drawRect(cx - 60, cy - 60, 120, 120).endFill()
    }
  }

  private _drawLavaCave(gfx:PIXI.Graphics, cx:number, cy:number) {
    // Не рисуем ничего — лава уже визуализируется через LavaSimulation
    // Оставляем невидимый хитбокс для коллизии
  }

  private _drawPickup(gfx:PIXI.Graphics, type:EventType) {
    const typeMap: {[key in EventType]?: string} = {
      'COIN': 'coin', 'GOLD': 'gold', 'DIAMOND': 'diamond',
      'BOMB': 'bomba', 'STONE': 'stoun',
    }
    const fileName = typeMap[type]
    if (fileName) {
      const tex = this._textures.get(fileName)
      if (tex) {
        const spr = new PIXI.Sprite(tex)
        spr.anchor.set(0.1, 0.1)
        spr.scale.set(0.1, 0.1)
        gfx.addChild(spr)
        return
      }
    }
    gfx.beginFill(0xFFD700).drawCircle(0, 0, 10).endFill()
  }

  private _getPickupSize(type:EventType): {w:number, h:number} {
    const typeMap: {[key in EventType]?: string} = {
      'COIN': 'coin', 'GOLD': 'gold', 'DIAMOND': 'diamond',
      'BOMB': 'bomba', 'STONE': 'stoun',
    }
    const fileName = typeMap[type]
    if (fileName) {
      const tex = this._textures.get(fileName)
      if (tex) {
        const scale = 0.1
        const w = tex.width * scale, h = tex.height * scale
        return { w: Math.min(Math.max(w, 10), 20), h: Math.min(Math.max(h, 10), 20) }
      }
    }
    return { w: 10, h: 10 }
  }

  private _getHomeSize(): {w:number, h:number} {
    const tex = this._textures.get('home')
    if (tex) {
      const scale = 0.3
      return { w: Math.min(tex.width * scale, 40), h: Math.min(tex.height * scale, 40) }
    }
    return { w: 40, h: 40 }
  }

  private _getLavaSize(): {w:number, h:number} {
    return { w: 160, h: 120 }
  }

  // ─── Tick ─────────────────────────────────────────────────────────────────

  private _tick(delta:number){
    const dt=delta/60
    const store=useGameStore.getState()
    const spd=store.speed

    if(this.idleActive){
      if(this.tunnelActive) this._hideTunnel()
      this.idleX+=this.idleDir*IDLE_SPEED*dt
      this._bounceT-=dt
      if(this._bounceT<=0){this._bounceT=3+Math.random()*4;this.idleDir*=-1}
      this.miner.root.scale.x=this.idleDir
      this.miner.root.x=this.idleX;this.miner.root.y=this.surfY
      const tcX=this.idleX-this.W/2
      this.camX+=(tcX-this.camX)*0.08
      this.camY+=(this.idleCamY-this.camY)*0.08
      this.worldLayer.x=-this.camX;   this.worldLayer.y=-this.camY
      this.objectsLayer.x=-this.camX; this.objectsLayer.y=-this.camY
      this.minerLayer.x=-this.camX;   this.minerLayer.y=-this.camY
      // Параллакс фона — двигается в 0.2x медленнее камеры
      const bgSpr = this.skyLayer.getChildByName('bgSprite') as PIXI.TilingSprite | null
      if (bgSpr) bgSpr.tilePosition.x = -this.camX * 0.2
      this._updateWorldMask(this.W, this.H)
      if(this.tileWorld)this.tileWorld.update(this.camX,this.camY,this.W,this.H)
      this.miner.update(dt,0.9,false)
      this._pUpdate(dt);return
    }

    if(!this.running){this._pUpdate(dt);return}

    // ── DIGGING ───────────────────────────────────────────────────────────────

    let move=0
    let canMove=true

    if (this.stoneBreakActive) {
      this.stoneBreakRemainingTime -= dt
      // Визуально плавно снижаем множитель до финального значения из RGS
      const progress = 1 - Math.max(0, this.stoneBreakRemainingTime / this.stoneBreakTotalDuration)
      const targetMult = this.multiplier  // уже установлен из RGS в _onCollect
      const displayMult = this.stoneBreakStartMultiplier + (targetMult - this.stoneBreakStartMultiplier) * progress
      store.updateStats({ multiplier: Math.round(displayMult * 100) / 100 })

      if (this.stoneBreakRemainingTime <= 0) {
        this.stoneBreakActive = false
        store.updateStats({ multiplier: Math.round(this.multiplier * 100) / 100 })
        this._destroyBreakObj()
        canMove = true
      } else {
        canMove = false
      }
    }

    // Золотой самородок — стоим на месте, множитель визуально растёт до значения RGS
    if (this.goldBreakActive) {
      this.goldBreakRemainingTime -= dt
      const progress = Math.max(0, 1 - this.goldBreakRemainingTime / Math.max(this.goldBreakTotalDuration, 0.01))
      const displayMult = this.goldBreakStartMultiplier + (this.multiplier - this.goldBreakStartMultiplier) * progress
      if (Math.random() < 0.3) {
        this._burst(this.charX, this.charY, C.gold, 3)
      }
      store.updateStats({ multiplier: Math.round(displayMult * 100) / 100 })
      if (this.goldBreakRemainingTime <= 0) {
        this.goldBreakActive = false
        store.updateStats({ multiplier: Math.round(this.multiplier * 100) / 100 })
        this._destroyBreakObj()
        canMove = true
      } else {
        canMove = false
      }
    }

    if (canMove) {
      // Плавно меняем скорость к целевому значению
      this._speedChangeTimer -= dt
      if (this._speedChangeTimer <= 0) {
        this._speedTarget = 0.55 + Math.random() * 0.9   // 0.55x … 1.45x
        this._speedChangeTimer = 1.2 + Math.random() * 2.5
      }
      this._speedMult += (this._speedTarget - this._speedMult) * dt * 1.8

      move = CHAR_SPEED * spd * this._speedMult * dt
      this.charY += move
      this.depth = (this.charY - this.surfY) / this.ppm
      this.distance += move / this.ppm

      if(this._waypointIdx>=this._waypoints.length-10){
        const more=this._buildWaypoints(200)
        this._waypoints.push(...more)
      }

      const X_SPEED=CHAR_SPEED*0.85*spd
      if(this._waypointIdx<this._waypoints.length){
        const tx=this._waypoints[this._waypointIdx]
        const dx=tx-this.charX
        if(Math.abs(dx)>2){
          this.charX+=Math.sign(dx)*X_SPEED*dt
        }else{
          this.charX=tx
          this._waypointIdx++
        }
      }
    }

    this.miner.root.scale.x=this._waypoints[this._waypointIdx]>=this.charX?1:-1
    this.miner.root.x=this.charX;this.miner.root.y=this.charY

    if(!this.tunnelActive) this._showTunnel()
    this._updateTunnel(this.charX - this.camX, this.charY - this.camY)

    const tCX=this.charX-this.W/2
    const tCY=this.charY-this.charScreenY
    this.camX+=(tCX-this.camX)*0.12
    this.camY+=(tCY-this.camY)*0.12

    this.worldLayer.x=-this.camX;   this.worldLayer.y=-this.camY
    this.objectsLayer.x=-this.camX; this.objectsLayer.y=-this.camY
    this.minerLayer.x=-this.camX;   this.minerLayer.y=-this.camY

    // Show bg sky only when camera is still near the surface
    // surfY is TILE (120px), hide bg when camera has moved more than 1 tile below surface
    const skyVisible = this.camY < this.surfY + TILE * 2
    if (this.skyLayer.visible !== skyVisible) this.skyLayer.visible = skyVisible

    this._updateWorldMask(this.W, this.H)
    if(this.tileWorld)this.tileWorld.update(this.camX,this.camY,this.W,this.H)
    this._spawnCavesAhead()
    if(this.spawner)this.spawner.update(this.charX,this.charY,this.H*5)

    this.miner.update(dt,spd,true)

    store.updateStats({
      depth:    Math.max(0,Math.round(this.depth*10)/10),
      distance: Math.round(this.distance*10)/10,
      multiplier:Math.round(this.multiplier*100)/100,
    })

    if(this.spawner && !this._ended && !this.stoneBreakActive){
      this.spawner.checkCollisions(this.charX,this.charY,(obj)=>{
        this._onCollect(obj)
      })
    }

    if(!this._ended&&this.lavaSimulation&&this.lavaSimulation.touchesPoint(this.charX,this.charY)){
      this._ended=true
      this.running=false
      this._burst(this.charX,this.charY,C.lava,20)
      setTimeout(()=>{
        gameEngine.onRoundComplete(0,false)
        this._returnToIdle()
      },1000)
    }

    this._pUpdate(dt)
  }

  // ─── Сбор объекта ─────────────────────────────────────────────────────────

  private _onCollect(obj:SpawnedObj){
    const type=obj.type

    if (type === 'STONE') {
      this.stoneBreakActive = true
      this.stoneBreakStartMultiplier = this.multiplier
      // Используем durationMs из RGS если есть, иначе случайное
      const rgsIdx = this.rgsQueue.findIndex(e => e.type === 'STONE')
      let duration = 2 + Math.random() * 3
      if (rgsIdx >= 0) {
        const ev = this.rgsQueue.splice(rgsIdx, 1)[0]
        if (ev.durationMs) duration = ev.durationMs / 1000
        this.multiplier = ev.multiplierSnap  // применяем итоговый множитель из RGS
      }
      this.stoneBreakTotalDuration = duration
      this.stoneBreakRemainingTime = duration
      if (obj.spine) {
        SpineAnimator.setAnimationSyncedTo(obj.spine, 'rock/rock_action', duration)
        this._breakSpine = obj.spine
        this._breakGfx   = obj.gfx
      } else {
        SpineAnimator.remove(obj.spine)
        obj.gfx.destroy()
      }
      return
    }

    // Золотой самородок — останавливаемся и получаем ×3/сек пока бурим
    if (type === 'GOLD') {
      this.goldBreakActive = true
      this.goldBreakStartMultiplier = this.multiplier  // сохраняем ДО перезаписи из RGS
      // Используем durationMs из RGS если есть, иначе случайное
      const rgsIdx = this.rgsQueue.findIndex(e => e.type === 'GOLD')
      let duration = 1.5 + Math.random() * 2.5
      if (rgsIdx >= 0) {
        const ev = this.rgsQueue.splice(rgsIdx, 1)[0]
        if (ev.durationMs) duration = ev.durationMs / 1000
        this.multiplier = ev.multiplierSnap  // итоговый множитель уже посчитан RGS
      }
      this.goldBreakRemainingTime = duration
      this.goldBreakTotalDuration = duration
      this._burst(obj.worldX, obj.worldY, C.gold, 12)
      if (obj.spine) {
        SpineAnimator.setAnimationSyncedTo(obj.spine, 'gold/gold_action', duration)
        this._breakSpine = obj.spine
        this._breakGfx   = obj.gfx
      } else {
        SpineAnimator.remove(obj.spine)
        obj.gfx.destroy()
      }
      return
    }

    const rgsMatch=this.rgsQueue.findIndex(e=>e.type===type)
    if(rgsMatch>=0){
      const ev=this.rgsQueue.splice(rgsMatch,1)[0]
      if(type!=='HOME'&&type!=='LAVA') this.multiplier=ev.multiplierSnap
    }else{
      this.multiplier=this._applyEffect(type,this.multiplier)
    }
    useGameStore.getState().updateStats({multiplier:Math.round(this.multiplier*100)/100})

    this._burst(obj.worldX,obj.worldY,C.particleColors[type],type==='HOME'?24:12)

    if(obj.terminal){
      this._ended=true
      this.running=false
      obj.gfx.visible=false
      const won=type==='HOME'
      setTimeout(()=>{
        gameEngine.onRoundComplete(won?this.multiplier:0,won)
        this._returnToIdle()
      },won?800:1000)
    }else{
      this._animCollect(obj.gfx, obj.spine)
    }
  }

  private _destroyBreakObj(){
    if (this._breakSpine) { SpineAnimator.remove(this._breakSpine); this._breakSpine = null }
    if (this._breakGfx && !(this._breakGfx as any).destroyed) {
      this._breakGfx.destroy()
    }
    this._breakGfx = null
  }

  private _applyEffect(type:EventType, m:number):number{
    switch(type){
      case 'COIN':    return m + 0.1+Math.random()*0.4
      case 'GOLD':    return m  // обрабатывается через goldBreak
      case 'DIAMOND': return m * (1.5+Math.random()*1.5)
      case 'BOMB':    return Math.max(0.1, m/2)
      case 'STONE':   return m
      default:        return m
    }
  }

  private _returnToIdle(){
    this._hideTunnel()
    this.spawner?.reset(); this.spawner=null

    for (const {renderer} of this.activeLavas.values()) {
      renderer.destroy()
    }
    this.activeLavas.clear()
    this.lavasCavePathUpdated = new WeakSet()
    if (this.lavaSimulation) {
      const lava = this.lavaSimulation as any
      if (lava.container?.parent) lava.container.parent.removeChild(lava.container)
      if (lava.glowGfx?.parent)   lava.glowGfx.parent.removeChild(lava.glowGfx)
      this.lavaSimulation.destroy()
      this.lavaSimulation = null
    }

    if(this.tileWorld){this.tileWorld.destroy();this.tileWorld=null}
    this.worldLayer.removeChildren()
    this.objectsLayer.removeChildren()  // ← чистим объекты при возврате
    this.worldSeed=0xdeadbeef
    this._makeIdleWorld()
    this.minerLayer.addChild(this.miner.root)
    this.idleX=this.charX;this.idleDir=1;this._bounceT=3
    this.idleActive=true
    this.miner.setIdleMode(true)
    this.skyLayer.visible = true    // показываем фон в idle
    this.miner.root.x=this.idleX;this.miner.root.y=this.surfY
    this.camX=this.idleX-this.W/2;this.camY=this.idleCamY
    this.worldLayer.x=-this.camX;   this.worldLayer.y=-this.camY
    this.objectsLayer.x=-this.camX; this.objectsLayer.y=-this.camY
    this.minerLayer.x=-this.camX;   this.minerLayer.y=-this.camY
    this.stoneBreakActive = false
    this._destroyBreakObj()
  }

  // ─── Particles ────────────────────────────────────────────────────────────

  private _burst(wx:number,wy:number,col:number,n:number){
    for(let i=0;i<n;i++){
      const g=new PIXI.Graphics()
      g.beginFill(col);g.drawCircle(0,0,Math.random()*5+2);g.endFill()
      g.x=wx;g.y=wy;this.objectsLayer.addChild(g)  // ← частицы тоже в objectsLayer
      const a=Math.random()*Math.PI*2,s=Math.random()*100+60
      this.particles.push({gfx:g,vx:Math.cos(a)*s,vy:Math.sin(a)*s-80,life:1})
    }
  }

  private _animCollect(gfx:PIXI.Graphics, spine: import('pixi-spine').Spine | null = null){
    SpineAnimator.remove(spine)
    let t=0
    const tick=()=>{
      t+=0.1;gfx.scale.set(1.5-t*0.5);gfx.alpha=1-t
      if(t>=1){gfx.visible=false;this.app.ticker.remove(tick)}
    }
    this.app.ticker.add(tick)
  }

  private _pUpdate(dt:number){
    SpineAnimator.tick(dt)

    this.particles=this.particles.filter(p=>{
      p.life-=dt*1.8
      if(p.life<=0){this.objectsLayer.removeChild(p.gfx);p.gfx.destroy();return false}
      p.gfx.x+=p.vx*dt;p.gfx.y+=p.vy*dt;p.vy+=260*dt
      p.gfx.alpha=p.life;p.gfx.scale.set(p.life*0.7+0.3);return true
    })

    if (this.tileWorld) this.tileWorld.updateLavas(dt)
    if (this.lavaSimulation) {
      this.lavaSimulation.setCameraPos(this.camX, this.camY)
      this.lavaSimulation.cullFarCells(this.camX, this.camY, this.W, this.H)
    }
  }

  private _spawnCavesAhead() {
    if (!this.tileWorld || !this.running) return

    const aheadY = this.charY + this.H * 5.0  // далеко вперёд — текстуры успевают загрузиться
    const depthFactor = Math.max(0.5, Math.min(2, (this.charY - this.surfY) / 2000))
    const interval = TILE * (15 + 5 * depthFactor)

    if (aheadY < this._lastCaveY + interval) return

    while (this._lastCaveY + interval <= aheadY) {
      this._lastCaveY += interval
      this._caveSeed = (Math.imul(1664525, this._caveSeed) + 1013904223) >>> 0
      const localSeed = this._caveSeed

      const xOffset = ((localSeed & 0xFF) / 0xFF - 0.5) * TILE * 12
      const caveWX = this.charX + xOffset
      const caveWY = this._lastCaveY

      this.tileWorld.spawnCave(caveWX, caveWY, localSeed)

      const localSeed2 = (Math.imul(69069, localSeed) + 1) >>> 0
      if ((localSeed2 & 0xF) < 5) {
        const dx2 = ((localSeed2 & 0xFF) / 0xFF - 0.5) * TILE * 8
        const dy2 = TILE * (4 + (localSeed2 & 0x7))
        this.tileWorld.spawnCave(caveWX + dx2, caveWY + dy2, localSeed2 ^ 0xABCD)
      }
    }
  }

  // ─── Resize / destroy ─────────────────────────────────────────────────────

  private _updateWorldMask(w: number, h: number) {
    // The mask clips worldLayer to only render at or below the surface line on screen.
    // surfY is the world Y of the surface (= TILE = 120).
    // Screen Y of surface = surfY - camY (since worldLayer.y = -camY)
    // We clip worldLayer above: screenSurfY = this.surfY - this.camY
    // During idle, camY is negative (camera above surface), so screenSurfY > 0 — correct.
    // During digging, camY increases, screenSurfY decreases — eventually clips the full height.
    // We always allow a small overlap (surfY on screen) to show the grass line.
    // Маска для skyLayer: показываем небо только в области ВЫШЕ верхнего края травы.
    // Grass row=0 верхний край = world y=0, на экране = (0 - camY) = -camY.
    // Маска = прямоугольник от 0 до screenGrassTop.
    const screenGrassTop = Math.max(0, Math.min(h, -this.camY))
    this._worldMask.clear()
    this._worldMask.beginFill(0xffffff)
    this._worldMask.drawRect(0, 0, w, screenGrassTop)
    this._worldMask.endFill()
  }

  resize(w:number,h:number){
    this.W=w;this.H=h;this.charScreenY=h*0.42
    this.app.renderer.resize(w,h)
    this.skyLayer.removeChildren();this._buildSky()
    this._updateWorldMask(w, h)
    this._buildTunnel()
    if(this.idleActive){this.camY=this.idleCamY;this.worldLayer.y=-this.camY}
  }

  destroy(){
    this.skyLayer.mask=null
    this.worldLayer.mask=null
    this._worldMask.destroy()
    this.spawner?.reset()
    this.tileWorld?.destroy()
    this.miner.destroy()
    this.app.destroy(false,{children:true,texture:true})
  }
}