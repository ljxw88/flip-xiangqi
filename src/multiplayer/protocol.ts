import { BOARD_SIZE, type Action, type GameView, type Player } from '../game/engine';

/** Reject the old 4×8 room protocol before the UI tries to render it. */
export function isSupportedGameView(value: unknown): value is GameView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const game = value as Partial<GameView>;
  return Array.isArray(game.board) && game.board.length === BOARD_SIZE &&
    Array.isArray(game.colors) && game.colors[0] === 'red' && game.colors[1] === 'black' &&
    (game.turn === 0 || game.turn === 1) && game.outcome !== undefined &&
    game.lastMove !== undefined && Array.isArray(game.captures);
}

export type ClientMessage =
  | { type: 'create' }
  | { type: 'join'; room: string; token?: string }
  | { type: 'action'; action: Action }
  | { type: 'rematch' };

export type ServerMessage =
  | { type: 'joined'; room: string; player: Player; token: string }
  | { type: 'state'; game: GameView; connected: [boolean, boolean] }
  | { type: 'error'; message: string };
