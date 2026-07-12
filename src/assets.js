// アセット管理: Meshy生成のGLBがあれば使い、無ければ墨風プレースホルダーを出す
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
export const INK = 0x14120e;      // 墨色
export const WASHI = 0xe9dfc8;    // 和紙色

// モデルをViteにバンドルさせる。build時はassetsInlineLimitでdata URI化され
// 単一HTMLに埋め込まれるので file:// でも動く。dev時は普通のURLになる。
const MODEL_URLS = import.meta.glob('./models/*.glb', { eager: true, query: '?url', import: 'default' });
function modelUrl(name) {
  for (const key in MODEL_URLS) {
    if (key.endsWith(`/${name}.glb`)) return MODEL_URLS[key];
  }
  return null;
}

export const inkMat = (color = INK, opacity = 1) =>
  new THREE.MeshToonMaterial({ color, transparent: opacity < 1, opacity });

// 名前 -> { scene(Group), loaded(bool) }
const cache = {};

// 巨大テクスチャをモバイル向けに縮小し、マテリアルを軽量化する
const MAX_TEX = 1024;
function optimize(group) {
  group.traverse(obj => {
    if (!obj.isMesh) return;
    const src = obj.material;
    let map = src?.map ?? null;
    const img = map?.image;
    if (img && (img.width > MAX_TEX || img.height > MAX_TEX)) {
      const s = MAX_TEX / Math.max(img.width, img.height);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      map = new THREE.CanvasTexture(c);
      map.colorSpace = THREE.SRGBColorSpace;
      map.flipY = src.map.flipY;
    }
    obj.material = new THREE.MeshLambertMaterial({ map, color: map ? 0xffffff : (src?.color ?? INK) });
    obj.frustumCulled = true;
  });
}

// GLBを読み、指定サイズに正規化して返す。失敗時はfallback()を使う
export async function loadModel(name, targetSize, fallback) {
  if (cache[name]) return cache[name].scene.clone();
  let group;
  try {
    const url = modelUrl(name);
    if (!url) throw new Error(`model not found: ${name}`);
    const gltf = await loader.loadAsync(url);
    group = gltf.scene;
    optimize(group);
    // サイズ正規化(最大辺をtargetSizeに)・接地(y=0が底)
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const s = targetSize / Math.max(size.x, size.y, size.z);
    group.scale.setScalar(s);
    const box2 = new THREE.Box3().setFromObject(group);
    const c = box2.getCenter(new THREE.Vector3());
    group.position.set(-c.x, -box2.min.y, -c.z);
    const wrapper = new THREE.Group();
    wrapper.add(group);
    group = wrapper;
    cache[name] = { scene: group, loaded: true };
  } catch {
    group = fallback();
    cache[name] = { scene: group, loaded: false };
  }
  return cache[name].scene.clone();
}

// アニメーション付きGLBを読む(runner_run等)。無ければnull
export async function loadAnimated(name, targetSize) {
  try {
    const url = modelUrl(name);
    if (!url) throw new Error(`model not found: ${name}`);
    const gltf = await loader.loadAsync(url);
    const group = gltf.scene;
    optimize(group);
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const s = targetSize / Math.max(size.x, size.y, size.z);
    group.scale.setScalar(s);
    const box2 = new THREE.Box3().setFromObject(group);
    const c = box2.getCenter(new THREE.Vector3());
    group.position.set(-c.x, -box2.min.y, -c.z);
    const wrapper = new THREE.Group();
    wrapper.add(group);
    return { scene: wrapper, clips: gltf.animations };
  } catch {
    return null;
  }
}

// ====== プレースホルダー群(墨シルエット) ======
export const ph = {
  runner() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.7, 4, 12), inkMat());
    body.position.y = 0.75; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), inkMat());
    head.position.y = 1.45; g.add(head);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.02), inkMat());
    band.position.set(0, 1.45, -0.2); g.add(band);
    return g;
  },
  dragon() {
    const g = new THREE.Group();
    const mat = inkMat();
    let r = 0.55;
    for (let i = 0; i < 14; i++) {
      const seg = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), mat);
      seg.position.set(Math.sin(i * 0.55) * 0.9, Math.sin(i * 0.4) * 0.35 + 0.6, -i * 0.75);
      g.add(seg); r *= 0.94;
    }
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.6, 8), mat);
    horn.position.set(0.2, 1.35, 0.1); horn.rotation.z = -0.4; g.add(horn);
    return g;
  },
  coin() {
    const g = new THREE.Group();
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.07, 24), inkMat(0x2b2620));
    c.rotation.x = Math.PI / 2; c.position.y = 0.32; g.add(c);
    return g;
  },
  scroll() {
    const g = new THREE.Group();
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.9, 16), inkMat(0xd8ccb0));
    roll.rotation.z = Math.PI / 2; roll.position.y = 0.4; g.add(roll);
    const ends = inkMat();
    for (const x of [-0.5, 0.5]) {
      const e = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.08, 16), ends);
      e.rotation.z = Math.PI / 2; e.position.set(x, 0.4, 0); g.add(e);
    }
    return g;
  },
  crate() {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), inkMat(0x241f18));
    m.position.y = 0.8; g.add(m);
    return g;
  },
  ball() {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.SphereGeometry(1.0, 20, 16), inkMat(0x1c1812));
    m.position.y = 1.0; g.add(m);
    return g;
  },
  torii() {
    const g = new THREE.Group();
    const mat = inkMat();
    for (const x of [-1.1, 1.1]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 1.5, 10), mat);
      p.position.set(x, 0.75, 0); g.add(p);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.22, 0.3), mat);
    beam.position.y = 1.45; g.add(beam);
    return g;
  },
  barrier() {
    const g = new THREE.Group();
    const mat = inkMat(0x2b2620);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.16, 0.16), mat);
    bar.position.y = 0.75; g.add(bar);
    for (const x of [-0.9, 0.9]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 8), mat);
      leg.position.set(x, 0.4, 0); g.add(leg);
    }
    return g;
  },
  wall() {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.6, 0.5), inkMat(0x1c1812));
    m.position.y = 1.3; g.add(m);
    return g;
  },
  lantern() {
    const g = new THREE.Group();
    const mat = inkMat(0x2b2620);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 0.4, 8), mat); base.position.y = 0.2; g.add(base);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.9, 8), mat); pole.position.y = 0.85; g.add(pole);
    const house = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.4, 0.55), mat); house.position.y = 1.5; g.add(house);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.35, 4), mat); roof.position.y = 1.85; roof.rotation.y = Math.PI / 4; g.add(roof);
    return g;
  },
  bamboo() {
    const g = new THREE.Group();
    const mat = inkMat(0x241f18);
    for (let i = 0; i < 4; i++) {
      const h = 4 + Math.random() * 2.5;
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, h, 6), mat);
      b.position.set((Math.random() - 0.5) * 1.2, h / 2, (Math.random() - 0.5) * 1.2);
      b.rotation.z = (Math.random() - 0.5) * 0.1;
      g.add(b);
    }
    return g;
  },
  pagoda() {
    const g = new THREE.Group();
    const mat = inkMat(0x1c1812);
    for (let i = 0; i < 5; i++) {
      const w = 2.4 - i * 0.35, y = i * 1.1;
      const box = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 0.8, w * 0.7), mat);
      box.position.y = y + 0.4; g.add(box);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(w, 0.5, 4), mat);
      roof.position.y = y + 1.0; roof.rotation.y = Math.PI / 4; g.add(roof);
    }
    return g;
  },
};
