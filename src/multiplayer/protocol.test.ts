import { describe, expect, it } from 'vitest';
import { createGame, toGameView } from '../game/engine';
import { isSupportedGameView } from './protocol';

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

  it('rejects incomplete or malformed state before it reaches the board', () => {
    const game = toGameView(createGame(() => 0));
    expect(isSupportedGameView(null)).toBe(false);
    expect(isSupportedGameView({ ...game, captures: undefined })).toBe(false);
    expect(isSupportedGameView({ ...game, board: game.board.slice(0, 89) })).toBe(false);
    expect(isSupportedGameView({ ...game, colors: [null, null] })).toBe(false);
  });
});
