import * as PIXI from 'pixi.js'
import { gameEngine }   from './GameEngine'
import { useGameStore } from '../store/gameStore'
import type { RoundEvent, EventType } from '../rgs/client'
import { TileWorld, TILE } from './Tileworld'
import { LavaSimulation } from './LavaSimulation'

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
    BOMB:0xFF4500,STONE:0xAAAAAA,LAVA:0xFF4500,HOME:0x7CFC00,
  } as Record<EventType,number>,
}

const CHAR_SPEED = 130
const IDLE_SPEED = 70
const COLL_R     = TILE * 1.8   // радиус сбора объекта

// ─── MinerCharacter ───────────────────────────────────────────────────────────

class MinerCharacter {
  root:PIXI.Container
  private legL:PIXI.Graphics; private legR:PIXI.Graphics
  private armL:PIXI.Graphics; private armR:PIXI.Graphics
  private body:PIXI.Graphics; private head:PIXI.Graphics
  private axe:PIXI.Graphics;  private lamp:PIXI.Graphics
  private dirts:{g:PIXI.Graphics;vx:number;vy:number;life:number}[]=[]
  chunkParent:PIXI.Container|null=null
  walkT=0; digT=0

  constructor(){
    this.root=new PIXI.Container()
    this.legL=new PIXI.Graphics();this.legR=new PIXI.Graphics()
    this.armL=new PIXI.Graphics();this.armR=new PIXI.Graphics()
    this.body=new PIXI.Graphics();this.head=new PIXI.Graphics()
    this.axe=new PIXI.Graphics();this.lamp=new PIXI.Graphics()
    this.armR.addChild(this.axe)
    this.root.addChild(this.legL,this.armL,this.body,this.legR,this.armR,this.head,this.lamp)
    this._staticDraw()
  }
  private _staticDraw(){
    const b=this.body
    b.beginFill(C.shirt);b.drawRoundedRect(-11,-20,22,24,4);b.endFill()
    b.lineStyle(3,C.pants,0.8);b.moveTo(-11,2);b.lineTo(11,2);b.lineStyle(0)
    const h=this.head
    h.beginFill(C.skin);h.drawRect(-4,-26,8,8);h.endFill()
    h.beginFill(C.skin);h.drawRoundedRect(-12,-50,24,26,7);h.endFill()
    h.beginFill(C.skinDk,0.3);h.drawEllipse(8,-36,5,7);h.endFill()
    h.beginFill(0x1a1a2e);h.drawCircle(6,-42,3);h.endFill()
    h.beginFill(0xffffff);h.drawCircle(7,-43,1.2);h.endFill()
    h.lineStyle(2,C.skinDk);h.moveTo(2,-33);h.quadraticCurveTo(6,-30,10,-33);h.lineStyle(0)
    h.beginFill(C.helmet);h.drawEllipse(0,-50,15,11);h.endFill()
    h.beginFill(C.helmetRim);h.drawRoundedRect(-16,-44,32,6,2);h.endFill()
    const lp=this.lamp
    lp.beginFill(C.lamp);lp.drawCircle(12,-53,5);lp.endFill()
    lp.beginFill(0xffffff,0.55);lp.drawCircle(13,-54,2.5);lp.endFill()
    lp.beginFill(C.lamp,0.1);lp.drawPolygon([12,-53,34,-38,30,-28,12,-48]);lp.endFill()
    const ax=this.axe
    ax.lineStyle(4,C.axeShaft);ax.moveTo(0,4);ax.lineTo(26,-8);ax.lineStyle(0)
    ax.beginFill(C.axeBlade);ax.drawPolygon([20,-12,32,-6,30,0,18,-6]);ax.endFill()
    ax.beginFill(C.axeShine,0.75);ax.drawPolygon([20,-12,31,-7,28,-4,19,-9]);ax.endFill()
    ax.beginFill(C.axeShine);ax.drawPolygon([29,1,36,-2,34,4,27,4]);ax.endFill()
  }
  private _leg(g:PIXI.Graphics,dark:boolean){
    g.clear()
    const pc=dark?0x1e2d3d:C.pants
    g.beginFill(pc);g.drawRoundedRect(-5,0,11,17,3);g.endFill()
    g.beginFill(pc);g.drawRoundedRect(-4,15,9,15,3);g.endFill()
    g.beginFill(C.boots);g.drawRoundedRect(-5,26,14,9,3);g.endFill()
  }
  private _arm(g:PIXI.Graphics,dark:boolean){
    g.clear()
    g.beginFill(dark?C.shirtDk:C.shirt);g.drawRoundedRect(-4,0,9,15,3);g.endFill()
    g.beginFill(C.skin);g.drawRoundedRect(-4,13,8,13,3);g.endFill()
  }
  update(dt:number,spd:number,digging:boolean){
    if(digging){
      this.digT+=dt*7*Math.max(spd,0.5)
      const sw=Math.sin(this.digT)
      this.body.rotation=0.3+Math.abs(sw)*0.1;this.body.y=0
      this._leg(this.legR,false);this._leg(this.legL,true)
      this.legR.rotation=0.2+Math.sin(this.digT*0.5)*0.1;this.legL.rotation=-0.15
      this.legR.x=5;this.legR.y=4;this.legL.x=-5;this.legL.y=4
      this.armR.rotation=-0.5+sw*1.1;this.armL.rotation=-0.7+sw*0.8
      this._arm(this.armR,false);this._arm(this.armL,true)
      this.armR.x=9;this.armR.y=-18;this.armL.x=-9;this.armL.y=-18
      this.axe.rotation=sw*0.35;this.head.y=Math.abs(sw)*2
      if(sw>0.65&&Math.random()<0.18)this._dirt()
    }else{
      this.walkT+=dt*4.5*Math.max(spd,0.4)
      const w=Math.sin(this.walkT)
      this.body.rotation=w*0.04;this.body.y=Math.abs(w)*2-1
      this._leg(this.legR,false);this._leg(this.legL,true)
      this.legR.rotation=w*0.6;this.legL.rotation=-w*0.6
      this.legR.x=5;this.legR.y=4;this.legL.x=-5;this.legL.y=4
      this._arm(this.armR,false);this._arm(this.armL,true)
      this.armR.rotation=-w*0.45;this.armL.rotation=w*0.45
      this.armR.x=9;this.armR.y=-18;this.armL.x=-9;this.armL.y=-18
      this.axe.rotation=-0.4;this.head.y=Math.abs(w)*1.5
    }
    this.lamp.alpha=0.9+Math.sin(Date.now()*0.011)*0.08
    this.dirts=this.dirts.filter(d=>{
      d.life-=dt*2.2
      if(d.life<=0){d.g.parent?.removeChild(d.g);d.g.destroy();return false}
      d.g.x+=d.vx*dt;d.g.y+=d.vy*dt;d.vy+=320*dt
      d.g.alpha=d.life;d.g.rotation+=dt*5;return true
    })
  }
  private _dirt(){
    const p=this.chunkParent??this.root.parent;if(!p)return
    const g=new PIXI.Graphics()
    const sz=Math.random()*6+3
    g.beginFill(C.dirtChunk,0.9);g.drawRoundedRect(-sz/2,-sz/2,sz,sz,2);g.endFill()
    g.x=this.root.x+18+(Math.random()-0.5)*12;g.y=this.root.y+8
    p.addChild(g)
    this.dirts.push({g,vx:50+Math.random()*60,vy:-(20+Math.random()*50),life:1})
  }
  destroy(){this.dirts.forEach(d=>d.g.destroy());this.root.destroy({children:true})}
}

// ─── SpawnedObj ───────────────────────────────────────────────────────────────

interface SpawnedObj {
  type:     EventType
  gfx:      PIXI.Graphics
  worldX:   number
  worldY:   number
  collected:boolean
  // для HOME/LAVA — финальный объект (game-ending)
  terminal: boolean
  // размеры hitbox
  width:    number
  height:   number
}

// ─── ObjectSpawner ────────────────────────────────────────────────────────────
// Генерирует объекты по мере продвижения персонажа вниз.
// Обычные объекты — рандомно вокруг пути.
// Каждые TERMINAL_INTERVAL метров — гарантированный HOME или LAVA.

const SPAWN_INTERVAL  = TILE * 5    // каждые 5 тайлов по Y — шанс спауна
const TERMINAL_EVERY  = TILE * 60   // каждые 60 тайлов — обязательный терминал

class ObjectSpawner {
  private layer:     PIXI.Container
  private objects:   SpawnedObj[] = []
  private spawnedUpToY = 0          // до какого Y уже заспаунили
  private nextTerminalY = 0         // следующий Y для терминального объекта
  private seed:      number
  private drawPickup: (g:PIXI.Graphics, type:EventType) => void
  private drawHome:   (g:PIXI.Graphics, cx:number, cy:number) => void
  private drawLava:   (g:PIXI.Graphics, cx:number, cy:number) => void
  private getPickupSize: (type:EventType) => {w:number, h:number}
  private getHomeSize: () => {w:number, h:number}
  private getLavaSize: () => {w:number, h:number}

  // RGS события — объекты из серверной математики
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
    // Добавляем RGS объекты как "подсказку" — они тоже попадут в мир
    // но только не-терминальные; HOME/LAVA управляются отдельно
    events.forEach((ev,i)=>{
      if(ev.type==='HOME'||ev.type==='LAVA') return
      const worldY = this.surfY + ev.depth*ppm
      this._spawnAt(ev.type, worldY, false)
    })
  }

  /** Вызывается каждый кадр — генерирует объекты впереди персонажа */
  update(charX:number, charY:number, aheadPx:number){
    const genUpTo = charY + aheadPx

    // Спауним обычные объекты
    let y = this.spawnedUpToY || charY
    while(y < genUpTo){
      y += SPAWN_INTERVAL
      // Случайный шанс спауна на этом Y
      const r = this._rng(y)
      if(r < 0.35){
        const type = this._pickType(y, this._rng(y^0xABC))
        this._spawnAt(type, y, false)
      }
    }
    this.spawnedUpToY = Math.max(this.spawnedUpToY, y)

    // Терминальный объект (HOME или LAVA) — каждые TERMINAL_EVERY px
    if(!this.nextTerminalY) this.nextTerminalY = charY + TERMINAL_EVERY
    if(charY + aheadPx >= this.nextTerminalY){
      const won = this._rng(this.nextTerminalY^0xDEAD) < 0.6  // 60% HOME, 40% LAVA
      const type: EventType = won ? 'HOME' : 'LAVA'
      this._spawnAt(type, this.nextTerminalY, true)
      this.nextTerminalY += TERMINAL_EVERY
    }

    // Удаляем объекты которые персонаж давно прошёл (>15 тайлов выше)
    this.objects = this.objects.filter(o=>{
      if(o.collected) return false
      if(o.worldY < charY - TILE*15){
        this.layer.removeChild(o.gfx)
        o.gfx.destroy()
        return false
      }
      return true
    })
  }

  private _spawnAt(type:EventType, worldY:number, terminal:boolean){
    // Разброс по X — рандомно ±8 тайлов
    const xOff = (this._rng(worldY^0x1234) - 0.5) * TILE * 16
    const worldX = Math.round(xOff/TILE)*TILE

    const gfx = new PIXI.Graphics()
    let size = {w: TILE * 1.8, h: TILE * 1.8}
    
    if(type==='HOME') {
      this.drawHome(gfx, worldX, worldY)
      const homeSize = this.getHomeSize()
      // Hitbox значительно меньше визуального размера — коэффициент 0.6
      size = { w: homeSize.w * 0.6, h: homeSize.h * 0.6 }
    }
    else if(type==='LAVA') {
      this.drawLava(gfx, worldX, worldY)
      size = this.getLavaSize()
    }
    else {
      this.drawPickup(gfx, type)
      gfx.x=worldX; gfx.y=worldY
      const pickupSize = this.getPickupSize(type)
      // Hitbox значительно меньше визуального размера — коэффициент 0.55
      size = { w: pickupSize.w * 0.55, h: pickupSize.h * 0.55 }
    }
    this.layer.addChild(gfx)
    this.objects.push({type,gfx,worldX,worldY,collected:false,terminal,width:size.w,height:size.h})
  }

  private _pickType(y:number, r:number): EventType {
    // Чем глубже — тем больше бомб и меньше монет
    const depth = y / (TILE*10)
    const bombChance = Math.min(0.3, 0.05 + depth*0.01)
    const stoneChance = Math.min(0.2, 0.03 + depth*0.008)
    if(r < 0.35)              return 'COIN'
    if(r < 0.35+bombChance)   return 'BOMB'
    if(r < 0.55+stoneChance)  return 'STONE'
    if(r < 0.70)              return 'GOLD'
    return 'DIAMOND'
  }

  /** Детерминированный hash-рандом по Y */
  private _rng(y:number): number {
    let s = ((y*73856093)^this.seed)>>>0
    s = Math.imul(1664525,s)+1013904223>>>0
    return s/0x100000000
  }

  /** Проверяем коллизию персонажа со всеми объектами */
  checkCollisions(
    charX:number, charY:number,
    onCollect:(obj:SpawnedObj)=>void
  ){
    for(const o of this.objects){
      if(o.collected) continue
      
      // AABB коллизия — hitbox персонажа (радиус COLL_R) против hitbox объекта
      const charLeft = charX - COLL_R
      const charRight = charX + COLL_R
      const charTop = charY - COLL_R
      const charBottom = charY + COLL_R
      
      const objLeft = o.worldX - o.width/2
      const objRight = o.worldX + o.width/2
      const objTop = o.worldY - o.height/2
      const objBottom = o.worldY + o.height/2
      
      // Проверяем пересечение прямоугольников
      if(charLeft < objRight && charRight > objLeft &&
         charTop < objBottom && charBottom > objTop){
        o.collected=true
        onCollect(o)
        break
      }
    }
  }

  reset(){
    this.objects.forEach(o=>{ if(o.gfx.parent) o.gfx.parent.removeChild(o.gfx); o.gfx.destroy() })
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
  private worldLayer:PIXI.Container
  private skyLayer:PIXI.Container
  private minerLayer:PIXI.Container = new PIXI.Container()
  private miner:MinerCharacter
  private spawner:ObjectSpawner|null=null
  // Scratch tunnel — каждый чанк имеет свою RenderTexture маску
  // Персонаж рисует белое в маски чанков → тайлы открываются
  private tunnelActive = false
  private W=0; private H=0
  private camX=0; private camY=0
  private tileWorld:TileWorld|null=null
  private worldSeed=0xdeadbeef
  private get surfY(){ return TILE }
  private get idleCamY(){ return this.surfY-this.H*0.40 }

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
  // RGS multiplier sequence — применяем по мере сбора событий
  private rgsQueue:RoundEvent[]=[]

  // X waypoints — зигзаг-путь
  private _waypoints:number[]=[]
  private _waypointIdx=0

  // Конец игры уже triggered
  private _ended=false

  // Кэш текстур для спрайтов
  private _textures: Map<string, PIXI.Texture> = new Map()
  private _texturesLoading: Promise<void> | null = null

  // Cave spawning — пещеры за кадром
  private _lastCaveY = 0          // Y последней заспауненной пещеры (мировые коорд)
  private _caveInterval = TILE * 15 // каждые ~15 тайлов — новая пещера (было 25)
  private _caveSeed = 0           // накапливаемый seed для разнообразия

  // Active lava renderers — для анимации и маски пещер (УСТАРЕЛО — лавы теперь в TileWorld)
  private activeLavas: Map<PIXI.Graphics, {renderer: any, wx: number, wy: number}> = new Map()
  private lavasCavePathUpdated: WeakSet<any> = new WeakSet()
  private lavaSimulation: LavaSimulation | null = null

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
    this.skyLayer=new PIXI.Container()
    this.worldLayer=new PIXI.Container()
    this.app.stage.addChild(this.skyLayer,this.worldLayer,this.minerLayer)
    this.charScreenY=h*0.42
    this._buildSky()
    this._makeIdleWorld()
    this.miner=new MinerCharacter()
    this.miner.chunkParent=this.worldLayer
    this.idleX=0
    this.miner.root.x=this.idleX;this.miner.root.y=this.surfY
    this.minerLayer.addChild(this.miner.root)
    this.camX=this.idleX-w/2;this.camY=this.idleCamY
    this.worldLayer.x=-this.camX;this.worldLayer.y=-this.camY
    this.minerLayer.x=-this.camX;this.minerLayer.y=-this.camY
    this._buildTunnel()
    
    // Загружаем текстуры для спрайтов
    this._loadTextures()
    
    this.app.ticker.add(this._tick.bind(this))
  }

  private _buildTunnel(){
    // Передаём renderer в TileWorld — он нужен для рисования в maskRT чанков
    if (this.tileWorld) {
      this.tileWorld.renderer = this.app.renderer as PIXI.Renderer
    }
  }


  private _updateTunnel(sx: number, sy: number){
    // Передаём экранные координаты персонажа в TileWorld
    // TileWorld сам вычисляет какие чанки затронуты и рисует белое в их maskRT
    if (this.tileWorld) {
      this.tileWorld.scratchAt(sx, sy, this.camX, this.camY)
    }
  }

  // ── Cave Spawner ───────────────────────────────────────────────────────────
  // Генерирует пещеры за кадром, по мере того как персонаж движется вниз.
  // Логика зеркалит туннель: пещеры появляются НИЖЕ текущей позиции камеры,
  // т.е. игрок их ещё не видит — они уже «вырыты» в земле.

private _spawnCavesAhead() {
  if (!this.tileWorld || !this.running) return

  // Генерируем пещеры БЛИЖЕ впереди, не слишком далеко
  const aheadY = this.charY + this.H * 1.2

  // Динамический интервал в зависимости от глубины
  const depthFactor = Math.max(0.5, Math.min(2, (this.charY - this.surfY) / 2000))
  const interval = TILE * (15 + 5 * depthFactor)  // от 15 до 20 тайлов

  if (aheadY < this._lastCaveY + interval) return

  while (this._lastCaveY + interval <= aheadY) {
    this._lastCaveY += interval

    // Детерминированный seed для пещеры
    this._caveSeed = (Math.imul(1664525, this._caveSeed) + 1013904223) >>> 0
    const localSeed = this._caveSeed

    // Смещение по X (не обязательно по центру персонажа)
    const xOffset = ((localSeed & 0xFF) / 0xFF - 0.5) * TILE * 12
    const caveWX = this.charX + xOffset
    const caveWY = this._lastCaveY

    // Генерируем пещеру в TileWorld
    this.tileWorld.spawnCave(caveWX, caveWY, localSeed)

    // (Опционально) Спавним объекты внутри пещеры
    if (this.spawner) {
      // Можно добавить объекты с повышенной ценностью
      const rng = ((seed: number) => {
        let s = seed >>> 0
        return () => { s = Math.imul(1664525, s) + 1013904223 >>> 0; return s / 0x100000000 }
      })(localSeed ^ 0xCAFE)

      const objCount = 2 + Math.floor(rng() * 5)
      for (let i = 0; i < objCount; i++) {
        const dx = (rng() - 0.5) * TILE * 6
        const dy = (rng() - 0.5) * TILE * 4
        const type = this._pickCaveObjectType(rng)
        // Спавним объект в координатах пещеры
        // (здесь нужно вызвать метод spawner._spawnAt, но он приватный, можно сделать публичным)
        // this.spawner.spawnAt(type, caveWX + dx, caveWY + dy, false)
      }
    }

    // Случайная дополнительная маленькая пещера рядом
    const localSeed2 = (Math.imul(69069, localSeed) + 1) >>> 0
    if ((localSeed2 & 0xF) < 5) {
      const dx2 = ((localSeed2 & 0xFF) / 0xFF - 0.5) * TILE * 8
      const dy2 = TILE * (4 + (localSeed2 & 0x7))
      this.tileWorld.spawnCave(caveWX + dx2, caveWY + dy2, localSeed2 ^ 0xABCD)
    }
  }
}

/**
 * Вспомогательный метод для выбора типа объекта внутри пещеры.
 */
private _pickCaveObjectType(rng: () => number): EventType {
  const r = rng()
  if (r < 0.4) return 'COIN'
  if (r < 0.6) return 'GOLD'
  if (r < 0.75) return 'DIAMOND'
  if (r < 0.85) return 'STONE'
  return 'BOMB'
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
    // Грузим текстуру травы один раз, потом создаём мир
    TileWorld.loadGrassTex().then(()=>{
      if(!this.app) return   // renderer уже уничтожен
      this.tileWorld=new TileWorld(this.worldLayer,this.worldSeed)
      this.tileWorld.renderer=this.app.renderer as PIXI.Renderer
      this.tileWorld.update(-this.W*2,this.idleCamY,this.W*5,this.H*2)
      this._initLavaSimulation()
    })
  }

  private _initLavaSimulation() {
    if (this.lavaSimulation) {
      this.lavaSimulation.destroy()
      // Remove old objects — теперь это container + glowGfx
      const old = this.lavaSimulation as any
      if (old.container?.parent) old.container.parent.removeChild(old.container)
      if (old.glowGfx?.parent)   old.glowGfx.parent.removeChild(old.glowGfx)
    }
    this.lavaSimulation = new LavaSimulation()
    const lava = this.lavaSimulation as any
    // Свечение — под метаболами
    this.worldLayer.addChild(lava.glowGfx)
    // Metaball container (blur + threshold shader) — поверх
    this.worldLayer.addChild(lava.container)
    // Передаём симуляцию в TileWorld
    if (this.tileWorld) {
      this.tileWorld.lavaSimulation = this.lavaSimulation
    }
  }

  private _buildSky(){
    const bgTex = this._textures.get('bg')
    if (bgTex) {
      const bgSpr = new PIXI.TilingSprite(bgTex, this.W, this.H)
      bgSpr.tileScale.set(1, 1)
      this.skyLayer.addChild(bgSpr)
    } else {
      // Fallback: рисуем цветной фон
      const s1=new PIXI.Graphics()
      s1.beginFill(C.skyDeep);s1.drawRect(0,0,this.W,this.H*0.20);s1.endFill()
      const s2=new PIXI.Graphics()
      s2.beginFill(C.sky);s2.drawRect(0,this.H*0.20,this.W,this.H*0.25);s2.endFill()
      this.skyLayer.addChild(s1,s2)
    }
  }

  // ─── Round ────────────────────────────────────────────────────────────────

  startRound(events:RoundEvent[],_spd:number){
    this.running=false;this.idleActive=false;this._ended=false
    this.multiplier=1;this.depth=0;this.distance=0
    this.particles=[]
    this.rgsQueue=[...events]

    if(this.tileWorld){this.tileWorld.destroy();this.tileWorld=null}
    this.spawner?.reset()
    this.worldLayer.removeChildren()

    const lastEv  = events[events.length-1]
    const depthM  = Math.max(lastEv.depth,50)
    this.ppm      = Math.max(TILE*2, Math.round((this.H*2.5)/depthM/TILE)*TILE)

    this.worldSeed= events.reduce((a,e,i)=>a^(e.depth*31+i*97),0x1337)
    // Текстура уже должна быть загружена из _makeIdleWorld, но на всякий случай
    TileWorld.loadGrassTex()
    this.tileWorld= new TileWorld(this.worldLayer,this.worldSeed)
    this.tileWorld.renderer=this.app.renderer as PIXI.Renderer
    this._initLavaSimulation()

    // Зигзаг-путь персонажа — 500 waypoints (бесконечная игра)
    this._waypoints=this._buildWaypoints(500)
    this._waypointIdx=0

    this.charX=0;this.charY=this.surfY
    this.camX=this.charX-this.W/2;this.camY=this.idleCamY
    // Сброс cave spawner
    this._lastCaveY = this.surfY + TILE * 3  // первая пещера уже через 3 тайла (была 15)
    this._caveSeed  = this.worldSeed ^ 0xCAFE1234

    // Spawner — генерирует объекты бесконечно
    this.spawner=new ObjectSpawner(
      this.worldLayer,
      this.worldSeed,
      this.surfY,
      this._drawPickup.bind(this),
      this._drawHome.bind(this),
      this._drawLavaCave.bind(this),
      this._getPickupSize.bind(this),
      this._getHomeSize.bind(this),
      this._getLavaSize.bind(this),
    )
    // Загружаем RGS события как начальные объекты
    this.spawner.setRgsEvents(events, this.ppm)

    this.tileWorld.update(this.camX,this.camY,this.W,this.H)
    this.minerLayer.addChild(this.miner.root)
    this.miner.chunkParent=this.worldLayer
    this.miner.root.x=this.charX;this.miner.root.y=this.charY
    this.miner.root.scale.x=1
    this.worldLayer.x=-this.camX;this.worldLayer.y=-this.camY
    this.minerLayer.x=-this.camX;this.minerLayer.y=-this.camY
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
    })()
    
    return this._texturesLoading
  }

  private _drawHome(gfx:PIXI.Graphics, cx:number, cy:number) {
    const tex = this._textures.get('home')
    if (tex) {
      const spr = new PIXI.Sprite(tex)
      spr.anchor.set(0.5, 0.5)
      spr.scale.set(0.3, 0.3)  // 50% размера
      spr.x = cx
      spr.y = cy
      gfx.addChild(spr)
    } else {
      // Fallback
      gfx.beginFill(0x27AE60).drawRect(cx - 60, cy - 60, 120, 120).endFill()
    }
  }

  private _drawLavaCave(gfx:PIXI.Graphics, cx:number, cy:number) {
    // УСТАРЕЛО: Лавы теперь встроены в чанки через TileWorld
    // Эта функция больше не используется, но оставлена для совместимости
    // Если нужно спаунить LAVA объект через ObjectSpawner — рисуем простой основной объект
    gfx.beginFill(0xFF4500, 0.7)
    gfx.drawRect(cx - 80, cy - 60, 160, 120)
    gfx.endFill()
  }

  private _drawPickup(gfx:PIXI.Graphics, type:EventType) {
    const typeMap: {[key in EventType]?: string} = {
      'COIN': 'coin',
      'GOLD': 'gold',
      'DIAMOND': 'diamond',
      'BOMB': 'bomba',
      'STONE': 'stoun',
    }
    
    const fileName = typeMap[type]
    if (fileName) {
      const tex = this._textures.get(fileName)
      if (tex) {
        const spr = new PIXI.Sprite(tex)
        spr.anchor.set(0.1, 0.1)
        spr.scale.set(0.1, 0.1)  // 40% размера
        gfx.addChild(spr)
        return
      }
    }
    
    // Fallback: рисуем кружок
    gfx.beginFill(0xFFD700).drawCircle(0, 0, 10).endFill()
  }

  private _getPickupSize(type:EventType): {w:number, h:number} {
    const typeMap: {[key in EventType]?: string} = {
      'COIN': 'coin',
      'GOLD': 'gold',
      'DIAMOND': 'diamond',
      'BOMB': 'bomba',
      'STONE': 'stoun',
    }
    
    const fileName = typeMap[type]
    if (fileName) {
      const tex = this._textures.get(fileName)
      if (tex) {
        const scale = 0.1  // Тот же scale что и в _drawPickup
        const w = tex.width * scale
        const h = tex.height * scale
        // Минимум 10px, максимум 20px
        return { 
          w: Math.min(Math.max(w, 10), 20), 
          h: Math.min(Math.max(h, 10), 20) 
        }
      }
    }
    // Fallback если текстура еще загружается
    return { w: 10, h: 10 }
  }

  private _getHomeSize(): {w:number, h:number} {
    const tex = this._textures.get('home')
    if (tex) {
      const scale = 0.3  // Тот же scale что и в _drawHome
      const w = tex.width * scale
      const h = tex.height * scale
      // Ограничиваем максимум ~40px
      return { 
        w: Math.min(w, 40), 
        h: Math.min(h, 40) 
      }
    }
    // Fallback если текстура еще загружается
    return { w: 40, h: 40 }
  }

  private _getLavaSize(): {w:number, h:number} {
    // LAVA рисуется как простой прямоугольник в _drawLavaCave
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
      this.worldLayer.x=-this.camX;this.worldLayer.y=-this.camY
    this.minerLayer.x=-this.camX;this.minerLayer.y=-this.camY
      if(this.tileWorld)this.tileWorld.update(this.camX,this.camY,this.W,this.H)
      this.miner.update(dt,0.9,false)
      this._pUpdate(dt);return
    }

    if(!this.running){this._pUpdate(dt);return}

    // ── DIGGING ───────────────────────────────────────────────────────────────

    const move=CHAR_SPEED*spd*dt
    this.charY+=move
    this.depth=(this.charY-this.surfY)/this.ppm
    this.distance+=move/this.ppm

    // Бесконечный зигзаг: если waypoints закончились — добавляем ещё
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

    const _nxt=this._waypoints[this._waypointIdx]??this.charX
    this.miner.root.scale.x=_nxt>=this.charX?1:-1
    this.miner.root.x=this.charX;this.miner.root.y=this.charY

    if(!this.tunnelActive) this._showTunnel()
    this._updateTunnel(this.charX - this.camX, this.charY - this.camY)

    const tCX=this.charX-this.W/2
    const tCY=this.charY-this.charScreenY
    this.camX+=(tCX-this.camX)*0.12
    this.camY+=(tCY-this.camY)*0.12
    this.worldLayer.x=-this.camX;this.worldLayer.y=-this.camY
    this.minerLayer.x=-this.camX;this.minerLayer.y=-this.camY

    if(this.tileWorld)this.tileWorld.update(this.camX,this.camY,this.W,this.H)

    // Спауним пещеры за кадром (впереди персонажа)
    this._spawnCavesAhead()

    // Генерируем объекты впереди (3 экрана вперёд)
    if(this.spawner)this.spawner.update(this.charX,this.charY,this.H*3)

    this.miner.update(dt,spd,true)

    store.updateStats({
      depth:    Math.max(0,Math.round(this.depth*10)/10),
      distance: Math.round(this.distance*10)/10,
      multiplier:Math.round(this.multiplier*100)/100,
    })

    // Проверяем коллизии через spawner
    if(this.spawner&&!this._ended){
      this.spawner.checkCollisions(this.charX,this.charY,(obj)=>{
        this._onCollect(obj)
      })
    }

    // Проверяем касание лавы симуляции — мгновенная гибель
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

    // Обновляем множитель: берём следующее RGS событие того же типа
    const rgsMatch=this.rgsQueue.findIndex(e=>e.type===type)
    if(rgsMatch>=0){
      const ev=this.rgsQueue.splice(rgsMatch,1)[0]
      if(type!=='HOME'&&type!=='LAVA') this.multiplier=ev.multiplierSnap
    }else{
      // Нет RGS события — вычисляем эффект сами
      this.multiplier=this._applyEffect(type,this.multiplier)
    }
    useGameStore.getState().updateStats({multiplier:Math.round(this.multiplier*100)/100})

    // Частицы
    this._burst(obj.worldX,obj.worldY,C.particleColors[type],type==='HOME'?24:12)

    if(obj.terminal){
      // КОНЕЦ ИГРЫ
      this._ended=true
      this.running=false
      obj.gfx.visible=false
      const won=type==='HOME'
      setTimeout(()=>{
        gameEngine.onRoundComplete(won?this.multiplier:0,won)
        this._returnToIdle()
      },won?800:1000)
    }else{
      // Обычный pickup — pop анимация
      this._animCollect(obj.gfx)
    }
  }

  private _applyEffect(type:EventType, m:number):number{
    switch(type){
      case 'COIN':    return m + 0.1+Math.random()*0.4
      case 'GOLD':    return m + 1+Math.random()*3
      case 'DIAMOND': return m * (1.5+Math.random()*1.5)
      case 'BOMB':    return Math.max(0.1, m/2)
      case 'STONE':   return Math.max(0.1, m*(1-0.05*(1+Math.random()*4)))
      default:        return m
    }
  }

  private _returnToIdle(){
    this._hideTunnel()
    this.spawner?.reset(); this.spawner=null
    
    // Очищаем все активные лавы
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
    this.worldSeed=0xdeadbeef
    this._makeIdleWorld()
    this.minerLayer.addChild(this.miner.root)
    this.idleX=this.charX;this.idleDir=1;this._bounceT=3
    this.idleActive=true
    this.miner.root.x=this.idleX;this.miner.root.y=this.surfY
    this.camX=this.idleX-this.W/2;this.camY=this.idleCamY
    this.worldLayer.x=-this.camX;this.worldLayer.y=-this.camY
    this.minerLayer.x=-this.camX;this.minerLayer.y=-this.camY
  }

  // ─── Particles ────────────────────────────────────────────────────────────

  private _burst(wx:number,wy:number,col:number,n:number){
    for(let i=0;i<n;i++){
      const g=new PIXI.Graphics()
      g.beginFill(col);g.drawCircle(0,0,Math.random()*5+2);g.endFill()
      g.x=wx;g.y=wy;this.worldLayer.addChild(g)
      const a=Math.random()*Math.PI*2,s=Math.random()*100+60
      this.particles.push({gfx:g,vx:Math.cos(a)*s,vy:Math.sin(a)*s-80,life:1})
    }
  }

  private _animCollect(gfx:PIXI.Graphics){
    let t=0
    const tick=()=>{
      t+=0.1;gfx.scale.set(1.5-t*0.5);gfx.alpha=1-t
      if(t>=1){gfx.visible=false;this.app.ticker.remove(tick)}
    }
    this.app.ticker.add(tick)
  }

  private _pUpdate(dt:number){
    // Обновляем частицы
    this.particles=this.particles.filter(p=>{
      p.life-=dt*1.8
      if(p.life<=0){this.worldLayer.removeChild(p.gfx);p.gfx.destroy();return false}
      p.gfx.x+=p.vx*dt;p.gfx.y+=p.vy*dt;p.vy+=260*dt
      p.gfx.alpha=p.life;p.gfx.scale.set(p.life*0.7+0.3);return true
    })

    // Обновляем физику всех лав в чанках
    if (this.tileWorld) {
      this.tileWorld.updateLavas(dt)
    }
    // Culling далёких клеток симуляции
    if (this.lavaSimulation) {
      this.lavaSimulation.cullFarCells(this.camX, this.camY, this.W, this.H)
    }
  }

  // ─── Resize / destroy ─────────────────────────────────────────────────────

  resize(w:number,h:number){
    this.W=w;this.H=h;this.charScreenY=h*0.42
    this.app.renderer.resize(w,h)
    this.skyLayer.removeChildren();this._buildSky()

    this._buildTunnel()
    if(this.idleActive){this.camY=this.idleCamY;this.worldLayer.y=-this.camY}
  }

  destroy(){


    this.worldLayer.mask=null
    this.spawner?.reset()
    this.tileWorld?.destroy()
    this.miner.destroy()
    this.app.destroy(false,{children:true,texture:true})
  }
}