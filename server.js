import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

// Serve built files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(join(__dirname, 'dist')));
}

const players = {};

const COLORS = [
  '#ff6b6b', '#4ecdc4', '#ffe66d', '#a29bfe',
  '#fd79a8', '#00cec9', '#ffeaa7', '#6c5ce7',
  '#fab1a0', '#81ecec', '#55efc4', '#74b9ff',
];

let colorIndex = 0;

const MOON_RADIUS = 210; // slightly above surface so rover falls and snaps

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('join', (data) => {
    const color = COLORS[colorIndex % COLORS.length];
    colorIndex++;

    // Random point on the sphere surface
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const sx = Math.sin(phi) * Math.cos(theta);
    const sy = Math.sin(phi) * Math.sin(theta);
    const sz = Math.cos(phi);

    players[socket.id] = {
      id: socket.id,
      name: data.name || 'Anonymous',
      color,
      position: { x: sx * MOON_RADIUS, y: sy * MOON_RADIUS, z: sz * MOON_RADIUS },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
    };

    // Send current players to the new player
    socket.emit('current-players', players);

    // Tell everyone else about the new player
    socket.broadcast.emit('player-joined', players[socket.id]);

    console.log(`${data.name} joined (${Object.keys(players).length} players online)`);
  });

  socket.on('move', (data) => {
    if (!players[socket.id]) return;
    players[socket.id].position = data.position;
    players[socket.id].quaternion = data.quaternion;

    socket.broadcast.emit('player-moved', {
      id: socket.id,
      position: data.position,
      quaternion: data.quaternion,
    });
  });

  socket.on('disconnect', () => {
    if (players[socket.id]) {
      console.log(`${players[socket.id].name} left`);
      delete players[socket.id];
      io.emit('player-left', { id: socket.id });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Moober server running on http://localhost:${PORT}`);
});
