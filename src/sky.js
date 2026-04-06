import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export function createSky(scene) {
  // Procedural starfield
  const starCount = 3000;
  const starGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(starCount * 3);
  const sizes = new Float32Array(starCount);

  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 800;

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
    sizes[i] = 0.5 + Math.random() * 1.5;
  }

  starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  starGeo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const starMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.2,
    sizeAttenuation: true,
  });

  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // Sun — bright yellow spot
  const sunDir = new THREE.Vector3(1, 0.5, -0.3).normalize();
  const sunPos = sunDir.clone().multiplyScalar(700);

  const sunGeo = new THREE.SphereGeometry(8, 32, 32);
  const sunMat = new THREE.MeshBasicMaterial({ color: 0xffee55 });
  const sun = new THREE.Mesh(sunGeo, sunMat);
  sun.position.copy(sunPos);
  scene.add(sun);

  // --- Earth (GLB model) ---
  const earthPos = new THREE.Vector3(200, 280, -400);
  const earthRadius = 20;
  const earthScale = 0.06; // model is ~660 units across, scale to ~40 diameter

  let earthModel = null;
  const gltfLoader = new GLTFLoader();
  gltfLoader.load('/models/earth.glb', (gltf) => {
    earthModel = gltf.scene;
    earthModel.scale.setScalar(earthScale);
    // Center the model (raw Y center is ~380, X/Z roughly centered)
    earthModel.position.copy(earthPos);
    earthModel.traverse((child) => {
      if (child.isMesh) {
        child.material = child.material.clone();
        child.material.emissive = new THREE.Color(0x112233);
        child.material.emissiveIntensity = 0.3;
      }
    });
    scene.add(earthModel);
  });

  // Soft point light near Earth for ambient earthshine feel
  const earthLight = new THREE.PointLight(0x6699cc, 0.4, 120);
  earthLight.position.copy(earthPos);
  scene.add(earthLight);

  return {
    update(dt) {
      if (earthModel) earthModel.rotation.y += dt * 0.02;
    },
  };
}
