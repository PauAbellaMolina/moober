import * as THREE from 'three';
import { createRover } from './rover.js';

const remotePlayers = new Map();

export function addPlayer(scene, id, data) {
  if (remotePlayers.has(id)) return;

  const rover = createRover(scene, data.color || '#ffffff');
  if (data.position) {
    rover.group.position.set(data.position.x, data.position.y, data.position.z);
  }
  if (data.rotation) {
    rover.group.rotation.set(data.rotation.x, data.rotation.y, data.rotation.z);
  }

  // Name label
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px Courier New';
  ctx.textAlign = 'center';
  ctx.fillText(data.name || 'Player', 128, 40);

  const texture = new THREE.CanvasTexture(canvas);
  const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.8 });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(4, 1, 1);
  sprite.position.y = 3.5;
  rover.group.add(sprite);

  // Interpolation state
  const player = {
    rover,
    sprite,
    prevState: null,
    nextState: null,
    stateTime: 0,
    interpDuration: 1 / 15, // matches network tick rate
  };

  remotePlayers.set(id, player);
}

export function removePlayer(scene, id) {
  const player = remotePlayers.get(id);
  if (!player) return;

  scene.remove(player.rover.group);
  // Clean up sprite
  player.sprite.material.map.dispose();
  player.sprite.material.dispose();
  remotePlayers.delete(id);
}

export function updatePlayerState(id, data) {
  const player = remotePlayers.get(id);
  if (!player) return;

  player.prevState = player.nextState || {
    position: { ...data.position },
    rotation: { ...data.rotation },
  };
  player.nextState = {
    position: { ...data.position },
    rotation: { ...data.rotation },
  };
  player.stateTime = 0;
}

export function interpolatePlayers(dt) {
  for (const [, player] of remotePlayers) {
    if (!player.prevState || !player.nextState) continue;

    player.stateTime += dt;
    const t = Math.min(player.stateTime / player.interpDuration, 1);

    const prev = player.prevState;
    const next = player.nextState;
    const group = player.rover.group;

    group.position.x = prev.position.x + (next.position.x - prev.position.x) * t;
    group.position.y = prev.position.y + (next.position.y - prev.position.y) * t;
    group.position.z = prev.position.z + (next.position.z - prev.position.z) * t;

    // Slerp rotation via quaternions
    const qPrev = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(prev.rotation.x, prev.rotation.y, prev.rotation.z)
    );
    const qNext = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(next.rotation.x, next.rotation.y, next.rotation.z)
    );
    const qInterp = qPrev.clone().slerp(qNext, t);
    group.quaternion.copy(qInterp);
  }
}

export function getPlayerCount() {
  return remotePlayers.size;
}
