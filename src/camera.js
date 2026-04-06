import * as THREE from 'three';
import { getTerrainRadius } from './terrain.js';
import { CAMERA_FOLLOW_DISTANCE, CAMERA_HEIGHT, CAMERA_DAMPING } from './constants.js';

export function createChaseCamera(camera) {
  const lookTarget = new THREE.Vector3();

  // Mouse orbit state
  let orbitX = 0; // horizontal angle offset (radians)
  let orbitY = 0; // vertical angle offset (radians)
  let isDragging = false;
  let lastMouseX = 0;
  let lastMouseY = 0;
  let idleTime = 0; // time since last mouse movement
  const MOUSE_SENSITIVITY = 0.004;
  const RETURN_DELAY = 0.8;  // seconds before snapping back
  const RETURN_SPEED = 3.0;

  window.addEventListener('mousedown', (e) => {
    if (e.button === 0 || e.button === 2) {
      isDragging = true;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - lastMouseX;
    const dy = e.clientY - lastMouseY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    orbitX -= dx * MOUSE_SENSITIVITY;
    orbitY -= dy * MOUSE_SENSITIVITY;
    orbitY = Math.max(-1.2, Math.min(1.2, orbitY)); // clamp vertical
    idleTime = 0;
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
  });

  // Prevent context menu on right-click
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  function update(dt, roverGroup) {
    const up = roverGroup.position.clone().normalize();

    // Smoothly return to default when not dragging
    if (!isDragging) {
      idleTime += dt;
      if (idleTime > RETURN_DELAY) {
        const t = 1 - Math.exp(-RETURN_SPEED * dt);
        orbitX += (0 - orbitX) * t;
        orbitY += (0 - orbitY) * t;
        if (Math.abs(orbitX) < 0.001) orbitX = 0;
        if (Math.abs(orbitY) < 0.001) orbitY = 0;
      }
    }

    // Base vectors: behind and above the rover
    const backward = new THREE.Vector3(0, 0, 1).applyQuaternion(roverGroup.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(roverGroup.quaternion);

    // Orbit: rotate the camera offset around the rover
    // Horizontal orbit: rotate backward vector around up axis
    const orbitBackward = backward.clone()
      .applyAxisAngle(up, orbitX);
    // Vertical orbit: tilt up/down
    const orbitRight = right.clone().applyAxisAngle(up, orbitX);
    orbitBackward.applyAxisAngle(orbitRight, orbitY);

    const desired = roverGroup.position.clone()
      .add(orbitBackward.multiplyScalar(CAMERA_FOLLOW_DISTANCE))
      .add(up.clone().multiplyScalar(CAMERA_HEIGHT));

    // Don't let camera go below terrain
    const camDir = desired.clone().normalize();
    const terrainR = getTerrainRadius(camDir);
    if (desired.length() < terrainR + 2) {
      desired.copy(camDir.multiplyScalar(terrainR + 2));
    }

    // Smooth follow
    const damping = 1 - Math.exp(-CAMERA_DAMPING * dt);
    camera.position.lerp(desired, damping);

    // Always look at the rover
    lookTarget.copy(roverGroup.position);

    camera.up.copy(up);
    camera.lookAt(lookTarget);
  }

  return { update };
}
