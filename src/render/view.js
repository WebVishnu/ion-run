import * as THREE from 'three';
import { CEIL_Y, LANES, LANE_W, laneX } from '../config.js';
import {
  LIVERIES,
  VehiclePool,
  applyLivery,
  createEnvironment,
  createHeroCar,
  createPadMesh,
  createRampMesh,
  setDoors,
} from './models.js';

const ROAD_W = LANES * LANE_W;
const TILE = 12; // metres per road texture repeat
const ROAD_LEN = 620;
const TAU = Math.PI * 2;

const PALETTES = [
  { name: 'Coastal Dusk', top: 0x1b1450, horizon: 0xff8a5c, ground: 0x1d2330, road: 0x2a2d36, lamp: 0xffd9a0, accent: 0xff6a8c, bld: 0x3a2f66, emis: 0x1a0a28, fogFar: 330, stars: 0.25, rain: 0, sun: 0xffc27a, sunY: 14, hemiSky: 0xffa57a, hemiGround: 0x2a2040, dir: 0xffa070, bldH: 1.0 },
  { name: 'Neon City', top: 0x06041a, horizon: 0x4b1a7a, ground: 0x0a0c16, road: 0x1c1e2a, lamp: 0x6ae4ff, accent: 0xff2bd6, bld: 0x14163a, emis: 0x3a0a6a, fogFar: 300, stars: 0.5, rain: 0, sun: 0xff5fd0, sunY: 26, hemiSky: 0x7a4cff, hemiGround: 0x10102a, dir: 0x9a7aff, bldH: 1.9 },
  { name: 'Desert Night', top: 0x040818, horizon: 0x3b2a4f, ground: 0x3a2c25, road: 0x24262c, lamp: 0xffb86b, accent: 0xffb86b, bld: 0x5a3f33, emis: 0x000000, fogFar: 340, stars: 1, rain: 0, sun: 0xdfe9ff, sunY: 34, hemiSky: 0x6a7cc0, hemiGround: 0x2a1f1a, dir: 0xa8b8ff, bldH: 0.55 },
  { name: 'Rain Storm', top: 0x0d1218, horizon: 0x3d4a58, ground: 0x10161c, road: 0x1b2027, lamp: 0xbfe6ff, accent: 0x7fd0ff, bld: 0x1d2733, emis: 0x061018, fogFar: 210, stars: 0, rain: 1, sun: 0x5c6c7c, sunY: 22, hemiSky: 0x6a8aa8, hemiGround: 0x10161c, dir: 0x8aa8c8, bldH: 1.3 },
  { name: 'Mountain Dawn', top: 0x2a5080, horizon: 0xffd1a1, ground: 0x22332e, road: 0x2a2f33, lamp: 0xfff0d0, accent: 0xffe08a, bld: 0x3a4f4a, emis: 0x000000, fogFar: 360, stars: 0.1, rain: 0, sun: 0xfff2c0, sunY: 16, hemiSky: 0xffe0b8, hemiGround: 0x22332e, dir: 0xfff0d0, bldH: 0.9 },
];

const PALETTE_KEYS = ['top', 'horizon', 'ground', 'road', 'lamp', 'accent', 'bld', 'emis', 'sun', 'hemiSky', 'hemiGround', 'dir'];
// built once so the per-frame palette blend allocates nothing
const PALETTE_COLORS = PALETTES.map((p) => Object.fromEntries(PALETTE_KEYS.map((k) => [k, new THREE.Color(p[k])])));

const fract = (v) => v - Math.floor(v);
const hash = (n) => fract(Math.sin(n * 12.9898 + 78.233) * 43758.5453);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function makeRoadTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#34373f';
  g.fillRect(0, 0, 256, 256);
  // asphalt speckle
  for (let i = 0; i < 1400; i++) {
    const v = 40 + Math.floor(Math.random() * 40);
    g.fillStyle = `rgba(${v},${v},${v + 4},0.5)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const lane = 256 / LANES;
  // double yellow between oncoming lane and the rest
  g.fillStyle = '#f5b82e';
  g.fillRect(lane - 5, 0, 3, 256);
  g.fillRect(lane + 2, 0, 3, 256);
  // dashed white lane lines
  g.fillStyle = '#e8eef5';
  for (let i = 2; i < LANES; i++) g.fillRect(lane * i - 2, 0, 4, 85);
  // edge lines
  g.fillRect(3, 0, 4, 256);
  g.fillRect(249, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function isWebGLAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

/**
 * Renders the simulation. Owns the Three.js scene, camera rig, quality tiers and effects.
 * The sim never knows this exists.
 */
export class GameView {
  constructor(canvas, { reducedMotion = false, quality = 'auto' } = {}) {
    this.canvas = canvas;
    this.reducedMotion = reducedMotion;
    this.qualityMode = quality;
    this.tier = quality === 'auto' ? 'high' : quality; // high | medium | low
    this.frame = 0;
    this.fovKick = 0;
    this.shake = 0;
    this.camBlend = 0; // 0 ground, 1 ceiling
    this.camRoll = 0;
    this.paletteIndex = 0;
    this.paletteTarget = 0;
    this.slowFrames = 0;
    this.frameTimes = [];
    this.padPulse = 0;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x000000, 40, 300);
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 700);
    this.camera.rotation.order = 'ZYX';

    this.cur = {
      top: new THREE.Color(PALETTES[0].top),
      horizon: new THREE.Color(PALETTES[0].horizon),
      ground: new THREE.Color(PALETTES[0].ground),
      road: new THREE.Color(PALETTES[0].road),
      lamp: new THREE.Color(PALETTES[0].lamp),
      accent: new THREE.Color(PALETTES[0].accent),
      bld: new THREE.Color(PALETTES[0].bld),
      emis: new THREE.Color(PALETTES[0].emis),
      sun: new THREE.Color(PALETTES[0].sun),
      hemiSky: new THREE.Color(PALETTES[0].hemiSky),
      hemiGround: new THREE.Color(PALETTES[0].hemiGround),
      dir: new THREE.Color(PALETTES[0].dir),
      fogFar: PALETTES[0].fogFar,
      stars: PALETTES[0].stars,
      rain: PALETTES[0].rain,
      sunY: PALETTES[0].sunY,
      bldH: PALETTES[0].bldH,
    };

    this.buildLights();
    this.buildSky();
    this.buildGround();
    this.buildRoad();
    this.buildRoadside();
    this.buildTunnel();
    this.buildEffects();

    this.hero = createHeroCar(null);
    this.hero.rotation.order = 'ZXY';
    this.shadowBlob = this.hero.userData.parts.shadow;
    this.hero.remove(this.shadowBlob);
    this.scene.add(this.shadowBlob);
    this.scene.add(this.hero);

    this.vehicles = new VehiclePool(this.scene);
    this.pads = new Map();
    this.padFree = [];
    this.ramps = new Map();
    this.rampFree = [];

    this.setLivery(LIVERIES[0]);
    this.resize();
    this.applyPalette(1);

    // reflections load lazily so the first frame is never blocked
    createEnvironment(this.renderer)
      .then((env) => {
        if (!env || this.disposed) return;
        this.env = env;
        this.applyQuality();
      })
      .catch(() => {});
  }

  // ------------------------------------------------------------ construction
  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x222244, 1.0);
    this.sunLight = new THREE.DirectionalLight(0xffffff, 1.6);
    this.sunLight.position.set(-30, 60, 40);
    this.scene.add(this.hemi, this.sunLight);
  }

  buildSky() {
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() } },
      vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying float h; void main(){ float t = pow(clamp(h,0.0,1.0),0.55); gl_FragColor = vec4(mix(horizon, top, t), 1.0); }',
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(500, 24, 12), this.skyMat);
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);

    const starCount = 420;
    const pos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const u = Math.random() * TAU;
      const v = Math.random() * 0.9 + 0.08;
      const r = 470;
      pos[i * 3] = Math.cos(u) * Math.sqrt(1 - v * v) * r;
      pos[i * 3 + 1] = v * r;
      pos[i * 3 + 2] = Math.sin(u) * Math.sqrt(1 - v * v) * r;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(starGeo, this.starMat);
    this.scene.add(this.stars);

    this.sunMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, depthWrite: false });
    this.sunDisc = new THREE.Mesh(new THREE.CircleGeometry(34, 32), this.sunMat);
    this.sunDisc.renderOrder = -9;
    this.scene.add(this.sunDisc);
  }

  buildGround() {
    this.groundMat = new THREE.MeshBasicMaterial({ color: 0x1d2330 }); // unlit so it never goes pitch black
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), this.groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.set(0, -0.06, -300);
    this.scene.add(this.ground);
  }

  buildRoad() {
    this.roadTex = makeRoadTexture();
    this.roadTex.repeat.set(1, ROAD_LEN / TILE);
    this.roadMat = new THREE.MeshStandardMaterial({ map: this.roadTex, roughness: 0.62, metalness: 0.1, envMapIntensity: 0.5 });
    this.road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, ROAD_LEN), this.roadMat);
    this.road.rotation.x = -Math.PI / 2;
    this.road.position.set(0, 0, -(ROAD_LEN / 2 - 60));
    this.scene.add(this.road);

    // glowing guard rails
    this.railMat = new THREE.MeshBasicMaterial({ color: 0xff6a8c });
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, ROAD_LEN), this.railMat);
      rail.position.set(s * (ROAD_W / 2 + 0.55), 0.7, -(ROAD_LEN / 2 - 60));
      this.scene.add(rail);
    }
  }

  buildRoadside() {
    const dummy = new THREE.Object3D();
    this.dummy = dummy;

    // posts
    this.postCount = 2 * 52;
    this.posts = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.14, 0.9, 0.14),
      new THREE.MeshLambertMaterial({ color: 0x9aa4b4 }),
      this.postCount,
    );
    this.posts.frustumCulled = false;
    this.scene.add(this.posts);

    // lamp poles + heads
    this.lampSlots = 15;
    this.lampSpacing = 24;
    this.poles = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.2, 7, 0.2),
      new THREE.MeshLambertMaterial({ color: 0x4a5160 }),
      this.lampSlots * 2,
    );
    this.poles.frustumCulled = false;
    this.lampMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    this.lampHeads = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.16, 0.35), this.lampMat, this.lampSlots * 2);
    this.lampHeads.frustumCulled = false;
    this.scene.add(this.poles, this.lampHeads);

    // skyline / rocks
    this.bldSlots = 22;
    this.bldSpacing = 20;
    this.bldMat = new THREE.MeshLambertMaterial({ color: 0x3a2f66, emissive: 0x1a0a28 });
    this.buildings = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.bldMat, this.bldSlots * 2);
    this.buildings.frustumCulled = false;
    this.scene.add(this.buildings);

    // speed streaks
    this.streakCount = 64;
    this.streakMat = new THREE.MeshBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.streaks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.035, 0.035, 9), this.streakMat, this.streakCount);
    this.streaks.frustumCulled = false;
    this.streakSeed = Array.from({ length: this.streakCount }, (_, i) => ({
      x: (hash(i * 3.1) * 2 - 1) * 12,
      y: 0.4 + hash(i * 5.7) * 5,
      z: hash(i * 7.3) * 140,
    }));
    this.scene.add(this.streaks);
  }

  buildTunnel() {
    this.tunnel = new THREE.Group();
    this.tunnel.visible = false;
    this.ceilTex = this.roadTex.clone();
    this.ceilTex.needsUpdate = true;
    this.ceilTex.wrapT = THREE.RepeatWrapping;
    this.ceilMat = new THREE.MeshStandardMaterial({ map: this.ceilTex, roughness: 0.6, metalness: 0.15, side: THREE.DoubleSide, envMapIntensity: 0.4 });
    this.ceil = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, 1), this.ceilMat);
    this.ceil.rotation.x = Math.PI / 2; // driving surface faces down
    this.ceil.position.y = CEIL_Y;
    this.tunnel.add(this.ceil);

    this.tunnelLightMat = new THREE.MeshBasicMaterial({ color: 0x35e0ff });
    this.tunnelStrips = [];
    for (const s of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1), this.tunnelLightMat);
      strip.position.set(s * (ROAD_W / 2 + 0.1), CEIL_Y + 0.05, 0);
      this.tunnel.add(strip);
      this.tunnelStrips.push(strip);
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, CEIL_Y + 0.6, 1),
        new THREE.MeshLambertMaterial({ color: 0x1a2030 }),
      );
      wall.position.set(s * (ROAD_W / 2 + 0.8), (CEIL_Y + 0.6) / 2 - 0.3, 0);
      this.tunnel.add(wall);
      this.tunnelStrips.push(wall);
    }
    // entry and exit arches
    this.arches = [];
    for (let i = 0; i < 2; i++) {
      const arch = new THREE.Group();
      const frameMat = new THREE.MeshBasicMaterial({ color: i === 0 ? 0x35e0ff : 0xff6ad5 });
      const top = new THREE.Mesh(new THREE.BoxGeometry(ROAD_W + 2, 0.4, 0.4), frameMat);
      top.position.y = CEIL_Y + 0.4;
      arch.add(top);
      for (const s of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, CEIL_Y + 0.6, 0.4), frameMat);
        leg.position.set(s * (ROAD_W / 2 + 0.9), (CEIL_Y + 0.6) / 2, 0);
        arch.add(leg);
      }
      this.tunnel.add(arch);
      this.arches.push(arch);
    }
    this.scene.add(this.tunnel);
  }

  buildEffects() {
    // rain
    this.rainCount = 380;
    const rainPos = new Float32Array(this.rainCount * 6);
    this.rainVel = new Float32Array(this.rainCount);
    this.rainBase = new Float32Array(this.rainCount * 3);
    for (let i = 0; i < this.rainCount; i++) {
      this.rainBase[i * 3] = (Math.random() * 2 - 1) * 26;
      this.rainBase[i * 3 + 1] = Math.random() * 18;
      this.rainBase[i * 3 + 2] = -Math.random() * 120 + 10;
      this.rainVel[i] = 24 + Math.random() * 14;
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
    this.rainMat = new THREE.LineBasicMaterial({ color: 0xaad4ff, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.rain = new THREE.LineSegments(rainGeo, this.rainMat);
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);

    // crash debris
    this.debrisCount = 36;
    this.debris = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.22, 0.22, 0.22),
      new THREE.MeshBasicMaterial({ color: 0xffb36b }),
      this.debrisCount,
    );
    this.debris.frustumCulled = false;
    this.debris.visible = false;
    this.debrisState = Array.from({ length: this.debrisCount }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0 }));
    this.scene.add(this.debris);
  }

  // ------------------------------------------------------------ settings
  setLivery(livery) {
    applyLivery(this.hero, livery);
    this.liveryGlow = livery.glow;
    this.tunnelLightMat.color.setHex(livery.glow);
  }

  setReducedMotion(on) {
    this.reducedMotion = !!on;
  }

  setQualityMode(mode) {
    this.qualityMode = mode;
    if (mode !== 'auto') this.tier = mode;
    else this.tier = 'high';
    this.slowFrames = 0;
    this.applyQuality();
  }

  applyQuality() {
    const dpr = window.devicePixelRatio || 1;
    const cap = this.tier === 'high' ? 1.5 : this.tier === 'medium' ? 1.2 : 1;
    this.renderer.setPixelRatio(Math.min(dpr, cap));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    // reflections: off on the Low tier, including the explicit maps on the hero and road materials
    const env = this.tier === 'low' ? null : this.env ?? null;
    this.scene.environment = env;
    const setEnv = (m) => {
      if (m && m.isMeshStandardMaterial && m.envMap !== env) {
        m.envMap = env;
        m.needsUpdate = true;
      }
    };
    if (this.hero) this.hero.traverse((o) => setEnv(o.material));
    setEnv(this.roadMat);
    setEnv(this.ceilMat);
    this.rain.visible = this.tier !== 'low';
    this.stars.visible = this.tier !== 'low';
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.baseFov = 60 + clamp((1.25 - w / h) * 34, 0, 26); // wider vertical FOV on portrait phones
    this.camera.updateProjectionMatrix();
    this.applyQuality();
  }

  // ------------------------------------------------------------ palette
  /** Everything a new run must start clean: camera, effects, and the first district palette. */
  resetForRun() {
    this.doorTarget = 0;
    this.doorOpen = 0;
    this.camBlend = 0;
    this.camRoll = 0;
    this.fovKick = 0;
    this.shake = 0;
    this.debris.visible = false;
    this.debrisActive = false;
    this.paletteIndex = 0;
    this.setDistrict(0, true);
  }

  setDistrict(index, instant = false) {
    this.paletteTarget = index % PALETTES.length;
    this.paletteAge = 0;
    if (instant) this.applyPalette(1, true);
  }

  applyPalette(k, instant = false) {
    // the blend converges exponentially; once it has, stop touching materials every frame
    this.paletteAge = (this.paletteAge ?? 0) + (instant ? 1 : k);
    if (!instant && this.paletteAge > 9) return;
    const t = PALETTES[this.paletteTarget];
    const tc = PALETTE_COLORS[this.paletteTarget];
    const c = this.cur;
    const f = instant ? 1 : k;
    for (const key of PALETTE_KEYS) c[key].lerp(tc[key], f);
    c.fogFar += (t.fogFar - c.fogFar) * f;
    c.stars += (t.stars - c.stars) * f;
    c.rain += (t.rain - c.rain) * f;
    c.sunY += (t.sunY - c.sunY) * f;
    c.bldH += (t.bldH - c.bldH) * f;

    this.skyMat.uniforms.top.value.copy(c.top);
    this.skyMat.uniforms.horizon.value.copy(c.horizon);
    this.scene.fog.color.copy(c.horizon).lerp(c.top, 0.12);
    this.scene.fog.near = 30;
    this.scene.fog.far = c.fogFar;
    this.groundMat.color.copy(c.ground);
    this.roadMat.color.copy(c.road).multiplyScalar(2.2);
    this.ceilMat.color.copy(c.road).multiplyScalar(2.2);
    this.lampMat.color.copy(c.lamp);
    this.railMat.color.copy(c.accent);
    this.bldMat.color.copy(c.bld);
    this.bldMat.emissive.copy(c.emis);
    this.hemi.color.copy(c.hemiSky);
    this.hemi.groundColor.copy(c.hemiGround);
    this.sunLight.color.copy(c.dir);
    this.sunMat.color.copy(c.sun);
    this.starMat.opacity = c.stars;
    this.rainMat.opacity = c.rain * 0.5;
  }

  // ------------------------------------------------------------ events
  onEvent(ev) {
    const calm = this.reducedMotion;
    switch (ev.type) {
      case 'nearMiss':
        if (!calm) this.fovKick = Math.min(10, this.fovKick + (ev.shave ? 4 : 2.5));
        break;
      case 'hop':
      case 'ramp':
        if (!calm) this.fovKick = Math.min(12, this.fovKick + 6);
        break;
      case 'ceilGrab':
      case 'ceilDrop':
        if (!calm) this.fovKick = Math.min(12, this.fovKick + 5);
        break;
      case 'landClean':
        if (!calm) this.shake = Math.max(this.shake, 0.05);
        break;
      case 'landMessy':
        if (!calm) this.shake = Math.max(this.shake, 0.12);
        break;
      case 'pad':
        this.padPulse = 1;
        break;
      case 'crash':
        if (!calm) this.shake = 0.5;
        this.spawnDebris();
        break;
      default:
        break;
    }
  }

  spawnDebris() {
    const p = this.hero.position;
    for (const d of this.debrisState) {
      d.x = p.x + (Math.random() - 0.5) * 1.4;
      d.y = p.y + 0.5 + Math.random() * 0.6;
      d.z = (Math.random() - 0.5) * 3;
      d.vx = (Math.random() - 0.5) * 9;
      d.vy = 3 + Math.random() * 7;
      d.vz = (Math.random() - 0.7) * 9;
      d.life = 1.4 + Math.random() * 0.6;
    }
    this.debris.visible = true;
    this.debrisActive = true;
  }

  // ------------------------------------------------------------ frame
  update(state, dt) {
    this.frame++;
    this.trackPerformance(dt);

    const pose = state.pose;
    const p = state.player;
    const speedFrac = clamp((state.speed - 20) / 44, 0, 1);

    // palette tween
    if (this.paletteIndex !== state.district) {
      this.paletteIndex = state.district;
      this.setDistrict(state.district);
    }
    this.applyPalette(Math.min(1, dt * 0.9));

    this.updateHero(state, dt, pose, p);
    this.updateCamera(state, dt, pose, speedFrac);
    this.updateWorld(state, dt, speedFrac);
    this.updateEntities(state);
    this.updateTunnel(state);
    this.updateEffects(state, dt, speedFrac);
  }

  updateHero(state, dt, pose, p) {
    const hero = this.hero;
    hero.position.set(pose.x, pose.y, 0);
    const lean = clamp((laneX(p.lane) - p.x) * -0.05, -0.12, 0.12);
    hero.rotation.set(pose.pitch, lean * 0.6, pose.roll + lean);

    const spin = (state.speed * dt) / 0.37;
    for (const w of hero.userData.parts.wheels) w.userData.spin.rotation.x += spin;

    // doors swing up in the showcase (menu and garage) and close for driving
    this.doorOpen = (this.doorOpen ?? 0) + ((this.doorTarget ?? 0) - (this.doorOpen ?? 0)) * Math.min(1, dt * 5);
    setDoors(hero, this.doorOpen);

    // thruster flames when airborne or transiting
    const burning = p.air || !!p.transit;
    const parts = hero.userData.parts;
    for (const f of parts.flames) {
      const target = burning ? 1 : 0;
      f.scale.z += (target - f.scale.z) * Math.min(1, dt * 14);
      if (f.scale.z < 0.01) f.scale.z = 0.01;
    }
    parts.flameMat.opacity += ((burning ? 0.75 : 0) - parts.flameMat.opacity) * Math.min(1, dt * 14);

    // underglow pulse on pad pickup and low battery warning
    this.padPulse = Math.max(0, this.padPulse - dt * 2.5);
    const warn = state.battery < 22 ? 0.5 + 0.5 * Math.sin(state.t * 10) : 0;
    parts.glow.material.opacity = 0.26 + this.padPulse * 0.5 + warn * 0.25;
    parts.glow.material.color.setHex(state.battery < 22 ? 0xff5a4a : this.liveryGlow);

    // contact shadow stays on the road below the car
    const h = pose.level === 1 || p.transit ? CEIL_Y : pose.y;
    this.shadowBlob.position.set(pose.x, 0.03, 0);
    this.shadowBlob.material.opacity = clamp(0.5 - h * 0.08, 0, 0.5) * (pose.level === 1 ? 0 : 1);
    const sc = 1 - clamp(h / 12, 0, 0.5);
    this.shadowBlob.scale.set(sc, 1, sc);

    // underglow follows the car, flipped on the ceiling
    parts.glow.visible = pose.level === 0 && !p.transit;
  }

  updateCamera(state, dt, pose, speedFrac) {
    const cam = this.camera;
    const onCeil = pose.level === 1 || (state.player.transit && state.player.transit.dir > 0);
    const target = onCeil ? 1 : 0;
    this.camBlend += (target - this.camBlend) * Math.min(1, dt * 4);
    const b = this.camBlend;

    const targetRoll = this.reducedMotion ? 0 : b * Math.PI;
    this.camRoll += (targetRoll - this.camRoll) * Math.min(1, dt * 8);

    this.fovKick *= Math.exp(-dt * 3.2);
    this.shake *= Math.exp(-dt * 6);

    const camX = pose.x * 0.65;
    const baseY = 3.2 + (CEIL_Y - 6.4) * b;
    const lookY = 1.2 + (CEIL_Y - 2.4) * b;
    let sx = 0;
    let sy = 0;
    if (this.shake > 0.002) {
      sx = (Math.random() - 0.5) * this.shake;
      sy = (Math.random() - 0.5) * this.shake;
    }
    const yUp = state.player.air || state.player.transit ? clamp(pose.y * 0.28, 0, 2.5) : 0;
    cam.position.set(camX + sx, baseY + sy + (onCeil ? 0 : yUp), 8.2);
    cam.up.set(Math.sin(-this.camRoll) * 1, Math.cos(this.camRoll), 0);
    cam.lookAt(pose.x * 0.8, lookY, -14);

    const fov = this.baseFov + speedFrac * 12 + this.fovKick;
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  updateWorld(state, dt, speedFrac) {
    const dist = state.dist;
    const cam = this.camera;

    this.sky.position.copy(cam.position);
    this.stars.position.copy(cam.position);
    this.sunDisc.position.set(cam.position.x * 0.2, this.cur.sunY + 6, -440);

    // the road plane's near end sits 60 m behind the car (rNear = -60); the pattern is world-locked
    this.roadTex.offset.y = (dist - 60) / TILE;

    const dummy = this.dummy;
    const edge = ROAD_W / 2;

    // posts
    let i = 0;
    const postGap = 6;
    const postBase = dist % postGap;
    for (let k = 0; k < 52; k++) {
      const z = -(k * postGap - postBase) + 10;
      for (const s of [-1, 1]) {
        dummy.position.set(s * (edge + 0.55), 0.45, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        this.posts.setMatrixAt(i++, dummy.matrix);
      }
    }
    this.posts.instanceMatrix.needsUpdate = true;

    // lamps
    const lampBase = dist % this.lampSpacing;
    i = 0;
    for (let k = 0; k < this.lampSlots; k++) {
      const z = -(k * this.lampSpacing - lampBase) + 12;
      for (const s of [-1, 1]) {
        dummy.position.set(s * (edge + 1.6), 3.5, z);
        dummy.scale.set(1, 1, 1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        this.poles.setMatrixAt(i, dummy.matrix);
        dummy.position.set(s * (edge + 0.9), 7.0, z);
        dummy.updateMatrix();
        this.lampHeads.setMatrixAt(i, dummy.matrix);
        i++;
      }
    }
    this.poles.instanceMatrix.needsUpdate = true;
    this.lampHeads.instanceMatrix.needsUpdate = true;

    // skyline
    const bldBase = dist % this.bldSpacing;
    const baseIndex = Math.floor(dist / this.bldSpacing);
    i = 0;
    for (let k = 0; k < this.bldSlots; k++) {
      const idx = baseIndex + k;
      const z = -(k * this.bldSpacing - bldBase) + 14;
      for (const s of [-1, 1]) {
        const hs = hash(idx * 2 + (s > 0 ? 1 : 0));
        const hs2 = hash(idx * 3.7 + (s > 0 ? 5 : 2));
        const width = 6 + hs * 10;
        const height = (6 + hs2 * 34) * this.cur.bldH;
        const off = edge + 10 + hs * 22;
        dummy.position.set(s * (off + width / 2), height / 2, z);
        dummy.scale.set(width, height, 7 + hs2 * 7);
        dummy.updateMatrix();
        this.buildings.setMatrixAt(i++, dummy.matrix);
      }
    }
    this.buildings.instanceMatrix.needsUpdate = true;

    // speed streaks
    const strVis = this.reducedMotion ? 0 : clamp((speedFrac - 0.25) * 1.2, 0, 0.7);
    this.streakMat.opacity = strVis;
    this.streaks.visible = strVis > 0.02;
    if (this.streaks.visible) {
      for (let k = 0; k < this.streakCount; k++) {
        const sd = this.streakSeed[k];
        const z = -(((sd.z - dist * 1.3) % 140) + 140) % 140;
        dummy.position.set(sd.x, sd.y, z + 8);
        dummy.scale.set(1, 1, 0.6 + speedFrac);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        this.streaks.setMatrixAt(k, dummy.matrix);
      }
      this.streaks.instanceMatrix.needsUpdate = true;
    }
  }

  updateEntities(state) {
    const dist = state.dist;
    const frame = this.frame;

    for (const e of state.vehicles) {
      const rel = e.z - dist;
      if (rel > 300 || rel < -25) continue;
      const mesh = this.vehicles.get(e.id) ?? this.vehicles.acquire(e);
      mesh.userData.seen = frame;
      mesh.position.set(e.x, e.level === 1 ? CEIL_Y : 0, -rel);
      mesh.rotation.set(0, e.vz < 0 ? Math.PI : 0, e.level === 1 ? Math.PI : 0);
    }
    for (const [id, mesh] of this.vehicles.active) {
      if (mesh.userData.seen !== frame) this.vehicles.release(id);
    }

    for (const pad of state.pads) {
      const rel = pad.z - dist;
      if (rel > 300 || rel < -20) continue;
      let mesh = this.pads.get(pad.id);
      if (!mesh) {
        mesh = this.padFree.pop() ?? createPadMesh();
        this.pads.set(pad.id, mesh);
        this.scene.add(mesh);
      }
      mesh.userData.seen = frame;
      mesh.position.set(pad.x, pad.level === 1 ? CEIL_Y : 0, -rel);
      mesh.rotation.z = pad.level === 1 ? Math.PI : 0;
      mesh.rotation.y = state.t * 1.5;
    }
    for (const [id, mesh] of this.pads) {
      if (mesh.userData.seen !== frame) {
        this.scene.remove(mesh);
        this.padFree.push(mesh);
        this.pads.delete(id);
      }
    }

    for (const r of state.ramps) {
      const rel = r.z - dist;
      if (rel > 300 || rel < -20) continue;
      let mesh = this.ramps.get(r.id);
      if (!mesh) {
        mesh = this.rampFree.pop() ?? createRampMesh();
        this.ramps.set(r.id, mesh);
        this.scene.add(mesh);
      }
      mesh.userData.seen = frame;
      mesh.position.set(r.x, 0, -rel);
    }
    for (const [id, mesh] of this.ramps) {
      if (mesh.userData.seen !== frame) {
        this.scene.remove(mesh);
        this.rampFree.push(mesh);
        this.ramps.delete(id);
      }
    }
  }

  updateTunnel(state) {
    const zone = state.zone;
    if (!zone) {
      this.tunnel.visible = false;
      return;
    }
    const dist = state.dist;
    const near = Math.max(zone.start - dist, -30);
    const far = Math.min(zone.end - dist, 300);
    if (far <= near) {
      this.tunnel.visible = false;
      return;
    }
    this.tunnel.visible = true;
    const len = far - near;
    const centre = -(near + far) / 2;
    this.ceil.scale.y = len;
    this.ceil.position.z = centre;
    this.ceilTex.repeat.set(1, len / TILE);
    this.ceilTex.offset.y = (dist + near) / TILE;
    for (const s of this.tunnelStrips) {
      s.scale.z = len;
      s.position.z = centre;
    }
    const startRel = zone.start - dist;
    const endRel = zone.end - dist;
    this.arches[0].visible = startRel > -30 && startRel < 300;
    this.arches[0].position.z = -startRel;
    this.arches[1].visible = endRel > -30 && endRel < 300;
    this.arches[1].position.z = -endRel;
  }

  updateEffects(state, dt, speedFrac) {
    // rain
    if (this.rain.visible && this.cur.rain > 0.02) {
      const pos = this.rain.geometry.attributes.position.array;
      const base = this.rainBase;
      const camX = this.camera.position.x;
      for (let i = 0; i < this.rainCount; i++) {
        let y = base[i * 3 + 1] - this.rainVel[i] * dt;
        let z = base[i * 3 + 2] + state.speed * dt;
        if (y < 0) y += 18;
        if (z > 10) z -= 130;
        base[i * 3 + 1] = y;
        base[i * 3 + 2] = z;
        const x = camX + base[i * 3];
        pos[i * 6] = x;
        pos[i * 6 + 1] = y;
        pos[i * 6 + 2] = z;
        pos[i * 6 + 3] = x;
        pos[i * 6 + 4] = y + 0.8;
        pos[i * 6 + 5] = z - 0.5 - speedFrac;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }

    // debris
    if (this.debrisActive) {
      const dummy = this.dummy;
      let alive = 0;
      this.debrisState.forEach((d, i) => {
        d.life -= dt;
        if (d.life > 0) {
          alive++;
          d.vy -= 20 * dt;
          d.x += d.vx * dt;
          d.y = Math.max(0.1, d.y + d.vy * dt);
          d.z += d.vz * dt;
          dummy.position.set(d.x, d.y, d.z);
          dummy.scale.setScalar(Math.max(0.1, d.life));
        } else {
          dummy.position.set(0, -50, 0);
        }
        dummy.rotation.set(d.life * 6, d.life * 4, 0);
        dummy.updateMatrix();
        this.debris.setMatrixAt(i, dummy.matrix);
      });
      this.debris.instanceMatrix.needsUpdate = true;
      if (!alive) {
        this.debrisActive = false;
        this.debris.visible = false;
      }
    }
  }

  trackPerformance(dt) {
    if (this.qualityMode !== 'auto' || this.tier === 'low') return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    if (avg > 0.024) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 1);
    if (this.slowFrames >= 2) {
      this.slowFrames = 0;
      this.tier = this.tier === 'high' ? 'medium' : 'low';
      this.applyQuality();
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** Menu / garage backdrop: a slowly scrolling road with the car turning in the foreground. */
  idleUpdate(dt, t, { garage = false } = {}) {
    this.frame++;
    this.trackPerformance(dt);
    this.idleDist = (this.idleDist ?? 0) + 14 * dt;
    const fake = this.idleState ?? (this.idleState = {
      dist: 0,
      speed: 26,
      t: 0,
      battery: 100,
      district: 0,
      vehicles: [],
      pads: [],
      ramps: [],
      zone: null,
      player: { lane: 2, x: laneX(2), air: false, transit: null },
      pose: { x: 0, y: 0, roll: 0, pitch: 0, level: 0 },
    });
    fake.dist = this.idleDist;
    fake.t = t;
    this.doorTarget = 1; // doors up while the car is on show
    fake.district = Math.floor(this.idleDist / 900) % PALETTES.length;
    if (this.paletteIndex !== fake.district) {
      this.paletteIndex = fake.district;
      this.setDistrict(fake.district);
    }
    this.applyPalette(Math.min(1, dt * 0.9));
    fake.player.x = laneX(2);
    this.updateHero(fake, dt, fake.pose, fake.player);
    this.updateWorld(fake, dt, 0.25);
    this.updateEntities(fake);
    this.updateTunnel(fake);
    this.updateEffects(fake, dt, 0.25);

    // showcase pose
    const hero = this.hero;
    hero.position.set(0, 0, 0);
    hero.rotation.set(0, Math.sin(t * 0.5) * 0.55 - 0.55, 0);
    this.shadowBlob.position.set(0, 0.03, 0);
    const cam = this.camera;
    const portrait = cam.aspect < 0.9;
    cam.position.set(portrait ? 2.6 : garage ? 4.2 : 3.8, portrait ? 1.7 : garage ? 1.5 : 1.9, portrait ? 9.8 : 6.8);
    cam.up.set(0, 1, 0);
    // portrait phones show a bottom-sheet menu, so aim low to keep the car in the upper third
    cam.lookAt(portrait ? 0 : -1.2, portrait ? -2.4 : 0.75, 0);
    const fov = portrait ? 52 : 44;
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    this.fovKick = 0;
    this.camBlend = 0;
    this.camRoll = 0;
  }

  dispose() {
    this.disposed = true;
    this.renderer.dispose();
  }
}
