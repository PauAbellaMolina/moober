import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { createTerrain, craters, rng } from './terrain.js';
import { createSky } from './sky.js';
import { createRover } from './rover.js';
import { createChaseCamera } from './camera.js';
import { connect, sendMove, on, getSocketId } from './network.js';
import { addPlayer, removePlayer, updatePlayerState, interpolatePlayers, getPlayerCount } from './players.js';
import { createMiningSystem, MINERAL_TYPES, TOOLS } from './mining.js';
import { NETWORK_TICK_RATE } from './constants.js';

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x000000);
document.body.appendChild(renderer.domElement);

// Post-processing — rover cam VHS shader
const RoverCamShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform vec2 resolution;
    varying vec2 vUv;

    float rand(vec2 co) {
      return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;

      // Chromatic aberration — subtle RGB split
      float aberr = 0.0012;
      float r = texture2D(tDiffuse, uv + vec2(aberr, 0.0)).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - vec2(aberr, 0.0)).b;
      vec3 col = vec3(r, g, b);

      // Scanlines — barely visible
      float scanline = sin(uv.y * resolution.y * 1.5) * 0.5 + 0.5;
      col *= 0.98 + 0.02 * scanline;

      // Film grain — very subtle
      float grain = rand(uv * resolution + time * 100.0) * 0.04;
      col += grain - 0.02;

      // Vignette — only at the very edges
      float dist = length(uv - 0.5);
      float vig = 1.0 - dist * dist * 0.3;
      col *= vig;

      // sRGB gamma correction (EffectComposer works in linear space)
      col = pow(col, vec3(1.0 / 2.2));

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

const composer = new EffectComposer(renderer);

// Scene
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 0.0015);

// Camera
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1500);
camera.position.set(100, 60, -80);

// Post-processing passes
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
const vhsPass = new ShaderPass(RoverCamShader);
composer.addPass(vhsPass);

// Lighting
const SUN_DIR = new THREE.Vector3(1, 0.5, -0.3).normalize();

const sunLight = new THREE.DirectionalLight(0xffeedd, 2.0);
sunLight.position.copy(SUN_DIR.clone().multiplyScalar(150));
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 10;
sunLight.shadow.camera.far = 300;
sunLight.shadow.camera.left = -60;
sunLight.shadow.camera.right = 60;
sunLight.shadow.camera.top = 60;
sunLight.shadow.camera.bottom = -60;
scene.add(sunLight);
scene.add(sunLight.target);

const ambientLight = new THREE.AmbientLight(0x222233, 0.5);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0x112244, 0x000000, 0.3);
scene.add(hemiLight);

// World
createTerrain(scene);
const sky = createSky(scene);

// Mining system
const mining = createMiningSystem(scene, craters, rng);

// Build inventory HUD
const inventoryHud = document.getElementById('inventory-hud');
for (const m of MINERAL_TYPES) {
  const row = document.createElement('div');
  row.className = 'mineral-row';
  row.innerHTML = `<span class="mineral-count" id="inv-${m.id}">0</span>
    <span>${m.symbol}</span>
    <span class="mineral-dot" style="background:#${m.color.toString(16).padStart(6, '0')}"></span>`;
  inventoryHud.appendChild(row);
}

// Local rover
let localRover = null;
let chaseCamera = null;
let gameStarted = false;

// Input
const keys = {};
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyH' && localRover) localRover.toggleLights();
  if (e.code === 'Digit1') mining.setTool(TOOLS.DRIVE);
  if (e.code === 'Digit2') mining.setTool(TOOLS.DRILL);
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

function getInput() {
  let forward = 0;
  let turn = 0;
  let brake = false;

  if (keys['KeyW'] || keys['ArrowUp']) forward = 1;
  if (keys['KeyS'] || keys['ArrowDown']) forward = -1;
  if (keys['KeyA'] || keys['ArrowLeft']) turn = 1;
  if (keys['KeyD'] || keys['ArrowRight']) turn = -1;
  if (keys['Space']) brake = true;

  return { forward, turn, brake };
}

// Network
let networkAccum = 0;
const networkInterval = 1 / NETWORK_TICK_RATE;

on('onCurrentPlayers', (players) => {
  const myId = getSocketId();
  for (const [id, data] of Object.entries(players)) {
    if (id === myId) continue;
    addPlayer(scene, id, data);
  }
  updatePlayerHUD();
});

on('onPlayerJoined', (data) => {
  addPlayer(scene, data.id, data);
  updatePlayerHUD();
});

on('onPlayerMoved', (data) => {
  updatePlayerState(data.id, data);
});

on('onPlayerLeft', (data) => {
  removePlayer(scene, data.id);
  updatePlayerHUD();
});

function updatePlayerHUD() {
  const count = getPlayerCount() + 1;
  document.getElementById('player-count').textContent =
    `${count} rover${count !== 1 ? 's' : ''} online`;
}

// Join flow
document.getElementById('join-btn').addEventListener('click', startGame);
document.getElementById('name-input').addEventListener('keydown', (e) => {
  if (e.code === 'Enter') startGame();
});

function startGame() {
  const nameInput = document.getElementById('name-input');
  const name = nameInput.value.trim() || 'Rover';

  document.getElementById('join-modal').classList.add('hidden');

  localRover = createRover(scene, '#4ecdc4');
  chaseCamera = createChaseCamera(camera);
  gameStarted = true;

  connect(name);
  updatePlayerHUD();
}

// Resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  vhsPass.uniforms.resolution.value.set(window.innerWidth, window.innerHeight);
});

// Shadow camera follows rover
function updateShadowCamera() {
  if (!localRover) return;
  const pos = localRover.group.position;
  sunLight.position.copy(pos).add(SUN_DIR.clone().multiplyScalar(150));
  sunLight.target.position.copy(pos);
  sunLight.target.updateMatrixWorld();
}

// HUD refs
const toolDriveEl = document.getElementById('tool-drive');
const toolDrillEl = document.getElementById('tool-drill');
const promptEl = document.getElementById('interaction-prompt');
const promptTextEl = document.getElementById('prompt-text');

function updateMiningHUD(nearby) {
  // Tool indicator
  const tool = mining.getTool();
  toolDriveEl.classList.toggle('active', tool === TOOLS.DRIVE);
  toolDrillEl.classList.toggle('active', tool === TOOLS.DRILL);

  // Interaction prompt
  const drilling = mining.getDrilling();
  if (drilling && nearby) {
    promptEl.classList.add('visible');
    promptTextEl.textContent = `Mining ${nearby.mineral.name}...`;
  } else if (drilling && !nearby) {
    promptEl.classList.add('visible');
    promptTextEl.textContent = `Mining Moon Rock...`;
  } else if (nearby && tool === TOOLS.DRILL) {
    promptEl.classList.add('visible');
    promptTextEl.textContent = `Hold E - Mine ${nearby.mineral.name} (${nearby.amount} left)`;
  } else if (nearby && tool === TOOLS.DRIVE) {
    promptEl.classList.add('visible');
    promptTextEl.textContent = `${nearby.mineral.name} deposit - Press 2 for drill`;
  } else if (tool === TOOLS.DRILL) {
    promptEl.classList.add('visible');
    promptTextEl.textContent = `Hold E - Mine Moon Rock`;
  } else {
    promptEl.classList.remove('visible');
  }

  // Inventory counts
  const inv = mining.getInventory();
  for (const m of MINERAL_TYPES) {
    const el = document.getElementById(`inv-${m.id}`);
    if (el) el.textContent = inv[m.id];
  }
}

// Game loop
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.1);

  sky.update(dt);

  if (gameStarted && localRover) {
    const input = getInput();
    localRover.setInput(input);
    localRover.update(dt, SUN_DIR);
    chaseCamera.update(dt, localRover.group);
    updateShadowCamera();

    // Battery HUD
    const bat = localRover.getBattery();
    const batFill = document.getElementById('battery-fill');
    const batText = document.getElementById('battery-text');
    batFill.style.width = bat + '%';
    batFill.style.backgroundColor = bat > 25 ? '#4ecdc4' : bat > 10 ? '#ffe66d' : '#ff6b6b';
    batText.textContent = Math.ceil(bat) + '%';

    // Mining
    const batteryRef = { drain: (amt) => localRover.drainBattery(amt) };
    const nearby = mining.update(
      dt,
      localRover.group.position,
      localRover.getSpeed(),
      keys['KeyE'] || false,
      batteryRef
    );
    updateMiningHUD(nearby);

    // Network
    networkAccum += dt;
    if (networkAccum >= networkInterval) {
      networkAccum -= networkInterval;
      sendMove(localRover.getState());
    }
  }

  interpolatePlayers(dt);
  vhsPass.uniforms.time.value += dt;
  composer.render();
}

animate();
