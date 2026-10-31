import { describe, expect, it } from 'vitest';
import {
  applyAction,
  BOARD_SIZE,
  canCaptureByRank,
  createGame,
  legalActions,
  legalMovesFrom,
  toGameView,
  type Action,
  type Color,
  type GameState,
  type Piece,
  type Rank,
  type Square,
} from './engine';

function piece(color: Color, rank: Rank, faceUp = true): Square {
  return { faceUp, piece: { color, rank } };
}

function position(squares: Record<number, Square>): GameState {
  const board: Square[] = Array(BOARD_SIZE).fill(null);
  for (const [index, square] of Object.entries(squares)) board[Number(index)] = square;
  return { board, turn: 0, colors: ['red', 'black'], outcome: null };
}

function play(game: GameState, action: Action): GameState {
  const result = applyAction(game, action);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

describe('starting a game', () => {
  it('shuffles all 32 face-down pieces with the correct inventory', () => {
    const game = createGame(() => 0);
    expect(game.board).toHaveLength(32);
    expect(game.turn).toBe(0);
    expect(game.colors).toEqual([null, null]);
    expect(game.board.every((square) => square && !square.faceUp)).toBe(true);

    const counts = new Map<string, number>();
    for (const square of game.board) {
      if (!square) throw new Error('Missing piece');
      const key = `${square.piece.color}:${square.piece.rank}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const color of ['red', 'black']) {
      expect(Object.fromEntries([...counts].filter(([key]) => key.startsWith(`${color}:`)))).toEqual({
        [`${color}:general`]: 1,
        [`${color}:advisor`]: 2,
        [`${color}:elephant`]: 2,
        [`${color}:rook`]: 2,
        [`${color}:horse`]: 2,
        [`${color}:cannon`]: 2,
        [`${color}:soldier`]: 5,
      });
    }
  });

  it('assigns the first flipped color to player one and the other color to player two', () => {
    const game = createGame(() => 0);
    const at = game.board.findIndex((square) => square?.piece.color === 'black');
    const next = play(game, { type: 'flip', at });

    expect(next.colors).toEqual(['black', 'red']);
    expect(next.board[at]).toMatchObject({ faceUp: true, piece: { color: 'black' } });
    expect(next.turn).toBe(1);
    expect(game.colors).toEqual([null, null]);
    expect(game.board[at]?.faceUp).toBe(false);
  });

  it('allows only flips before colors are assigned and hides unflipped identities', () => {
    const game = createGame(() => 0);
    expect(legalActions(game)).toHaveLength(32);
    expect(legalActions(game).every((action) => action.type === 'flip')).toBe(true);
    expect(applyAction(game, { type: 'move', from: 0, to: 1 }).ok).toBe(false);
    expect(toGameView(game).board.every((square) => JSON.stringify(square) === '{"faceUp":false}')).toBe(true);
  });
});

describe('ordinary movement and captures', () => {
  it.each<[Rank, Rank, boolean]>([
    ['general', 'general', true],
    ['general', 'advisor', true],
    ['general', 'soldier', false],
    ['advisor', 'general', false],
    ['advisor', 'elephant', true],
    ['elephant', 'rook', true],
    ['rook', 'elephant', false],
    ['rook', 'horse', true],
    ['horse', 'cannon', true],
    ['cannon', 'soldier', true],
    ['soldier', 'cannon', false],
    ['soldier', 'general', true],
    ['soldier', 'soldier', true],
  ])('%s versus %s has rank permission %s', (attacker, defender, expected) => {
    expect(canCaptureByRank(attacker, defender)).toBe(expected);
  });

  it('allows equal-rank captures and the soldier to capture a general, but not the reverse', () => {
    const game = position({
      0: piece('red', 'soldier'),
      1: piece('black', 'general'),
      8: piece('black', 'soldier'),
      16: piece('red', 'general'),
    });
    expect(legalMovesFrom(game.board, 0, 'red')).toEqual(expect.arrayContaining([1, 8]));
    expect(legalMovesFrom(game.board, 16, 'red')).not.toContain(8);
    expect(play(game, { type: 'move', from: 0, to: 1 }).board[1]).toEqual(piece('red', 'soldier'));
  });

  it('cannot step on a face-down piece, capture a friendly piece, move diagonally or wrap rows', () => {
    const game = position({
      7: piece('red', 'rook'),
      6: piece('red', 'soldier'),
      15: piece('black', 'general', false),
      8: piece('black', 'soldier'),
    });
    const moves = legalMovesFrom(game.board, 7, 'red');
    expect(moves).not.toContain(6);
    expect(moves).not.toContain(8);
    expect(moves).not.toContain(14);
    expect(moves).not.toContain(15);
    expect(applyAction(game, { type: 'move', from: 7, to: 15 }).ok).toBe(false);
    expect(applyAction(game, { type: 'move', from: 7, to: 8 }).ok).toBe(false);
  });

  it('only moves the current player’s face-up pieces one orthogonal square', () => {
    const game = position({
      9: piece('red', 'rook'),
      10: piece('black', 'horse'),
      31: piece('black', 'soldier', false),
    });
    expect(legalMovesFrom(game.board, 9, 'red').sort((a, b) => a - b)).toEqual([1, 8, 10, 17]);
    expect(applyAction(game, { type: 'move', from: 10, to: 11 }).ok).toBe(false);
    expect(applyAction(game, { type: 'move', from: 9, to: 18 }).ok).toBe(false);
    expect(applyAction(game, { type: 'move', from: 9, to: 25 }).ok).toBe(false);
    expect(applyAction(game, { type: 'move', from: -1, to: 1 }).ok).toBe(false);
    expect(applyAction(game, { type: 'flip', at: 32 }).ok).toBe(false);
    expect(game.board[9]).toEqual(piece('red', 'rook'));
  });
});

describe('cannon', () => {
  it('jumps exactly one face-down screen to capture any rank along a row', () => {
    const game = position({
      0: piece('red', 'cannon'),
      1: piece('red', 'soldier', false),
      3: piece('black', 'general'),
      4: piece('black', 'soldier'),
    });
    expect(legalMovesFrom(toGameView(game).board, 0, 'red')).toEqual([8, 3]);
    expect(applyAction(game, { type: 'move', from: 0, to: 3 }).ok).toBe(true);
    expect(applyAction(game, { type: 'move', from: 0, to: 4 }).ok).toBe(false);
  });

  it('may use an enemy screen and capture vertically, but only moves one square without capturing', () => {
    const game = position({
      0: piece('red', 'cannon'),
      16: piece('black', 'horse'),
      24: piece('black', 'soldier'),
    });
    const moves = legalMovesFrom(game.board, 0, 'red');
    expect(moves).toEqual(expect.arrayContaining([1, 8, 24]));
    expect(moves).not.toContain(2);
    expect(moves).not.toContain(16);
  });

  it('cannot capture without a screen, a face-down target, a friendly target, or beyond a second blocker', () => {
    const noScreen = position({ 0: piece('red', 'cannon'), 1: piece('black', 'general') });
    expect(legalMovesFrom(noScreen.board, 0, 'red')).not.toContain(1);

    const blocked = position({
      0: piece('red', 'cannon'),
      1: piece('black', 'horse'),
      2: piece('black', 'soldier', false),
      3: piece('black', 'general'),
      8: piece('black', 'soldier'),
      16: piece('red', 'rook'),
      24: piece('black', 'general'),
    });
    const moves = legalMovesFrom(blocked.board, 0, 'red');
    expect(moves).not.toContain(2);
    expect(moves).not.toContain(3);
    expect(moves).not.toContain(16);
    expect(moves).not.toContain(24);
  });
});

describe('game end', () => {
  it('counts hidden enemy pieces when deciding whether a side has been eliminated', () => {
    const game = position({
      0: piece('red', 'rook'),
      1: piece('black', 'horse'),
      10: piece('black', 'general', false),
    });
    const next = play(game, { type: 'move', from: 0, to: 1 });
    expect(next.outcome).toBeNull();
    expect(next.turn).toBe(1);
    expect(legalActions(next)).toContainEqual({ type: 'flip', at: 10 });
  });

  it('wins on the final enemy capture, even when the winner still has hidden pieces', () => {
    const game = position({
      0: piece('red', 'rook'),
      1: piece('black', 'horse'),
      10: piece('red', 'general', false),
    });
    const next = play(game, { type: 'move', from: 0, to: 1 });
    expect(next.outcome).toEqual({ winner: 0, reason: 'elimination' });
    expect(applyAction(next, { type: 'flip', at: 10 }).ok).toBe(false);
    expect(legalActions(next)).toEqual([]);
  });

  it('wins when the opponent has pieces but no legal action', () => {
    const game = position({
      0: piece('black', 'general'),
      2: piece('red', 'soldier'),
      8: piece('red', 'soldier'),
    });
    const next = play(game, { type: 'move', from: 2, to: 1 });
    expect(next.outcome).toEqual({ winner: 0, reason: 'no-legal-moves' });
  });

  it('does not treat a blocked opponent as stuck when any piece can still be flipped', () => {
    const game = position({
      0: piece('black', 'general'),
      2: piece('red', 'soldier'),
      8: piece('red', 'soldier'),
      20: piece('red', 'rook', false),
    });
    const next = play(game, { type: 'move', from: 2, to: 1 });
    expect(next.outcome).toBeNull();
    expect(legalActions(next)).toEqual([{ type: 'flip', at: 20 }]);
  });

  it('does not automatically end repeated positions as a draw', () => {
    let game = position({ 0: piece('red', 'rook'), 31: piece('black', 'rook') });
    for (let i = 0; i < 4; i += 1) {
      game = play(game, { type: 'move', from: 0, to: 1 });
      game = play(game, { type: 'move', from: 31, to: 30 });
      game = play(game, { type: 'move', from: 1, to: 0 });
      game = play(game, { type: 'move', from: 30, to: 31 });
    }
    expect(game.outcome).toBeNull();
  });
});

describe('public state', () => {
  it('shows revealed pieces without exposing or sharing references to hidden pieces', () => {
    const hidden: Piece = { color: 'black', rank: 'general' };
    const game = position({
      0: { faceUp: false, piece: hidden },
      1: piece('red', 'soldier'),
    });
    const view = toGameView(game);
    expect(view.board[0]).toEqual({ faceUp: false });
    expect(view.board[1]).toEqual(piece('red', 'soldier'));
    expect(view.board[1]).not.toBe(game.board[1]);
    expect(JSON.stringify(view)).not.toContain('general');
  });
});
