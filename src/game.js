// 墨ランナー コアゲームロジック
import * as THREE from 'three';
import { loadModel, loadAnimated, ph, inkMat, INK, WASHI } from './assets.js';

const LANES = [-2.2, 0, 2.2];
const CHUNK = 14;            // 障害物パターンの間隔(m)
const DRAGON_TIME = 8;       // 竜に乗れる秒数
const INVINCIBLE_TIME = 1.5; // 竜から降りた後の無敵秒数

// ===== 和紙+墨の路面テクスチャ(手続き生成) =====
function makeGroundTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 1024;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e6dcc4'; ctx.fillRect(0, 0, 512, 1024);
  // 和紙の繊維ムラ
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(120,105,80,${Math.random() * 0.05})`;
    ctx.fillRect(Math.random() * 512, Math.random() * 1024, 2 + Math.random() * 6, 1 + Math.random() * 3);
  }
  // 走行方向の墨のかすれ筋
  for (let i = 0; i < 46; i++) {
    const x = Math.random() * 512, w = 1 + Math.random() * 5, a = 0.04 + Math.random() * 0.12;
    ctx.fillStyle = `rgba(25,20,14,${a})`;
    const y0 = Math.random() * 1024, len = 150 + Math.random() * 700;
    ctx.fillRect(x, y0, w, len);
  }
  // レーン境界のうっすら筆線
  for (const x of [512 * 0.335, 512 * 0.665]) {
    ctx.strokeStyle = 'rgba(25,20,14,0.16)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, 0);
    for (let y = 0; y <= 1024; y += 32) ctx.lineTo(x + (Math.random() - 0.5) * 6, y);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 6);
  return tex;
}

export class Game {
  constructor(container, hud, audio) {
    this.hud = hud;
    this.audio = audio;
    this.items = {};       // 購入済み強化(start時にmain.jsから渡される)
    this.coinMult = 1;
    this.shield = 0;
    this.dragonTime = DRAGON_TIME;
    // capture=1 の時だけpreserveDrawingBufferを有効化(デバッグ用スクショ)
    const capture = new URLSearchParams(location.search).has('capture');
    this.renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: capture, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(innerWidth, innerHeight);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(WASHI);
    this.scene.fog = new THREE.Fog(WASHI, 26, 78);

    this.camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 200);

    this.scene.add(new THREE.HemisphereLight(0xfff6e0, 0x9a8c70, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(4, 10, 6);
    this.scene.add(sun);

    // 路面
    const groundGeo = new THREE.PlaneGeometry(9, 400);
    this.groundTex = makeGroundTexture();
    const ground = new THREE.Mesh(groundGeo, new THREE.MeshBasicMaterial({ map: this.groundTex }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.z = -150;
    this.scene.add(ground);
    // 橋の欄干(左右)
    this.rails = [];
    const railMat = inkMat(0x241f18);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 30; i++) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.9, 0.18), railMat);
        post.position.set(side * 4.6, 0.45, -i * 12);
        this.scene.add(post); this.rails.push(post);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 400), railMat);
      beam.position.set(side * 4.6, 0.95, -150);
      this.scene.add(beam);
    }

    this.pools = { obstacles: [], coins: [], scrolls: [], scenery: [] };
    this.reset();
    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });
  }

  async loadAssets() {
    const [runner, dragon, coin, scroll, crate, ball, torii, barrier, wall, lantern, bamboo, pagoda] =
      await Promise.all([
        loadModel('runner', 1.7, ph.runner),
        loadModel('dragon', 5, ph.dragon),
        loadModel('coin', 0.7, ph.coin),
        loadModel('scroll', 1.0, ph.scroll),
        loadModel('crate', 1.7, ph.crate),
        loadModel('ball', 2.0, ph.ball),
        loadModel('torii', 3.0, ph.torii),
        loadModel('barrier', 2.2, ph.barrier),
        loadModel('wall', 2.8, ph.wall),
        loadModel('lantern', 2.0, ph.lantern),
        loadModel('bamboo', 6, ph.bamboo),
        loadModel('pagoda', 8, ph.pagoda),
      ]);
    this.proto = { runner, dragon, coin, scroll, crate, ball, torii, barrier, wall, lantern, bamboo, pagoda };

    // 岩球: 回転軸を球の中心に移す(転がり表現用)
    {
      const bb = new THREE.Box3().setFromObject(ball);
      const r = (bb.max.y - bb.min.y) / 2;
      const inner = new THREE.Group();
      while (ball.children.length) inner.add(ball.children[0]);
      inner.position.y = -r;
      const pivot = new THREE.Group();
      pivot.add(inner);
      pivot.position.y = r;
      ball.add(pivot);
      this.ballR = r;
    }
    // 再利用プール(スポーン時のclone/GCによるカクつき防止)
    this.free = { coin: [], scroll: [], crate: [], ball: [], torii: [], barrier: [], wall: [] };

    // プレイヤー: hero.glb(複数アニメ入り) > runner_run.glb > 静的モデル の優先順
    this.player = new THREE.Group();
    this.mixer = null;
    this.actions = {};
    this.currentAction = null;
    const animated = (await loadAnimated('hero', 1.7)) ?? (await loadAnimated('runner_run', 1.7));
    if (animated && animated.clips.length) {
      this.playerModel = animated.scene;
      this.mixer = new THREE.AnimationMixer(animated.scene);
      // Leap_of_Faithはビルから飛び降りる移動成分(+26m)を含むため、位置トラックを除去してその場ポーズ化
      for (const c of animated.clips) {
        if (c.name === 'Leap_of_Faith') c.tracks = c.tracks.filter(t => !/\.position$/.test(t.name));
        this.actions[c.name] = this.mixer.clipAction(c);
      }
      // RunFastが最も疾走感のあるフォーム(Runningはガニ股気味)
      this.runAction = this.actions['RunFast'] ?? this.actions['Running'] ?? this.actions[animated.clips.find(c => /run/i.test(c.name))?.name] ?? this.actions[animated.clips[0].name];
      this.jumpAction = this.actions['Jump_Run'] ?? null;
      this.leapAction = this.actions['Leap_of_Faith'] ?? null;   // 竜騎乗: 信仰の飛躍
      this.knockAction = this.actions['Knock_Down'] ?? null;     // 被弾: ノックダウン
      // スライディング専用: 走りクリップを複製した独立アクションを固定ポーズで使う。
      // (runActionと同一実体を凍結すると走りごと止まるため必ず複製する)
      const slideClip = this.runAction.getClip().clone();
      slideClip.name = 'SlidePose';
      this.slideAction = this.mixer.clipAction(slideClip);
      if (this.leapAction) { this.leapAction.setLoop(THREE.LoopOnce); this.leapAction.clampWhenFinished = true; }
      if (this.knockAction) { this.knockAction.setLoop(THREE.LoopOnce); this.knockAction.clampWhenFinished = true; }
      this.currentAction = this.runAction;
      this.runAction.play();
    } else {
      this.playerModel = runner;
    }

    // 墨のオーラ(必殺技演出用パーティクル)
    this.aura = this.makeInkAura();
    this.aura.visible = false;
    this.player.add(this.aura);
    this.playerModel.rotation.y = Math.PI; // 進行方向(-Z)を向かせる
    this.player.add(this.playerModel);
    this.scene.add(this.player);

    // 竜
    this.dragon = dragon;
    this.dragon.visible = false;
    this.scene.add(this.dragon);

    // 背景の遠景(パゴダ・竹・灯籠)を配置
    for (let i = 0; i < 14; i++) {
      const kind = ['bamboo', 'lantern', 'bamboo', 'pagoda'][i % 4];
      const m = this.proto[kind].clone();
      const side = i % 2 ? 1 : -1;
      m.position.set(side * (6.5 + Math.random() * 6), 0, -i * 26 - 10);
      if (kind === 'pagoda') m.position.x = side * 14;
      m.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(m);
      this.pools.scenery.push(m);
    }

    // シェーダー事前コンパイル&テクスチャ転送(初出現時のヒッチ防止)
    const warm = new THREE.Group();
    for (const key of Object.keys(this.proto)) {
      const c = this.proto[key].clone();
      c.position.set((Math.random() - 0.5) * 4, 0, -20);
      warm.add(c);
    }
    this.scene.add(warm);
    this.camera.position.set(0, 3, 7);
    this.camera.lookAt(0, 1, -6);
    this.renderer.compile(this.scene, this.camera);
    this.renderer.render(this.scene, this.camera);
    this.scene.remove(warm);
  }

  // 墨のオーラ: 主人公の周囲を渦巻く墨粒
  makeInkAura() {
    const N = 90;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
    grad.addColorStop(0, 'rgba(20,18,14,0.95)');
    grad.addColorStop(0.6, 'rgba(20,18,14,0.45)');
    grad.addColorStop(1, 'rgba(20,18,14,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    this.auraSeeds = [];
    for (let i = 0; i < N; i++) {
      this.auraSeeds.push({ r: 0.7 + Math.random() * 1.1, a: Math.random() * Math.PI * 2, h: Math.random() * 2.0, sp: 1.5 + Math.random() * 3, vy: 0.4 + Math.random() * 0.9 });
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ map: tex, size: 0.55, transparent: true, opacity: 0.85, depthWrite: false, sizeAttenuation: true });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return pts;
  }

  updateAura(dt) {
    const pos = this.aura.geometry.attributes.position;
    for (let i = 0; i < this.auraSeeds.length; i++) {
      const s = this.auraSeeds[i];
      s.a += s.sp * dt;
      s.h += s.vy * dt;
      if (s.h > 2.4) s.h = 0; // 下から湧き上がる
      pos.setXYZ(i, Math.cos(s.a) * s.r, s.h, Math.sin(s.a) * s.r * 0.7);
    }
    pos.needsUpdate = true;
  }

  // プールから取得(無ければclone)
  acquire(type) {
    const m = this.free[type]?.pop();
    if (m) { m.visible = true; return m; }
    const c = this.proto[type].clone();
    this.scene.add(c);
    return c;
  }

  release(type, mesh) {
    mesh.visible = false;
    if (this.free[type]) this.free[type].push(mesh);
    else this.scene.remove(mesh);
  }

  reset() {
    this.state = 'title';       // title | run | dragon | dead
    this.speed = 9;
    this.distance = 0;
    this.coins = 0;
    this.lane = 1; this.laneX = 0;
    this.y = 0; this.vy = 0;
    this.sliding = 0;           // 残り秒
    this.climbing = 0;
    this.dragonT = 0;
    this.invincible = 0;
    this.untilNext = 0;
    this.prefill = true;
    this.time = 0;
    if (this.free) {
      for (const o of this.pools.obstacles) this.release(o.type, o.mesh);
      for (const c of this.pools.coins) this.release('coin', c.mesh);
      for (const s of this.pools.scrolls) this.release('scroll', s.mesh);
    }
    if (this.pools) { this.pools.obstacles.length = 0; this.pools.coins.length = 0; this.pools.scrolls.length = 0; }
    if (this.player) { this.player.position.set(0, 0, 0); this.player.visible = true; }
    if (this.dragon) this.dragon.visible = false;
  }

  start(items = this.items) {
    this.items = items;
    this.reset();
    this.state = 'run';
    // 強化アイテムの効果
    this.coinMult = items.maneki ? 2 : 1;
    this.shield = items.omamori ? 1 : 0;
    this.dragonTime = DRAGON_TIME + (items.uroko ? 3 : 0);
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.runAction.reset().play();
      this.currentAction = this.runAction;
    }
    if (this.aura) this.aura.visible = false;
  }

  // ===== 入力 =====
  onSwipe(dir) {
    if (this.state === 'dragon') {
      if (dir === 'left' && this.lane > 0) this.lane--;
      if (dir === 'right' && this.lane < 2) this.lane++;
      return;
    }
    if (this.state !== 'run') return;
    if (dir === 'left' && this.lane > 0) this.lane--;
    if (dir === 'right' && this.lane < 2) this.lane++;
    if (dir === 'up' && this.y <= 0.01 && !this.climbing) {
      // 目の前に壁があれば登る、なければジャンプ
      const wallAhead = this.pools.obstacles.find(o =>
        o.type === 'wall' && Math.abs(o.mesh.position.x - this.laneX) < 1.1 &&
        o.mesh.position.z < -0.5 && o.mesh.position.z > -6);
      if (wallAhead) { this.climbing = 0.55; this.climbWall = wallAhead; }
      else this.vy = 9.2;
      this.sliding = 0;
      this.audio?.jump();
    }
    if (dir === 'down') {
      if (this.y > 0.01) this.vy = -18; // 空中なら急降下
      this.sliding = 0.6;
      this.audio?.slide();
    }
  }

  // ===== 生成 =====
  spawnChunk(z) {
    const r = Math.random();
    const lanes = [0, 1, 2];
    if (r < 0.14 && this.distance > 150) {
      // 巻物チャンク
      this.spawnScroll(LANES[(Math.random() * 3) | 0], z);
      this.spawnCoinLine(LANES[(Math.random() * 3) | 0], z - 4, 5);
      return;
    }
    // 障害物: 1〜2レーンに配置
    const types = ['crate', 'ball', 'torii', 'barrier', 'wall'];
    const n = this.distance > 400 ? 2 : 1;
    const used = [];
    for (let i = 0; i < n; i++) {
      const li = lanes.splice((Math.random() * lanes.length) | 0, 1)[0];
      const type = types[(Math.random() * types.length) | 0];
      this.spawnObstacle(type, LANES[li], z);
      used.push(li);
    }
    // 空きレーンに銭
    const free = lanes[(Math.random() * lanes.length) | 0];
    if (free !== undefined) this.spawnCoinLine(LANES[free], z - 3, 6);
  }

  spawnObstacle(type, x, z) {
    const mesh = this.acquire(type);
    // 岩球は遠くから転がってくるので余分に奥へ置く
    mesh.position.set(x, 0, type === 'ball' ? z - 25 : z);
    mesh.rotation.set(0, 0, 0);
    if (type === 'ball' && mesh.children[0]) mesh.children[0].rotation.set(0, 0, 0);
    this.pools.obstacles.push({ type, mesh, vz: type === 'ball' ? 8 : 0, rot: 0 });
  }

  spawnCoinLine(x, z, count, y = 0.35) {
    for (let i = 0; i < count; i++) {
      const m = this.acquire('coin');
      m.position.set(x, y, z - i * 1.6);
      this.pools.coins.push({ mesh: m, t: Math.random() * 6 });
    }
  }

  spawnScroll(x, z) {
    const m = this.acquire('scroll');
    m.position.set(x, 0.5, z);
    this.pools.scrolls.push({ mesh: m, t: 0 });
  }

  // ===== 竜モード =====
  mountDragon() {
    this.state = 'dragon';
    this.dragonT = this.dragonTime;
    this.audio?.ultimate();
    this.dragon.visible = true;
    this.hud.banner(true);
    if (this.aura) this.aura.visible = true; // 墨のオーラ発動
    // 空中に銭の列を敷く
    for (let i = 1; i <= 6; i++) {
      this.spawnCoinLine(LANES[(Math.random() * 3) | 0], -20 * i, 6, 4.6);
    }
  }

  dismountDragon() {
    this.state = 'run';
    this.dragon.visible = false;
    this.invincible = INVINCIBLE_TIME;
    this.hud.banner(false);
    if (this.aura) this.aura.visible = false;
  }

  // ===== 更新 =====
  update(dt) {
    // やられ演出中: 世界は止めてノックダウンだけ再生
    if (this.state === 'dying') {
      this.mixer?.update(dt);
      this.player.visible = true;
      this.dyingT -= dt;
      if (this.dyingT <= 0) {
        this.state = 'dead';
        this.hud.gameover(this.score(), this.coins, Math.floor(this.distance));
      }
      return;
    }
    if (this.state !== 'run' && this.state !== 'dragon') return;
    this.time += dt;
    this.speed = Math.min(22, 9 + this.time * 0.14 + (this.state === 'dragon' ? 6 : 0));
    const dz = this.speed * dt;
    this.distance += dz;
    this.groundTex.offset.y += dz / 66;

    // レーン移動
    this.laneX += (LANES[this.lane] - this.laneX) * Math.min(1, dt * 12);

    // 縦の動き
    if (this.state === 'dragon') {
      this.dragonT -= dt;
      const targetY = 4.2 + Math.sin(this.time * 2.2) * 0.35;
      this.y += (targetY - this.y) * Math.min(1, dt * 3);
      if (this.dragonT <= 0) this.dismountDragon();
    } else if (this.climbing > 0) {
      this.climbing -= dt;
      const w = this.climbWall;
      this.y += dt * 5.2;
      if (this.climbing <= 0 || !w) { this.vy = 2.5; this.climbing = 0; }
    } else {
      this.vy -= 26 * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) { this.y = 0; this.vy = 0; }
    }
    if (this.sliding > 0) this.sliding -= dt;
    if (this.invincible > 0) this.invincible -= dt;

    // プレイヤー姿勢
    this.player.position.set(this.laneX, this.y, 0);
    const lean = (LANES[this.lane] - this.laneX) * 0.12;
    this.player.rotation.z = -lean;
    if (this.state === 'dragon') {
      this.playerModel.rotation.x = -0.15;
      this.playerModel.position.y = 0.4;
      this.playerModel.scale.setScalar(1);
    } else if (this.sliding > 0) {
      this.playerModel.rotation.x = 1.4; // サッカーのスライディングのように体を寝かせる
      this.playerModel.position.y = 0.05;
    } else {
      this.playerModel.rotation.x = -0.12;
      this.playerModel.position.y = this.mixer ? 0 : Math.abs(Math.sin(this.time * 11)) * 0.09;
    }
    // アニメーション状態マシン
    if (this.mixer) {
      let desired = this.runAction;
      let scale = this.speed / 10; // 走りは速度連動
      if (this.state === 'dragon' && this.leapAction) {
        desired = this.leapAction; scale = 1;
      } else if (this.sliding > 0 && this.slideAction && this.state === 'run') {
        desired = this.slideAction; scale = 1; // スライディング: 固定ポーズ(独立実体)
      } else if (this.jumpAction && this.state === 'run' && this.y > 0.05 && this.climbing <= 0) {
        desired = this.jumpAction; scale = 1;
      }
      if (desired && this.currentAction !== desired) {
        desired.reset().crossFadeFrom(this.currentAction, desired === this.leapAction ? 0.35 : 0.12, false).play();
        // スライディング: 走りポーズの脚を伸ばした瞬間で固定(体はrotationで寝かせる)
        if (desired === this.slideAction) {
          desired.time = desired.getClip().duration * 0.3; desired.paused = true;
        }
        // 信仰の飛躍: 終盤のスカイダイビングポーズ(4.6s)へ即移行→キープ
        if (desired === this.leapAction && this.state === 'dragon') {
          desired.time = 4.6; desired.paused = true;
        }
        this.currentAction = desired;
      }
      // 降下開始で飛躍キープ解除→着地モーションの続きを再生
      if (this.state === 'dragon' && this.leapAction && this.dragonT <= 1.2) this.leapAction.paused = false;
      // 走りに戻ったのに一時停止が残っていたら解除(保険)
      if (this.currentAction === this.runAction && this.runAction.paused) this.runAction.paused = false;
      this.mixer.update(dt * scale);
    }
    // 墨のオーラ
    if (this.aura?.visible) this.updateAura(dt);
    // 無敵中は点滅
    this.player.visible = this.invincible > 0 ? (Math.sin(this.time * 30) > -0.4) : true;

    // 竜の動き
    if (this.state === 'dragon') {
      this.dragon.position.set(this.laneX, this.y - 2.6, 0.5);
      this.dragon.rotation.y = Math.PI;
      this.dragon.rotation.z = Math.sin(this.time * 3) * 0.06;
    }

    // カメラ
    const camY = 3.2 + this.y * 0.55, camZ = 7.2;
    this.camera.position.set(this.laneX * 0.55, camY, camZ);
    this.camera.lookAt(this.laneX * 0.7, 1.2 + this.y * 0.7, -6);

    // チャンク生成: CHUNKメートル進むごとに前方90mへ1パターン
    if (this.prefill) {
      this.prefill = false;
      for (let z = -34; z > -90; z -= CHUNK) this.spawnChunk(z);
    }
    this.untilNext -= dz;
    if (this.untilNext <= 0) { this.spawnChunk(-90); this.untilNext += CHUNK; }

    // ===== オブジェクト移動&判定 =====
    const px = this.laneX, py = this.y;
    for (let i = this.pools.obstacles.length - 1; i >= 0; i--) {
      const o = this.pools.obstacles[i];
      o.mesh.position.z += dz + o.vz * dt;
      if (o.type === 'ball') {
        o.rot += (dz + o.vz * dt) / (this.ballR || 1);
        if (o.mesh.children[0]) o.mesh.children[0].rotation.x = o.rot; // 中心軸でゴロゴロ転がる
      }
      if (o.mesh.position.z > 8) { this.release(o.type, o.mesh); this.pools.obstacles.splice(i, 1); continue; }
      // 判定
      if (this.state === 'dragon' || this.invincible > 0) continue;
      const oz = o.mesh.position.z, ox = o.mesh.position.x;
      if (oz > -0.7 && oz < 0.7 && Math.abs(ox - px) < 1.2) {
        let hit = false;
        switch (o.type) {
          case 'crate':   hit = py < 1.5; break;                    // 跳び越える
          case 'ball':    hit = py < 1.7; break;                    // 跳び越える
          case 'barrier': hit = py < 0.7 && this.sliding <= 0; break; // 跳ぶor滑る
          case 'torii':   hit = this.sliding <= 0 && py < 1.2; break; // くぐる
          case 'wall':    hit = py < 2.4 && this.climbing <= 0; break; // 登る
        }
        if (hit) {
          // お守り: 一度だけ被弾を無効化
          if (this.shield > 0) {
            this.shield--;
            this.invincible = INVINCIBLE_TIME;
            this.audio?.shield();
            continue;
          }
          this.die(); return;
        }
      }
    }
    for (let i = this.pools.coins.length - 1; i >= 0; i--) {
      const c = this.pools.coins[i];
      c.mesh.position.z += dz;
      c.t += dt; c.mesh.rotation.y = c.t * 3;
      const d2 = (c.mesh.position.x - px) ** 2 + (c.mesh.position.y - 0.35 - py) ** 2;
      if (c.mesh.position.z > -1 && c.mesh.position.z < 1 && d2 < 1.1) {
        this.coins += this.coinMult;
        this.audio?.coin();
        this.release('coin', c.mesh); this.pools.coins.splice(i, 1); continue;
      }
      if (c.mesh.position.z > 8) { this.release('coin', c.mesh); this.pools.coins.splice(i, 1); }
    }
    for (let i = this.pools.scrolls.length - 1; i >= 0; i--) {
      const s = this.pools.scrolls[i];
      s.mesh.position.z += dz;
      s.t += dt; s.mesh.rotation.y = s.t * 2; s.mesh.position.y = 0.5 + Math.sin(s.t * 3) * 0.15;
      if (this.state === 'run' && s.mesh.position.z > -1 && s.mesh.position.z < 1 && Math.abs(s.mesh.position.x - px) < 1.1 && py < 1.6) {
        this.release('scroll', s.mesh); this.pools.scrolls.splice(i, 1);
        this.mountDragon(); continue;
      }
      if (s.mesh.position.z > 8) { this.release('scroll', s.mesh); this.pools.scrolls.splice(i, 1); }
    }
    // 遠景・欄干のループ
    for (const m of this.pools.scenery) {
      m.position.z += dz;
      if (m.position.z > 12) m.position.z -= 26 * 14;
    }
    for (const p of this.rails) {
      p.position.z += dz;
      if (p.position.z > 6) p.position.z -= 360;
    }

    this.hud.update(this.score(), this.coins);
  }

  score() { return Math.floor(this.distance * 7 + this.coins * 60); }

  die() {
    if (this.state === 'dying' || this.state === 'dead') return;
    this.audio?.knock();
    this.dragon.visible = false;
    this.hud.banner(false);
    if (this.aura) this.aura.visible = false;
    if (this.knockAction && this.currentAction) {
      // ノックダウンモーション→終了後にゲームオーバー表示
      this.state = 'dying';
      this.dyingT = Math.min(2.2, this.knockAction.getClip().duration);
      this.knockAction.reset().crossFadeFrom(this.currentAction, 0.1, false).play();
      this.currentAction = this.knockAction;
    } else {
      this.state = 'dead';
      this.hud.gameover(this.score(), this.coins, Math.floor(this.distance));
    }
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
