/* naka-ai real-time 3D shop: the chosen plush Naka artwork on a 2.5D relief connects one product to
   four selling workflows. Driven by window.nakaSceneState, which
   journey.js keeps in sync with the scroll chapter and pointer. */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildNakaRelief } from './naka-reference-relief.js';

const host = document.getElementById('world-3d');
const state = window.nakaSceneState || (window.nakaSceneState = { chapter: 0, pointer: 0, paused: false });
const compact = matchMedia('(max-width: 760px)');
const lowPower = compact.matches || (navigator.hardwareConcurrency || 8) <= 4;

const SERVICES = ['sales', 'drama', 'bot', 'live'];
// Background, fog and accent light per chapter (00 intro, then the four services).
const MOODS = [
  { bg: 0x060d24, key: 0x9cc4ff, rim: 0x2f6bff },
  { bg: 0x08163a, key: 0xb6d4ff, rim: 0x2f7bff },
  { bg: 0x061a2e, key: 0xa8f0ff, rim: 0x1aa6d8 },
  { bg: 0x0b1036, key: 0xc2c8ff, rim: 0x5a63ff },
  { bg: 0x140d38, key: 0xe0c8ff, rim: 0x8a4fff }
];

let renderer, scene, camera, clock;
let naga, cardRing, cards = [], streams = [], orbitRings = [], sparkles, stars, keyLight, rimLight;
const smooth = { ring: 0, camAz: 0, camDist: 8.6, camY: 2.5, tgtY: 1.55, bg: new THREE.Color(MOODS[0].bg) };
let visible = true, running = false, time = 0, lastChapter = -1, frameCount = 0;

function fail(reason) {
  console.warn('[naka-3d] falling back to poster:', reason);
  document.body.classList.remove('three-ready');
  host?.remove();
}

/* ------------------------------------------------------------ materials */
function materials() {
  return {
    white: new THREE.MeshStandardMaterial({ color: 0xf6f4ee, roughness: .88, metalness: 0, envMapIntensity: .18 }),
    cobalt: new THREE.MeshStandardMaterial({ color: 0x426fbd, roughness: .82, metalness: 0, emissive: 0x10295d, emissiveIntensity: .045 }),
    cyan: new THREE.MeshBasicMaterial({ color: 0xb5daec }),
    blueGlow: new THREE.MeshBasicMaterial({ color: 0x739bd0 }),
    podium: new THREE.MeshStandardMaterial({ color: 0xe9e7e2, roughness: .96, metalness: 0, envMapIntensity: .12 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xb7c2d1, metalness: .16, roughness: .67 })
  };
}


// The chosen plush artwork is mapped to the relief in naka-reference-relief.js.

/* ------------------------------------------------------------ podium & props */
function buildStage(M) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.85, .28, 96), M.podium);
  base.position.y = .14; base.receiveShadow = true; base.castShadow = true;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(2.88, 2.88, .07, 96, 1, true), M.cobalt);
  band.position.y = .05;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(2.7, .018, 12, 160), M.cyan);
  lip.rotation.x = Math.PI / 2; lip.position.y = .285;
  const under = new THREE.Mesh(new THREE.CylinderGeometry(2.95, 3.1, .12, 96), M.cobalt);
  under.position.y = -.02;
  g.add(base, band, lip, under);

  // Product pedestal with the seller's product (a generic bottle).
  const ped = new THREE.Group();
  ped.position.set(1.45, .28, 1.05);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(.62, .66, .42, 64), M.podium);
  col.position.y = .21; col.castShadow = true; col.receiveShadow = true;
  const top = new THREE.Mesh(new THREE.TorusGeometry(.6, .02, 12, 96), M.cyan);
  top.rotation.x = Math.PI / 2; top.position.y = .43;
  ped.add(col, top);
  const profile = [[0, 0], [.2, 0], [.22, .02], [.22, .5], [.2, .56], [.11, .62], [.1, .7]].map(([x, y]) => new THREE.Vector2(x, y));
  const bottle = new THREE.Mesh(new THREE.LatheGeometry(profile, 48), M.white);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(.115, .115, .16, 40), M.chrome);
  cap.position.y = .78;
  const label = new THREE.Mesh(new THREE.CylinderGeometry(.224, .224, .14, 48, 1, true), M.cobalt);
  label.position.y = .26;
  const product = new THREE.Group();
  product.add(bottle, cap, label);
  product.position.y = .44; product.traverse(o => { o.castShadow = true; });
  ped.add(product);
  for (let i = 0; i < 2; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.48 + i * .14, .006, 8, 120), M.cyan);
    ring.position.y = .85 + i * .12; ring.rotation.x = Math.PI / 2 + (i ? .25 : -.2);
    orbitRings.push(ring); ped.add(ring);
  }
  g.add(ped);

  // Parcels ready to ship.
  const tape = M.cobalt;
  [[-1.55, .5, 1.35, .62, .2], [-.8, .42, 1.75, .5, -.25], [-.2, .34, 2.05, .4, .1]].forEach(([x, s, z, h, ry]) => {
    const box = new THREE.Group();
    const b = new THREE.Mesh(new RoundedBoxGeometry(s * 1.25, h, s, 3, .03), M.white);
    const t1 = new THREE.Mesh(new THREE.BoxGeometry(s * .2, h * 1.005, s * 1.01), tape);
    const t2 = new THREE.Mesh(new THREE.BoxGeometry(s * 1.26, .012, s * .2), tape);
    t2.position.y = h / 2;
    box.add(b, t1, t2);
    box.position.set(x, .28 + h / 2, z); box.rotation.y = ry;
    box.traverse(o => { o.castShadow = true; o.receiveShadow = true; });
    g.add(box);
  });
  return { stage: g, productTop: new THREE.Vector3(1.45, 1.45, 1.05) };
}

/* ------------------------------------------------------------ service cards */
function buildCards() {
  const ring = new THREE.Group();
  const art = window.NakaCardArt;
  SERVICES.forEach((key, i) => {
    const canvas = document.createElement('canvas');
    canvas.width = 2048; canvas.height = 1280;
    art.draw(canvas, key);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const w = 1.7, h = 1.06;
    const card = new THREE.Group();
    const glass = new THREE.Mesh(new RoundedBoxGeometry(w + .06, h + .06, .05, 4, .05),
      new THREE.MeshStandardMaterial({ color: 0xdce9f8, roughness: .86, metalness: 0, transparent: true, opacity: .48 }));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
    face.position.z = .03;
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(w + .5, h + .5), new THREE.MeshBasicMaterial({ map: haloTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0x93afd8, opacity: .14 }));
    edge.position.z = -.04;
    card.add(edge, glass, face);
    card.userData = { key, index: i, canvas, tex, face, edge, glass, angle: i / SERVICES.length * Math.PI * 2, focus: 0, alpha: 1, bob: Math.random() * 6 };
    cards.push(card); ring.add(card);
  });
  art.fontReady().then(() => cards.forEach(c => { art.draw(c.userData.canvas, c.userData.key); c.userData.tex.needsUpdate = true; }));
  return ring;
}

let halo;
function haloTexture() {
  if (halo) return halo;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 10, 64, 64, 64);
  g.addColorStop(0, '#ffffff'); g.addColorStop(.5, '#ffffff66'); g.addColorStop(1, '#ffffff00');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  halo = new THREE.CanvasTexture(c);
  return halo;
}

// Flowing energy from the product to each card (dashes travel along uv.x).
function streamMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    uniforms: { uTime: { value: 0 }, uStrength: { value: .4 }, uColor: { value: new THREE.Color(0x7ff0ff) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: `varying vec2 vUv; uniform float uTime; uniform float uStrength; uniform vec3 uColor;
      void main(){
        float dash = smoothstep(.55, 1., sin((vUv.x * 18. - uTime * 3.2)));
        float ends = smoothstep(0., .08, vUv.x) * smoothstep(1., .85, vUv.x);
        float a = (dash * .9 + .12) * ends * uStrength;
        gl_FragColor = vec4(uColor * (1.4 + dash * 1.6), a);
      }`
  });
}

/* ------------------------------------------------------------ atmosphere */
function dotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, '#ffffff'); g.addColorStop(.25, '#ffffffcc'); g.addColorStop(1, '#ffffff00');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function buildAtmosphere() {
  const dot = dotTexture();
  const starGeo = new THREE.BufferGeometry(), sp = [];
  for (let i = 0; i < (lowPower ? 60 : 160); i++) {
    const r = 28 + Math.random() * 30, th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 1.6 - .6);
    sp.push(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) + 4, r * Math.sin(ph) * Math.sin(th) - 8);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: .09, map: dot, transparent: true, depthWrite: false, color: 0xcfe0ff, opacity: .3, fog: false }));

  const n = lowPower ? 16 : 36, sparkGeo = new THREE.BufferGeometry(), p = [], seed = [];
  for (let i = 0; i < n; i++) {
    const r = 1 + Math.random() * 4.5, a = Math.random() * Math.PI * 2;
    p.push(Math.cos(a) * r, Math.random() * 5, Math.sin(a) * r); seed.push(Math.random());
  }
  sparkGeo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  sparkGeo.setAttribute('seed', new THREE.Float32BufferAttribute(seed, 1));
  sparkles = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ size: .07, map: dot, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(0x9fe8ff).multiplyScalar(1.6), toneMapped: false }));

  // Glossy night floor that fades into fog.
  const fc = document.createElement('canvas'); fc.width = fc.height = 512;
  const fx = fc.getContext('2d'), fg = fx.createRadialGradient(256, 256, 20, 256, 256, 256);
  fg.addColorStop(0, '#1d3f9a'); fg.addColorStop(.25, '#112658'); fg.addColorStop(.6, '#0a1538'); fg.addColorStop(1, '#0a153800');
  fx.fillStyle = fg; fx.fillRect(0, 0, 512, 512);
  const floorTex = new THREE.CanvasTexture(fc); floorTex.colorSpace = THREE.SRGBColorSpace;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 64), new THREE.MeshStandardMaterial({ map: floorTex, transparent: true, roughness: .98, metalness: 0 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.08; floor.receiveShadow = true;
  const shadowCatcher = new THREE.Mesh(new THREE.CircleGeometry(6, 48), new THREE.ShadowMaterial({ opacity: .35 }));
  shadowCatcher.rotation.x = -Math.PI / 2; shadowCatcher.position.y = -.07; shadowCatcher.receiveShadow = true;
  return [stars, sparkles, floor, shadowCatcher];
}

/* ------------------------------------------------------------ setup */
async function init() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL2 unavailable');
  renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true, alpha: true });
  // Render at the screen's full density (capped at 2) so edges and card text stay sharp.
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.shadowMap.enabled = !lowPower;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); running = false; fail('context lost'); });

  scene = new THREE.Scene();
  renderer.setClearColor(0x060d24, 0);
  scene.fog = new THREE.FogExp2(MOODS[0].bg, .012);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
  scene.environmentIntensity = .22;

  camera = new THREE.PerspectiveCamera(32, 1, .1, 120);
  clock = new THREE.Clock();

  scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x0a1640, .35));
  keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
  keyLight.position.set(3.5, 7, 5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  Object.assign(keyLight.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 });
  keyLight.shadow.bias = -.0005; keyLight.shadow.radius = 4;
  rimLight = new THREE.PointLight(MOODS[0].rim, 6, 14, 2);
  rimLight.position.set(-3, 3.5, -3);
  const under = new THREE.PointLight(0x3f86ff, .75, 4, 2);
  // Soft fill from the viewer so the ceramic reads white rather than grey.
  const fill = new THREE.DirectionalLight(0xdfe9ff, .7);
  fill.position.set(0, 2, 10);
  scene.add(fill);
  under.position.set(1.45, 1.6, 1.4);
  scene.add(keyLight, rimLight, under);

  const M = materials();
  naga = await buildNakaRelief();
  naga.position.set(-.85, .25, .25);
  naga.rotation.x = -.1;
  const { stage, productTop } = buildStage(M);
  scene.add(stage, naga, ...buildAtmosphere());

  cardRing = buildCards();
  cardRing.position.set(0, 0, 0);
  scene.add(cardRing);
  cards.forEach(card => {
    const m = streamMaterial();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(49 * 3), 3));
    const uv = new Float32Array(49 * 2);
    for (let i = 0; i <= 48; i++) uv[i * 2] = i / 48;
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const mesh = new THREE.Line(geometry, m);
    mesh.frustumCulled = false;
    mesh.userData.card = card;
    streams.push(mesh); scene.add(mesh);
  });

  resize();
  addEventListener('resize', resize);
  compact.addEventListener('change', resize);
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; wake(); }, { threshold: 0 })
    .observe(document.getElementById('journey'));
  document.addEventListener('visibilitychange', wake);
  addEventListener('naka-scene-wake', wake);
  addEventListener('scroll', wake, { passive: true });

  // Snap to the current chapter so the first frame is already composed.
  settle(state.chapter, true);
  renderFrame(0);
  document.body.classList.add('three-ready');
  // The ready class changes the stage width; render at the resulting CSS size, never stretch the old buffer.
  resize();
  new ResizeObserver(resize).observe(host);
  window.dispatchEvent(new CustomEvent('naka-3d-ready'));
  window.nakaScene = {
    get fps() { return fpsEstimate; },
    get mascotPose() { return { y: naga.position.y, tilt: naga.rotation.z, scale: naga.scale.x,
      breath: naga.userData.motion.breath.value, lean: naga.userData.motion.lean.value }; }
  };
  wake();
}

function resize() {
  const w = host.clientWidth || innerWidth, h = host.clientHeight || innerHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.clearViewOffset();
  camera.updateProjectionMatrix();
  settle(state.chapter, true);
  renderFrame(0);
}

/* ------------------------------------------------------------ animation */
const tmp = new THREE.Vector3();
const CARD_SLOTS = [
  new THREE.Vector3(1.55, 3.75, -.3),
  new THREE.Vector3(3.45, 3.45, -.7),
  new THREE.Vector3(1.9, 2.4, .15),
  new THREE.Vector3(3.6, 2.05, -.25)
];
function targets(chapter) {
  // Fit the complete silhouette and the four outputs inside the dedicated visual column.
  const frameHeight = Math.max(6.0, 8.5 / camera.aspect);
  return {
    active: chapter > 0 ? chapter - 1 : -1,
    ring: null,
    camAz: [0.035, .07, -.025, .06, .015][chapter] || 0,
    camDist: frameHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))),
    camY: 4.6,
    tgtY: 2.0
  };
}

function settle(chapter, snap) {
  const t = targets(chapter);
  if (snap) {
    if (t.ring !== null) smooth.ring = t.ring;
    Object.assign(smooth, { camAz: t.camAz, camDist: t.camDist, camY: t.camY, tgtY: t.tgtY });
    smooth.bg.setHex(MOODS[chapter].bg);
  }
  return t;
}

function wake() {
  if (running || !visible || document.hidden || document.body.classList.contains('world-ready')) return;
  running = true;
  clock.getDelta();
  requestAnimationFrame(loop);
}

let fpsEstimate = 0;
function loop() {
  if (!visible || document.hidden || document.body.classList.contains('world-ready')) { running = false; return; }
  const dt = Math.min(clock.getDelta(), .1);
  renderFrame(dt);
  if (dt) fpsEstimate = fpsEstimate * .9 + (1 / dt) * .1;
  // When motion is paused, keep rendering only while the camera is still settling.
  if (state.paused && frameCount > 24) { running = false; return; }
  requestAnimationFrame(loop);
}

function damp(current, target, lambda, dt) { return THREE.MathUtils.damp(current, target, lambda, dt); }
function dampAngle(current, target, lambda, dt) {
  const diff = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + diff * (1 - Math.exp(-lambda * dt));
}

function renderFrame(dt) {
  const chapter = Math.max(0, Math.min(4, state.chapter | 0));
  if (chapter !== lastChapter) { lastChapter = chapter; frameCount = 0; }
  frameCount++;
  const paused = !!state.paused;
  if (!paused) time += dt;
  const t = settle(chapter, false);
  const k = paused ? 12 : 2.6;

  // Ring: drift slowly on the intro, glide to the focal slot per service.
  if (t.ring === null) smooth.ring += paused ? 0 : dt * .12;
  else smooth.ring = dampAngle(smooth.ring, t.ring, k * .9, dt || 1);
  smooth.camAz = damp(smooth.camAz, t.camAz + (paused ? 0 : state.pointer * .07), k, dt || 1);
  smooth.camDist = damp(smooth.camDist, t.camDist, k, dt || 1);
  smooth.camY = damp(smooth.camY, t.camY, k, dt || 1);
  smooth.tgtY = damp(smooth.tgtY, t.tgtY, k, dt || 1);
  smooth.bg.lerp(new THREE.Color(MOODS[chapter].bg), 1 - Math.exp(-3 * (dt || 1)));
  scene.fog.color.copy(smooth.bg);
  rimLight.color.lerp(new THREE.Color(MOODS[chapter].rim), .05);

  camera.position.set(Math.sin(smooth.camAz) * smooth.camDist + .6, smooth.camY, Math.cos(smooth.camAz) * smooth.camDist);
  camera.lookAt(.6, smooth.tgtY, 0);
  camera.updateMatrixWorld();
  cards.forEach((card, i) => {
    const d = card.userData;
    const focus = t.active === i ? 1 : 0;
    d.focus = damp(d.focus, focus, 4, dt || 1);
    card.position.copy(CARD_SLOTS[i]);
    card.position.y += paused ? 0 : Math.sin(time * .7 + i) * .025;
    card.position.z += d.focus * .2;
    card.quaternion.copy(camera.quaternion);
    card.scale.setScalar(1 + d.focus * .12);
    const alpha = t.active < 0 ? 1 : .42 + d.focus * .58;
    d.face.material.opacity = alpha;
    d.glass.material.opacity = .4 * alpha;
    d.edge.material.opacity = .012 + d.focus * .022;
    card.visible = true;
    d.alpha = alpha;
  });

  streams.forEach((mesh, i) => {
    const card = mesh.userData.card;
    const from = new THREE.Vector3(1.45, 1.35, 1.05);
    const to = card.position;
    const mid = from.clone().lerp(to, .5).add(new THREE.Vector3(.15, .3, -.3));
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
    const positions = mesh.geometry.attributes.position;
    for (let j = 0; j <= 48; j++) {
      curve.getPoint(j / 48, tmp);
      positions.setXYZ(j, tmp.x, tmp.y, tmp.z);
    }
    positions.needsUpdate = true;
    mesh.material.uniforms.uTime.value = time + i * .7;
    mesh.material.uniforms.uStrength.value = (t.active < 0 ? .55 : t.active === i ? .9 : .1) * card.userData.alpha;
  });

  // Seated breathing: a 5.5-second cycle with a fixed coil and no whole-body bounce.
  // A cosine starts at rest with zero velocity; pause freezes the current breath.
  if (!paused) {
    const breath = (1 - Math.cos(time * Math.PI * 2 / 5.5)) * .5;
    naga.userData.motion.breath.value = breath * .012;
    naga.userData.motion.lean.value = breath * .006;
  }
  orbitRings.forEach((r, i) => { r.rotation.z = time * (i ? -.8 : .6); });
  sparkles.position.y = paused ? 0 : (time * .15) % 1 - .5;
  sparkles.rotation.y = time * .05;
  stars.rotation.y = time * .004;

  renderer.render(scene, camera);
}

// Start last, so every module-level binding above is initialised.
try {
  if (!host) throw new Error('no host');
  init().catch(fail);
} catch (error) {
  fail(error);
}
