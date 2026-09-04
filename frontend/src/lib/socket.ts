'use client';

import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from './api-client';

const WS_URL = process.env['NEXT_PUBLIC_WS_URL'] ?? 'http://localhost:3001';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(WS_URL, {
      autoConnect: false,
      transports: ['websocket'],
      // Function, not `{ token }`: Socket.io calls this on every handshake
      // (including auto-reconnect), so we send the current in-memory JWT.
      auth: (cb) => {
        cb({ token: getAccessToken() ?? '' });
      },
    });
  }
  return socket;
}

export function connectSocket(): Socket {
  const s = getSocket();
  if (!s.connected) s.connect();
  return s;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
