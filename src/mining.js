import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getTerrainRadius } from './terrain.js';
import { MINING_RANGE, MINING_DURATION, MINING_BATTERY_DRAIN, DEPOSITS_PER_CRATER_MAX } from './constants.js';

export const TOOLS = { DRIVE: 0, DRILL: 1 };

export const MINERAL_TYPES = [
  { id: 'iron', name: 'Iron', symbol: 'Fe', color: 0xaaaacc, rarity: 0.35, model: '/models/coal.glb', scale: 0.5 },
  { id: 'titanium', name: 'Titanium', symbol: 'Ti', color: 0x6688bb, rarity: 0.25, model: '/models/crystal.glb', scale: 0.5 },
  { id: 'helium3', name: 'Helium-3', symbol: 'He\u00B3', color: 0xcc77ee, rarity: 0.15, model: '/models/big-crystal.glb', scale: 2.5 },
  { id: 'ice', name: 'Ice', symbol: 'H\u2082O', color: 0x88ddff, rarity: 0.15, model: '/models/crystal-2.glb', scale: 1 },
  { id: 'gold', name: 'Gold', symbol: 'Au', color: 0xffcc33, rarity: 0.10, model: '/models/jewel.glb', scale: 0.01 },
  { id: 'moonrock', name: 'Moon Rock', symbol: 'MR', color: 0x888888, rarity: 0, model: '/models/mineral.glb', scale: 12 },
];

const gltfLoader = new GLTFLoader();
const modelCache = {};

function applyOreStyle(model, color) {
  model.traverse((child) => {
    if (child.isMesh) {
      child.material = child.material.clone();
      child.material.emissive = new THREE.Color(color);
      child.material.emissiveIntensity = 2.5;
      child.castShadow = true;
    }
  });
}

function pickMineral(rng) {
  let r = rng();
  for (const m of MINERAL_TYPES) {
    r -= m.rarity;
    if (r <= 0) return m;
  }
  return MINERAL_TYPES[0];
}

export function createMiningSystem(scene, craters, rng) {
  const deposits = [];
  const inventory = {};
  for (const m of MINERAL_TYPES) inventory[m.id] = 0;

  let currentTool = TOOLS.DRIVE;
  let drillProgress = 0;
  let drillTarget = null;
  let isDrilling = false;

  // --- Drill particle system ---
  const drillParticleCount = 50;
  const dpGeo = new THREE.BufferGeometry();
  const dpPositions = new Float32Array(drillParticleCount * 3);
  const dpVelocities = new Float32Array(drillParticleCount * 3);
  const dpLifetimes = new Float32Array(drillParticleCount);
  const dpMaxLifetimes = new Float32Array(drillParticleCount);
  const dpLifeAttr = new Float32Array(drillParticleCount);
  const dpColorAttr = new Float32Array(drillParticleCount * 3);
  for (let i = 0; i < drillParticleCount; i++) dpPositions[i * 3 + 1] = -1000;
  dpGeo.setAttribute('position', new THREE.BufferAttribute(dpPositions, 3));
  dpGeo.setAttribute('aLife', new THREE.BufferAttribute(dpLifeAttr, 1));
  dpGeo.setAttribute('aColor', new THREE.BufferAttribute(dpColorAttr, 3));

  const dpMat = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: `
      attribute float aLife;
      attribute vec3 aColor;
      varying float vLife;
      varying vec3 vColor;
      void main() {
        vLife = aLife;
        vColor = aColor;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = mix(1.0, 5.0, aLife) * (200.0 / -mvPos.z);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      varying float vLife;
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float core = 1.0 - smoothstep(0.0, 0.4, d);
        float glow = 1.0 - smoothstep(0.0, 1.0, d);
        float brightness = core + glow * 0.4;
        vec3 col = mix(vColor, vec3(1.0), core * 0.5);
        float alpha = brightness * vLife;
        gl_FragColor = vec4(col * 1.5, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const drillParticles = new THREE.Points(dpGeo, dpMat);
  drillParticles.frustumCulled = false;
  scene.add(drillParticles);

  let dpIndex = 0;
  let drillColor = new THREE.Color(0x888888);

  // Spawn a single deposit in a given crater
  function spawnDeposit(crater) {
    const mineral = pickMineral(Math.random);

    const angle = Math.random() * Math.PI * 2;
    const dist = Math.sqrt(Math.random()) * crater.angularRadius * 0.55;

    let t1 = new THREE.Vector3();
    if (Math.abs(crater.dir.y) < 0.999) {
      t1.crossVectors(crater.dir, new THREE.Vector3(0, 1, 0)).normalize();
    } else {
      t1.crossVectors(crater.dir, new THREE.Vector3(1, 0, 0)).normalize();
    }
    const axis = t1.applyAxisAngle(crater.dir, angle);
    const dir = crater.dir.clone().applyAxisAngle(axis, dist).normalize();

    const r = getTerrainRadius(dir);
    const pos = dir.clone().multiplyScalar(r + 0.3);

    const group = new THREE.Group();
    group.position.copy(pos);
    const up = pos.clone().normalize();
    const lookTarget = pos.clone().sub(up);
    group.lookAt(lookTarget);
    group.rotateX(Math.PI / 2);
    group.rotateY(Math.random() * Math.PI * 2);
    scene.add(group);

    const deposit = {
      mineral, dir, position: pos, group,
      amount: 2 + Math.floor(Math.random() * 4),
      depleted: false,
    };
    deposits.push(deposit);

    // Load model
    if (modelCache[mineral.id]) {
      const clone = modelCache[mineral.id].clone();
      clone.scale.setScalar(mineral.scale);
      applyOreStyle(clone, mineral.color);
      group.add(clone);
    } else {
      gltfLoader.load(mineral.model, (gltf) => {
        if (!modelCache[mineral.id]) modelCache[mineral.id] = gltf.scene;
        const clone = gltf.scene.clone();
        clone.scale.setScalar(mineral.scale);
        applyOreStyle(clone, mineral.color);
        group.add(clone);
      });
    }
  }

  // Initial deposits (use seeded rng for determinism)
  const _pickSeeded = () => pickMineral(rng);
  for (const crater of craters) {
    const count = Math.floor(rng() * (DEPOSITS_PER_CRATER_MAX + 1));
    for (let i = 0; i < count; i++) {
      // Use seeded rng for initial spawn only
      const mineral = _pickSeeded();

      const angle = rng() * Math.PI * 2;
      const dist = Math.sqrt(rng()) * crater.angularRadius * 0.55;

      let t1 = new THREE.Vector3();
      if (Math.abs(crater.dir.y) < 0.999) {
        t1.crossVectors(crater.dir, new THREE.Vector3(0, 1, 0)).normalize();
      } else {
        t1.crossVectors(crater.dir, new THREE.Vector3(1, 0, 0)).normalize();
      }
      const axis = t1.applyAxisAngle(crater.dir, angle);
      const dir = crater.dir.clone().applyAxisAngle(axis, dist).normalize();

      const r = getTerrainRadius(dir);
      const pos = dir.clone().multiplyScalar(r + 0.3);

      const group = new THREE.Group();
      group.position.copy(pos);
      const up = pos.clone().normalize();
      const lookTarget = pos.clone().sub(up);
      group.lookAt(lookTarget);
      group.rotateX(Math.PI / 2);
      group.rotateY(rng() * Math.PI * 2);
      scene.add(group);

      const deposit = {
        mineral, dir, position: pos, group,
        amount: 2 + Math.floor(rng() * 4),
        depleted: false,
      };
      deposits.push(deposit);

      if (modelCache[mineral.id]) {
        const clone = modelCache[mineral.id].clone();
        clone.scale.setScalar(mineral.scale);
        applyOreStyle(clone, mineral.color);
        group.add(clone);
      } else {
        gltfLoader.load(mineral.model, (gltf) => {
          if (!modelCache[mineral.id]) modelCache[mineral.id] = gltf.scene;
          const clone = gltf.scene.clone();
          clone.scale.setScalar(mineral.scale);
          applyOreStyle(clone, mineral.color);
          group.add(clone);
        });
      }
    }
  }

  // Respawn timer — spawn new deposits periodically
  const MIN_ACTIVE_DEPOSITS = 60;
  const RESPAWN_INTERVAL = 10; // seconds between respawn checks
  let respawnTimer = 0;

  function getNearestDeposit(roverPos) {
    let nearest = null;
    let nearestDist = Infinity;
    for (const dep of deposits) {
      if (dep.depleted) continue;
      const d = roverPos.distanceTo(dep.position);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = dep;
      }
    }
    return nearestDist < MINING_RANGE ? nearest : null;
  }

  function emitDrillParticles(emitPos, upDir, color) {
    drillColor.set(color);
    for (let i = 0; i < 3; i++) {
      const pi = dpIndex % drillParticleCount;
      const idx = pi * 3;

      dpPositions[idx] = emitPos.x + (Math.random() - 0.5) * 0.3;
      dpPositions[idx + 1] = emitPos.y + (Math.random() - 0.5) * 0.3;
      dpPositions[idx + 2] = emitPos.z + (Math.random() - 0.5) * 0.3;

      const spd = 2 + Math.random() * 3;
      const jx = (Math.random() - 0.5) * 3;
      const jy = (Math.random() - 0.5) * 3;
      const jz = (Math.random() - 0.5) * 3;
      dpVelocities[idx] = upDir.x * spd + jx;
      dpVelocities[idx + 1] = upDir.y * spd + jy;
      dpVelocities[idx + 2] = upDir.z * spd + jz;

      const life = 0.3 + Math.random() * 0.4;
      dpMaxLifetimes[pi] = life;
      dpLifetimes[pi] = life;

      dpColorAttr[idx] = drillColor.r;
      dpColorAttr[idx + 1] = drillColor.g;
      dpColorAttr[idx + 2] = drillColor.b;

      dpIndex++;
    }
  }

  function update(dt, roverPos, roverSpeed, eHeld, batteryRef) {
    // Respawn deposits if too few remain
    respawnTimer += dt;
    if (respawnTimer >= RESPAWN_INTERVAL) {
      respawnTimer = 0;
      const activeCount = deposits.filter(d => !d.depleted).length;
      if (activeCount < MIN_ACTIVE_DEPOSITS) {
        const needed = MIN_ACTIVE_DEPOSITS - activeCount;
        for (let i = 0; i < needed; i++) {
          const crater = craters[Math.floor(Math.random() * craters.length)];
          spawnDeposit(crater);
        }
      }
    }

    const nearby = getNearestDeposit(roverPos);

    const wantDrill = currentTool === TOOLS.DRILL && eHeld && Math.abs(roverSpeed) < 1;
    isDrilling = wantDrill;

    if (wantDrill) {
      drillTarget = nearby;
      drillProgress += dt / MINING_DURATION;

      if (batteryRef) batteryRef.drain(MINING_BATTERY_DRAIN * dt);

      // Emit drill particles from the drill point
      const emitPos = drillTarget ? drillTarget.position : roverPos;
      const upDir = emitPos.clone().normalize();
      const color = drillTarget ? drillTarget.mineral.color : 0x888888;
      emitDrillParticles(emitPos, upDir, color);

      if (drillProgress >= 1) {
        if (drillTarget) {
          drillTarget.amount--;
          inventory[drillTarget.mineral.id]++;
          if (drillTarget.amount <= 0) {
            drillTarget.depleted = true;
            scene.remove(drillTarget.group);
          }
        } else {
          inventory.moonrock++;
        }
        drillProgress = 0;
        drillTarget = null;
      }
    } else {
      drillProgress = 0;
      drillTarget = null;
    }

    // Update drill particles
    for (let i = 0; i < drillParticleCount; i++) {
      if (dpLifetimes[i] > 0) {
        dpLifetimes[i] -= dt;
        const idx = i * 3;
        dpPositions[idx] += dpVelocities[idx] * dt;
        dpPositions[idx + 1] += dpVelocities[idx + 1] * dt;
        dpPositions[idx + 2] += dpVelocities[idx + 2] * dt;
        const px = dpPositions[idx], py = dpPositions[idx + 1], pz = dpPositions[idx + 2];
        const len = Math.sqrt(px * px + py * py + pz * pz) || 1;
        dpVelocities[idx] -= (px / len) * 0.5 * dt;
        dpVelocities[idx + 1] -= (py / len) * 0.5 * dt;
        dpVelocities[idx + 2] -= (pz / len) * 0.5 * dt;
        dpLifeAttr[i] = Math.max(0, dpLifetimes[i] / dpMaxLifetimes[i]);
      } else {
        dpPositions[i * 3 + 1] = -1000;
        dpLifeAttr[i] = 0;
      }
    }
    dpGeo.attributes.position.needsUpdate = true;
    dpGeo.attributes.aLife.needsUpdate = true;
    dpGeo.attributes.aColor.needsUpdate = true;

    return nearby;
  }

  function setTool(tool) { currentTool = tool; }
  function getTool() { return currentTool; }
  function getProgress() { return drillProgress; }
  function getInventory() { return inventory; }
  function getDrilling() { return isDrilling; }

  return { update, setTool, getTool, getProgress, getInventory, getNearestDeposit, getDrilling, TOOLS };
}
