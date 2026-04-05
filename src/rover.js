import * as THREE from 'three';
import { getTerrainHeight, getTerrainNormal } from './terrain.js';
import {
  GRAVITY, ROVER_MAX_SPEED, ROVER_ACCELERATION,
  ROVER_TURN_SPEED, ROVER_FRICTION, ROVER_BRAKE_FRICTION,
} from './constants.js';

export function createRover(scene, color = '#ffffff') {
  const group = new THREE.Group();

  // Body
  const bodyGeo = new THREE.BoxGeometry(2, 0.6, 3);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xcccccc,
    roughness: 0.4,
    metalness: 0.6,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.7;
  body.castShadow = true;
  group.add(body);

  // Cabin
  const cabinGeo = new THREE.BoxGeometry(1.4, 0.5, 1.2);
  const cabinMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.3,
    metalness: 0.4,
  });
  const cabin = new THREE.Mesh(cabinGeo, cabinMat);
  cabin.position.set(0, 1.25, -0.3);
  cabin.castShadow = true;
  group.add(cabin);

  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.35, 12);
  const wheelMat = new THREE.MeshStandardMaterial({
    color: 0x333333,
    roughness: 0.8,
    metalness: 0.3,
  });

  const wheelPositions = [
    [-1.1, 0.35, 1.0],
    [1.1, 0.35, 1.0],
    [-1.1, 0.35, -1.0],
    [1.1, 0.35, -1.0],
  ];

  const wheels = [];
  for (const [wx, wy, wz] of wheelPositions) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, wy, wz);
    wheel.castShadow = true;
    wheels.push(wheel);
    group.add(wheel);
  }

  // Antenna
  const antennaGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6);
  const antennaMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa });
  const antenna = new THREE.Mesh(antennaGeo, antennaMat);
  antenna.position.set(0.5, 1.8, -0.8);
  group.add(antenna);

  // Antenna tip
  const tipGeo = new THREE.SphereGeometry(0.08, 8, 8);
  const tipMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.5,
  });
  const tip = new THREE.Mesh(tipGeo, tipMat);
  tip.position.set(0.5, 2.4, -0.8);
  group.add(tip);

  // Solar panel
  const panelGeo = new THREE.BoxGeometry(1.8, 0.05, 0.8);
  const panelMat = new THREE.MeshStandardMaterial({
    color: 0x223366,
    roughness: 0.2,
    metalness: 0.8,
  });
  const panel = new THREE.Mesh(panelGeo, panelMat);
  panel.position.set(0, 1.15, 1.2);
  panel.castShadow = true;
  group.add(panel);

  // Dust particle system
  const dustCount = 80;
  const dustGeo = new THREE.BufferGeometry();
  const dustPositions = new Float32Array(dustCount * 3);
  const dustVelocities = new Float32Array(dustCount * 3);
  const dustLifetimes = new Float32Array(dustCount);
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));

  const dustMat = new THREE.PointsMaterial({
    color: 0x999999,
    size: 0.3,
    transparent: true,
    opacity: 0.6,
    sizeAttenuation: true,
  });

  const dust = new THREE.Points(dustGeo, dustMat);
  scene.add(dust);

  let dustIndex = 0;

  scene.add(group);

  // Physics state
  let speed = 0;
  let velocityY = 0;
  let grounded = false;

  const input = { forward: 0, turn: 0, brake: false };

  function update(dt) {
    // Steering
    if (Math.abs(speed) > 0.5) {
      const turnAmount = input.turn * ROVER_TURN_SPEED * dt * Math.sign(speed);
      group.rotation.y += turnAmount;
    }

    // Acceleration
    speed += input.forward * ROVER_ACCELERATION * dt;
    speed = Math.max(-ROVER_MAX_SPEED * 0.5, Math.min(ROVER_MAX_SPEED, speed));

    // Friction / braking
    if (input.brake) {
      speed *= ROVER_BRAKE_FRICTION;
    } else if (input.forward === 0) {
      speed *= ROVER_FRICTION;
    }

    if (Math.abs(speed) < 0.05) speed = 0;

    // Move forward in the rover's local direction
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(group.quaternion);

    group.position.x += forward.x * speed * dt;
    group.position.z += forward.z * speed * dt;

    // Gravity
    velocityY -= GRAVITY * dt;
    group.position.y += velocityY * dt;

    // Terrain collision
    const terrainY = getTerrainHeight(group.position.x, group.position.z);
    const roverBottom = terrainY + 0.45; // wheel radius offset

    if (group.position.y <= roverBottom) {
      group.position.y = roverBottom;
      if (velocityY < -2) {
        // Bounce on hard landing
        velocityY = -velocityY * 0.2;
      } else {
        velocityY = 0;
      }
      grounded = true;
    } else {
      grounded = false;
    }

    // Align rover to terrain normal (smoothed)
    if (grounded) {
      const normal = getTerrainNormal(group.position.x, group.position.z);
      const up = new THREE.Vector3(0, 1, 0);
      const q = new THREE.Quaternion().setFromUnitVectors(up, normal);

      // Keep the rover's Y rotation, blend in terrain alignment
      const yRotation = new THREE.Euler(0, group.rotation.y, 0);
      const yQuat = new THREE.Quaternion().setFromEuler(yRotation);
      const targetQuat = q.multiply(yQuat);

      group.quaternion.slerp(targetQuat, dt * 5);
    }

    // Spin wheels
    const wheelSpin = speed * dt * 2;
    for (const wheel of wheels) {
      wheel.rotation.x += wheelSpin;
    }

    // Dust particles
    if (grounded && Math.abs(speed) > 1) {
      for (let i = 0; i < 2; i++) {
        const idx = (dustIndex % dustCount) * 3;
        dustPositions[idx] = group.position.x + (Math.random() - 0.5) * 1.5;
        dustPositions[idx + 1] = group.position.y;
        dustPositions[idx + 2] = group.position.z + (Math.random() - 0.5) * 1.5;
        dustVelocities[idx] = (Math.random() - 0.5) * 0.5;
        dustVelocities[idx + 1] = Math.random() * 1.5;
        dustVelocities[idx + 2] = (Math.random() - 0.5) * 0.5;
        dustLifetimes[dustIndex % dustCount] = 1.0;
        dustIndex++;
      }
    }

    // Update dust
    for (let i = 0; i < dustCount; i++) {
      if (dustLifetimes[i] > 0) {
        dustLifetimes[i] -= dt;
        const idx = i * 3;
        dustPositions[idx] += dustVelocities[idx] * dt;
        dustPositions[idx + 1] += dustVelocities[idx + 1] * dt;
        dustPositions[idx + 2] += dustVelocities[idx + 2] * dt;
        dustVelocities[idx + 1] -= 0.3 * dt; // slight gravity on dust
      } else {
        // Move dead particles out of view
        const idx = i * 3;
        dustPositions[idx + 1] = -1000;
      }
    }
    dustGeo.attributes.position.needsUpdate = true;
  }

  function setInput(newInput) {
    input.forward = newInput.forward;
    input.turn = newInput.turn;
    input.brake = newInput.brake;
  }

  function getState() {
    return {
      position: {
        x: group.position.x,
        y: group.position.y,
        z: group.position.z,
      },
      rotation: {
        x: group.rotation.x,
        y: group.rotation.y,
        z: group.rotation.z,
      },
    };
  }

  function setPositionRotation(pos, rot) {
    group.position.set(pos.x, pos.y, pos.z);
    group.rotation.set(rot.x, rot.y, rot.z);
  }

  return { group, update, setInput, getState, setPositionRotation };
}
