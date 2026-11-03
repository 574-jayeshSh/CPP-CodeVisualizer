import { io, Socket } from "socket.io-client";

import type { ClientSocketEvents, SocketEvents } from "@codelens/shared";

import { getToken } from "./api";

export type AppSocket = Socket<SocketEvents, ClientSocketEvents>;

let socket: AppSocket | null = null;

export function getSocket(): AppSocket {
  if (!socket) {
    socket = io({
      autoConnect: true,
      transports: ["websocket", "polling"],
      auth: { token: getToken() },
    });
  }

  return socket;
}

export function syncSocketAuth(): void {
  if (!socket) return;

  socket.auth = { token: getToken() };

  if (socket.connected) {
    socket.disconnect();
    socket.connect();
  }
}
