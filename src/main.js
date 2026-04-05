import * as THREE from 'three';
import { createTerrain } from './terrain.js';
import { createSky } from './sky.js';
import { createRover } from './rover.js';
import { createChaseCamera } from './camera.js';
import { connect, sendMove, on, getSocketId } from './network.js';
import { addPlayer, removePlayer, updatePlayerState, interpolatePlayers, getPlayerCount } from './players.js';
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

// Scene
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 0.003);

// Camera
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1500);
camera.position.set(0, 10, 20);

// Lighting
const sunLight = new THREE.DirectionalLight(0xffeedd, 2.0);
sunLight.position.set(100, 80, -50);
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

const ambientLight = new THREE.AmbientLight(0x222233, 0.4);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0x112244, 0x000000, 0.3);
scene.add(hemiLight);

// World
createTerrain(scene);
const sky = createSky(scene);

// Local rover
let localRover = null;
let chaseCamera = null;
let gameStarted = false;

// Input
const keys = {};
window.addEventListener('keydown', (e) => { keys[e.code] = true; });
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
    if (id === myId) {
      // Set our color
      if (localRover && data.color) {
        // Already created with default, we could recreate but it's fine
      }
      continue;
    }
    addPlayer(scene, id, data);
  }
  updateHUD();
});

on('onPlayerJoined', (data) => {
  addPlayer(scene, data.id, data);
  updateHUD();
});

on('onPlayerMoved', (data) => {
  updatePlayerState(data.id, data);
});

on('onPlayerLeft', (data) => {
  removePlayer(scene, data.id);
  updateHUD();
});

function updateHUD() {
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
  localRover.group.position.set(0, 10, 0);
  chaseCamera = createChaseCamera(camera);
  gameStarted = true;

  connect(name);
  updateHUD();
}

// Resize
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Shadow follow (attach shadow camera to rover position)
function updateShadowCamera() {
  if (!localRover) return;
  const pos = localRover.group.position;
  sunLight.position.set(pos.x + 100, pos.y + 80, pos.z - 50);
  sunLight.target.position.copy(pos);
  sunLight.target.updateMatrixWorld();
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
    localRover.update(dt);
    chaseCamera.update(dt, localRover.group);
    updateShadowCamera();

    // Send position to server
    networkAccum += dt;
    if (networkAccum >= networkInterval) {
      networkAccum -= networkInterval;
      sendMove(localRover.getState());
    }
  }

  interpolatePlayers(dt);
  renderer.render(scene, camera);
}

animate();
