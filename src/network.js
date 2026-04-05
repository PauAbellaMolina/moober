import { io } from 'socket.io-client';

let socket;
const callbacks = {};

export function connect(playerName) {
  socket = io();

  socket.on('connect', () => {
    socket.emit('join', { name: playerName });
  });

  socket.on('current-players', (data) => callbacks.onCurrentPlayers?.(data));
  socket.on('player-joined', (data) => callbacks.onPlayerJoined?.(data));
  socket.on('player-moved', (data) => callbacks.onPlayerMoved?.(data));
  socket.on('player-left', (data) => callbacks.onPlayerLeft?.(data));
}

export function sendMove(state) {
  socket?.volatile.emit('move', state);
}

export function on(event, cb) {
  callbacks[event] = cb;
}

export function getSocketId() {
  return socket?.id;
}
