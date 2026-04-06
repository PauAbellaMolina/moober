import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getTerrainRadius, getTerrainNormal } from './terrain.js';
import {
  GRAVITY, ROVER_MAX_SPEED, ROVER_ACCELERATION,
  ROVER_TURN_SPEED, ROVER_FRICTION, ROVER_BRAKE_FRICTION,
  MOON_RADIUS,
} from './constants.js';

const MODEL_SCALE = 0.38;
const MODEL_Z_OFFSET = -0.29; // center the model (raw center is shifted in Z)

const gltfLoader = new GLTFLoader();
let cachedModel = null;

function loadModel() {
  if (cachedModel) return Promise.resolve(cachedModel.clone());
  return new Promise((resolve) => {
    gltfLoader.load('/models/space-rover.glb', (gltf) => {
      cachedModel = gltf.scene;
      resolve(cachedModel.clone());
    });
  });
}

export function createRover(scene, color = '#ffffff') {
  const group = new THREE.Group();

  // Load the GLB model asynchronously
  loadModel().then((model) => {
    model.scale.setScalar(MODEL_SCALE);
    model.rotation.y = Math.PI;
    model.position.set(0, 0, -MODEL_Z_OFFSET);
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    group.add(model);
  });

  // --- Lights (positioned relative to scaled model) ---
  // Model at 0.38 scale: front ~Z=-1.3, back ~Z=1.9, top ~Y=2.6, width ~±1.0

  // Headlights — front
  const headlightGeo = new THREE.CylinderGeometry(0.1, 0.12, 0.08, 10);
  const headlightMatL = new THREE.MeshStandardMaterial({
    color: 0x444444, emissive: 0x000000, roughness: 0.3, metalness: 0.5,
  });
  const headlightMatR = headlightMatL.clone();
  const headlightL = new THREE.Mesh(headlightGeo, headlightMatL);
  headlightL.rotation.x = Math.PI / 2;
  headlightL.position.set(-0.5, 0.9, -0.6);
  group.add(headlightL);
  const headlightR = new THREE.Mesh(headlightGeo, headlightMatR);
  headlightR.rotation.x = Math.PI / 2;
  headlightR.position.set(0.5, 0.9, -0.6);
  group.add(headlightR);

  // Powerful front spotlights
  const spotL = new THREE.SpotLight(0xffeedd, 0, 80, Math.PI / 4, 0.3, 1.2);
  spotL.position.set(-0.5, 0.9, -0.6);
  spotL.target.position.set(-0.6, 0.0, -14);
  group.add(spotL);
  group.add(spotL.target);

  const spotR = new THREE.SpotLight(0xffeedd, 0, 80, Math.PI / 4, 0.3, 1.2);
  spotR.position.set(0.5, 0.9, -0.6);
  spotR.target.position.set(0.6, 0.0, -14);
  group.add(spotR);
  group.add(spotR.target);

  // Point light to illuminate the rover itself and nearby ground
  const roverGlow = new THREE.PointLight(0xddeeff, 0, 15, 2);
  roverGlow.position.set(0, 1.8, 0);
  group.add(roverGlow);

  // Rear marker glow (no visible meshes, just the light)
  const markerGlow = new THREE.PointLight(0xff8800, 0, 5, 2);
  markerGlow.position.set(0, 0.9, 1.7);
  group.add(markerGlow);

  // Battery & lights state
  let battery = 100;
  let lightsOn = false;
  const BATTERY_DRAIN_DRIVE = 3;
  const BATTERY_DRAIN_LIGHTS = 2;
  const BATTERY_RECHARGE = 1.5;

  // Dust particle system
  const dustCount = 100;
  const dustGeo = new THREE.BufferGeometry();
  const dustPositions = new Float32Array(dustCount * 3);
  const dustVelocities = new Float32Array(dustCount * 3);
  const dustLifetimes = new Float32Array(dustCount);
  const dustMaxLifetimes = new Float32Array(dustCount);
  for (let i = 0; i < dustCount; i++) dustPositions[i * 3 + 1] = -1000;
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  dustGeo.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(dustCount), 1));

  const dustMat = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: `
      attribute float aLife;
      varying float vLife;
      void main() {
        vLife = aLife;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = mix(6.0, 2.0, 1.0 - aLife) * (200.0 / -mvPos.z);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      varying float vLife;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float soft = 1.0 - smoothstep(0.0, 1.0, d);
        float alpha = soft * vLife * 0.5;
        vec3 col = vec3(0.7, 0.65, 0.6);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false;
  scene.add(dust);

  let dustIndex = 0;

  // Charge spark particle system
  const sparkCount = 60;
  const sparkGeo = new THREE.BufferGeometry();
  const sparkPositions = new Float32Array(sparkCount * 3);
  const sparkVelocities = new Float32Array(sparkCount * 3);
  const sparkLifetimes = new Float32Array(sparkCount);
  const sparkMaxLifetimes = new Float32Array(sparkCount);
  for (let i = 0; i < sparkCount; i++) sparkPositions[i * 3 + 1] = -1000;
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
  sparkGeo.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(sparkCount), 1));

  const sparkMat = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: `
      attribute float aLife;
      varying float vLife;
      void main() {
        vLife = aLife;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = mix(1.0, 4.0, aLife) * (200.0 / -mvPos.z);
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      varying float vLife;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        // Hot bright core with electric glow falloff
        float core = 1.0 - smoothstep(0.0, 0.3, d);
        float glow = 1.0 - smoothstep(0.0, 1.0, d);
        float brightness = core + glow * 0.5;
        // Color: white-hot center, yellow-orange edge
        vec3 hot = vec3(1.0, 1.0, 0.95);
        vec3 warm = vec3(1.0, 0.7, 0.15);
        vec3 col = mix(warm, hot, core);
        float alpha = brightness * vLife;
        gl_FragColor = vec4(col * 1.5, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const sparks = new THREE.Points(sparkGeo, sparkMat);
  sparks.frustumCulled = false;
  scene.add(sparks);

  let sparkIndex = 0;
  let sunExposure = 0;

  scene.add(group);

  // Physics state
  let speed = 0;
  let radialVelocity = 0;
  let grounded = false;

  // Spawn on the sun-facing side
  const _spawnDir = new THREE.Vector3(1, 0.5, -0.3).normalize();
  const orientation = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), _spawnDir
  );

  let currentRadius = getTerrainRadius(_spawnDir) + 5;

  const input = { forward: 0, turn: 0, brake: false };

  const _up = new THREE.Vector3();
  const _forward = new THREE.Vector3();
  const _right = new THREE.Vector3();

  function update(dt, sunDir) {
    // Solar exposure
    const panelUp = new THREE.Vector3(0, 1, 0).applyQuaternion(group.quaternion);
    sunExposure = sunDir ? Math.max(0, panelUp.dot(sunDir)) : 0;

    // Battery drain & recharge
    let drain = 0;
    if (lightsOn) drain += BATTERY_DRAIN_LIGHTS;
    if (Math.abs(speed) > 0.5) drain += BATTERY_DRAIN_DRIVE * (Math.abs(speed) / ROVER_MAX_SPEED);
    const chargeRate = BATTERY_RECHARGE * sunExposure;
    const netRate = chargeRate - drain;
    battery += netRate * dt;
    battery = Math.max(0, Math.min(100, battery));
    const isCharging = netRate > 0 && battery < 100;

    // Dim lights when battery is dead instead of killing them
    if (lightsOn) {
      const dimFactor = battery > 0 ? 1 : 0.1;
      spotL.intensity = 30 * dimFactor;
      spotR.intensity = 30 * dimFactor;
      roverGlow.intensity = 3 * dimFactor;
      markerGlow.intensity = 2 * dimFactor;
    }

    // Acceleration — at 0% battery, crawl at 15% power
    const powerFactor = battery > 0 ? 1 : 0.15;
    speed += input.forward * ROVER_ACCELERATION * powerFactor * dt;
    const maxSpd = ROVER_MAX_SPEED * powerFactor;
    speed = Math.max(-maxSpd * 0.5, Math.min(maxSpd, speed));

    // Friction / braking
    if (input.brake) {
      speed *= ROVER_BRAKE_FRICTION;
    } else if (input.forward === 0) {
      speed *= ROVER_FRICTION;
    }
    if (Math.abs(speed) < 0.05) speed = 0;

    // Current radial direction
    _up.set(0, 1, 0).applyQuaternion(orientation);

    // Steering
    if (Math.abs(speed) > 0.5) {
      const turnAmount = input.turn * ROVER_TURN_SPEED * dt * Math.sign(speed);
      const turnQuat = new THREE.Quaternion().setFromAxisAngle(_up, turnAmount);
      orientation.premultiply(turnQuat);
      orientation.normalize();
    }

    // Forward movement
    if (speed !== 0) {
      _up.set(0, 1, 0).applyQuaternion(orientation);
      _forward.set(0, 0, -1).applyQuaternion(orientation);
      _forward.sub(_up.clone().multiplyScalar(_forward.dot(_up))).normalize();
      _right.crossVectors(_forward, _up);

      const angularSpeed = speed / currentRadius;
      const moveQuat = new THREE.Quaternion().setFromAxisAngle(_right, -angularSpeed * dt);
      orientation.premultiply(moveQuat);
      orientation.normalize();
    }

    // Final frame
    _up.set(0, 1, 0).applyQuaternion(orientation);
    _forward.set(0, 0, -1).applyQuaternion(orientation);
    _forward.sub(_up.clone().multiplyScalar(_forward.dot(_up))).normalize();
    _right.crossVectors(_forward, _up);

    // Gravity
    radialVelocity -= GRAVITY * dt;
    currentRadius += radialVelocity * dt;

    // Terrain collision
    const terrainR = getTerrainRadius(_up);
    const groundR = terrainR + 0.1;

    if (currentRadius <= groundR) {
      currentRadius = groundR;
      if (radialVelocity < -4) {
        radialVelocity = -radialVelocity * 0.15;
      } else {
        radialVelocity = 0;
      }
      grounded = true;
    } else {
      grounded = false;
    }

    // Set world position
    group.position.copy(_up).multiplyScalar(currentRadius);

    // Visual orientation
    const visualUp = grounded ? getTerrainNormal(_up) : _up.clone();
    const vForward = _forward.clone().sub(visualUp.clone().multiplyScalar(_forward.dot(visualUp))).normalize();
    const vRight = new THREE.Vector3().crossVectors(vForward, visualUp);

    const rotMatrix = new THREE.Matrix4().makeBasis(vRight, visualUp, vForward.clone().negate());
    const targetQuat = new THREE.Quaternion().setFromRotationMatrix(rotMatrix);
    group.quaternion.slerp(targetQuat, grounded ? dt * 8 : dt * 3);

    // Dust particles — only when driving
    const dustLifeArr = dustGeo.attributes.aLife.array;
    if (grounded && Math.abs(speed) > 1)
    for (let i = 0; i < 3; i++) {
      const di = dustIndex % dustCount;
      const idx = di * 3;
      const ox = (Math.random() - 0.5) * 2;
      const oz = (Math.random() - 0.5) * 2;
      dustPositions[idx] = group.position.x + _right.x * ox + _forward.x * oz;
      dustPositions[idx + 1] = group.position.y + _right.y * ox + _forward.y * oz;
      dustPositions[idx + 2] = group.position.z + _right.z * ox + _forward.z * oz;
      const outSpeed = 0.5 + Math.random() * 0.8;
      dustVelocities[idx] = _up.x * outSpeed + (Math.random() - 0.5) * 0.4;
      dustVelocities[idx + 1] = _up.y * outSpeed + (Math.random() - 0.5) * 0.4;
      dustVelocities[idx + 2] = _up.z * outSpeed + (Math.random() - 0.5) * 0.4;
      dustMaxLifetimes[di] = 1.2;
      dustLifetimes[di] = 1.2;
      dustIndex++;
    }

    // Update dust
    for (let i = 0; i < dustCount; i++) {
      if (dustLifetimes[i] > 0) {
        dustLifetimes[i] -= dt;
        const idx = i * 3;
        dustPositions[idx] += dustVelocities[idx] * dt;
        dustPositions[idx + 1] += dustVelocities[idx + 1] * dt;
        dustPositions[idx + 2] += dustVelocities[idx + 2] * dt;
        const px = dustPositions[idx], py = dustPositions[idx + 1], pz = dustPositions[idx + 2];
        const len = Math.sqrt(px * px + py * py + pz * pz) || 1;
        dustVelocities[idx] -= (px / len) * 0.4 * dt;
        dustVelocities[idx + 1] -= (py / len) * 0.4 * dt;
        dustVelocities[idx + 2] -= (pz / len) * 0.4 * dt;
        dustLifeArr[i] = Math.max(0, dustLifetimes[i] / dustMaxLifetimes[i]);
      } else {
        const idx = i * 3;
        dustPositions[idx] = 0;
        dustPositions[idx + 1] = -1000;
        dustPositions[idx + 2] = 0;
        dustLifeArr[i] = 0;
      }
    }
    dustGeo.attributes.position.needsUpdate = true;
    dustGeo.attributes.aLife.needsUpdate = true;

    // Charge sparks
    const sparkLifeArr = sparkGeo.attributes.aLife.array;
    if (isCharging && Math.abs(speed) < 0.5) {
      const sparkRate = Math.ceil(sunExposure * 6);
      for (let i = 0; i < sparkRate; i++) {
        const spi = sparkIndex % sparkCount;
        const si = spi * 3;
        const panelLocal = new THREE.Vector3(
          (Math.random() - 0.5) * 1.6, 1.2, 0.8 + Math.random() * 0.5
        );
        panelLocal.applyQuaternion(group.quaternion).add(group.position);
        sparkPositions[si] = panelLocal.x;
        sparkPositions[si + 1] = panelLocal.y;
        sparkPositions[si + 2] = panelLocal.z;
        const sparkSpeed = 3 + Math.random() * 4;
        const jitterX = (Math.random() - 0.5) * 3;
        const jitterZ = (Math.random() - 0.5) * 3;
        sparkVelocities[si] = _up.x * sparkSpeed + _right.x * jitterX + _forward.x * jitterZ;
        sparkVelocities[si + 1] = _up.y * sparkSpeed + _right.y * jitterX + _forward.y * jitterZ;
        sparkVelocities[si + 2] = _up.z * sparkSpeed + _right.z * jitterX + _forward.z * jitterZ;
        const life = 0.15 + Math.random() * 0.25;
        sparkMaxLifetimes[spi] = life;
        sparkLifetimes[spi] = life;
        sparkIndex++;
      }
    }

    // Update sparks
    for (let i = 0; i < sparkCount; i++) {
      if (sparkLifetimes[i] > 0) {
        sparkLifetimes[i] -= dt;
        const si = i * 3;
        sparkPositions[si] += sparkVelocities[si] * dt;
        sparkPositions[si + 1] += sparkVelocities[si + 1] * dt;
        sparkPositions[si + 2] += sparkVelocities[si + 2] * dt;
        const px = sparkPositions[si], py = sparkPositions[si + 1], pz = sparkPositions[si + 2];
        const len = Math.sqrt(px * px + py * py + pz * pz) || 1;
        sparkVelocities[si] -= (px / len) * 0.2 * dt;
        sparkVelocities[si + 1] -= (py / len) * 0.2 * dt;
        sparkVelocities[si + 2] -= (pz / len) * 0.2 * dt;
        sparkLifeArr[i] = Math.max(0, sparkLifetimes[i] / sparkMaxLifetimes[i]);
      } else {
        const si = i * 3;
        sparkPositions[si] = 0;
        sparkPositions[si + 1] = -1000;
        sparkPositions[si + 2] = 0;
        sparkLifeArr[i] = 0;
      }
    }
    sparkGeo.attributes.position.needsUpdate = true;
    sparkGeo.attributes.aLife.needsUpdate = true;
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
      quaternion: {
        x: group.quaternion.x,
        y: group.quaternion.y,
        z: group.quaternion.z,
        w: group.quaternion.w,
      },
    };
  }

  function setPositionQuaternion(pos, quat) {
    group.position.set(pos.x, pos.y, pos.z);
    if (quat && quat.w !== undefined) {
      group.quaternion.set(quat.x, quat.y, quat.z, quat.w);
    }
  }

  function setLightState(on) {
    spotL.intensity = on ? 30 : 0;
    spotR.intensity = on ? 30 : 0;
    headlightMatL.emissive.setHex(on ? 0xffeedd : 0x000000);
    headlightMatR.emissive.setHex(on ? 0xffeedd : 0x000000);
    headlightMatL.emissiveIntensity = on ? 2 : 0;
    headlightMatR.emissiveIntensity = on ? 2 : 0;
    roverGlow.intensity = on ? 3 : 0;
    markerGlow.intensity = on ? 2 : 0;
  }

  function toggleLights() {
    if (battery <= 0) return;
    lightsOn = !lightsOn;
    setLightState(lightsOn);
  }

  function getBattery() { return battery; }
  function drainBattery(amount) { battery = Math.max(0, battery - amount); }
  function getSpeed() { return speed; }
  function isLightsOn() { return lightsOn; }

  // Set initial position on the sun-facing side
  group.position.copy(_spawnDir).multiplyScalar(currentRadius);

  return { group, update, setInput, getState, setPositionQuaternion, toggleLights, getBattery, drainBattery, getSpeed, isLightsOn };
}
