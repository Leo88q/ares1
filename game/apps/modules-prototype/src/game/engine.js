import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PALETTE, MODULES, START, CAPS } from '../data/modules.js';
import { MODEL_DATA } from '../data/modelData.js';

const GRID = 8;          // 8x8 клеток
const CELL = 1;          // 1 клетка = 1 юнит
const TILE = 0.94;       // зазор между тайлами
const TILE_H = 0.16;

function tex(hex) {
  return new THREE.MeshLambertMaterial({ color: hex });
}

// ——— Модули: настоящие модели (Quaternius, CC0-1.0) + фолбэк из примитивов ———
const modelCache = {};

function normalizeModel(obj) {
  let box = new THREE.Box3().setFromObject(obj);
  if (!isFinite(box.min.x)) return;
  const size = box.getSize(new THREE.Vector3());
  const s = 0.9 / Math.max(size.x, size.z, 1e-4); // влезаем в клетку
  obj.scale.setScalar(s);
  box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  obj.position.x -= c.x;
  obj.position.z -= c.z;
  obj.position.y -= box.min.y; // на землю
}

function uriToArrayBuffer(uri) {
  const b64 = uri.slice(uri.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function preloadModels(notify) {
  const entries = Object.entries(MODEL_DATA || {});
  if (!entries.length) return;
  let i = 0, failed = [];
  // строго последовательно и с отдельным загрузчиком на каждую модель:
  // общий экземпляр GLTFLoader при параллельных parse меж собой гонится
  function next() {
    if (i >= entries.length) {
      if (failed.length) console.error('[models] failed:', failed);
      notify && notify();
      return;
    }
    const [id, uri] = entries[i++];
    try {
      new GLTFLoader().parse(
        uriToArrayBuffer(uri),
        '',
        (gltf) => {
          normalizeModel(gltf.scene);
          modelCache[id] = gltf.scene;
          notify && notify();
          next();
        },
        (err) => { failed.push(id); console.error('[models] parse failed:', id, err); next(); }
      );
    } catch (e) {
      failed.push(id);
      console.error('[models] exception:', id, e);
      next();
    }
  }
  next();
}

function buildModule(def) {
  const wrap = new THREE.Group();
  const src = modelCache[def.id];
  if (src) {
    const clone = src.clone(true);
    clone.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    wrap.add(clone);
    return wrap;
  }
  wrap.add(buildPrimitives(def));
  return wrap;
}

function buildPrimitives(def) {
  const g = new THREE.Group();
  const white = tex(PALETTE.hull);
  const dark = tex('#3a3f45');
  const rust = tex(PALETTE.rust);
  const teal = tex(PALETTE.teal);

  if (def.id === 'solar') {
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 0.8), tex('#8a837c'));
    base.position.y = 0.05;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.4, 8), dark);
    pole.position.y = 0.3;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.05, 0.55), tex(PALETTE.panel));
    panel.position.y = 0.55;
    panel.rotation.x = -0.55;
    g.add(base, pole, panel);
  } else if (def.id === 'water') {
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.9), tex('#8a837c'));
    base.position.y = 0.04;
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.6, 14), tex(PALETTE.tank));
    tank.position.y = 0.4;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2), tex('#d5dde0'));
    cap.position.y = 0.7;
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8), rust);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(0.35, 0.15, 0.25);
    g.add(base, tank, cap, pipe);
  } else if (def.id === 'greenhouse') {
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.1, 0.88), tex('#8a837c'));
    base.position.y = 0.05;
    const canopy = new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.38, 0.8, 16, 1, false, 0, Math.PI),
      new THREE.MeshLambertMaterial({ color: '#ff9a4d', transparent: true, opacity: 0.75 })
    );
    canopy.rotation.z = Math.PI / 2;
    canopy.rotation.y = Math.PI / 2;
    canopy.position.y = 0.16;
    const soil = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.7), tex('#6b4a32'));
    soil.position.y = 0.16;
    g.add(base, canopy, soil);
  } else if (def.id === 'habitat') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.42, 0.86), white);
    body.position.y = 0.21;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), white);
    dome.position.y = 0.42;
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.06), rust);
    door.position.set(0, 0.16, 0.45);
    const win1 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.02), tex('#8fd0e8'));
    win1.position.set(-0.25, 0.28, 0.44);
    const win2 = win1.clone();
    win2.position.x = 0.25;
    g.add(body, dome, door, win1, win2);
  } else if (def.id === 'node') {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), teal);
    box.position.y = 0.25;
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), tex('#ffffff'));
    core.position.y = 0.25;
    g.add(box, core);
    for (let i = 0; i < 4; i++) {
      const port = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.14, 8), dark);
      port.rotation.z = Math.PI / 2;
      const a = (i * Math.PI) / 2;
      port.position.set(Math.cos(a) * 0.3, 0.2, Math.sin(a) * 0.3);
      if (i % 2 === 1) port.rotation.x = Math.PI / 2, port.rotation.z = 0;
      g.add(port);
    }
  } else if (def.id === 'lab') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.5, 0.86), rust);
    body.position.y = 0.25;
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.24, 0.5), white);
    top.position.y = 0.62;
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), dark);
    ant.position.y = 0.95;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), teal);
    bulb.position.y = 1.2;
    g.add(body, top, ant, bulb);
  }

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

export function createGame(container, onState) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.bg);
  scene.fog = new THREE.Fog(PALETTE.bg, 18, 42);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // Ортогональная изометрия
  const frustum = 6.4;
  const camera = new THREE.OrthographicCamera(-frustum, frustum, frustum, -frustum, 0.1, 100);
  camera.position.set(11, 11, 11);
  camera.lookAt(0, 0, 0);
  let zoom = 0.82;
  let userZoom = false;
  camera.zoom = zoom;
  camera.updateProjectionMatrix();

  // Свет: мягкий «студийный»
  scene.add(new THREE.HemisphereLight('#ffe7d0', '#3a332e', 0.85));
  const sun = new THREE.DirectionalLight('#fff4e6', 1.15);
  sun.position.set(8, 14, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const d = 8;
  sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
  sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
  scene.add(sun);
  const rim = new THREE.DirectionalLight('#8fbfff', 0.25);
  rim.position.set(-6, 8, -8);
  scene.add(rim);

  // Пол-студия
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 48), tex(PALETTE.ground));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.06;
  floor.receiveShadow = true;
  scene.add(floor);

  // Тайлы
  const tiles = [];
  const tileMeshes = [];
  const tileGroup = new THREE.Group();
  const offset = (GRID * CELL - CELL) / 2;
  for (let x = 0; x < GRID; x++) {
    for (let z = 0; z < GRID; z++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(TILE, TILE_H, TILE), tex(PALETTE.tile));
      m.position.set(x * CELL - offset, TILE_H / 2, z * CELL - offset);
      m.castShadow = false;
      m.receiveShadow = true;
      m.userData.cell = { x, z };
      tileGroup.add(m);
      tiles.push(m);
      tileMeshes.push(m);
    }
  }
  scene.add(tileGroup);

  // Призрак установки
  const ghost = new THREE.Mesh(
    new THREE.BoxGeometry(TILE, 0.3, TILE),
    new THREE.MeshBasicMaterial({ color: '#4fd1c5', transparent: true, opacity: 0.45, depthWrite: false })
  );
  ghost.visible = false;
  scene.add(ghost);

  // Состояние
  const placed = new Map();   // "x,z" -> {def, group}
  const cableGroup = new THREE.Group();
  scene.add(cableGroup);

  const res = { ...START };
  let placingDef = null;
  let hovered = null;
  let toast = null;
  let toastT = 0;

  function push() {
    onState({
      balance: Math.round(res.balance),
      energy: Math.round(res.energy),
      water: Math.round(res.water),
      food: Math.round(res.food),
      air: Math.round(res.air),
      science: Math.floor(res.science),
      count: placed.size,
      models: `${Object.keys(modelCache).length}/${Object.keys(MODEL_DATA || {}).length}`,
      zoom: (camera.zoom || 1).toFixed(2),
      toast
    });
  }

  function key(c) { return `${c.x},${c.z}`; }
  function occupied(c) { return placed.has(key(c)); }
  function inBounds(c) { return c.x >= 0 && c.x < GRID && c.z >= 0 && c.z < GRID; }

  function rebuildCables() {
    while (cableGroup.children.length) {
      const c = cableGroup.children.pop();
      c.geometry?.dispose(); c.material?.dispose();
    }
    const mat = tex('#2c2f33');
    placed.forEach((entry, k) => {
      const [x, z] = k.split(',').map(Number);
      const dirs = [[1, 0], [0, 1]];
      for (const [dx, dz] of dirs) {
        const nk = `${x + dx},${z + dz}`;
        if (!placed.has(nk)) continue;
        const ax = x * CELL - offset, az = z * CELL - offset;
        const bx = (x + dx) * CELL - offset, bz = (z + dz) * CELL - offset;
        const p0 = new THREE.Vector3(ax, 0.42, az);
        const p1 = new THREE.Vector3(bx, 0.42, bz);
        const mid = p0.clone().add(p1).multiplyScalar(0.5);
        mid.y = 0.6;
        const curve = new THREE.QuadraticBezierCurve3(p0, mid, p1);
        const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.035, 6, false), mat);
        tube.castShadow = true;
        cableGroup.add(tube);
      }
    });
  }

  function place(c) {
    if (!placingDef || !inBounds(c) || occupied(c)) return;
    if (res.balance < placingDef.cost) {
      toast = 'Недостаточно 🥔 — нужно ' + placingDef.cost;
      push(); return;
    }
    const group = buildModule(placingDef);
    group.position.set(c.x * CELL - offset, TILE_H, c.z * CELL - offset);
    group.scale.setScalar(0.01);
    group.userData.animT = performance.now();
    scene.add(group);
    placed.set(key(c), { def: placingDef, group });
    res.balance -= placingDef.cost;                 // BURN: списание стоимости постройки
    rebuildCables();
    toast = `${placingDef.name}: −${placingDef.cost} 🥔 сожжено (BURN)`;
    toastT = 2.5;
    push();
  }

  // ——— Ресурсы ———
  let acc = 0;
  function tick(dt) {
    const has = (id) => [...placed.values()].filter((e) => e.def.id === id).length;
    const nSolar = has('solar'), nWater = has('water'), nGh = has('greenhouse'),
          nHab = has('habitat'), nNode = has('node'), nLab = has('lab');

    const eCap = CAPS.energy + nNode * 40;
    // производители
    res.energy = Math.min(eCap, res.energy + nSolar * 6 * dt);
    res.water = Math.min(CAPS.water, res.water + nWater * 4 * dt);
    res.air = Math.min(CAPS.air, res.air + nHab * 2 * dt);
    res.science += nLab * 1 * dt;
    // теплица: ест энергию и воду
    if (nGh > 0 && res.energy >= nGh * 2 * dt && res.water >= nGh * 2 * dt) {
      res.energy -= nGh * 2 * dt;
      res.water -= nGh * 2 * dt;
      res.food = Math.min(CAPS.food, res.food + nGh * 3 * dt);
    }
    if (toast && (toastT -= dt) <= 0) { toast = null; push(); }
  }

  // ——— Ввод ———
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  function cellFromEvent(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ptr.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ptr.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(tileMeshes, false)[0];
    return hit ? hit.object.userData.cell : null;
  }

  function onMove(e) {
    hovered = cellFromEvent(e);
    if (placingDef && hovered && inBounds(hovered) && !occupied(hovered)) {
      ghost.visible = true;
      ghost.position.set(hovered.x * CELL - offset, TILE_H + 0.16, hovered.z * CELL - offset);
      const ok = res.balance >= placingDef.cost;
      ghost.material.color.set(ok ? '#4fd1c5' : '#e05f5f');
    } else {
      ghost.visible = false;
    }
  }
  function onClick(e) {
    const c = cellFromEvent(e);
    if (c) place(c);
  }
  function onKey(e) {
    if (e.key === 'Escape') { placingDef = null; ghost.visible = false; push(); }
  }
  function onWheel(e) {
    userZoom = true;
    zoom = Math.max(0.5, Math.min(2.6, zoom - Math.sign(e.deltaY) * 0.12));
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    push();
  }

  renderer.domElement.addEventListener('pointermove', onMove);
  renderer.domElement.addEventListener('click', onClick);
  renderer.domElement.addEventListener('wheel', onWheel, { passive: true });
  window.addEventListener('keydown', onKey);

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    const aspect = w / h;
    camera.left = -frustum * aspect;
    camera.right = frustum * aspect;
    camera.top = frustum;
    camera.bottom = -frustum;
    if (!userZoom && w > 0 && h > 0) {
      // авто-вписывание решётки: изо-проекция GRID×GRID при взгляде (1,1,1)
      const isoW = GRID * Math.SQRT2;
      const isoH = GRID * Math.SQRT2 * 0.577;
      zoom = Math.min(
        (0.86 * 2 * frustum * aspect) / isoW,
        (0.84 * 2 * frustum) / isoH
      );
      camera.zoom = zoom;
    }
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  // ——— Цикл ———
  let raf = 0, last = performance.now();
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    tick(dt);
    // анимация появления
    placed.forEach((e) => {
      const t = (now - e.group.userData.animT) / 300;
      if (t < 1) {
        const s = t < 0.6 ? t / 0.6 * 1.15 : 1.15 - (t - 0.6) / 0.4 * 0.15;
        e.group.scale.setScalar(Math.max(0.01, s));
      } else e.group.scale.setScalar(1);
    });
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(loop);
  preloadModels(push);
  push();

  return {
    setPlacing(def) {
      placingDef = def;
      ghost.visible = false;
    },
    getPlacing() { return placingDef; },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('click', onClick);
      renderer.domElement.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      renderer.dispose();
      container.removeChild(renderer.domElement);
    }
  };
}
