import { randomBytes, randomInt } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import {
  applyAction,
  createGame,
  toGameView,
  type Action,
  type GameState,
  type Player,
} from '../src/game/engine';
import { ROOM_PROTOCOL_VERSION, type ServerMessage } from '../src/multiplayer/protocol';

interface Seat {
  readonly token: string;
  socket: WebSocket | null;
}

interface Room {
  readonly code: string;
  game: GameState;
  readonly seats: [Seat | null, Seat | null];
  cleanupTimer: ReturnType<typeof setTimeout> | null;
}

interface RoomServerOptions {
  port?: number;
  host?: string;
  reconnectGraceMs?: number;
  gameFactory?: () => GameState;
}

const RANDOM_RANGE = 2 ** 32;
const newGame = () => createGame(() => randomInt(RANDOM_RANGE) / RANDOM_RANGE);
const newToken = () => randomBytes(24).toString('base64url');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseAction(value: unknown): Action | null {
  if (!isRecord(value)) return null;
  if (value.type === 'end-turn') return { type: 'end-turn' };
  if (value.type === 'flip' && Number.isInteger(value.at)) {
    return { type: 'flip', at: value.at as number };
  }
  if (value.type === 'move' && Number.isInteger(value.from) && Number.isInteger(value.to)) {
    return { type: 'move', from: value.from as number, to: value.to as number };
  }
  return null;
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function connected(room: Room, player: Player): boolean {
  return room.seats[player]?.socket?.readyState === WebSocket.OPEN;
}

function broadcast(room: Room): void {
  const message: ServerMessage = {
    type: 'state',
    version: ROOM_PROTOCOL_VERSION,
    game: toGameView(room.game),
    connected: [connected(room, 0), connected(room, 1)],
  };
  for (const seat of room.seats) {
    if (seat?.socket) send(seat.socket, message);
  }
}

export function createRoomServer(options: RoomServerOptions = {}): WebSocketServer {
  const server = new WebSocketServer({
    port: options.port ?? 3001,
    host: options.host ?? '127.0.0.1',
    path: '/ws',
    maxPayload: 4096,
  });
  const rooms = new Map<string, Room>();
  const reconnectGraceMs = options.reconnectGraceMs ?? 30 * 60 * 1000;
  const gameFactory = options.gameFactory ?? newGame;

  server.on('connection', (socket) => {
    let membership: { room: Room; player: Player } | null = null;
    const error = (message: string) => send(socket, { type: 'error', message });

    function joinSeat(room: Room, player: Player, seat: Seat): void {
      if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
      if (seat.socket && seat.socket !== socket) {
        seat.socket.close(4001, 'Session resumed in another connection');
      }
      seat.socket = socket;
      membership = { room, player };
      send(socket, { type: 'joined', room: room.code, player, token: seat.token });
      broadcast(room);
    }

    socket.on('message', (raw, isBinary) => {
      if (isBinary) return error('Only text messages are supported.');
      let message: unknown;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return error('Invalid message.');
      }
      if (!isRecord(message) || typeof message.type !== 'string') return error('Invalid message.');

      if (message.type === 'create') {
        if (membership) return error('You are already in a room.');
        let code: string;
        do {
          code = randomBytes(4).toString('hex').toUpperCase();
        } while (rooms.has(code));
        const seat: Seat = { token: newToken(), socket: null };
        const room: Room = {
          code,
          game: gameFactory(),
          seats: [seat, null],
          cleanupTimer: null,
        };
        rooms.set(code, room);
        joinSeat(room, 0, seat);
        return;
      }

      if (message.type === 'join') {
        if (membership) return error('You are already in a room.');
        if (typeof message.room !== 'string') return error('Invalid room code.');
        const code = message.room.trim().toUpperCase();
        if (!/^[0-9A-F]{8}$/.test(code)) return error('Invalid room code.');
        const room = rooms.get(code);
        if (!room) return error('That room does not exist or has expired.');
        if (message.token !== undefined && typeof message.token !== 'string') {
          return error('Invalid session token.');
        }

        if (typeof message.token === 'string') {
          const player = room.seats.findIndex((seat) => seat?.token === message.token);
          if (player !== 0 && player !== 1) return error('This session cannot rejoin that room.');
          const seat = room.seats[player];
          if (!seat) return error('This session cannot rejoin that room.');
          joinSeat(room, player, seat);
        } else if (!room.seats[1]) {
          const seat: Seat = { token: newToken(), socket: null };
          room.seats[1] = seat;
          joinSeat(room, 1, seat);
        } else {
          error('This room already has two players.');
        }
        return;
      }

      if (!membership) return error('Join a room first.');
      const { room, player } = membership;
      if (room.seats[player]?.socket !== socket) return error('This session was replaced.');

      if (message.type === 'action') {
        if (!connected(room, 0) || !connected(room, 1)) {
          return error('Both players must be connected to play.');
        }
        if (room.game.turn !== player) return error('It is not your turn.');
        const action = parseAction(message.action);
        if (!action) return error('Invalid action.');
        const result = applyAction(room.game, action);
        if (!result.ok) return error(result.error);
        room.game = result.state;
        broadcast(room);
        return;
      }

      if (message.type === 'rematch') {
        if (!connected(room, 0) || !connected(room, 1)) {
          return error('Both players must be connected for a rematch.');
        }
        if (!room.game.outcome) return error('Finish the current game before starting a rematch.');
        room.game = gameFactory();
        broadcast(room);
        return;
      }

      error('Unknown message.');
    });

    // Socket errors are followed by close; do not let a disconnected client crash the server.
    socket.on('error', () => {});
    socket.on('close', () => {
      if (!membership) return;
      const { room, player } = membership;
      const seat = room.seats[player];
      if (!seat || seat.socket !== socket) return;
      seat.socket = null;
      broadcast(room);
      if (!connected(room, 0) && !connected(room, 1) && !room.cleanupTimer) {
        room.cleanupTimer = setTimeout(() => rooms.delete(room.code), reconnectGraceMs);
        room.cleanupTimer.unref();
      }
    });
  });

  server.on('close', () => {
    for (const room of rooms.values()) {
      if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    }
    rooms.clear();
  });

  return server;
}
