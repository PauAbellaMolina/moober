import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEED, CRATER_COUNT } from './constants.js';

// Seeded PRNG (mulberry32)
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(TERRAIN_SEED);
const noise2D = createNoise2D(rng);

// Generate crater data deterministically
const craters = [];
for (let i = 0; i < CRATER_COUNT; i++) {
  craters.push({
    x: (rng() - 0.5) * TERRAIN_SIZE * 0.8,
    z: (rng() - 0.5) * TERRAIN_SIZE * 0.8,
    radius: 5 + rng() * 35,
    depth: 1 + rng() * 4,
    rimHeight: 0.3 + rng() * 1.5,
  });
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function craterHeight(x, z) {
  let h = 0;
  for (const c of craters) {
    const dx = x - c.x;
    const dz = z - c.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const d = dist / c.radius;

    if (d < 1.4) {
      if (d < 0.8) {
        // Bowl interior
        const t = d / 0.8;
        h -= c.depth * (1 - t * t);
      } else if (d < 1.0) {
        // Transition from bowl to rim
        const t = smoothstep(0.8, 1.0, d);
        const bowlVal = 0; // at d=0.8, bowl contribution is 0
        const rimVal = c.rimHeight;
        h += (1 - t) * bowlVal + t * rimVal;
      } else {
        // Rim falloff
        const t = smoothstep(1.0, 1.4, d);
        h += c.rimHeight * (1 - t);
      }
    }
  }
  return h;
}

export function getTerrainHeight(x, z) {
  // Large-scale undulation
  const base = noise2D(x * 0.005, z * 0.005) * 8
    + noise2D(x * 0.015, z * 0.015) * 3;

  // Craters
  const crater = craterHeight(x, z);

  // Fine detail
  const detail = noise2D(x * 0.08, z * 0.08) * 0.5
    + noise2D(x * 0.2, z * 0.2) * 0.15;

  return base + crater + detail;
}

export function getTerrainNormal(x, z) {
  const eps = 0.5;
  const hL = getTerrainHeight(x - eps, z);
  const hR = getTerrainHeight(x + eps, z);
  const hD = getTerrainHeight(x, z - eps);
  const hU = getTerrainHeight(x, z + eps);

  const normal = new THREE.Vector3(
    (hL - hR) / (2 * eps),
    1,
    (hD - hU) / (2 * eps)
  );
  return normal.normalize();
}

export function createTerrain(scene) {
  const geometry = new THREE.PlaneGeometry(
    TERRAIN_SIZE, TERRAIN_SIZE,
    TERRAIN_SEGMENTS, TERRAIN_SEGMENTS
  );

  // Rotate plane to be horizontal
  geometry.rotateX(-Math.PI / 2);

  const positions = geometry.attributes.position;

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    positions.setY(i, getTerrainHeight(x, z));
  }

  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: 0x888888,
    roughness: 0.95,
    metalness: 0.0,
    flatShading: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  scene.add(mesh);

  return mesh;
}
