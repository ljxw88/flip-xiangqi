import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameView, Player } from '../game/engine';
import { isSupportedGameView, type ClientMessage, type ServerMessage } from './protocol';

type RoomStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'failed';

interface RoomSession {
  status: RoomStatus;
  room: string | null;
  player: Player | null;
  game: GameView | null;
  connected: [boolean, boolean];
  pending: boolean;
  error: string | null;
}

const emptySession = (): RoomSession => ({
  status: 'idle',
  room: null,
  player: null,
  game: null,
  connected: [false, false],
  pending: false,
  error: null,
});

function sessionKey(room: string): string {
  return `flip-xiangqi-room:${room}`;
}

function getToken(room: string): string | null {
  try {
    return sessionStorage.getItem(sessionKey(room));
  } catch {
    return null;
  }
}

function saveToken(room: string, token: string): void {
  try {
    sessionStorage.setItem(sessionKey(room), token);
  } catch {
    // The current connection still works when browser storage is unavailable.
  }
}

function updateRoomUrl(room: string | null): void {
  const url = new URL(window.location.href);
  if (room) url.searchParams.set('room', room);
  else url.searchParams.delete('room');
  window.history.replaceState(null, '', url);
}

function socketUrl(): string {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

export function useRoom() {
  const [session, setSession] = useState<RoomSession>(emptySession);
  const socketRef = useRef<WebSocket | null>(null);
  const tokensRef = useRef(new Map<string, string>());

  const connect = useCallback((request: Extract<ClientMessage, { type: 'create' | 'join' }>) => {
    const previous = socketRef.current;
    socketRef.current = null;
    previous?.close();
    const requestedRoom = request.type === 'join' ? request.room : null;
    setSession((current) => ({
      ...emptySession(),
      status: 'connecting',
      room: requestedRoom,
      ...(requestedRoom && current.room === requestedRoom
        ? { player: current.player, game: current.game }
        : {}),
    }));

    let socket: WebSocket;
    try {
      socket = new WebSocket(socketUrl());
    } catch {
      setSession((current) => ({ ...current, status: 'failed', error: 'Invalid WebSocket server URL.' }));
      return;
    }
    socketRef.current = socket;
    let joined = false;

    socket.onopen = () => {
      if (socketRef.current === socket) socket.send(JSON.stringify(request));
    };
    socket.onmessage = (event: MessageEvent<string>) => {
      if (socketRef.current !== socket) return;
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data) as ServerMessage;
      } catch {
        setSession((current) => ({ ...current, pending: false, error: 'Invalid server response.' }));
        return;
      }
      if (message.type === 'joined') {
        joined = true;
        tokensRef.current.set(message.room, message.token);
        saveToken(message.room, message.token);
        updateRoomUrl(message.room);
        setSession((current) => ({
          ...current,
          status: 'connected',
          room: message.room,
          player: message.player,
          error: null,
        }));
      } else if (message.type === 'state') {
        if (!isSupportedGameView(message.game)) {
          setSession((current) => ({
            ...current,
            status: 'failed',
            game: null,
            connected: [false, false],
            pending: false,
            error: 'The room server uses an incompatible game version. Restart it after updating.',
          }));
          socket.close();
          return;
        }
        setSession((current) => ({
          ...current,
          status: 'connected',
          game: message.game,
          connected: message.connected,
          pending: false,
          error: null,
        }));
      } else if (message.type === 'error') {
        setSession((current) => ({
          ...current,
          status: joined ? current.status : 'failed',
          pending: false,
          error: message.message,
        }));
        if (!joined) socket.close();
      }
    };
    socket.onerror = () => {
      if (socketRef.current !== socket) return;
      setSession((current) => ({
        ...current,
        pending: false,
        error: 'Could not connect to the room server. Make sure it is running.',
      }));
    };
    socket.onclose = () => {
      if (socketRef.current !== socket) return;
      socketRef.current = null;
      setSession((current) => ({
        ...current,
        status: current.status === 'failed' ? 'failed' : 'disconnected',
        connected: [false, false],
        pending: false,
      }));
    };
  }, []);

  const create = useCallback(() => {
    updateRoomUrl(null);
    connect({ type: 'create' });
  }, [connect]);

  const join = useCallback((room: string) => {
    const code = room.trim().toUpperCase();
    const token = tokensRef.current.get(code) ?? getToken(code);
    connect(token ? { type: 'join', room: code, token } : { type: 'join', room: code });
  }, [connect]);

  const leave = useCallback(() => {
    const socket = socketRef.current;
    socketRef.current = null;
    socket?.close();
    updateRoomUrl(null);
    setSession(emptySession());
  }, []);

  const send = useCallback((message: Extract<ClientMessage, { type: 'action' | 'rematch' }>) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setSession((current) => ({ ...current, error: 'Not connected to the room.' }));
      return;
    }
    setSession((current) => ({ ...current, pending: true, error: null }));
    socket.send(JSON.stringify(message));
  }, []);

  useEffect(() => () => {
    const socket = socketRef.current;
    socketRef.current = null;
    socket?.close();
  }, []);

  return { ...session, create, join, leave, send };
}
