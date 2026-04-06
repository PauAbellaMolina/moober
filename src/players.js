import * as THREE from 'three';
import { createRover } from './rover.js';

const remotePlayers = new Map();

export function addPlayer(scene, id, data) {
  if (remotePlayers.has(id)) return;

  const rover = createRover(scene, data.color || '#ffffff');
  if (data.position) {
    rover.group.position.set(data.position.x, data.position.y, data.position.z);
  }
  if (data.quaternion) {
    rover.group.quaternion.set(data.quaternion.x, data.quaternion.y, data.quaternion.z, data.quaternion.w);
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

  const player = {
    rover,
    sprite,
    prevState: null,
    nextState: null,
    stateTime: 0,
    interpDuration: 1 / 15,
  };

  remotePlayers.set(id, player);
}

export function removePlayer(scene, id) {
  const player = remotePlayers.get(id);
  if (!player) return;

  scene.remove(player.rover.group);
  player.sprite.material.map.dispose();
  player.sprite.material.dispose();
  remotePlayers.delete(id);
}

export function updatePlayerState(id, data) {
  const player = remotePlayers.get(id);
  if (!player) return;

  const quat = data.quaternion || { x: 0, y: 0, z: 0, w: 1 };

  player.prevState = player.nextState || {
    position: { ...data.position },
    quaternion: { ...quat },
  };
  player.nextState = {
    position: { ...data.position },
    quaternion: { ...quat },
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

    const qPrev = new THREE.Quaternion(prev.quaternion.x, prev.quaternion.y, prev.quaternion.z, prev.quaternion.w);
    const qNext = new THREE.Quaternion(next.quaternion.x, next.quaternion.y, next.quaternion.z, next.quaternion.w);
    group.quaternion.copy(qPrev.slerp(qNext, t));
  }
}

export function getPlayerCount() {
  return remotePlayers.size;
}
