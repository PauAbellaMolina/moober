import * as THREE from 'three';
import { getTerrainHeight } from './terrain.js';
import { CAMERA_FOLLOW_DISTANCE, CAMERA_HEIGHT, CAMERA_DAMPING } from './constants.js';

export function createChaseCamera(camera) {
  const offset = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();

  function update(dt, roverGroup) {
    // Desired position: behind and above the rover
    const backward = new THREE.Vector3(0, 0, 1);
    backward.applyQuaternion(roverGroup.quaternion);

    const desired = roverGroup.position.clone()
      .add(backward.multiplyScalar(CAMERA_FOLLOW_DISTANCE))
      .add(new THREE.Vector3(0, CAMERA_HEIGHT, 0));

    // Don't let camera go below terrain
    const terrainY = getTerrainHeight(desired.x, desired.z) + 2;
    if (desired.y < terrainY) {
      desired.y = terrainY;
    }

    // Smooth follow
    const damping = 1 - Math.exp(-CAMERA_DAMPING * dt);
    camera.position.lerp(desired, damping);

    // Look ahead of the rover
    const forward = new THREE.Vector3(0, 0, -1);
    forward.applyQuaternion(roverGroup.quaternion);
    lookTarget.copy(roverGroup.position).add(forward.multiplyScalar(5));
    lookTarget.y += 1;

    camera.lookAt(lookTarget);
  }

  return { update };
}
