import * as THREE from 'three';
import { getTerrainRadius } from './terrain.js';
import { MINING_RANGE, MINING_DURATION, MINING_BATTERY_DRAIN, DEPOSITS_PER_CRATER_MAX } from './constants.js';

export const TOOLS = { DRIVE: 0, DRILL: 1 };

export const MINERAL_TYPES = [
  { id: 'iron', name: 'Iron', symbol: 'Fe', color: 0xaaaacc, rarity: 0.35 },
  { id: 'titanium', name: 'Titanium', symbol: 'Ti', color: 0x6688bb, rarity: 0.25 },
  { id: 'helium3', name: 'Helium-3', symbol: 'He\u00B3', color: 0xcc77ee, rarity: 0.15 },
  { id: 'ice', name: 'Ice', symbol: 'H\u2082O', color: 0x88ddff, rarity: 0.15 },
  { id: 'gold', name: 'Gold', symbol: 'Au', color: 0xffcc33, rarity: 0.10 },
];

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

  // Generate ore deposits inside craters
  for (const crater of craters) {
    const count = Math.floor(rng() * (DEPOSITS_PER_CRATER_MAX + 1));
    for (let i = 0; i < count; i++) {
      const mineral = pickMineral(rng);

      // Random position inside crater bowl
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

      // Ore mesh — small glowing crystal
      const geo = new THREE.IcosahedronGeometry(0.35, 0);
      const mat = new THREE.MeshStandardMaterial({
        color: mineral.color,
        emissive: mineral.color,
        emissiveIntensity: 2.5,
        roughness: 0.3,
        metalness: 0.6,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      // Orient up to face outward
      mesh.lookAt(new THREE.Vector3(0, 0, 0));
      mesh.rotation.x += Math.random() * 0.5;
      mesh.rotation.z += Math.random() * 0.5;
      mesh.castShadow = true;
      scene.add(mesh);

      deposits.push({
        mineral,
        dir,
        position: pos,
        mesh,
        amount: 2 + Math.floor(rng() * 4), // 2-5 units
        depleted: false,
      });
    }
  }

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

  function update(dt, roverPos, roverSpeed, eHeld, batteryRef) {
    const nearby = getNearestDeposit(roverPos);

    if (currentTool === TOOLS.DRILL && nearby && eHeld && Math.abs(roverSpeed) < 1) {
      drillTarget = nearby;
      drillProgress += dt / MINING_DURATION;

      // Drain battery while drilling
      if (batteryRef) batteryRef.drain(MINING_BATTERY_DRAIN * dt);

      if (drillProgress >= 1) {
        // Extract one unit
        drillTarget.amount--;
        inventory[drillTarget.mineral.id]++;
        drillProgress = 0;

        if (drillTarget.amount <= 0) {
          drillTarget.depleted = true;
          scene.remove(drillTarget.mesh);
          drillTarget.mesh.geometry.dispose();
          drillTarget.mesh.material.dispose();
        }
        drillTarget = null;
      }
    } else {
      drillProgress = 0;
      drillTarget = null;
    }

    // Pulse ore glow
    const pulse = 1.0 + Math.sin(Date.now() * 0.003) * 0.8;
    for (const dep of deposits) {
      if (dep.depleted) continue;
      dep.mesh.material.emissiveIntensity = pulse;
    }

    return nearby;
  }

  function setTool(tool) { currentTool = tool; }
  function getTool() { return currentTool; }
  function getProgress() { return drillProgress; }
  function getInventory() { return inventory; }

  return { update, setTool, getTool, getProgress, getInventory, getNearestDeposit, TOOLS };
}
