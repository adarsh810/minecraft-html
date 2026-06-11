'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

// ─── World dimensions ─────────────────────────────────────────────────────────
const WX = 128, WZ = 128, WY = 64;
const SEA_Y = 12;
const CHUNK = 16;

// ─── Block IDs ────────────────────────────────────────────────────────────────
const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, WOOD = 4, LEAVES = 5,
      SAND = 6, WATER = 7, BEDROCK = 8, GRAVEL = 9, SNOW = 10,
      COAL = 11, IRON = 12;

const BLOCK_NAMES: Record<number, string> = {
  [GRASS]: 'Grass', [DIRT]: 'Dirt', [STONE]: 'Stone', [WOOD]: 'Wood',
  [LEAVES]: 'Leaves', [SAND]: 'Sand', [GRAVEL]: 'Gravel', [SNOW]: 'Snow',
  [COAL]: 'Coal', [IRON]: 'Iron Ore',
};

const HOTBAR_IDS   = [GRASS, DIRT, STONE, WOOD, LEAVES, SAND, GRAVEL, SNOW, COAL];
const HOTBAR_NAMES = ['Grass', 'Dirt', 'Stone', 'Wood', 'Leaves', 'Sand', 'Gravel', 'Snow', 'Coal'];
const HOTBAR_HEX   = ['#5BA83C','#8B6340','#888888','#5D4037','#2D7A2D','#E0C878','#9E9E9E','#F5F5F5','#555555'];

// ─── Break times ──────────────────────────────────────────────────────────────
const BREAK_TIME: Record<number, number> = {
  [GRASS]: 0.5, [DIRT]: 0.6, [SAND]: 0.5, [GRAVEL]: 0.5, [SNOW]: 0.3,
  [LEAVES]: 0.35, [WOOD]: 0.9, [STONE]: 1.5, [COAL]: 2.0, [IRON]: 2.5,
  [BEDROCK]: Infinity, [WATER]: Infinity,
};

// ─── Physics constants ────────────────────────────────────────────────────────
const GRAVITY     = -30;
const JUMP_VEL    = 10;
const WALK_SPEED  = 5;
const SPRINT_MULT = 1.7;
const PLAYER_HW   = 0.3;
const PLAYER_H    = 1.8;
const EYE_H       = 1.62;
const REACH       = 5.5;

// ─── Texture atlas setup ──────────────────────────────────────────────────────
const NUM_TEX = 13;

function fract(x: number) { return x - Math.floor(x); }
function noise2(x: number, y: number) { return fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5); }
function vary(base: number, amt: number, x: number, y: number, seed: number): number {
  return Math.max(0, Math.min(255, base + (noise2(x + seed * 100, y + seed * 37) - 0.5) * amt * 2));
}

function buildAtlas(): THREE.CanvasTexture {
  const W = 16, H = NUM_TEX * 16;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  function drawTex(texIdx: number, cb: (x: number, y: number, offY: number) => void) {
    for (let py = 0; py < 16; py++) {
      for (let px = 0; px < 16; px++) {
        cb(px, py, texIdx * 16);
      }
    }
  }

  function setPixel(ctx2: CanvasRenderingContext2D, px: number, py: number, r: number, g: number, b: number, a = 255) {
    ctx2.fillStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a / 255})`;
    ctx2.fillRect(px, py, 1, 1);
  }

  // 0: GRASS_TOP
  drawTex(0, (x, y, oy) => {
    const r = vary(80, 40, x, y, 0);
    const g = vary(160, 40, x, y, 1);
    const bl = vary(40, 20, x, y, 2);
    setPixel(ctx, x, oy + y, r, g, bl);
  });

  // 1: GRASS_SIDE (brown with green strip at top)
  drawTex(1, (x, y, oy) => {
    if (y < 4) {
      const r = vary(80, 30, x, y, 3);
      const g = vary(150, 40, x, y, 4);
      const bl = vary(40, 20, x, y, 5);
      setPixel(ctx, x, oy + y, r, g, bl);
    } else {
      const r = vary(130, 30, x, y, 6);
      const g = vary(95, 25, x, y, 7);
      const bl = vary(60, 20, x, y, 8);
      setPixel(ctx, x, oy + y, r, g, bl);
    }
  });

  // 2: DIRT
  drawTex(2, (x, y, oy) => {
    const r = vary(130, 30, x, y, 9);
    const g = vary(95, 25, x, y, 10);
    const bl = vary(60, 20, x, y, 11);
    setPixel(ctx, x, oy + y, r, g, bl);
  });

  // 3: STONE
  drawTex(3, (x, y, oy) => {
    const v = vary(135, 30, x, y, 12);
    setPixel(ctx, x, oy + y, v, v, v);
  });

  // 4: WOOD_TOP (concentric rings)
  drawTex(4, (x, y, oy) => {
    const dx = x - 7.5, dy = y - 7.5;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const ring = Math.floor(dist) % 2;
    const base = ring === 0 ? 120 : 95;
    const r = vary(base + 20, 15, x, y, 13);
    const g = vary(base, 15, x, y, 14);
    const bl = vary(base - 30, 10, x, y, 15);
    setPixel(ctx, x, oy + y, r, g, bl);
  });

  // 5: WOOD_SIDE (vertical grain)
  drawTex(5, (x, y, oy) => {
    const grain = (x % 3 === 0) ? -15 : 0;
    const r = vary(120 + grain, 15, x, y, 16);
    const g = vary(85 + grain, 15, x, y, 17);
    const bl = vary(45 + grain, 10, x, y, 18);
    setPixel(ctx, x, oy + y, r, g, bl);
  });

  // 6: LEAVES (patchy transparent)
  ctx.clearRect(0, 6 * 16, 16, 16);
  drawTex(6, (x, y, oy) => {
    if (Math.sin(x * 2 + y * 3) > 0.3) {
      const r = vary(45, 20, x, y, 19);
      const g = vary(120, 30, x, y, 20);
      const bl = vary(35, 15, x, y, 21);
      setPixel(ctx, x, oy + y, r, g, bl, 255);
    }
    // else leave transparent (already cleared)
  });

  // 7: SAND
  drawTex(7, (x, y, oy) => {
    const r = vary(215, 20, x, y, 22);
    const g = vary(190, 20, x, y, 23);
    const bl = vary(130, 15, x, y, 24);
    setPixel(ctx, x, oy + y, r, g, bl);
  });

  // 8: WATER (wave pattern)
  drawTex(8, (x, y, oy) => {
    const wave = Math.sin((x + y) * 0.8) * 12;
    const r = vary(20, 15, x, y, 25);
    const g = vary(80 + wave, 20, x, y, 26);
    const bl = vary(200 + wave, 25, x, y, 27);
    setPixel(ctx, x, oy + y, r, g, bl, 180);
  });

  // 9: BEDROCK (dark irregular)
  drawTex(9, (x, y, oy) => {
    const n = noise2(x * 3.7, y * 2.9);
    const v = n < 0.4 ? vary(30, 15, x, y, 28) : vary(55, 20, x, y, 29);
    setPixel(ctx, x, oy + y, v, v, v);
  });

  // 10: GRAVEL (mixed chunks)
  drawTex(10, (x, y, oy) => {
    const n = noise2(Math.floor(x / 3) * 3.1, Math.floor(y / 3) * 2.7);
    const v = vary(140 + n * 40, 20, x, y, 30);
    setPixel(ctx, x, oy + y, v, v, v);
  });

  // 11: SNOW
  drawTex(11, (x, y, oy) => {
    const v = vary(240, 15, x, y, 31);
    setPixel(ctx, x, oy + y, v, v, v + 5);
  });

  // 12: COAL (stone with black spots)
  drawTex(12, (x, y, oy) => {
    const h = noise2(x * 5.1 + 100, y * 4.3 + 200);
    if (h > 0.68) {
      setPixel(ctx, x, oy + y, 20, 20, 20);
    } else {
      const v = vary(135, 30, x, y, 32);
      setPixel(ctx, x, oy + y, v, v, v);
    }
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.flipY = false;
  return tex;
}

// Block → [top_tex, side_tex, bottom_tex]
const BLOCK_TEXTURES: Record<number, [number, number, number]> = {
  [GRASS]:   [0, 1, 2],
  [DIRT]:    [2, 2, 2],
  [STONE]:   [3, 3, 3],
  [WOOD]:    [4, 5, 4],
  [LEAVES]:  [6, 6, 6],
  [SAND]:    [7, 7, 7],
  [WATER]:   [8, 8, 8],
  [BEDROCK]: [9, 9, 9],
  [GRAVEL]:  [10, 10, 10],
  [SNOW]:    [11, 11, 11],
  [COAL]:    [12, 12, 12],
  [IRON]:    [12, 12, 12],
};

// ─── World helpers ────────────────────────────────────────────────────────────
function wIdx(x: number, y: number, z: number) { return (y * WZ + z) * WX + x; }
function inBounds(x: number, y: number, z: number) {
  return x >= 0 && x < WX && y >= 0 && y < WY && z >= 0 && z < WZ;
}

function getBlock(world: Uint8Array, x: number, y: number, z: number): number {
  if (y < 0) return BEDROCK;
  if (!inBounds(x, y, z)) return AIR;
  return world[wIdx(x, y, z)];
}

function isSolid(b: number) { return b !== AIR && b !== WATER && b !== LEAVES; }

// ─── Noise ────────────────────────────────────────────────────────────────────
function hash(x: number, z: number) { return fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5); }
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function smooth(t: number) { return t * t * (3 - 2 * t); }

function smoothNoise(x: number, z: number, scale: number): number {
  const sx = x / scale, sz = z / scale;
  const ix = Math.floor(sx), iz = Math.floor(sz);
  const tx = smooth(sx - ix), tz = smooth(sz - iz);
  return lerp(
    lerp(hash(ix, iz),     hash(ix + 1, iz),     tx),
    lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), tx),
    tz,
  );
}

function terrainH(x: number, z: number): number {
  return Math.round(
    SEA_Y + 1
    + smoothNoise(x, z, 16) * 12
    + smoothNoise(x, z, 8)  * 5
    + smoothNoise(x, z, 4)  * 2,
  );
}

// ─── World generation ─────────────────────────────────────────────────────────
function generateWorld(): Uint8Array {
  const world = new Uint8Array(WX * WY * WZ);

  for (let x = 0; x < WX; x++) {
    for (let z = 0; z < WZ; z++) {
      const h = Math.min(terrainH(x, z), WY - 2);
      const sandy = h <= SEA_Y + 1;
      const snowy  = h >= SEA_Y + 14;

      for (let y = 0; y < WY; y++) {
        if (y === 0) { world[wIdx(x, y, z)] = BEDROCK; continue; }
        if (y > h) {
          if (y <= SEA_Y) world[wIdx(x, y, z)] = WATER;
          // else AIR (default 0)
          continue;
        }
        if (y === h) {
          world[wIdx(x, y, z)] = sandy ? SAND : snowy ? SNOW : GRASS;
        } else if (y >= h - 4) {
          world[wIdx(x, y, z)] = sandy ? SAND : DIRT;
        } else {
          const rnd = hash(x * 3 + y * 7, z * 5 + y * 11);
          if (rnd < 0.04)       world[wIdx(x, y, z)] = COAL;
          else if (rnd < 0.06)  world[wIdx(x, y, z)] = IRON;
          else                  world[wIdx(x, y, z)] = STONE;
        }
      }
    }
  }

  // Trees
  for (let x = 3; x < WX - 3; x++) {
    for (let z = 3; z < WZ - 3; z++) {
      if (hash(x * 5, z * 3) < 0.03) {
        const h = terrainH(x, z);
        if (h > SEA_Y + 1 && h < SEA_Y + 13 && world[wIdx(x, h, z)] === GRASS) {
          placeTree(world, x, h + 1, z);
        }
      }
    }
  }

  return world;
}

function placeTree(world: Uint8Array, x: number, baseY: number, z: number) {
  const trunkH = 4 + Math.floor(hash(x, z) * 3);
  for (let i = 0; i < trunkH; i++) {
    if (baseY + i < WY) world[wIdx(x, baseY + i, z)] = WOOD;
  }
  const topY = baseY + trunkH;

  // Leaves layers
  for (let dy = -1; dy <= 1; dy++) {
    const ly = topY + dy;
    if (ly < 0 || ly >= WY) continue;
    const r = (dy <= 0) ? 1 : 0;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (dx === 0 && dz === 0 && dy < 1) continue;
        const lx = x + dx, lz = z + dz;
        if (inBounds(lx, ly, lz) && world[wIdx(lx, ly, lz)] === AIR) {
          if (hash(lx * 7.3 + ly, lz * 5.1) < 0.8 || (dx === 0 && dz === 0)) {
            world[wIdx(lx, ly, lz)] = LEAVES;
          }
        }
      }
    }
  }
  // 3x3 ring one below top
  const ringY = topY - 1;
  if (ringY >= 0 && ringY < WY) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const lx = x + dx, lz = z + dz;
        if (inBounds(lx, ringY, lz) && world[wIdx(lx, ringY, lz)] === AIR) {
          world[wIdx(lx, ringY, lz)] = LEAVES;
        }
      }
    }
  }
  // single top cap
  if (topY + 1 < WY && world[wIdx(x, topY + 1, z)] === AIR) {
    world[wIdx(x, topY + 1, z)] = LEAVES;
  }
}

// ─── Face definitions ─────────────────────────────────────────────────────────
type V3 = [number, number, number];
type FaceType = 'top' | 'bottom' | 'side';

interface FaceDef {
  n: V3;
  verts: V3[];
  faceType: FaceType;
}

const FACE_DEFS: FaceDef[] = [
  { n: [ 0, 1, 0], verts: [[0,1,0],[1,1,0],[1,1,1],[0,1,1]], faceType: 'top'    },
  { n: [ 0,-1, 0], verts: [[0,0,1],[1,0,1],[1,0,0],[0,0,0]], faceType: 'bottom' },
  { n: [ 1, 0, 0], verts: [[1,0,0],[1,0,1],[1,1,1],[1,1,0]], faceType: 'side'   },
  { n: [-1, 0, 0], verts: [[0,0,1],[0,0,0],[0,1,0],[0,1,1]], faceType: 'side'   },
  { n: [ 0, 0, 1], verts: [[1,0,1],[0,0,1],[0,1,1],[1,1,1]], faceType: 'side'   },
  { n: [ 0, 0,-1], verts: [[0,0,0],[1,0,0],[1,1,0],[0,1,0]], faceType: 'side'   },
];

function showFace(self: number, neighbor: number): boolean {
  if (self === WATER)  return neighbor === AIR;
  if (self === LEAVES) return neighbor === AIR || neighbor === WATER;
  return neighbor === AIR || neighbor === WATER || neighbor === LEAVES;
}

// ─── Chunk mesh building ──────────────────────────────────────────────────────
interface ChunkMaterials {
  solid:  THREE.MeshLambertMaterial;
  leaves: THREE.MeshLambertMaterial;
  water:  THREE.MeshLambertMaterial;
}

function makeChunkMaterials(atlas: THREE.CanvasTexture): ChunkMaterials {
  return {
    solid:  new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true }),
    leaves: new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, transparent: true }),
    water:  new THREE.MeshLambertMaterial({ map: atlas, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
  };
}

// Per-face brightness multiplier (simulates ambient occlusion + directional shading)
const FACE_SHADE: Record<string, number> = {
  top: 1.0, bottom: 0.45, side_px: 0.80, side_nx: 0.70, side_pz: 0.85, side_nz: 0.75,
};
function faceShadeKey(n: V3): string {
  if (n[1] === 1)  return 'top';
  if (n[1] === -1) return 'bottom';
  if (n[0] === 1)  return 'side_px';
  if (n[0] === -1) return 'side_nx';
  if (n[2] === 1)  return 'side_pz';
  return 'side_nz';
}

function buildChunkGroup(
  world: Uint8Array,
  cx: number, cy: number, cz: number,
  mats: ChunkMaterials,
): THREE.Group {
  const sPos: number[] = [], sUV: number[] = [], sCol: number[] = [], sNorm: number[] = [], sIdx: number[] = [];
  const lPos: number[] = [], lUV: number[] = [], lCol: number[] = [], lNorm: number[] = [], lIdx: number[] = [];
  const wPos: number[] = [], wUV: number[] = [], wNorm: number[] = [], wIdx2: number[] = [];
  let si = 0, li = 0, wi = 0;

  const ox = cx * CHUNK, oy = cy * CHUNK, oz = cz * CHUNK;

  for (let ly = 0; ly < CHUNK; ly++) {
    const wy = oy + ly; if (wy >= WY) continue;
    for (let lz = 0; lz < CHUNK; lz++) {
      const wz = oz + lz; if (wz >= WZ) continue;
      for (let lx = 0; lx < CHUNK; lx++) {
        const wx2 = ox + lx; if (wx2 >= WX) continue;
        const b = world[wIdx(wx2, wy, wz)];
        if (b === AIR) continue;

        const texs = BLOCK_TEXTURES[b] ?? [3, 3, 3];

        for (const f of FACE_DEFS) {
          const nx = wx2 + f.n[0], ny2 = wy + f.n[1], nz = wz + f.n[2];
          const nb = getBlock(world, nx, ny2, nz);
          if (!showFace(b, nb)) continue;

          const tIdx = f.faceType === 'top' ? texs[0] : f.faceType === 'bottom' ? texs[2] : texs[1];
          const vMin = tIdx / NUM_TEX;
          const vMax = (tIdx + 1) / NUM_TEX;

          // UV assignments per vertex: vert0=(0,vMin), vert1=(1,vMin), vert2=(1,vMax), vert3=(0,vMax)
          const uvs = [0, vMin, 1, vMin, 1, vMax, 0, vMax];

          const isWater  = b === WATER;
          const isLeaves = b === LEAVES;
          const shade = FACE_SHADE[faceShadeKey(f.n)];

          const pos  = isWater ? wPos  : isLeaves ? lPos  : sPos;
          const uvA  = isWater ? wUV   : isLeaves ? lUV   : sUV;
          const col  = isWater ? null  : isLeaves ? lCol  : sCol;
          const norm = isWater ? wNorm : isLeaves ? lNorm : sNorm;
          const idx  = isWater ? wIdx2 : isLeaves ? lIdx  : sIdx;
          const base = isWater ? wi    : isLeaves ? li     : si;

          for (let vi = 0; vi < 4; vi++) {
            const [vx, vy, vz] = f.verts[vi];
            const wvy = (isWater && f.n[1] === 1) ? wy + 0.875 : wy + vy;
            pos.push(wx2 + vx, wvy, wz + vz);
            uvA.push(uvs[vi * 2], uvs[vi * 2 + 1]);
            // Explicit flat normal (no averaging — fixes Lambert shading on voxels)
            norm.push(f.n[0], f.n[1], f.n[2]);
            // Per-face vertex color for AO-like depth
            if (col) col.push(shade, shade, shade);
          }
          idx.push(base, base + 1, base + 2, base, base + 2, base + 3);

          if (isWater) wi += 4;
          else if (isLeaves) li += 4;
          else si += 4;
        }
      }
    }
  }

  function makeMesh(
    pos: number[], uvA: number[], norm: number[], idx: number[],
    col: number[] | null, mat: THREE.MeshLambertMaterial,
  ): THREE.Mesh | null {
    if (idx.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvA, 2));
    geo.setAttribute('normal',   new THREE.Float32BufferAttribute(norm, 3));
    if (col) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    return new THREE.Mesh(geo, mat);
  }

  const group = new THREE.Group();
  const sm = makeMesh(sPos, sUV, sNorm, sIdx, sCol, mats.solid);
  const lm = makeMesh(lPos, lUV, lNorm, lIdx, lCol, mats.leaves);
  const wm = makeMesh(wPos, wUV, wNorm, wIdx2, null, mats.water);
  if (sm) group.add(sm);
  if (lm) group.add(lm);
  if (wm) group.add(wm);
  return group;
}

// ─── Physics collision ────────────────────────────────────────────────────────
function collidesAt(world: Uint8Array, px: number, py: number, pz: number): boolean {
  const x0 = Math.floor(px - PLAYER_HW), x1 = Math.floor(px + PLAYER_HW);
  const z0 = Math.floor(pz - PLAYER_HW), z1 = Math.floor(pz + PLAYER_HW);
  const y0 = Math.floor(py),              y1 = Math.floor(py + PLAYER_H - 0.001);
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        if (isSolid(getBlock(world, x, y, z))) return true;
  return false;
}

// ─── DDA Raycast ─────────────────────────────────────────────────────────────
function raycast(world: Uint8Array, origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): {
  block?: V3; face?: V3; dist: number;
} {
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  const stepX = dir.x > 0 ? 1 : -1;
  const stepY = dir.y > 0 ? 1 : -1;
  const stepZ = dir.z > 0 ? 1 : -1;

  const tDX = Math.abs(1 / (dir.x || 1e-10));
  const tDY = Math.abs(1 / (dir.y || 1e-10));
  const tDZ = Math.abs(1 / (dir.z || 1e-10));

  let tMaxX = dir.x > 0 ? (x + 1 - origin.x) * tDX : (origin.x - x) * tDX;
  let tMaxY = dir.y > 0 ? (y + 1 - origin.y) * tDY : (origin.y - y) * tDY;
  let tMaxZ = dir.z > 0 ? (z + 1 - origin.z) * tDZ : (origin.z - z) * tDZ;

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

// ─── Zombie mesh builder ──────────────────────────────────────────────────────
function makeZombieMesh(): THREE.Group {
  const g = new THREE.Group();

  const bodyMat  = new THREE.MeshLambertMaterial({ color: 0x2D7D1F });
  const headMat  = new THREE.MeshLambertMaterial({ color: 0x3D8A2D });
  const eyeMat   = new THREE.MeshLambertMaterial({ color: 0xff0000 });
  const legMat   = new THREE.MeshLambertMaterial({ color: 0x1A5C10 });
  const armMat   = new THREE.MeshLambertMaterial({ color: 0x2D7D1F });

  // Body
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.75, 0.3), bodyMat);
  body.position.set(0, 1.1, 0);
  g.add(body);

  // Head
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), headMat);
  head.position.set(0, 1.7, 0);
  g.add(head);

  // Eyes
  for (const sx of [-0.12, 0.12]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.05), eyeMat);
    eye.position.set(sx, 1.72, 0.26);
    g.add(eye);
  }

  // Legs (indices 4, 5 in group children)
  for (const sx of [-0.15, 0.15]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.75, 0.25), legMat);
    leg.position.set(sx, 0.37, 0);
    g.add(leg);
  }

  // Arms (indices 6, 7)
  for (const sx of [-0.42, 0.42]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.7, 0.25), armMat);
    arm.position.set(sx, 1.05, 0);
    g.add(arm);
  }

  return g;
}

// ─── Particle burst ───────────────────────────────────────────────────────────
interface Particle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
}

function spawnParticles(scene: THREE.Scene, pos: THREE.Vector3): Particle[] {
  const particles: Particle[] = [];
  const colors = [0x2D7D1F, 0x3D8A2D, 0x1A5C10, 0xff0000, 0x5A3A00];
  for (let i = 0; i < 8; i++) {
    const col = colors[i % colors.length];
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.15, 0.15),
      new THREE.MeshLambertMaterial({ color: col }),
    );
    mesh.position.copy(pos);
    scene.add(mesh);
    particles.push({
      mesh,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * 5,
        Math.random() * 5 + 2,
        (Math.random() - 0.5) * 5,
      ),
      life: 0.7,
    });
  }
  return particles;
}

// ─── React component ──────────────────────────────────────────────────────────
interface Zombie {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  hp: number;
  mesh: THREE.Group;
  attackCooldown: number;
  walkPhase: number;
}

export default function MinecraftGame() {
  const mountRef = useRef<HTMLDivElement>(null);
  const slotRef  = useRef(0);

  const [locked,        setLocked]        = useState(false);
  const [hp,            setHp]            = useState(20);
  const [slot,          setSlot]          = useState(0);
  const [dayTime,       setDayTime]       = useState(0.25);
  const [coords,        setCoords]        = useState([64, 20, 64]);
  const [miningProgress, setMiningProgress] = useState(0);
  const [dead,          setDead]          = useState(false);
  const [loading,       setLoading]       = useState(true);

  function changeSlot(s: number) {
    slotRef.current = s;
    setSlot(s);
  }

  useEffect(() => {
    if (!mountRef.current) return;
    const container = mountRef.current;

    // ── Scene ──────────────────────────────────────────────────
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.FogExp2(0x87CEEB, 0.008);

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 300);

    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);

    // Lighting — ambient provides base fill, sun at fixed good angle for side-face depth
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xfff5e0, 0.6);
    sunLight.position.set(1, 2, 0.8); // fixed angle: top-lit with good side contrast
    scene.add(sunLight);

    // Sun / Moon meshes
    const sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(3, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xFFFF00 }),
    );
    scene.add(sunMesh);

    const moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(2, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xEEEEDD }),
    );
    scene.add(moonMesh);

    // ── Atlas + materials ──────────────────────────────────────
    const atlas = buildAtlas();
    const chunkMats = makeChunkMaterials(atlas);

    // ── World + chunks ─────────────────────────────────────────
    const world = generateWorld();
    const chunks = new Map<string, THREE.Group>();

    function chunkKey(cx: number, cy: number, cz: number) { return `${cx},${cy},${cz}`; }

    function buildChunk(cx: number, cy: number, cz: number) {
      const key = chunkKey(cx, cy, cz);
      const old = chunks.get(key);
      if (old) {
        scene.remove(old);
        old.traverse(obj => {
          if ((obj as THREE.Mesh).isMesh) {
            (obj as THREE.Mesh).geometry.dispose();
          }
        });
      }
      const grp = buildChunkGroup(world, cx, cy, cz, chunkMats);
      scene.add(grp);
      chunks.set(key, grp);
    }

    function rebuildChunksForBlock(bx: number, by: number, bz: number) {
      const cx = Math.floor(bx / CHUNK);
      const cy = Math.floor(by / CHUNK);
      const cz = Math.floor(bz / CHUNK);
      buildChunk(cx, cy, cz);
      // Rebuild neighbors if on boundary
      if (bx % CHUNK === 0 && cx > 0)           buildChunk(cx - 1, cy, cz);
      if (bx % CHUNK === CHUNK - 1 && cx + 1 < Math.ceil(WX / CHUNK)) buildChunk(cx + 1, cy, cz);
      if (by % CHUNK === 0 && cy > 0)           buildChunk(cx, cy - 1, cz);
      if (by % CHUNK === CHUNK - 1 && cy + 1 < Math.ceil(WY / CHUNK)) buildChunk(cx, cy + 1, cz);
      if (bz % CHUNK === 0 && cz > 0)           buildChunk(cx, cy, cz - 1);
      if (bz % CHUNK === CHUNK - 1 && cz + 1 < Math.ceil(WZ / CHUNK)) buildChunk(cx, cy, cz + 1);
    }

    // Build all chunks
    const CX = Math.ceil(WX / CHUNK);
    const CY = Math.ceil(WY / CHUNK);
    const CZ = Math.ceil(WZ / CHUNK);

    // Use setTimeout to allow the loading UI to render first
    setTimeout(() => {
      for (let cy = 0; cy < CY; cy++)
        for (let cz = 0; cz < CZ; cz++)
          for (let cx = 0; cx < CX; cx++)
            buildChunk(cx, cy, cz);
      setLoading(false);
    }, 10);

    // ── Block highlight ────────────────────────────────────────
    const hlGeo = new THREE.BoxGeometry(1.004, 1.004, 1.004);
    const hlMat = new THREE.MeshBasicMaterial({ color: 0x000000, wireframe: true });
    const highlight = new THREE.Mesh(hlGeo, hlMat);
    highlight.visible = false;
    scene.add(highlight);

    // ── Spawn ──────────────────────────────────────────────────
    const sx = WX / 2 | 0, sz = WZ / 2 | 0;
    let spawnY = WY - 2;
    for (let y = WY - 2; y >= 1; y--) {
      if (isSolid(world[wIdx(sx, y, sz)])) { spawnY = y + 1; break; }
    }
    const spawnPos = new THREE.Vector3(sx + 0.5, spawnY + 0.5, sz + 0.5);

    const pos = spawnPos.clone();
    const vel = new THREE.Vector3();
    let yaw = 0, pitch = -0.25; // look slightly downward to see terrain
    let onGround = false;
    let hpRef = 20;
    let deadRef = false;
    let respawnTimer = 0;
    let fallStartY = pos.y;
    let wasFalling = false;
    const keys: Record<string, boolean> = {};

    // ── Mining state ───────────────────────────────────────────
    let miningState: { block: V3; progress: number } | null = null;
    let mouseLeftHeld = false;

    // ── Day/Night ──────────────────────────────────────────────
    let dayTimeRef = 0.25;
    let hudTimer = 0;

    // ── Zombies ────────────────────────────────────────────────
    const zombies: Zombie[] = [];
    const allParticles: Particle[] = [];
    let zombieSpawnTimer = 0;

    function spawnZombie(px: number, pz: number) {
      const angle = Math.random() * Math.PI * 2;
      const dist  = 15 + Math.random() * 10;
      const zx = px + Math.cos(angle) * dist;
      const zz = pz + Math.sin(angle) * dist;
      const zxi = Math.max(1, Math.min(WX - 2, Math.round(zx)));
      const zzi = Math.max(1, Math.min(WZ - 2, Math.round(zz)));

      let zy = WY - 2;
      for (let y = WY - 2; y >= 1; y--) {
        if (isSolid(world[wIdx(zxi, y, zzi)])) { zy = y + 1; break; }
      }

      const mesh = makeZombieMesh();
      mesh.position.set(zxi + 0.5, zy, zzi + 0.5);
      scene.add(mesh);

      zombies.push({
        pos: new THREE.Vector3(zxi + 0.5, zy, zzi + 0.5),
        vel: new THREE.Vector3(),
        hp: 20,
        mesh,
        attackCooldown: 0,
        walkPhase: Math.random() * Math.PI * 2,
      });
    }

    // Spawn initial 3 zombies
    for (let i = 0; i < 3; i++) spawnZombie(pos.x, pos.z);

    // ── Input ──────────────────────────────────────────────────
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      keys[e.code] = true;
      if (e.code === 'Space' && onGround && document.pointerLockElement) {
        vel.y = JUMP_VEL;
        onGround = false;
      }
      const n = parseInt(e.key);
      if (n >= 1 && n <= 9) changeSlot(n - 1);
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
      if (deadRef) return;

      if (e.button === 0) {
        mouseLeftHeld = true;
        // Check if we hit a zombie first
        const dir2 = new THREE.Vector3();
        camera.getWorldDirection(dir2);
        const eye = new THREE.Vector3(pos.x, pos.y + EYE_H, pos.z);
        const { block } = raycast(world, eye, dir2, REACH);
        // Check zombie hit
        const rayCaster = new THREE.Raycaster(eye, dir2, 0, REACH);
        for (let i = zombies.length - 1; i >= 0; i--) {
          const z = zombies[i];
          const hits = rayCaster.intersectObject(z.mesh, true);
          if (hits.length > 0 && (!block || hits[0].distance < (block ? REACH : Infinity))) {
            z.hp -= 7;
            if (z.hp <= 0) {
              const particles = spawnParticles(scene, z.pos.clone());
              allParticles.push(...particles);
              scene.remove(z.mesh);
              z.mesh.traverse(obj => {
                if ((obj as THREE.Mesh).isMesh) (obj as THREE.Mesh).geometry.dispose();
              });
              zombies.splice(i, 1);
            }
            return;
          }
        }
      }

      if (e.button === 2) {
        const dir2 = new THREE.Vector3();
        camera.getWorldDirection(dir2);
        const eye = new THREE.Vector3(pos.x, pos.y + EYE_H, pos.z);
        const { block, face } = raycast(world, eye, dir2, REACH);
        if (block && face) {
          const [bx, by, bz] = block;
          const [fx, fy, fz] = face;
          const px2 = bx + fx, py2 = by + fy, pz2 = bz + fz;
          if (!inBounds(px2, py2, pz2) || world[wIdx(px2, py2, pz2)] !== AIR) return;
          // Don't place inside player
          const x0 = Math.floor(pos.x - PLAYER_HW), x1 = Math.floor(pos.x + PLAYER_HW);
          const z0 = Math.floor(pos.z - PLAYER_HW), z1 = Math.floor(pos.z + PLAYER_HW);
          const y0 = Math.floor(pos.y),              y1 = Math.floor(pos.y + PLAYER_H - 0.001);
          if (px2 >= x0 && px2 <= x1 && pz2 >= z0 && pz2 <= z1 && py2 >= y0 && py2 <= y1) return;
          world[wIdx(px2, py2, pz2)] = HOTBAR_IDS[slotRef.current];
          rebuildChunksForBlock(px2, py2, pz2);
        }
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) {
        mouseLeftHeld = false;
        miningState = null;
        setMiningProgress(0);
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
    window.addEventListener('mouseup',       onMouseUp);
    window.addEventListener('wheel',         onWheel, { passive: true });
    window.addEventListener('resize',        onResize);
    window.addEventListener('contextmenu',   onContextMenu);
    document.addEventListener('pointerlockchange', onLockChange);

    // ── Game loop ──────────────────────────────────────────────
    let last = performance.now();
    let rafId: number;

    function respawn() {
      pos.copy(spawnPos);
      vel.set(0, 0, 0);
      hpRef = 20;
      deadRef = false;
      onGround = false;
      setHp(20);
      setDead(false);
    }

    function lerpColor(a: THREE.Color, b: THREE.Color, t: number): THREE.Color {
      return new THREE.Color(
        a.r + (b.r - a.r) * t,
        a.g + (b.g - a.g) * t,
        a.b + (b.b - a.b) * t,
      );
    }

    const dayColor   = new THREE.Color(0x87CEEB);
    const dawnColor  = new THREE.Color(0xFF8C42);
    const nightColor = new THREE.Color(0x0A0A2E);

    function getSkyColor(t: number): THREE.Color {
      if (t < 0.1)        return lerpColor(nightColor, dawnColor,  t / 0.1);
      if (t < 0.2)        return lerpColor(dawnColor,  dayColor,   (t - 0.1) / 0.1);
      if (t < 0.4)        return dayColor;
      if (t < 0.5)        return lerpColor(dayColor,   dawnColor,  (t - 0.4) / 0.1);
      if (t < 0.6)        return lerpColor(dawnColor,  nightColor, (t - 0.5) / 0.1);
      if (t < 0.9)        return nightColor;
      return lerpColor(nightColor, dawnColor, (t - 0.9) / 0.1);
    }

    function update(dt: number) {
      dt = Math.min(dt, 0.05);

      // Death / respawn
      if (deadRef) {
        respawnTimer -= dt;
        if (respawnTimer <= 0) respawn();
        return;
      }

      // ── Day/night ────────────────────────────────────────────
      dayTimeRef = (dayTimeRef + dt / 300) % 1;
      const sky = getSkyColor(dayTimeRef);
      scene.background = sky;
      (scene.fog as THREE.FogExp2).color.copy(sky);

      const isDay   = dayTimeRef > 0.15 && dayTimeRef < 0.85;
      const ambInt  = isDay ? 0.9 : 0.18;
      ambientLight.intensity += (ambInt - ambientLight.intensity) * Math.min(1, dt * 2);
      sunLight.intensity = isDay ? 0.6 : 0.0;
      // sun position stays fixed for correct side-face lighting

      // Sun/moon orbit
      const angle = dayTimeRef * Math.PI * 2;
      sunMesh.position.set(
        pos.x + Math.cos(angle) * 80,
        pos.y + Math.sin(angle) * 80,
        pos.z,
      );
      moonMesh.position.set(
        pos.x - Math.cos(angle) * 80,
        pos.y - Math.sin(angle) * 80,
        pos.z,
      );
      // sunLight.position stays fixed — only the visual sun mesh orbits

      // ── Player physics ────────────────────────────────────────
      const inWaterBlock = getBlock(world, Math.floor(pos.x), Math.floor(pos.y + 0.5), Math.floor(pos.z));
      const swimming = inWaterBlock === WATER;
      const sprint = keys['ShiftLeft'] || keys['ShiftRight'];
      const spd = WALK_SPEED * (sprint ? SPRINT_MULT : 1);

      const fwd   = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const right = new THREE.Vector3( Math.cos(yaw), 0, -Math.sin(yaw));

      let moveX = 0, moveZ = 0;
      if (keys['KeyW'] || keys['ArrowUp'])    { moveX += fwd.x * spd; moveZ += fwd.z * spd; }
      if (keys['KeyS'] || keys['ArrowDown'])  { moveX -= fwd.x * spd; moveZ -= fwd.z * spd; }
      if (keys['KeyA'] || keys['ArrowLeft'])  { moveX -= right.x * spd; moveZ -= right.z * spd; }
      if (keys['KeyD'] || keys['ArrowRight']) { moveX += right.x * spd; moveZ += right.z * spd; }
      vel.x = moveX;
      vel.z = moveZ;

      if (swimming) {
        vel.y += GRAVITY * 0.08 * dt;
        if (keys['Space']) vel.y = Math.min(vel.y + 8 * dt, 3);
        vel.y = Math.max(vel.y, -2);
      } else {
        vel.y += GRAVITY * dt;
      }

      // Track fall for damage
      if (!onGround && vel.y < 0 && !wasFalling) {
        fallStartY = pos.y;
        wasFalling = true;
      }

      // X
      pos.x += vel.x * dt;
      if (collidesAt(world, pos.x, pos.y, pos.z)) { pos.x -= vel.x * dt; vel.x = 0; }

      // Y
      const prevY = pos.y;
      pos.y += vel.y * dt;
      if (collidesAt(world, pos.x, pos.y, pos.z)) {
        if (vel.y < 0) {
          // Landing: compute fall damage
          if (wasFalling) {
            const fell = fallStartY - pos.y;
            if (fell > 4) {
              const dmg = Math.floor((fell - 3) * 2);
              hpRef = Math.max(0, hpRef - dmg);
              setHp(hpRef);
              if (hpRef <= 0) { deadRef = true; respawnTimer = 3; setDead(true); }
            }
            wasFalling = false;
          }
          onGround = true;
          // Snap up to ground surface
          const snappedY = Math.floor(pos.y + 0.1);
          pos.y = snappedY;
        } else {
          onGround = false;
        }
        vel.y = 0;
      } else {
        if (Math.abs(prevY - pos.y) > 0.001) onGround = false;
      }

      // Z
      pos.z += vel.z * dt;
      if (collidesAt(world, pos.x, pos.y, pos.z)) { pos.z -= vel.z * dt; vel.z = 0; }

      // World boundary
      pos.x = Math.max(PLAYER_HW + 0.01, Math.min(WX - PLAYER_HW - 0.01, pos.x));
      pos.z = Math.max(PLAYER_HW + 0.01, Math.min(WZ - PLAYER_HW - 0.01, pos.z));
      if (pos.y < -10) respawn();

      // Camera
      camera.position.set(pos.x, pos.y + EYE_H, pos.z);
      camera.rotation.order = 'YXZ';
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;

      // ── Mining ────────────────────────────────────────────────
      const camDir = new THREE.Vector3();
      camera.getWorldDirection(camDir);
      const eye = camera.position.clone();
      const { block: lookedBlock } = raycast(world, eye, camDir, REACH);

      if (mouseLeftHeld && lookedBlock) {
        const [bx, by, bz] = lookedBlock;
        const same = miningState &&
          miningState.block[0] === bx &&
          miningState.block[1] === by &&
          miningState.block[2] === bz;

        const bt = world[wIdx(bx, by, bz)];
        const breakT = BREAK_TIME[bt] ?? 1.0;

        if (!same) {
          miningState = { block: lookedBlock, progress: 0 };
        } else {
          miningState!.progress += dt / breakT;
          if (miningState!.progress >= 1) {
            world[wIdx(bx, by, bz)] = AIR;
            rebuildChunksForBlock(bx, by, bz);
            miningState = null;
            setMiningProgress(0);
          } else {
            setMiningProgress(miningState!.progress);
          }
        }
      } else if (!mouseLeftHeld || !lookedBlock) {
        if (miningState) { miningState = null; setMiningProgress(0); }
      }

      // Block highlight
      if (lookedBlock) {
        highlight.position.set(lookedBlock[0] + 0.5, lookedBlock[1] + 0.5, lookedBlock[2] + 0.5);
        highlight.visible = true;
      } else {
        highlight.visible = false;
      }

      // ── Zombies ────────────────────────────────────────────────
      const maxZombies = (dayTimeRef > 0.5 && dayTimeRef < 0.9) ? 8 : 3;
      zombieSpawnTimer += dt;
      if (zombieSpawnTimer >= 30 && zombies.length < maxZombies) {
        zombieSpawnTimer = 0;
        spawnZombie(pos.x, pos.z);
      }

      for (let i = zombies.length - 1; i >= 0; i--) {
        const zb = zombies[i];
        const dx = pos.x - zb.pos.x;
        const dz = pos.z - zb.pos.z;
        const dist2d = Math.sqrt(dx * dx + dz * dz);

        if (dist2d < 20) {
          const spd2 = 1.8;
          zb.vel.x = (dx / (dist2d + 0.001)) * spd2;
          zb.vel.z = (dz / (dist2d + 0.001)) * spd2;
          zb.mesh.rotation.y = Math.atan2(dx, dz);
        } else {
          zb.vel.x *= 0.8;
          zb.vel.z *= 0.8;
        }

        // Gravity
        zb.vel.y += GRAVITY * dt;

        // Jump if blocked
        const frontX = zb.pos.x + zb.vel.x * 0.2;
        const frontZ = zb.pos.z + zb.vel.z * 0.2;
        const blockAhead = getBlock(world, Math.floor(frontX), Math.floor(zb.pos.y), Math.floor(frontZ));
        const blockAbove = getBlock(world, Math.floor(frontX), Math.floor(zb.pos.y + 1.1), Math.floor(frontZ));
        if (isSolid(blockAhead) && !isSolid(blockAbove) && zb.vel.y <= 0) {
          zb.vel.y = 7;
        }

        // Move X
        zb.pos.x += zb.vel.x * dt;
        if (collidesAt(world, zb.pos.x, zb.pos.y, zb.pos.z)) { zb.pos.x -= zb.vel.x * dt; zb.vel.x = 0; }
        // Move Y
        zb.pos.y += zb.vel.y * dt;
        if (collidesAt(world, zb.pos.x, zb.pos.y, zb.pos.z)) {
          if (zb.vel.y < 0) zb.pos.y = Math.floor(zb.pos.y + 0.1);
          zb.vel.y = 0;
        }
        // Move Z
        zb.pos.z += zb.vel.z * dt;
        if (collidesAt(world, zb.pos.x, zb.pos.y, zb.pos.z)) { zb.pos.z -= zb.vel.z * dt; zb.vel.z = 0; }

        // Walking animation
        zb.walkPhase += dt * 4;
        const legSwing = Math.sin(zb.walkPhase);
        const children = zb.mesh.children;
        if (children[4]) children[4].rotation.x =  legSwing * 0.6;
        if (children[5]) children[5].rotation.x = -legSwing * 0.6;
        if (children[6]) children[6].rotation.x = -legSwing * 0.5;
        if (children[7]) children[7].rotation.x =  legSwing * 0.5;

        // Bob
        zb.mesh.position.set(zb.pos.x, zb.pos.y + Math.sin(zb.walkPhase) * 0.05, zb.pos.z);

        // Attack player
        zb.attackCooldown -= dt;
        const fullDist = zb.pos.distanceTo(pos);
        if (fullDist < 1.5 && zb.attackCooldown <= 0) {
          hpRef = Math.max(0, hpRef - 2);
          setHp(hpRef);
          zb.attackCooldown = 1.2;
          if (hpRef <= 0) { deadRef = true; respawnTimer = 3; setDead(true); }
        }

        // World bounds
        zb.pos.x = Math.max(1, Math.min(WX - 1, zb.pos.x));
        zb.pos.z = Math.max(1, Math.min(WZ - 1, zb.pos.z));
        if (zb.pos.y < -5) { zb.pos.y = 5; zb.vel.y = 0; }
      }

      // ── Particles ─────────────────────────────────────────────
      for (let i = allParticles.length - 1; i >= 0; i--) {
        const p = allParticles[i];
        p.life -= dt;
        p.vel.y += GRAVITY * dt;
        p.mesh.position.addScaledVector(p.vel, dt);
        p.mesh.rotation.x += dt * 3;
        p.mesh.rotation.y += dt * 5;
        if (p.life <= 0) {
          scene.remove(p.mesh);
          (p.mesh.material as THREE.MeshLambertMaterial).dispose();
          p.mesh.geometry.dispose();
          allParticles.splice(i, 1);
        }
      }

      // ── HUD update (throttled) ────────────────────────────────
      hudTimer += dt;
      if (hudTimer > 0.1) {
        hudTimer = 0;
        setCoords([Math.round(pos.x), Math.round(pos.y), Math.round(pos.z)]);
        setDayTime(dayTimeRef);
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
      window.removeEventListener('mouseup',       onMouseUp);
      window.removeEventListener('wheel',         onWheel);
      window.removeEventListener('resize',        onResize);
      window.removeEventListener('contextmenu',   onContextMenu);
      document.removeEventListener('pointerlockchange', onLockChange);
      renderer.dispose();
      atlas.dispose();
      chunkMats.solid.dispose();
      chunkMats.leaves.dispose();
      chunkMats.water.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, []);

  // Hearts display
  const hearts = [];
  for (let i = 0; i < 10; i++) {
    const filled = hp / 2 > i;
    const half   = !filled && hp / 2 > i - 0.5;
    hearts.push(
      <span key={i} style={{ color: filled || half ? '#E53935' : '#555', fontSize: 18, lineHeight: 1 }}>
        {filled ? '❤' : half ? '❤' : '♡'}
      </span>,
    );
  }

  const isDayUI = dayTime > 0.15 && dayTime < 0.85;

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      {/* Crosshair */}
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', width: 2, height: 18, background: 'rgba(255,255,255,0.9)', top: -9, left: -1 }} />
        <div style={{ position: 'absolute', width: 18, height: 2, background: 'rgba(255,255,255,0.9)', left: -9, top: -1 }} />
      </div>

      {/* Mining progress arc */}
      {miningProgress > 0 && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, 20px)', pointerEvents: 'none' }}>
          <svg width="40" height="40" viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth="4" />
            <circle
              cx="20" cy="20" r="16" fill="none"
              stroke="white" strokeWidth="4"
              strokeDasharray={`${miningProgress * 100.53} 100.53`}
              strokeLinecap="round"
              transform="rotate(-90 20 20)"
            />
          </svg>
        </div>
      )}

      {/* HUD top-left */}
      <div style={{
        position: 'absolute', top: 12, left: 12, pointerEvents: 'none',
        fontFamily: 'monospace', fontSize: 13, textShadow: '1px 1px 2px #000',
        color: 'white', lineHeight: 1.6,
      }}>
        <div>{hearts}</div>
        <div>X:{coords[0]} Y:{coords[1]} Z:{coords[2]}</div>
      </div>

      {/* Day indicator top-right */}
      <div style={{
        position: 'absolute', top: 12, right: 12, pointerEvents: 'none',
        color: 'white', fontFamily: 'monospace', fontSize: 13,
        textShadow: '1px 1px 2px #000',
      }}>
        {isDayUI ? '☀ Day' : '☽ Night'}
      </div>

      {/* Hotbar */}
      <div style={{
        position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', gap: 3, pointerEvents: 'none',
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
            <div style={{ color: '#fff', fontSize: 8, marginTop: 2, textShadow: '1px 1px 1px #000' }}>
              {i + 1}
            </div>
          </div>
        ))}
      </div>

      {/* Selected block name */}
      <div style={{
        position: 'absolute', bottom: 76, left: '50%', transform: 'translateX(-50%)',
        color: 'white', fontFamily: 'sans-serif', fontSize: 12,
        textShadow: '1px 1px 2px #000', pointerEvents: 'none', letterSpacing: '0.05em',
      }}>
        {BLOCK_NAMES[HOTBAR_IDS[slot]] ?? HOTBAR_NAMES[slot]}
      </div>

      {/* Loading */}
      {loading && (
        <div style={{
          position: 'absolute', inset: 0, background: '#1a1a2e',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontFamily: 'sans-serif', fontSize: 24,
        }}>
          Generating world...
        </div>
      )}

      {/* Death screen */}
      {dead && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(80,0,0,0.75)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontFamily: 'sans-serif', pointerEvents: 'none',
        }}>
          <div style={{ fontSize: 48, fontWeight: 900, color: '#E53935', textShadow: '2px 2px 4px #000' }}>You Died!</div>
          <div style={{ fontSize: 18, marginTop: 16, opacity: 0.8 }}>Respawning in 3 seconds...</div>
        </div>
      )}

      {/* Start/pause overlay */}
      {!locked && !loading && !dead && (
        <div
          style={{
            position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}
          onClick={() => (document.querySelector('canvas') as HTMLElement)?.requestPointerLock?.()}
        >
          <div style={{ textAlign: 'center', color: 'white', fontFamily: 'sans-serif', userSelect: 'none' }}>
            <div style={{ fontSize: 40, fontWeight: 900, letterSpacing: '-0.02em', marginBottom: 8 }}>
              Minecraft HTML
            </div>
            <div style={{ fontSize: 16, marginBottom: 28, opacity: 0.75 }}>Built with Three.js</div>
            <div style={{
              background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)',
              borderRadius: 12, padding: '16px 32px', marginBottom: 24, display: 'inline-block',
            }}>
              <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>Click to Play</div>
              <div style={{ fontSize: 13, opacity: 0.85, lineHeight: 2 }}>
                <b>WASD</b> · Move &nbsp;|&nbsp; <b>Mouse</b> · Look<br />
                <b>Space</b> · Jump &nbsp;|&nbsp; <b>Shift</b> · Sprint<br />
                <b>Left Click (hold)</b> · Mine &nbsp;|&nbsp; <b>Right Click</b> · Place<br />
                <b>1–9</b> or <b>Scroll</b> · Select Block<br />
                <b>Esc</b> · Release mouse
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
