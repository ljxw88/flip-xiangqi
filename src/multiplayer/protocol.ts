import type { Action, GameView, Player } from '../game/engine';

export type ClientMessage =
  | { type: 'create' }
  | { type: 'join'; room: string; token?: string }
  | { type: 'action'; action: Action }
  | { type: 'rematch' };

export type ServerMessage =
  | { type: 'joined'; room: string; player: Player; token: string }
  | { type: 'state'; game: GameView; connected: [boolean, boolean] }
  | { type: 'error'; message: string };
