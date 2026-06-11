'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

// ─── World dimensions ─────────────────────────────────────────────────────────
const WX = 80, WZ = 80, WY = 64;
const SEA = 10;

// ─── Block IDs ────────────────────────────────────────────────────────────────
const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, WOOD = 4, LEAVES = 5,
      SAND = 6, WATER = 7, BEDROCK = 8, GRAVEL = 9, SNOW = 10;

// [top color, side color] as 0xRRGGBB
const BLOCK_COLORS: Record<number, [number, number]> = {
  [GRASS]:   [0x5BA83C, 0x8B6340],
  [DIRT]:    [0x8B6340, 0x8B6340],
  [STONE]:   [0x888888, 0x888888],
  [WOOD]:    [0x5D4037, 0x6B4226],
  [LEAVES]:  [0x2D7A2D, 0x2D7A2D],
  [SAND]:    [0xE0C878, 0xE0C878],
  [WATER]:   [0x1E88E5, 0x1E88E5],
  [BEDROCK]: [0x2A2A2A, 0x2A2A2A],
  [GRAVEL]:  [0x9E9E9E, 0x9E9E9E],
  [SNOW]:    [0xF5F5F5, 0xEEEEEE],
};

const HOTBAR_IDS    = [GRASS, DIRT, STONE, WOOD, LEAVES, SAND, GRAVEL, SNOW];
const HOTBAR_NAMES  = ['Grass','Dirt','Stone','Wood','Leaves','Sand','Gravel','Snow'];
const HOTBAR_HEX    = ['#5BA83C','#8B6340','#888888','#5D4037','#2D7A2D','#E0C878','#9E9E9E','#F5F5F5'];

// ─── Physics ─────────────────────────────────────────────────────────────────
const GRAVITY     = -32;
const JUMP_VEL    = 12;
const WALK_SPEED  = 5;
const SPRINT_MULT = 1.8;
const PLAYER_HW   = 0.3;   // half-width
const PLAYER_H    = 1.8;
const EYE_H       = 1.62;
const REACH       = 5.5;

// ─── Face definitions (for mesh building + raycasting) ───────────────────────
type V3 = [number, number, number];
interface FaceDef { n: V3; verts: V3[]; isTop: boolean; shade: number }

const FACE_DEFS: FaceDef[] = [
  { n:[ 0, 1, 0], verts:[[0,1,0],[1,1,0],[1,1,1],[0,1,1]], isTop:true,  shade:1.0 },
  { n:[ 0,-1, 0], verts:[[0,0,1],[1,0,1],[1,0,0],[0,0,0]], isTop:false, shade:0.5 },
  { n:[ 1, 0, 0], verts:[[1,0,0],[1,0,1],[1,1,1],[1,1,0]], isTop:false, shade:0.8 },
  { n:[-1, 0, 0], verts:[[0,0,1],[0,0,0],[0,1,0],[0,1,1]], isTop:false, shade:0.8 },
  { n:[ 0, 0, 1], verts:[[1,0,1],[0,0,1],[0,1,1],[1,1,1]], isTop:false, shade:0.9 },
  { n:[ 0, 0,-1], verts:[[0,0,0],[1,0,0],[1,1,0],[0,1,0]], isTop:false, shade:0.9 },
];

// ─── World helpers ────────────────────────────────────────────────────────────
function wIdx(x: number, y: number, z: number) { return (y * WZ + z) * WX + x; }
function inBounds(x: number, y: number, z: number) {
  return x >= 0 && x < WX && y >= 0 && y < WY && z >= 0 && z < WZ;
}

// ─── Noise ───────────────────────────────────────────────────────────────────
function fract(x: number) { return x - Math.floor(x); }
function hash2(a: number, b: number) { return fract(Math.sin(a * 127.1 + b * 311.7) * 43758.5453); }
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function smooth(t: number) { return t * t * (3 - 2 * t); }

function smoothNoise(x: number, z: number, scale: number): number {
  const sx = x / scale, sz = z / scale;
  const ix = Math.floor(sx), iz = Math.floor(sz);
  const tx = smooth(sx - ix), tz = smooth(sz - iz);
  return lerp(
    lerp(hash2(ix, iz),   hash2(ix+1, iz),   tx),
    lerp(hash2(ix, iz+1), hash2(ix+1, iz+1), tx),
    tz
  );
}

function terrainH(x: number, z: number): number {
  return Math.round(
    SEA + 1
    + smoothNoise(x, z, 24) * 14
    + smoothNoise(x, z, 12) * 5
    + smoothNoise(x, z, 6)  * 2
  );
}

// ─── World generation ────────────────────────────────────────────────────────
function generateWorld(): Uint8Array {
  const world = new Uint8Array(WX * WY * WZ);

  for (let x = 0; x < WX; x++) {
    for (let z = 0; z < WZ; z++) {
      const th = Math.min(terrainH(x, z), WY - 2);
      for (let y = 0; y < WY; y++) {
        if (y === 0) { world[wIdx(x, y, z)] = BEDROCK; continue; }
        if (y > th) {
          if (y <= SEA) world[wIdx(x, y, z)] = WATER;
          continue;
        }
        if (y === th) {
          if (th <= SEA + 1)       world[wIdx(x, y, z)] = SAND;
          else if (th >= WY - 6)   world[wIdx(x, y, z)] = SNOW;
          else                     world[wIdx(x, y, z)] = GRASS;
        } else if (y >= th - 3) {
          world[wIdx(x, y, z)] = th <= SEA + 1 ? SAND : DIRT;
        } else if (y >= th - 8) {
          world[wIdx(x, y, z)] = hash2(x * 3 + y, z * 7) < 0.15 ? GRAVEL : STONE;
        } else {
          world[wIdx(x, y, z)] = STONE;
        }
      }
    }
  }

  // Trees
  for (let x = 3; x < WX - 3; x++) {
    for (let z = 3; z < WZ - 3; z++) {
      if (hash2(x * 5 + 1, z * 3 + 2) < 0.03) {
        const th = terrainH(x, z);
        if (th > SEA + 1 && th < WY - 8 && world[wIdx(x, th, z)] === GRASS) {
          placeTree(world, x, th + 1, z);
        }
      }
    }
  }

  return world;
}

function placeTree(world: Uint8Array, x: number, y: number, z: number) {
  const h = 4 + Math.floor(hash2(x, z) * 3);
  for (let i = 0; i < h; i++) {
    if (y + i < WY) world[wIdx(x, y + i, z)] = WOOD;
  }
  const topY = y + h;
  for (let dy = -1; dy <= 2; dy++) {
    const r = dy <= 0 ? 2 : 1;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (dx === 0 && dz === 0 && dy < 1) continue;
        if (Math.abs(dx) + Math.abs(dz) > r + (r === 2 ? 1 : 0)) continue;
        const lx = x + dx, ly = topY + dy, lz = z + dz;
        if (inBounds(lx, ly, lz) && world[wIdx(lx, ly, lz)] === AIR)
          world[wIdx(lx, ly, lz)] = LEAVES;
      }
    }
  }
}

// ─── Mesh building ────────────────────────────────────────────────────────────
function isOpaque(b: number) { return b !== AIR && b !== WATER && b !== LEAVES; }
function showFaceFor(self: number, neighbor: number): boolean {
  if (self === WATER) return neighbor === AIR;
  if (self === LEAVES) return neighbor === AIR || neighbor === WATER;
  return neighbor === AIR || neighbor === WATER || neighbor === LEAVES;
}

function buildMeshes(world: Uint8Array): { solid: THREE.Mesh; water: THREE.Mesh; leaves: THREE.Mesh } {
  const sPos: number[] = [], sCol: number[] = [], sIdxArr: number[] = [];
  const wPos: number[] = [], wIdxArr: number[] = [];
  const lPos: number[] = [], lCol: number[] = [], lIdxArr: number[] = [];
  let si = 0, wi = 0, li = 0;

  for (let y = 0; y < WY; y++) {
    for (let z = 0; z < WZ; z++) {
      for (let x = 0; x < WX; x++) {
        const b = world[wIdx(x, y, z)];
        if (b === AIR) continue;

        for (const f of FACE_DEFS) {
          const [nx, ny, nz] = [x + f.n[0], y + f.n[1], z + f.n[2]];
          const nb = inBounds(nx, ny, nz) ? world[wIdx(nx, ny, nz)] : AIR;
          if (!showFaceFor(b, nb)) continue;

          if (b === WATER) {
            const wy = f.n[1] === 1 ? y + 0.9 : y; // slight dip on top
            for (const [vx, vy, vz] of f.verts) {
              wPos.push(x + vx, (f.n[1] === 1 ? y + 0.9 : y + vy), z + vz);
            }
            wIdxArr.push(wi, wi+1, wi+2, wi, wi+2, wi+3);
            wi += 4;
          } else {
            const [tc, sc] = BLOCK_COLORS[b] ?? [0xffffff, 0xffffff];
            const hex = f.isTop ? tc : sc;
            const shade = f.shade;
            const r = (((hex >> 16) & 0xff) / 255) * shade;
            const g = (((hex >> 8) & 0xff) / 255) * shade;
            const bl = ((hex & 0xff) / 255) * shade;

            const isLeaf = b === LEAVES;
            for (const [vx, vy, vz] of f.verts) {
              if (isLeaf) { lPos.push(x+vx, y+vy, z+vz); lCol.push(r, g, bl); }
              else        { sPos.push(x+vx, y+vy, z+vz); sCol.push(r, g, bl); }
            }
            if (isLeaf) { lIdxArr.push(li, li+1, li+2, li, li+2, li+3); li += 4; }
            else        { sIdxArr.push(si, si+1, si+2, si, si+2, si+3); si += 4; }
          }
        }
      }
    }
  }

  function makeMesh(pos: number[], col: number[], idx: number[], mat: THREE.Material): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (col.length) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, mat);
  }

  const solid  = makeMesh(sPos, sCol, sIdxArr, new THREE.MeshLambertMaterial({ vertexColors: true }));
  const leaves = makeMesh(lPos, lCol, lIdxArr, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.1 }));
  const water  = makeMesh(wPos, [],   wIdxArr,  new THREE.MeshLambertMaterial({ color: 0x1E88E5, transparent: true, opacity: 0.65, side: THREE.DoubleSide }));

  return { solid, water, leaves };
}

// ─── DDA Raycast ─────────────────────────────────────────────────────────────
function raycast(world: Uint8Array, origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): {
  block?: V3; face?: V3; dist: number
} {
  let [x, y, z] = [Math.floor(origin.x), Math.floor(origin.y), Math.floor(origin.z)];
  const [dx, dy, dz] = [dir.x, dir.y, dir.z];

  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const tDX = Math.abs(1 / (dx || 1e-10)), tDY = Math.abs(1 / (dy || 1e-10)), tDZ = Math.abs(1 / (dz || 1e-10));

  let tMaxX = dx > 0 ? (x+1 - origin.x) * tDX : (origin.x - x) * tDX;
  let tMaxY = dy > 0 ? (y+1 - origin.y) * tDY : (origin.y - y) * tDY;
  let tMaxZ = dz > 0 ? (z+1 - origin.z) * tDZ : (origin.z - z) * tDZ;

  let face: V3 = [0, 0, 0];

  while (Math.min(tMaxX, tMaxY, tMaxZ) < maxDist) {
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; tMaxX += tDX; face = [-stepX, 0, 0] as V3;
    } else if (tMaxY < tMaxZ) {
      y += stepY; tMaxY += tDY; face = [0, -stepY, 0] as V3;
    } else {
      z += stepZ; tMaxZ += tDZ; face = [0, 0, -stepZ] as V3;
    }
    if (!inBounds(x, y, z)) continue;
    const b = world[wIdx(x, y, z)];
    if (b !== AIR && b !== WATER) {
      return { block: [x, y, z], face, dist: Math.min(tMaxX, tMaxY, tMaxZ) };
    }
  }
  return { dist: Infinity };
}

// ─── React Component ──────────────────────────────────────────────────────────
export default function MinecraftGame() {
  const mountRef  = useRef<HTMLDivElement>(null);
  const slotRef   = useRef(0);
  const [locked,  setLocked]  = useState(false);
  const [coords,  setCoords]  = useState([40, 20, 40]);
  const [slot,    setSlot]    = useState(0);
  const [inWater, setInWater] = useState(false);

  function changeSlot(s: number) {
    slotRef.current = s;
    setSlot(s);
  }

  useEffect(() => {
    if (!mountRef.current) return;
    const container = mountRef.current;

    // ── Scene setup ───────────────────────────────────────────
    const scene    = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog        = new THREE.FogExp2(0x87CEEB, 0.022);

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 200);

    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = false;
    container.appendChild(renderer.domElement);

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xfffde7, 0.9);
    sun.position.set(50, 80, 30);
    scene.add(sun);

    // ── World ─────────────────────────────────────────────────
    const world = generateWorld();

    let solidMesh: THREE.Mesh, waterMesh: THREE.Mesh, leavesMesh: THREE.Mesh;

    function applyMeshes(m: ReturnType<typeof buildMeshes>) {
      if (solidMesh)  { scene.remove(solidMesh);  solidMesh.geometry.dispose(); }
      if (waterMesh)  { scene.remove(waterMesh);  waterMesh.geometry.dispose(); }
      if (leavesMesh) { scene.remove(leavesMesh); leavesMesh.geometry.dispose(); }
      solidMesh  = m.solid;
      waterMesh  = m.water;
      leavesMesh = m.leaves;
      scene.add(solidMesh, leavesMesh, waterMesh);
    }

    applyMeshes(buildMeshes(world));

    // ── Block highlight ───────────────────────────────────────
    const hlGeo = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    const hlMat = new THREE.MeshBasicMaterial({ color: 0x000000, wireframe: true, depthTest: true });
    const highlight = new THREE.Mesh(hlGeo, hlMat);
    highlight.visible = false;
    scene.add(highlight);

    // ── Player state ──────────────────────────────────────────
    const startX = WX / 2, startZ = WZ / 2;
    const startY = terrainH(startX | 0, startZ | 0) + 2;
    const pos = new THREE.Vector3(startX, startY, startZ);
    const vel = new THREE.Vector3(0, 0, 0);
    let yaw = 0, pitch = 0;
    let onGround = false;
    const keys: Record<string, boolean> = {};

    // ── Input ─────────────────────────────────────────────────
    function getBlock(x: number, y: number, z: number): number {
      if (y < 0) return BEDROCK;
      if (!inBounds(x, y, z)) return AIR;
      return world[wIdx(x, y, z)];
    }

    function isSolid(b: number) { return b !== AIR && b !== WATER && b !== LEAVES; }

    function collidesAt(px: number, py: number, pz: number): boolean {
      for (const dx of [-PLAYER_HW, PLAYER_HW]) {
        for (const dz of [-PLAYER_HW, PLAYER_HW]) {
          const bx = Math.floor(px + dx), bz = Math.floor(pz + dz);
          for (let dy = 0; dy < PLAYER_H; dy += 0.5) {
            if (isSolid(getBlock(bx, Math.floor(py + dy), bz))) return true;
          }
          if (isSolid(getBlock(bx, Math.floor(py + PLAYER_H - 0.01), bz))) return true;
        }
      }
      return false;
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      keys[e.code] = true;
      if (e.code === 'Space' && onGround && document.pointerLockElement) {
        vel.y = JUMP_VEL;
        onGround = false;
      }
      const n = parseInt(e.key);
      if (n >= 1 && n <= 8) changeSlot(n - 1);
      if (e.code === 'KeyF') scene.fog = scene.fog ? null : new THREE.FogExp2(0x87CEEB, 0.022);
    };
    const onKeyUp = (e: KeyboardEvent) => { keys[e.code] = false; };

    const onMouseMove = (e: MouseEvent) => {
      if (!document.pointerLockElement) return;
      yaw   -= e.movementX * 0.0022;
      pitch -= e.movementY * 0.0022;
      pitch  = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
    };

    const onMouseDown = (e: MouseEvent) => {
      if (!document.pointerLockElement) {
        renderer.domElement.requestPointerLock();
        return;
      }
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const eye = new THREE.Vector3(pos.x, pos.y + EYE_H, pos.z);
      const { block, face } = raycast(world, eye, dir, REACH);

      if (e.button === 0 && block) {
        const [bx, by, bz] = block;
        if (world[wIdx(bx, by, bz)] !== BEDROCK) {
          world[wIdx(bx, by, bz)] = AIR;
          applyMeshes(buildMeshes(world));
        }
      } else if (e.button === 2 && block && face) {
        const [bx, by, bz] = block;
        const [fx, fy, fz] = face;
        const px = bx + fx, py = by + fy, pz = bz + fz;
        if (!inBounds(px, py, pz) || world[wIdx(px, py, pz)] !== AIR) return;
        // Don't place inside player
        const insidePlayer = [0, 1].some(dy =>
          Math.floor(pos.x - PLAYER_HW) <= px && px <= Math.floor(pos.x + PLAYER_HW) &&
          Math.floor(pos.y + dy) === py &&
          Math.floor(pos.z - PLAYER_HW) <= pz && pz <= Math.floor(pos.z + PLAYER_HW)
        );
        if (insidePlayer) return;
        world[wIdx(px, py, pz)] = HOTBAR_IDS[slotRef.current];
        applyMeshes(buildMeshes(world));
      }
    };

    const onWheel = (e: WheelEvent) => {
      const next = ((slotRef.current + (e.deltaY > 0 ? 1 : -1)) + HOTBAR_IDS.length) % HOTBAR_IDS.length;
      changeSlot(next);
    };

    const onLockChange = () => setLocked(!!document.pointerLockElement);
    const onContextMenu = (e: Event) => e.preventDefault();
    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener('keydown',       onKeyDown);
    window.addEventListener('keyup',         onKeyUp);
    window.addEventListener('mousemove',     onMouseMove);
    window.addEventListener('mousedown',     onMouseDown);
    window.addEventListener('wheel',         onWheel,         { passive: true });
    window.addEventListener('resize',        onResize);
    window.addEventListener('contextmenu',   onContextMenu);
    document.addEventListener('pointerlockchange', onLockChange);

    // ── Game loop ─────────────────────────────────────────────
    let last = performance.now();
    let coordTimer = 0;
    let rafId: number;

    function update(dt: number) {
      dt = Math.min(dt, 0.06);

      // Determine if in water
      const eyeBlock = getBlock(Math.floor(pos.x), Math.floor(pos.y + EYE_H), Math.floor(pos.z));
      const swimming  = eyeBlock === WATER;
      const inW = getBlock(Math.floor(pos.x), Math.floor(pos.y + 0.5), Math.floor(pos.z)) === WATER;

      // Movement direction
      const fwd   = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const right = new THREE.Vector3(Math.cos(yaw),  0, -Math.sin(yaw));
      const sprint = keys['ShiftLeft'] || keys['ShiftRight'];
      const spd    = WALK_SPEED * (sprint ? SPRINT_MULT : 1);

      const move = new THREE.Vector3();
      if (keys['KeyW'] || keys['ArrowUp'])    move.add(fwd.clone().multiplyScalar(spd));
      if (keys['KeyS'] || keys['ArrowDown'])  move.add(fwd.clone().multiplyScalar(-spd));
      if (keys['KeyA'] || keys['ArrowLeft'])  move.add(right.clone().multiplyScalar(-spd));
      if (keys['KeyD'] || keys['ArrowRight']) move.add(right.clone().multiplyScalar(spd));

      vel.x = move.x;
      vel.z = move.z;

      if (inW) {
        // Swimming — much reduced gravity, space to float up
        vel.y += GRAVITY * 0.08 * dt;
        if (keys['Space']) vel.y = Math.min(vel.y + 8 * dt, 3);
        vel.y = Math.max(vel.y, -2);
      } else {
        vel.y += GRAVITY * dt;
      }

      // X axis
      pos.x += vel.x * dt;
      if (collidesAt(pos.x, pos.y, pos.z)) { pos.x -= vel.x * dt; vel.x = 0; }

      // Y axis
      pos.y += vel.y * dt;
      if (collidesAt(pos.x, pos.y, pos.z)) {
        if (vel.y < 0) { onGround = true; }
        vel.y = 0;
        pos.y -= vel.y * dt; // already applied, just zero vel
        // Snap to nearest floor
        if (onGround) pos.y = Math.floor(pos.y + 0.1) - 0.001;
      } else {
        onGround = false;
      }

      // Z axis
      pos.z += vel.z * dt;
      if (collidesAt(pos.x, pos.y, pos.z)) { pos.z -= vel.z * dt; vel.z = 0; }

      // World boundary
      pos.x = Math.max(PLAYER_HW, Math.min(WX - PLAYER_HW, pos.x));
      pos.z = Math.max(PLAYER_HW, Math.min(WZ - PLAYER_HW, pos.z));
      if (pos.y < -5) { pos.set(startX, startY + 5, startZ); vel.set(0,0,0); }

      // Camera
      camera.position.set(pos.x, pos.y + EYE_H, pos.z);
      camera.rotation.order = 'YXZ';
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;

      // Block highlight
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const { block } = raycast(world, camera.position.clone(), dir, REACH);
      if (block) {
        highlight.position.set(block[0] + 0.5, block[1] + 0.5, block[2] + 0.5);
        highlight.visible = true;
      } else {
        highlight.visible = false;
      }

      // Update coords display (throttled)
      coordTimer += dt;
      if (coordTimer > 0.1) {
        coordTimer = 0;
        setCoords([Math.round(pos.x), Math.round(pos.y), Math.round(pos.z)]);
        setInWater(swimming);
      }
    }

    function loop(time: number) {
      rafId = requestAnimationFrame(loop);
      const dt = (time - last) / 1000;
      last = time;
      update(dt);
      renderer.render(scene, camera);
    }
    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('keydown',       onKeyDown);
      window.removeEventListener('keyup',         onKeyUp);
      window.removeEventListener('mousemove',     onMouseMove);
      window.removeEventListener('mousedown',     onMouseDown);
      window.removeEventListener('wheel',         onWheel);
      window.removeEventListener('resize',        onResize);
      window.removeEventListener('contextmenu',   onContextMenu);
      document.removeEventListener('pointerlockchange', onLockChange);
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      {/* Three.js canvas mount */}
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      {/* Underwater tint */}
      {inWater && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(10,60,140,0.35)', pointerEvents: 'none'
        }} />
      )}

      {/* Crosshair */}
      <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', pointerEvents:'none' }}>
        <div style={{ position:'absolute', width:2, height:18, background:'rgba(255,255,255,0.85)', top:-9, left:-1 }} />
        <div style={{ position:'absolute', width:18, height:2, background:'rgba(255,255,255,0.85)', left:-9, top:-1 }} />
      </div>

      {/* Coordinates */}
      <div style={{
        position:'absolute', top:12, left:12, color:'white', fontFamily:'monospace',
        fontSize:13, textShadow:'1px 1px 2px #000', pointerEvents:'none', lineHeight:1.6
      }}>
        <div>X:{coords[0]} Y:{coords[1]} Z:{coords[2]}</div>
        <div style={{ opacity:0.7, fontSize:11 }}>F: toggle fog</div>
      </div>

      {/* Hotbar */}
      <div style={{
        position:'absolute', bottom:24, left:'50%', transform:'translateX(-50%)',
        display:'flex', gap:3, pointerEvents:'none'
      }}>
        {HOTBAR_IDS.map((_, i) => (
          <div key={i} style={{
            width: 46, height: 46,
            border: i === slot ? '2.5px solid #fff' : '2px solid rgba(0,0,0,0.7)',
            borderRadius: 5,
            background: i === slot ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.45)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            boxShadow: i === slot ? '0 0 0 1px rgba(0,0,0,0.5)' : 'none',
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 3,
              background: HOTBAR_HEX[i],
              border: '1px solid rgba(0,0,0,0.4)',
              boxShadow: 'inset 0 -3px 0 rgba(0,0,0,0.25)',
            }} />
            <div style={{ color:'#fff', fontSize:8, marginTop:2, textShadow:'1px 1px 1px #000', letterSpacing:'0.03em' }}>
              {i + 1}
            </div>
          </div>
        ))}
      </div>

      {/* Selected block name */}
      <div style={{
        position:'absolute', bottom:76, left:'50%', transform:'translateX(-50%)',
        color:'white', fontFamily:'sans-serif', fontSize:12,
        textShadow:'1px 1px 2px #000', pointerEvents:'none', letterSpacing:'0.05em'
      }}>
        {HOTBAR_NAMES[slot]}
      </div>

      {/* Pause / start overlay */}
      {!locked && (
        <div
          style={{
            position:'absolute', inset:0,
            background:'rgba(0,0,0,0.6)',
            display:'flex', alignItems:'center', justifyContent:'center',
            cursor:'pointer',
          }}
          onClick={() => (document.querySelector('canvas') as HTMLElement)?.requestPointerLock?.()}
        >
          <div style={{ textAlign:'center', color:'white', fontFamily:'sans-serif', userSelect:'none' }}>
            <div style={{ fontSize:40, fontWeight:900, letterSpacing:'-0.02em', marginBottom:8 }}>
              ⛏ Minecraft HTML
            </div>
            <div style={{ fontSize:16, marginBottom:28, opacity:0.75 }}>
              Built with Three.js
            </div>
            <div style={{
              background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.3)',
              borderRadius:12, padding:'16px 32px', marginBottom:24, display:'inline-block'
            }}>
              <div style={{ fontSize:20, fontWeight:700, marginBottom:12 }}>Click to Play</div>
              <div style={{ fontSize:13, opacity:0.85, lineHeight:2 }}>
                <b>WASD</b> · Move &nbsp;|&nbsp; <b>Mouse</b> · Look<br />
                <b>Space</b> · Jump &nbsp;|&nbsp; <b>Shift</b> · Sprint<br />
                <b>Left Click</b> · Break &nbsp;|&nbsp; <b>Right Click</b> · Place<br />
                <b>1–8</b> or <b>Scroll</b> · Select Block &nbsp;|&nbsp; <b>F</b> · Toggle Fog<br />
                <b>Esc</b> · Release mouse
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
