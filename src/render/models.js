import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COLORS, LANE_W, VEHICLES } from '../config.js';

/**
 * Procedural, lightweight models (style: scifi + lowpoly). No external assets.
 * Every model is a THREE.Group (or a merged mesh) with named children and
 * gameplay metadata in userData.
 */

// ---------------------------------------------------------------- liveries
export const LIVERIES = [
  { id: 'midnight', name: 'Midnight Copper', body: 0x10204a, accent: 0xc77b3b, glow: 0x35e0ff, price: 0 },
  { id: 'aurora', name: 'Aurora Teal', body: 0x0c7a78, accent: 0xe8c07a, glow: 0x7dffe9, price: 150 },
  { id: 'ember', name: 'Ember', body: 0x8a1f1a, accent: 0xffb36b, glow: 0xff7a3a, price: 300 },
  { id: 'ghost', name: 'Ghost White', body: 0xdfe6ee, accent: 0x5d6b7a, glow: 0x9fd8ff, price: 450 },
  { id: 'violet', name: 'Ultraviolet', body: 0x3a1a78, accent: 0xff6ad5, glow: 0xc58bff, price: 650 },
  { id: 'solar', name: 'Solar Gold', body: 0xc9a21b, accent: 0x222222, glow: 0xfff0a0, price: 850 },
  { id: 'forest', name: 'Forest Night', body: 0x103a2a, accent: 0xa6e22e, glow: 0x7dff7a, price: 1100 },
  { id: 'carbon', name: 'Carbon Neon', body: 0x16181d, accent: 0x00f0ff, glow: 0xff2bd6, price: 1500 },
];

// ---------------------------------------------------------------- helpers
function colorize(geometry, color) {
  const c = new THREE.Color(color);
  const count = geometry.attributes.position.count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geometry;
}

function box(w, h, l, x, y, z, color) {
  const g = new THREE.BoxGeometry(w, h, l);
  g.translate(x, y, z);
  return colorize(g, color);
}

// ---------------------------------------------------------------- environment map
export function createEnvironment(renderer) {
  try {
    // Lazy import keeps the main bundle smaller if reflections are disabled.
    return import('three/examples/jsm/environments/RoomEnvironment.js').then(({ RoomEnvironment }) => {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const tex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
      return tex;
    });
  } catch {
    return Promise.resolve(null);
  }
}

let softTexture = null;
/** A white radial falloff used for the underglow and the contact shadow (no hard rectangle edges). */
function softBlobTexture() {
  if (softTexture) return softTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  softTexture = new THREE.CanvasTexture(c);
  return softTexture;
}

// ---------------------------------------------------------------- hero car
const profileToMesh = (shape, depth, bevel, material) => {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 3,
    curveSegments: 14,
  });
  geo.translate(0, 0, -depth / 2);
  geo.rotateY(Math.PI / 2); // length axis -> z, front -> -z
  return new THREE.Mesh(geo, material);
};

/**
 * The hero car: an original low teardrop-canopy electric hypercar.
 * Forward is -z. Origin sits at the wheel contact patch (y = 0).
 */
export function createHeroCar(envMap = null) {
  const group = new THREE.Group();
  group.name = 'heroCar';
  group.userData = { modelType: 'hero', style: 'scifi' };

  const bodyMat = new THREE.MeshStandardMaterial({
    color: LIVERIES[0].body,
    metalness: 0.65,
    roughness: 0.28,
    envMap,
    envMapIntensity: 1.1,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x05070d,
    metalness: 0.95,
    roughness: 0.08,
    envMap,
    envMapIntensity: 1.6,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: LIVERIES[0].accent,
    metalness: 0.8,
    roughness: 0.3,
    envMap,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0b0c10, metalness: 0.3, roughness: 0.7 });
  const glowMat = new THREE.MeshBasicMaterial({ color: LIVERIES[0].glow });
  const headMat = new THREE.MeshBasicMaterial({ color: 0xeaffff });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a3a });

  // lower body: low wedge with a pronounced rear
  const bodyShape = new THREE.Shape();
  bodyShape.moveTo(-2.2, 0.3);
  bodyShape.lineTo(2.05, 0.3);
  bodyShape.quadraticCurveTo(2.3, 0.3, 2.3, 0.42);
  bodyShape.bezierCurveTo(2.2, 0.55, 1.4, 0.62, 0.7, 0.72);
  bodyShape.lineTo(-1.2, 0.8);
  bodyShape.bezierCurveTo(-1.9, 0.86, -2.25, 0.82, -2.3, 0.62);
  bodyShape.lineTo(-2.3, 0.4);
  bodyShape.quadraticCurveTo(-2.3, 0.3, -2.2, 0.3);
  const body = profileToMesh(bodyShape, 1.5, 0.18, bodyMat);
  body.name = 'body';
  group.add(body);

  // teardrop canopy
  const canopyShape = new THREE.Shape();
  canopyShape.moveTo(0.8, 0.7);
  canopyShape.bezierCurveTo(0.45, 1.0, 0.2, 1.17, -0.2, 1.17);
  canopyShape.bezierCurveTo(-0.9, 1.17, -1.3, 0.97, -1.6, 0.78);
  canopyShape.lineTo(0.8, 0.7);
  const canopy = profileToMesh(canopyShape, 1.0, 0.14, glassMat);
  canopy.name = 'canopy';
  group.add(canopy);

  // copper side blades
  for (const s of [-1, 1]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 2.4), accentMat);
    blade.position.set(s * 0.95, 0.52, 0.15);
    blade.name = s < 0 ? 'bladeL' : 'bladeR';
    group.add(blade);
  }

  // vertical blade headlights + front strip
  for (const s of [-1, 1]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.2, 0.06), headMat);
    head.position.set(s * 0.72, 0.5, -2.46);
    head.rotation.x = -0.25;
    head.name = s < 0 ? 'headlightL' : 'headlightR';
    group.add(head);
  }
  const strip = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.03, 0.04), glowMat);
  strip.position.set(0, 0.4, -2.5);
  strip.name = 'frontStrip';
  group.add(strip);

  // triple-bar taillight
  const tails = new THREE.Group();
  tails.name = 'taillights';
  for (let i = 0; i < 3; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.45 - i * 0.12, 0.04, 0.05), tailMat);
    bar.position.set(0, 0.66 - i * 0.075, 2.5);
    tails.add(bar);
  }
  group.add(tails);

  // rear diffuser + active wing blade
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.3), darkMat);
  diffuser.position.set(0, 0.32, 2.45);
  group.add(diffuser);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 0.38), accentMat);
  wing.position.set(0, 0.93, 2.28);
  wing.name = 'wing';
  group.add(wing);
  for (const s of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.06), darkMat);
    strut.position.set(s * 0.45, 0.83, 2.28);
    group.add(strut);
  }

  // wheels
  const wheelGeo = new THREE.CylinderGeometry(0.37, 0.37, 0.3, 18);
  wheelGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.32, 8);
  rimGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const [sx, sz, name] of [
    [-1, -1.45, 'wheelFL'],
    [1, -1.45, 'wheelFR'],
    [-1, 1.4, 'wheelRL'],
    [1, 1.4, 'wheelRR'],
  ]) {
    const w = new THREE.Group();
    w.name = name;
    w.add(new THREE.Mesh(wheelGeo, darkMat));
    w.add(new THREE.Mesh(rimGeo, accentMat));
    w.position.set(sx * 0.9, 0.37, sz);
    group.add(w);
    wheels.push(w);
  }

  // thruster nozzles + flames
  const nozzleGeo = new THREE.ConeGeometry(0.13, 0.32, 12, 1, true);
  nozzleGeo.rotateX(-Math.PI / 2); // opens toward +z
  const flameGeo = new THREE.ConeGeometry(0.11, 1.6, 10, 1, true);
  flameGeo.rotateX(Math.PI / 2); // wide base at the nozzle, tip trailing behind the car (+z)
  flameGeo.translate(0, 0, 0.8);
  const flameMat = new THREE.MeshBasicMaterial({
    color: LIVERIES[0].glow,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const flames = [];
  for (const s of [-1, 1]) {
    const nozzle = new THREE.Mesh(nozzleGeo, accentMat);
    nozzle.position.set(s * 0.5, 0.5, 2.38);
    nozzle.name = s < 0 ? 'nozzleL' : 'nozzleR';
    group.add(nozzle);
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(s * 0.5, 0.5, 2.55);
    flame.name = s < 0 ? 'flameL' : 'flameR';
    flame.scale.set(1, 1, 0.01);
    group.add(flame);
    flames.push(flame);
  }

  // underglow + contact shadow blob
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 6.8),
    new THREE.MeshBasicMaterial({
      map: softBlobTexture(),
      color: LIVERIES[0].glow,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.04;
  glow.name = 'underglow';
  group.add(glow);

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.0, 6.0),
    new THREE.MeshBasicMaterial({ map: softBlobTexture(), color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  shadow.name = 'shadow';
  group.add(shadow);

  group.userData.parts = { bodyMat, accentMat, glowMat, flameMat, glow, shadow, wheels, flames, tails };
  return group;
}

export function applyLivery(car, livery) {
  const { bodyMat, accentMat, glowMat, flameMat, glow } = car.userData.parts;
  bodyMat.color.setHex(livery.body);
  accentMat.color.setHex(livery.accent);
  glowMat.color.setHex(livery.glow);
  flameMat.color.setHex(livery.glow);
  glow.material.color.setHex(livery.glow);
}

// ---------------------------------------------------------------- traffic
const GLASS = 0x0d1118;
const TAIL = 0xff2b2b;
const HEAD = 0xfff3c4;
const TYRE = 0x0a0a0a;

function wheelSet(w, l, r = 0.34) {
  const parts = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(0.22, r * 2, r * 2, sx * (w / 2 - 0.05), r, sz * (l / 2 - 0.9), TYRE));
  return parts;
}

function lights(w, l, y) {
  return [
    box(0.36, 0.14, 0.06, -w / 2 + 0.3, y, l / 2 + 0.01, TAIL),
    box(0.36, 0.14, 0.06, w / 2 - 0.3, y, l / 2 + 0.01, TAIL),
    box(0.3, 0.14, 0.06, -w / 2 + 0.3, y, -l / 2 - 0.01, HEAD),
    box(0.3, 0.14, 0.06, w / 2 - 0.3, y, -l / 2 - 0.01, HEAD),
  ];
}

const BUILDERS = {
  sedan: (c) => [
    box(1.8, 0.55, 4.4, 0, 0.62, 0, c),
    box(1.5, 0.5, 2.2, 0, 1.15, 0.2, GLASS),
    box(1.46, 0.08, 2.0, 0, 1.43, 0.2, c),
    ...lights(1.8, 4.4, 0.7),
    ...wheelSet(1.8, 4.4),
  ],
  suv: (c) => [
    box(2.0, 0.85, 4.7, 0, 0.8, 0, c),
    box(1.8, 0.6, 3.3, 0, 1.52, 0.35, GLASS),
    box(1.76, 0.08, 3.1, 0, 1.85, 0.35, c),
    ...lights(2.0, 4.7, 0.9),
    ...wheelSet(2.0, 4.7, 0.38),
  ],
  van: (c) => [
    box(2.0, 1.7, 5.2, 0, 1.2, 0, c),
    box(1.9, 0.5, 0.1, 0, 1.75, -2.55, GLASS),
    box(1.9, 0.5, 0.1, 0, 1.75, 2.55, GLASS),
    ...lights(2.0, 5.2, 0.8),
    ...wheelSet(2.0, 5.2, 0.38),
  ],
  truck: (c) => [
    box(2.5, 2.4, 2.6, 0, 1.55, -3.2, c),
    box(2.3, 0.8, 0.08, 0, 2.1, -4.52, GLASS),
    box(2.5, 3.0, 6.2, 0, 2.0, 1.4, 0xd7dde6),
    box(2.52, 0.25, 6.2, 0, 0.55, 1.4, 0x20242b),
    ...lights(2.5, 9.0, 0.8),
    ...wheelSet(2.5, 9.0, 0.5),
  ],
  bus: (c) => [
    box(2.5, 2.6, 11, 0, 1.75, 0, c),
    box(2.52, 0.8, 9.6, 0, 2.2, 0, GLASS),
    box(2.3, 0.9, 0.08, 0, 2.1, -5.52, GLASS),
    ...lights(2.5, 11, 0.8),
    ...wheelSet(2.5, 11, 0.5),
  ],
  bike: (c) => [
    box(0.35, 0.5, 1.7, 0, 0.55, 0, c),
    box(0.5, 0.55, 0.4, 0, 1.0, 0.1, 0x1d2430),
    box(0.3, 0.3, 0.3, 0, 1.45, 0.05, GLASS),
    box(0.12, 0.6, 0.6, 0, 0.3, -0.7, TYRE),
    box(0.12, 0.6, 0.6, 0, 0.3, 0.75, TYRE),
    box(0.2, 0.1, 0.05, 0, 0.8, 0.88, TAIL),
    box(0.2, 0.1, 0.05, 0, 0.8, -0.88, HEAD),
  ],
  // a road-works barrier on a slow trailer, so it travels with the traffic like everything else
  barrier: () => [
    box(2.2, 0.5, 1.0, 0, 0.5, 0, 0xf2f2f2),
    box(2.2, 0.5, 1.0, 0, 1.0, 0, 0xff7a00),
    box(0.15, 1.0, 0.15, -1.0, 0.75, 0, 0x333333),
    box(0.15, 1.0, 0.15, 1.0, 0.75, 0, 0x333333),
    box(0.2, 0.5, 0.5, -1.0, 0.25, 0, TYRE),
    box(0.2, 0.5, 0.5, 1.0, 0.25, 0, TYRE),
    box(0.3, 0.12, 0.05, -0.6, 0.62, 0.52, TAIL),
    box(0.3, 0.12, 0.05, 0.6, 0.62, 0.52, TAIL),
  ],
};

const geometryCache = new Map();

export function vehicleGeometry(type, colorIndex) {
  const key = `${type}:${colorIndex}`;
  let geo = geometryCache.get(key);
  if (!geo) {
    const hex = type === 'truck' || type === 'bus' ? [0x2f6fed, 0xe69f00, 0x2a9d8f, 0xd55e00, 0x6c757d, 0xcc79a7, 0xf0e442][colorIndex % 7] : COLORS.traffic[colorIndex % COLORS.traffic.length];
    geo = mergeGeometries(BUILDERS[type](hex));
    geo.computeBoundingSphere();
    geometryCache.set(key, geo);
  }
  return geo;
}

/** Shared material for all traffic: vertex colours carry the livery. */
export const trafficMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });

export class VehiclePool {
  constructor(scene) {
    this.scene = scene;
    this.free = new Map();
    this.active = new Map(); // id -> mesh
  }

  acquire(e) {
    const key = `${e.type}:${e.color}`;
    let list = this.free.get(key);
    let mesh = list?.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(vehicleGeometry(e.type, e.color), trafficMaterial);
      mesh.userData.key = key;
      mesh.matrixAutoUpdate = true;
    }
    mesh.visible = true;
    this.scene.add(mesh);
    this.active.set(e.id, mesh);
    return mesh;
  }

  release(id) {
    const mesh = this.active.get(id);
    if (!mesh) return;
    this.active.delete(id);
    this.scene.remove(mesh);
    const list = this.free.get(mesh.userData.key) ?? [];
    list.push(mesh);
    this.free.set(mesh.userData.key, list);
  }

  get(id) {
    return this.active.get(id);
  }
}

// ---------------------------------------------------------------- charge pad and ramp
export function createPadMesh() {
  const g = new THREE.Group();
  g.name = 'chargePad';
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.1, 0.12, 8, 28),
    new THREE.MeshBasicMaterial({ color: 0x35ffb0 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.12;
  g.add(ring);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(1.0, 24),
    new THREE.MeshBasicMaterial({ color: 0x35ffb0, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.06;
  g.add(disc);
  // bolt glyph: two thin slanted bars
  const boltMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.9), boltMat);
  b1.rotation.y = 0.5;
  b1.position.set(0.12, 0.16, -0.15);
  g.add(b1);
  const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.7), boltMat);
  b2.rotation.y = 0.5;
  b2.position.set(-0.12, 0.16, 0.25);
  g.add(b2);
  g.userData = { modelType: 'prop', style: 'scifi' };
  return g;
}

export function createRampMesh() {
  const w = LANE_W * 0.9;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(6, 0);
  shape.lineTo(6, 1.1);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  geo.translate(-3, 0, -w / 2);
  geo.rotateY(Math.PI / 2); // slope rises toward -z? keep high end ahead of the car
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0x2a3140, metalness: 0.5, roughness: 0.5, emissive: 0x0b4f66, emissiveIntensity: 0.9 }),
  );
  mesh.name = 'ramp';
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(w, 0.04, 0.15),
    new THREE.MeshBasicMaterial({ color: 0x35e0ff }),
  );
  stripe.position.set(0, 1.12, -2.9);
  mesh.add(stripe);
  mesh.userData = { modelType: 'prop', style: 'scifi', hitW: VEHICLES.barrier.w };
  return mesh;
}
