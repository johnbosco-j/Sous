// Sous hero scene: low-poly produce orbiting a breathing Alexa-cyan ring.
// Three.js is pinned (0.170.0) from the CDN, with a vendored copy as an offline fallback.
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
const LOCAL = new URL('./vendor/three.module.min.js', import.meta.url).href;

const canvas = document.getElementById('hero-canvas');
const hero = document.getElementById('hero');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

async function loadThree() {
  try {
    return await import(CDN);
  } catch {
    return await import(LOCAL);
  }
}

// Seeded random so the composition is the same on every load (and in the demo video).
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function radialTexture(THREE, inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.35, inner.replace(/[\d.]+\)$/, m => `${parseFloat(m) * 0.45})`));
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function produceMakers(THREE) {
  const mat = (color, roughness = 0.55) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02, flatShading: true });
  const green = mat(0x3f9b52, 0.6);

  const tomato = () => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.46, 1), mat(0xe8442c, 0.42));
    body.scale.set(1, 0.82, 1);
    const calyx = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.1, 5), green);
    calyx.position.y = 0.37;
    calyx.rotation.x = Math.PI;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.04, 0.16, 5), green);
    stem.position.y = 0.46;
    g.add(body, calyx, stem);
    return g;
  };
  const egg = () => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.32, 9, 7), mat(0xf4e7d2, 0.75));
    m.scale.set(1, 1.3, 1);
    return m;
  };
  const leaf = () => {
    const s = new THREE.Shape();
    s.moveTo(0, -0.55);
    s.quadraticCurveTo(0.44, -0.08, 0, 0.6);
    s.quadraticCurveTo(-0.44, -0.08, 0, -0.55);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.03, bevelSegments: 1, curveSegments: 5 });
    geo.center();
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo, mat(0x4fb468, 0.5)));
    const vein = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.95, 0.09), mat(0x86d498, 0.6));
    g.add(vein);
    return g;
  };
  const pepper = color => () => {
    const pts = [[0, -0.44], [0.2, -0.41], [0.35, -0.26], [0.39, 0.04], [0.35, 0.3], [0.22, 0.41], [0.07, 0.43], [0, 0.43]]
      .map(([x, y]) => new THREE.Vector2(x, y));
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 7), mat(color, 0.32)));
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.24, 5), green);
    stem.position.set(0.02, 0.52, 0);
    stem.rotation.z = -0.25;
    g.add(stem);
    return g;
  };
  const lemon = () => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 1), mat(0xf3cc3c, 0.45));
    body.scale.set(1.3, 1, 1);
    const tipMat = mat(0xe3b52a, 0.5);
    const a = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.14, 5), tipMat);
    a.position.x = 0.45; a.rotation.z = -Math.PI / 2;
    const b = a.clone(); b.position.x = -0.45; b.rotation.z = Math.PI / 2;
    g.add(body, a, b);
    return g;
  };
  const carrot = () => {
    const g = new THREE.Group();
    const root = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.95, 6), mat(0xf07a2a, 0.5));
    root.rotation.z = Math.PI;
    g.add(root);
    for (let i = 0; i < 3; i++) {
      const top = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.38, 4), green);
      top.position.set((i - 1) * 0.06, 0.62, 0);
      top.rotation.z = (i - 1) * 0.35;
      g.add(top);
    }
    return g;
  };
  const garlic = () => {
    const g = new THREE.Group();
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), mat(0xf1e6d6, 0.8));
    bulb.scale.set(1, 0.85, 1);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 6), mat(0xe6d6bf, 0.8));
    tip.position.y = 0.32;
    g.add(bulb, tip);
    return g;
  };
  return [tomato, leaf, egg, pepper(0xf5a524), lemon, carrot, pepper(0xd83a2a), garlic, leaf, tomato, pepper(0x5cbf73), egg];
}

async function init() {
  const THREE = await loadThree();

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    return; // no WebGL: the CSS ring fallback stays visible
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0f0b08, 0.038);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);
  camera.position.set(0, 0.2, 12);

  scene.add(new THREE.HemisphereLight(0xfff0de, 0x2a170b, 1.9));
  const key = new THREE.DirectionalLight(0xffc48a, 3.4);
  key.position.set(-6, 7, 8);
  const rim = new THREE.DirectionalLight(0x7fdcff, 1.3);
  rim.position.set(6, -2, -6);
  scene.add(key, rim);

  const world = new THREE.Group();
  scene.add(world);
  const ringRig = new THREE.Group();
  world.add(ringRig);

  // The ring: a hot core, an additive halo and two thin gyroscope rings
  const CYAN = 0x2fd8ff;
  const basic = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, toneMapped: false, ...extra });
  const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };
  const ringCore = new THREE.Mesh(new THREE.TorusGeometry(2.7, 0.075, 24, 256), basic(CYAN));
  const ringHalo = new THREE.Mesh(new THREE.TorusGeometry(2.7, 0.34, 24, 256), basic(CYAN, { ...additive, opacity: 0.12 }));
  const ringOuter = new THREE.Mesh(new THREE.TorusGeometry(3.35, 0.012, 8, 256), basic(0xf5a524, { transparent: true, opacity: 0.5 }));
  ringOuter.rotation.x = 1.15;
  const ringOuter2 = new THREE.Mesh(new THREE.TorusGeometry(3.75, 0.01, 8, 256), basic(CYAN, { transparent: true, opacity: 0.28 }));
  ringOuter2.rotation.y = 0.95;
  ringRig.add(ringCore, ringHalo, ringOuter, ringOuter2);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture(THREE, 'rgba(47,216,255,0.5)', 'rgba(47,216,255,0)'), ...additive, toneMapped: false }));
  glow.scale.set(11, 11, 1);
  const warm = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture(THREE, 'rgba(245,165,36,0.35)', 'rgba(245,165,36,0)'), ...additive, toneMapped: false }));
  warm.scale.set(4, 4, 1);
  ringRig.add(glow, warm);

  const cyanLight = new THREE.PointLight(CYAN, 36, 14, 1.6);
  ringRig.add(cyanLight);

  const rand = rng(20261023);

  // Sparkles riding the ring
  const sparkN = 420;
  const sparkPos = new Float32Array(sparkN * 3);
  for (let i = 0; i < sparkN; i++) {
    const a = rand() * Math.PI * 2;
    const r = 2.7 + (rand() - 0.5) * 0.55;
    sparkPos[i * 3] = Math.cos(a) * r;
    sparkPos[i * 3 + 1] = Math.sin(a) * r;
    sparkPos[i * 3 + 2] = (rand() - 0.5) * 0.35;
  }
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: 0xbff4ff, size: 0.045, ...additive, opacity: 0.85, toneMapped: false }));
  ringRig.add(sparks);

  // Produce on tilted elliptical orbits around the ring
  const makers = produceMakers(THREE);
  const small = window.innerWidth < 700;
  const N = small ? 12 : 18;
  const orbiters = [];
  for (let i = 0; i < N; i++) {
    const obj = makers[i % makers.length]();
    const holder = new THREE.Group();
    holder.add(obj);
    world.add(holder);
    const s = 0.8 + rand() * 0.6;
    obj.scale.multiplyScalar(s);
    obj.rotation.set(rand() * 6, rand() * 6, rand() * 6);
    orbiters.push({
      holder, obj,
      radius: 3.6 + rand() * 2.1,
      angle: (i / N) * Math.PI * 2 + rand() * 0.4,
      speed: 0.07 + rand() * 0.07,
      incline: (rand() - 0.5) * 0.9,
      lift: (rand() - 0.5) * 1.6,
      bob: rand() * Math.PI * 2,
      spin: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(1.2),
    });
  }

  // Warm dust drifting up through the scene
  const dustN = small ? 260 : 520;
  const dustPos = new Float32Array(dustN * 3);
  for (let i = 0; i < dustN; i++) {
    dustPos[i * 3] = (rand() - 0.5) * 30;
    dustPos[i * 3 + 1] = (rand() - 0.5) * 18;
    dustPos[i * 3 + 2] = -12 + rand() * 18;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xf5b04a, size: 0.05, ...additive, opacity: 0.55, toneMapped: false }));
  scene.add(dust);

  // Layout: ring to the right on wide screens, above the copy on narrow ones
  const base = { x: 3.1, y: 0.1, s: 1 };
  function layout() {
    const w = hero.clientWidth;
    const h = hero.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (w / h > 1.05) {
      Object.assign(base, { x: Math.min(3.4, 1.4 + (w / h) * 1.15), y: 0.1, s: 1 });
    } else {
      Object.assign(base, { x: 0, y: 2.25, s: 0.46 });
    }
    world.scale.setScalar(base.s);
  }
  layout();
  window.addEventListener('resize', () => { layout(); if (reduceMotion) render(0); });

  let mx = 0, my = 0, cx = 0, cy = 0;
  if (!reduceMotion) {
    window.addEventListener('pointermove', e => {
      mx = (e.clientX / window.innerWidth) * 2 - 1;
      my = (e.clientY / window.innerHeight) * 2 - 1;
    }, { passive: true });
  }

  const tmp = new THREE.Vector3();
  let t = 4.2;

  function render(dt) {
    t += dt;
    const hs = Math.min(1, Math.max(0, window.scrollY / Math.max(1, hero.offsetHeight)));
    const b = (Math.sin(t * 1.3) + 1) / 2;

    ringCore.scale.setScalar(1 + b * 0.025);
    ringHalo.scale.setScalar(1 + b * 0.04);
    ringHalo.material.opacity = 0.08 + b * 0.09;
    glow.material.opacity = 0.55 + b * 0.35;
    glow.scale.setScalar(10 + b * 1.6);
    cyanLight.intensity = 26 + b * 22;

    ringRig.rotation.y = Math.sin(t * 0.25) * 0.32 + cx * 0.25;
    ringRig.rotation.x = -0.2 + Math.cos(t * 0.2) * 0.12 + cy * 0.12 + hs * 0.9;
    ringOuter.rotation.z += dt * 0.18;
    ringOuter2.rotation.x += dt * 0.12;
    sparks.rotation.z -= dt * 0.14;

    for (const o of orbiters) {
      o.angle += o.speed * dt;
      const a = o.angle;
      tmp.set(Math.cos(a) * o.radius, Math.sin(a) * o.radius * o.incline + o.lift + Math.sin(t * 0.8 + o.bob) * 0.18, Math.sin(a) * o.radius * 0.85);
      o.holder.position.copy(tmp);
      o.obj.rotation.x += o.spin.x * dt;
      o.obj.rotation.y += o.spin.y * dt;
      o.obj.rotation.z += o.spin.z * dt;
    }

    const p = dustGeo.attributes.position.array;
    for (let i = 1; i < p.length; i += 3) {
      p[i] += dt * 0.18;
      if (p[i] > 9) p[i] = -9;
    }
    dustGeo.attributes.position.needsUpdate = true;

    cx += (mx - cx) * 0.045;
    cy += (my - cy) * 0.045;
    world.position.set(base.x - hs * 0.6, base.y + hs * 2.4, 0);
    camera.position.set(cx * 0.9, 0.2 - cy * 0.55, 12 + hs * 5);
    camera.lookAt(base.x * 0.3, base.y * 0.3 + hs * 0.8, 0);

    renderer.render(scene, camera);
  }

  document.documentElement.classList.add('webgl-ready');

  if (reduceMotion) {
    render(0);
    return;
  }

  let visible = true;
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(hero);
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!visible || document.hidden) return;
    render(dt);
  });
}

if (canvas && hero) {
  init().catch(err => console.warn('Sous hero: 3D scene unavailable, using the CSS fallback.', err));
}
