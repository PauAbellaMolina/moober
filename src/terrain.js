import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import { MOON_RADIUS, TERRAIN_SEED, CRATER_COUNT } from './constants.js';

// Seeded PRNG (mulberry32)
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export const rng = mulberry32(TERRAIN_SEED);
const noise3D = createNoise3D(rng);

// Generate crater data deterministically on the sphere
export const craters = [];
for (let i = 0; i < CRATER_COUNT; i++) {
  const theta = rng() * Math.PI * 2;
  const phi = Math.acos(2 * rng() - 1);
  craters.push({
    dir: new THREE.Vector3(
      Math.sin(phi) * Math.cos(theta),
      Math.sin(phi) * Math.sin(theta),
      Math.cos(phi)
    ).normalize(),
    angularRadius: (5 + rng() * 35) / MOON_RADIUS,
    depth: 1 + rng() * 4,
    rimHeight: 0.3 + rng() * 1.5,
  });
}

// Precompute cosine thresholds for fast vertex color check
for (const c of craters) {
  c._cosThresh85 = Math.cos(c.angularRadius * 0.85);
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function craterHeight(dir) {
  let h = 0;
  for (const c of craters) {
    const angDist = Math.acos(Math.min(1, Math.max(-1, dir.dot(c.dir))));
    const d = angDist / c.angularRadius;

    if (d < 1.4) {
      if (d < 0.8) {
        const t = d / 0.8;
        h -= c.depth * (1 - t * t);
      } else if (d < 1.0) {
        const t = smoothstep(0.8, 1.0, d);
        h += t * c.rimHeight;
      } else {
        const t = smoothstep(1.0, 1.4, d);
        h += c.rimHeight * (1 - t);
      }
    }
  }
  return h;
}

// Returns the terrain radius at a given direction (normalized Vector3)
export function getTerrainRadius(dir) {
  const x = dir.x, y = dir.y, z = dir.z;

  // Large-scale undulation
  const base = noise3D(x * 1.5, y * 1.5, z * 1.5) * 8
    + noise3D(x * 4, y * 4, z * 4) * 3;

  // Craters
  const crater = craterHeight(dir);

  // Fine detail
  const detail = noise3D(x * 20, y * 20, z * 20) * 0.5
    + noise3D(x * 50, y * 50, z * 50) * 0.15;

  return MOON_RADIUS + base + crater + detail;
}

// Returns the surface normal at a given direction
const _tDir = new THREE.Vector3();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();

export function getTerrainNormal(dir) {
  _tDir.copy(dir).normalize();

  // Two tangent vectors on the unit sphere
  if (Math.abs(_tDir.y) < 0.999) {
    _t1.crossVectors(_tDir, new THREE.Vector3(0, 1, 0)).normalize();
  } else {
    _t1.crossVectors(_tDir, new THREE.Vector3(1, 0, 0)).normalize();
  }
  _t2.crossVectors(_tDir, _t1).normalize();

  const eps = 0.002;

  const dirL = _tDir.clone().applyAxisAngle(_t2, -eps).normalize();
  const dirR = _tDir.clone().applyAxisAngle(_t2, eps).normalize();
  const dirD = _tDir.clone().applyAxisAngle(_t1, -eps).normalize();
  const dirU = _tDir.clone().applyAxisAngle(_t1, eps).normalize();

  const pL = dirL.multiplyScalar(getTerrainRadius(dirL));
  const pR = dirR.multiplyScalar(getTerrainRadius(dirR));
  const pD = dirD.multiplyScalar(getTerrainRadius(dirD));
  const pU = dirU.multiplyScalar(getTerrainRadius(dirU));

  const dx = pR.clone().sub(pL);
  const dz = pU.clone().sub(pD);
  const normal = new THREE.Vector3().crossVectors(dx, dz).normalize();

  // Ensure outward-facing
  if (normal.dot(_tDir) < 0) normal.negate();

  return normal;
}

export function createTerrain(scene) {
  const geometry = new THREE.SphereGeometry(MOON_RADIUS, 256, 128);

  const positions = geometry.attributes.position;
  const dir = new THREE.Vector3();

  const colors = new Float32Array(positions.count * 3);

  for (let i = 0; i < positions.count; i++) {
    dir.set(positions.getX(i), positions.getY(i), positions.getZ(i)).normalize();
    const r = getTerrainRadius(dir);
    positions.setXYZ(i, dir.x * r, dir.y * r, dir.z * r);

    // Check if vertex is inside a crater bowl (use dot product, skip acos)
    let craterDepth = 0;
    for (const c of craters) {
      const dot = dir.dot(c.dir);
      const cosThresh = c._cosThresh85;
      if (dot > cosThresh) {
        const angDist = Math.acos(Math.min(1, dot));
        const d = angDist / c.angularRadius;
        craterDepth = Math.max(craterDepth, 1 - d / 0.85);
      }
    }

    if (craterDepth > 0) {
      // Darker, slightly warm-tinted crater interior
      const t = craterDepth * 0.4;
      colors[i * 3] = 0.53 - t * 0.15;
      colors[i * 3 + 1] = 0.53 - t * 0.2;
      colors[i * 3 + 2] = 0.53 - t * 0.22;
    } else {
      colors[i * 3] = 0.53;
      colors[i * 3 + 1] = 0.53;
      colors[i * 3 + 2] = 0.53;
    }
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0.0,
    flatShading: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  scene.add(mesh);

  return mesh;
}
