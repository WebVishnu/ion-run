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
  { id: 'glacier', name: 'Glacier Silver', body: 0xc3c8d0, accent: 0xe3b04b, glow: 0xff6a3d, price: 0 },
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
/**
 * Image-based lighting for a night highway, built once from a tiny scene: a dusk gradient dome plus bright
 * strip "softboxes" (street lamps and tunnel lights). The car's clearcoat then reflects warm horizon light
 * and long lamp streaks instead of a generic studio.
 */
export function createEnvironment(renderer) {
  try {
    const scene = new THREE.Scene();
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(50, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          top: { value: new THREE.Color(0x1a2a52) },
          mid: { value: new THREE.Color(0x4a4870) },
          horizon: { value: new THREE.Color(0xd49a82) },
          ground: { value: new THREE.Color(0x10131c) },
        },
        vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader:
          'uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 ground; varying float h;' +
          'void main(){ vec3 c = h > 0.0 ? mix(horizon, mix(mid, top, smoothstep(0.15, 0.9, h)), smoothstep(0.0, 0.35, h)) : mix(horizon * 0.25, ground, smoothstep(0.0, -0.4, h)); gl_FragColor = vec4(c, 1.0); }',
      }),
    );
    scene.add(dome);
    const bright = (c, k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k) });
    const strip = (w, h, d, x, y, z, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      scene.add(m);
    };
    // overhead light bars (long reflections along the roof and bonnet) and low side lamps
    const warm = bright(0xfff0d8, 8);
    const cool = bright(0xcfeaff, 9);
    strip(3, 0.3, 26, 0, 18, 0, warm);
    strip(2, 0.3, 20, -9, 14, -6, cool);
    strip(2, 0.3, 20, 9, 14, 6, cool);
    for (let i = 0; i < 6; i++) {
      strip(0.6, 0.6, 0.6, -14, 5, -30 + i * 12, warm);
      strip(0.6, 0.6, 0.6, 14, 5, -30 + i * 12, warm);
    }
    strip(10, 3, 0.5, 0, 4, -40, bright(0xff8a5c, 5)); // the sunset behind the horizon
    const pmrem = new THREE.PMREMGenerator(renderer);
    const tex = pmrem.fromScene(scene, 0.02).texture;
    pmrem.dispose();
    return Promise.resolve(tex);
  } catch {
    return Promise.resolve(null);
  }
}

let softTexture = null;
/** A white radial falloff used for the underglow, contact shadow and lamp light pools (no hard edges). */
export function softBlobTexture() {
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
/** Flat-shaded copy of a geometry, for the sharp, faceted look. */
const flat = (geometry) => {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.computeVertexNormals();
  return g;
};

/** Extrudes a side-profile polygon (x = length, +x is the front) across `width`. Forward ends up at -z. */
function profileMesh(points, width, material) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  geo.translate(0, 0, -width / 2);
  geo.rotateY(Math.PI / 2);
  return new THREE.Mesh(flat(geo), material);
}

/**
 * The hero car: an original angular electric hypercar. Silver wedge body over a black sill, upward-opening
 * doors, a tall swan-neck wing with a light strip, a full-width tail light, four thruster nozzles and
 * five-spoke wheels. Forward is -z; the origin sits at the wheel contact patch (y = 0).
 */
export function createHeroCar(envMap = null) {
  const group = new THREE.Group();
  group.name = 'heroCar';
  group.userData = { modelType: 'hero', style: 'scifi' };

  // car paint: a metallic base under a glossy clearcoat, so reflections have a sharp lacquer layer on top
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: LIVERIES[0].body,
    metalness: 0.7,
    roughness: 0.38,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMap,
    envMapIntensity: 1.25,
  });
  // dark tinted glass: very smooth, with its own clearcoat for the bright window reflections
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x03050a, metalness: 0.0, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.0, envMap, envMapIntensity: 1.8 });
  const accentMat = new THREE.MeshStandardMaterial({ color: LIVERIES[0].accent, metalness: 0.9, roughness: 0.25, envMap });
  const carbonMat = new THREE.MeshStandardMaterial({ color: 0x0d0f14, metalness: 0.4, roughness: 0.5, envMap, envMapIntensity: 0.6 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x2a2d34, metalness: 0.85, roughness: 0.32, envMap });
  // lights are HDR (values above 1) so the bloom pass makes them glow
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(LIVERIES[0].glow).multiplyScalar(2) });
  const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xf2fbff).multiplyScalar(4) });
  const tailMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2a3a).multiplyScalar(3.2) });

  // upper shell: low nose, flat hood, and a deck that rises toward the tail
  const shell = profileMesh(
    [[-2.3, 0.4], [2.2, 0.4], [2.42, 0.5], [2.3, 0.6], [1.0, 0.74], [0.55, 0.8], [-1.0, 0.9], [-2.05, 0.96], [-2.3, 0.9]],
    1.9,
    bodyMat,
  );
  shell.name = 'body';
  group.add(shell);

  // dark greenhouse with a raked windscreen, topped by a thin body-coloured roof
  const canopy = profileMesh([[0.78, 0.74], [0.12, 1.14], [-1.0, 1.09], [-1.7, 0.92], [-1.7, 0.8]], 1.55, glassMat);
  canopy.name = 'canopy';
  group.add(canopy);
  const roof = profileMesh([[0.1, 1.145], [-1.0, 1.095], [-1.0, 1.06], [0.1, 1.11]], 1.5, bodyMat);
  roof.name = 'roof';
  group.add(roof);

  // black sill, front splitter, rear diffuser
  const sill = new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.16, 4.5), carbonMat);
  sill.position.set(0, 0.32, 0);
  group.add(sill);
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.04, 0.55), carbonMat);
  splitter.position.set(0, 0.29, -2.35);
  group.add(splitter);
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.3, 0.4), carbonMat);
  diffuser.position.set(0, 0.45, 2.3);
  group.add(diffuser);

  // upward-opening doors: panels hinged at the roof line, swung up by setDoors()
  const doors = [];
  for (const s of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.name = s < 0 ? 'doorL' : 'doorR';
    hinge.position.set(s * 0.955, 0.86, -0.15);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 1.55), bodyMat);
    panel.position.y = -0.27;
    hinge.add(panel);
    group.add(hinge);
    doors.push(hinge);
  }

  // gold side pegs, like small cold-gas thrusters on the sill
  for (const s of [-1, 1]) {
    for (const z of [-0.6, 0.55]) {
      const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 8), accentMat);
      peg.position.set(s * 1.02, 0.23, z);
      group.add(peg);
    }
  }

  // nose: slim headlights and a full-width light strip
  for (const s of [-1, 1]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.05), headMat);
    head.position.set(s * 0.62, 0.57, -2.4);
    head.rotation.z = s * 0.08;
    head.name = s < 0 ? 'headlightL' : 'headlightR';
    group.add(head);
  }
  const strip = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.025, 0.04), glowMat);
  strip.position.set(0, 0.45, -2.42);
  strip.name = 'frontStrip';
  group.add(strip);

  // tail: two full-width red bars
  const tails = new THREE.Group();
  tails.name = 'taillights';
  for (const [w, y] of [[1.7, 0.82], [1.45, 0.72]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.045, 0.04), tailMat);
    bar.position.set(0, y, 2.34);
    tails.add(bar);
  }
  group.add(tails);

  // tall swan-neck wing with end plates and a red light strip
  const wingGroup = new THREE.Group();
  wingGroup.name = 'wing';
  const plane = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.05, 0.58), carbonMat);
  plane.position.set(0, 1.26, 2.15);
  plane.rotation.x = 0.1;
  wingGroup.add(plane);
  for (const s of [-1, 1]) {
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.36, 0.14), carbonMat);
    pylon.position.set(s * 0.5, 1.1, 2.0);
    wingGroup.add(pylon);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.24, 0.64), carbonMat);
    plate.position.set(s * 0.97, 1.22, 2.15);
    wingGroup.add(plate);
  }
  const wingLight = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.035, 0.04), tailMat);
  wingLight.position.set(0, 1.235, 2.44);
  wingGroup.add(wingLight);
  group.add(wingGroup);

  // wheels: dark tyre, brake disc, five star spokes and a gold hub
  const tyreGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.32, 22);
  tyreGeo.rotateZ(Math.PI / 2);
  const discGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.33, 18);
  discGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.36, 10);
  hubGeo.rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.06, 0.34, 0.075);
  spokeGeo.translate(0, 0.17, 0);
  const wheels = [];
  for (const [sx, sz, name] of [[-1, -1.5, 'wheelFL'], [1, -1.5, 'wheelFR'], [-1, 1.45, 'wheelRL'], [1, 1.45, 'wheelRR']]) {
    const w = new THREE.Group();
    w.name = name;
    const spin = new THREE.Group(); // only this part rotates when driving
    spin.add(new THREE.Mesh(tyreGeo, carbonMat));
    spin.add(new THREE.Mesh(discGeo, wheelMat));
    for (let i = 0; i < 5; i++) {
      const spoke = new THREE.Mesh(spokeGeo, wheelMat);
      spoke.position.x = sx * 0.165;
      spoke.rotation.x = (i / 5) * Math.PI * 2;
      spin.add(spoke);
    }
    const hub = new THREE.Mesh(hubGeo, accentMat);
    spin.add(hub);
    w.add(spin);
    w.userData.spin = spin;
    w.position.set(sx * 0.93, 0.4, sz);
    group.add(w);
    wheels.push(w);
  }

  // four thruster nozzles on the diffuser, each with a flame
  const nozzleGeo = new THREE.CylinderGeometry(0.075, 0.095, 0.2, 12, 1, true);
  nozzleGeo.rotateX(Math.PI / 2);
  const ringGeo = new THREE.TorusGeometry(0.085, 0.014, 6, 14);
  const flameGeo = new THREE.ConeGeometry(0.075, 1.2, 10, 1, true);
  flameGeo.rotateX(Math.PI / 2); // wide base at the nozzle, tip trailing behind (+z)
  flameGeo.translate(0, 0, 0.6);
  const flameMat = new THREE.MeshBasicMaterial({
    color: LIVERIES[0].glow,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const flames = [];
  [-0.66, -0.22, 0.22, 0.66].forEach((x, i) => {
    const nozzle = new THREE.Mesh(nozzleGeo, carbonMat);
    nozzle.position.set(x, 0.42, 2.46);
    nozzle.name = `nozzle${i}`;
    group.add(nozzle);
    const ring = new THREE.Mesh(ringGeo, glowMat);
    ring.position.set(x, 0.42, 2.57);
    group.add(ring);
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(x, 0.42, 2.56);
    flame.name = `flame${i}`;
    flame.scale.set(1, 1, 0.01);
    group.add(flame);
    flames.push(flame);
  });

  // soft underglow and a contact shadow that the view keeps on the road
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 6.8),
    new THREE.MeshBasicMaterial({ map: softBlobTexture(), color: LIVERIES[0].glow, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }),
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

  group.userData.parts = { bodyMat, accentMat, glowMat, flameMat, glow, shadow, wheels, flames, doors, tails };
  return group;
}

/** Swings both doors up (1) or closes them (0). */
export function setDoors(car, amount) {
  const [left, right] = car.userData.parts.doors;
  const a = amount * 1.2;
  left.rotation.z = -a;
  right.rotation.z = a;
}

export function applyLivery(car, livery) {
  const { bodyMat, accentMat, glowMat, flameMat, glow } = car.userData.parts;
  bodyMat.color.setHex(livery.body);
  accentMat.color.setHex(livery.accent);
  glowMat.color.setHex(livery.glow).multiplyScalar(2);
  flameMat.color.setHex(livery.glow).multiplyScalar(1.6);
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

/**
 * Shared material for all traffic: vertex colours carry the livery. A small shader tweak makes the bright
 * red tail lights and pale headlights self-lit (HDR), so they glow under the bloom pass at night.
 */
export const trafficMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
trafficMaterial.onBeforeCompile = (shader) => {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <emissivemap_fragment>',
    `#include <emissivemap_fragment>
    #ifdef USE_COLOR
      float tailMask = step(0.9, vColor.r) * step(vColor.g, 0.3) * step(vColor.b, 0.3);
      float headMask = step(0.9, min(vColor.r, vColor.g)) * step(0.55, vColor.b);
      totalEmissiveRadiance += vColor * (tailMask * 3.0 + headMask * 3.5);
    #endif`,
  );
};

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
    mesh.castShadow = true;
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
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0x35ffb0).multiplyScalar(2.2) }),
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
