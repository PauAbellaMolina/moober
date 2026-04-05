import * as THREE from 'three';

export function createSky(scene) {
  // Procedural starfield
  const starCount = 3000;
  const starGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(starCount * 3);
  const sizes = new Float32Array(starCount);

  for (let i = 0; i < starCount; i++) {
    // Random point on a sphere
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

  // Earth
  const earthGeo = new THREE.SphereGeometry(20, 32, 32);
  const earthMat = new THREE.MeshBasicMaterial({
    color: 0x4488cc,
  });
  const earth = new THREE.Mesh(earthGeo, earthMat);
  earth.position.set(200, 280, -400);
  scene.add(earth);

  // Earth glow (atmosphere halo)
  const glowGeo = new THREE.SphereGeometry(22, 32, 32);
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0x88bbff,
    transparent: true,
    opacity: 0.15,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.position.copy(earth.position);
  scene.add(glow);

  // Add some "continent" patches using a second sphere with vertex displacement
  const landGeo = new THREE.SphereGeometry(20.1, 32, 32);
  const landMat = new THREE.MeshBasicMaterial({
    color: 0x44aa55,
    transparent: true,
    opacity: 0.5,
  });
  const land = new THREE.Mesh(landGeo, landMat);
  land.position.copy(earth.position);
  scene.add(land);

  return {
    update(dt) {
      earth.rotation.y += dt * 0.02;
      land.rotation.y += dt * 0.02;
    },
  };
}
