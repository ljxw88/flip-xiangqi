import { describe, expect, it } from 'vitest';
import { createGame, toGameView } from '../game/engine';
import { isSupportedGameView, isSupportedRoomState, ROOM_PROTOCOL_VERSION } from './protocol';

describe('room protocol compatibility', () => {
  it('accepts a full-board game and rejects a legacy Banqi room', () => {
    expect(isSupportedGameView(toGameView(createGame(() => 0)))).toBe(true);
    expect(isSupportedGameView({
      board: Array(32).fill({ faceUp: false }),
      turn: 0,
      colors: [null, null],
      outcome: null,
    })).toBe(false);
  });

  it('rejects the previous starting-role protocol even though it also has a 9×10 board', () => {
    const game = toGameView(createGame(() => 0));
    expect(isSupportedGameView({ ...game, lastAction: undefined, lastMove: null })).toBe(false);
  });

  it('rejects incomplete or malformed state before it reaches the board', () => {
    const game = toGameView(createGame(() => 0));
    expect(isSupportedGameView(null)).toBe(false);
    expect(isSupportedGameView({ ...game, captures: undefined })).toBe(false);
    expect(isSupportedGameView({ ...game, pendingFlip: undefined })).toBe(false);
    expect(isSupportedGameView({ ...game, board: game.board.slice(0, 89) })).toBe(false);
    expect(isSupportedGameView({ ...game, colors: [null, null] })).toBe(false);
  });

  it('rejects older room rules even when their board shape matches', () => {
    const game = toGameView(createGame(() => 0));
    const state = { type: 'state', version: ROOM_PROTOCOL_VERSION, game, connected: [true, false] };
    expect(isSupportedRoomState(state)).toBe(true);
    expect(isSupportedRoomState({ type: 'state', game, connected: [true, false] })).toBe(false);
    expect(isSupportedRoomState({ ...state, version: 2 })).toBe(false);
  });
});
