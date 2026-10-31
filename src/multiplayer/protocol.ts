import { BOARD_SIZE, type Action, type GameView, type Player } from '../game/engine';

export const ROOM_PROTOCOL_VERSION = 4;

/** Reject incompatible board data before rendering it. */
export function isSupportedGameView(value: unknown): value is GameView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const game = value as Partial<GameView>;
  const pendingFlip = game.pendingFlip;
  return Array.isArray(game.board) && game.board.length === BOARD_SIZE &&
    Array.isArray(game.colors) && game.colors[0] === 'red' && game.colors[1] === 'black' &&
    (game.turn === 0 || game.turn === 1) && game.outcome !== undefined &&
    game.lastAction !== undefined && Array.isArray(game.captures) &&
    (pendingFlip === null || (typeof pendingFlip === 'number' && Number.isInteger(pendingFlip) && pendingFlip >= 0 && pendingFlip < BOARD_SIZE));
}

export type ClientMessage =
  | { type: 'create' }
  | { type: 'join'; room: string; token?: string }
  | { type: 'action'; action: Action }
  | { type: 'rematch' };

export type ServerMessage =
  | { type: 'joined'; room: string; player: Player; token: string }
  | { type: 'state'; version: typeof ROOM_PROTOCOL_VERSION; game: GameView; connected: [boolean, boolean] }
  | { type: 'error'; message: string };

/** An explicit version prevents older room rules from silently mixing with these rules. */
export function isSupportedRoomState(value: unknown): value is Extract<ServerMessage, { type: 'state' }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const state = value as { type?: unknown; version?: unknown; game?: unknown; connected?: unknown };
  return state.type === 'state' && state.version === ROOM_PROTOCOL_VERSION &&
    isSupportedGameView(state.game) && Array.isArray(state.connected) &&
    state.connected.length === 2 && state.connected.every((connected) => typeof connected === 'boolean');
}
