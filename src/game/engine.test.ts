import { describe, expect, it } from 'vitest';
import {
  applyAction,
  BOARD_COLUMNS,
  BOARD_ROWS,
  BOARD_SIZE,
  createGame,
  isInCheck,
  legalActions,
  legalMovesFrom,
  squareColor,
  toGameView,
  type Action,
  type Color,
  type GameState,
  type Player,
  type Rank,
  type Square,
} from './engine';

const at = (row: number, column: number) => row * BOARD_COLUMNS + column;
const up = (color: Color, rank: Rank): Square => ({ faceUp: true, piece: { color, rank } });
const covered = (color: Color, rank: Rank): Square => ({ faceUp: false, color, rank });

function position(entries: Array<[number, number, Square]>, turn: Player = 0): GameState {
  const board: Square[] = Array(BOARD_SIZE).fill(null);
  board[at(9, 4)] = up('red', 'general');
  board[at(0, 3)] = up('black', 'general');
  for (const [row, column, square] of entries) board[at(row, column)] = square;
  return { board, turn, colors: ['red', 'black'], outcome: null, lastAction: null, captures: [] };
}

function play(game: GameState, action: Action): GameState {
  const result = applyAction(game, action);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

const move = (fromRow: number, fromColumn: number, toRow: number, toColumn: number): Action =>
  ({ type: 'move', from: at(fromRow, fromColumn), to: at(toRow, toColumn) });
const flip = (row: number, column: number): Action => ({ type: 'flip', at: at(row, column) });

describe('full-cover setup', () => {
  it('places all 32 pieces face-down on standard starting points, including the generals', () => {
    const game = createGame(() => 0);
    expect([BOARD_ROWS, BOARD_COLUMNS, BOARD_SIZE]).toEqual([10, 9, 90]);
    expect(game.turn).toBe(0);
    expect(game.colors).toEqual(['red', 'black']);
    expect(game.lastAction).toBeNull();
    expect(game.board.filter(Boolean)).toHaveLength(32);
    expect(game.board.filter((square) => square?.faceUp)).toHaveLength(0);

    for (const [color, home, cannon, soldier] of [
      ['black', 0, 2, 3], ['red', 9, 7, 6],
    ] as const) {
      for (let column = 0; column < 9; column += 1) {
        expect(game.board[at(home, column)]).toMatchObject({ faceUp: false, color });
      }
      for (const column of [1, 7]) expect(game.board[at(cannon, column)]).toMatchObject({ faceUp: false, color });
      for (const column of [0, 2, 4, 6, 8]) expect(game.board[at(soldier, column)]).toMatchObject({ faceUp: false, color });
      const hidden = game.board.filter((square) => square && !square.faceUp && square.color === color);
      expect(hidden).toHaveLength(16);
      const counts: Record<string, number> = {};
      for (const square of hidden) {
        if (!square || square.faceUp) throw new Error('Expected a covered piece');
        counts[square.rank] = (counts[square.rank] ?? 0) + 1;
      }
      expect(counts).toEqual({ general: 1, advisor: 2, elephant: 2, horse: 2, rook: 2, cannon: 2, soldier: 5 });
    }
    expect(game.board[at(4, 4)]).toBeNull();
    expect(game.board[at(5, 4)]).toBeNull();
  });

  it('shuffles both generals among all 16 starting points, independently by color', () => {
    let calls = 0;
    const game = createGame(() => calls++ < 15 ? 0 : 0.999999);
    expect(game.board[at(9, 3)]).toEqual(covered('red', 'general'));
    expect(game.board[at(9, 4)]).not.toEqual(covered('red', 'general'));
    expect(game.board[at(0, 4)]).toEqual(covered('black', 'general'));
    expect(calls).toBe(30);
  });

  it('can shuffle a general onto a soldier starting point and flip it there', () => {
    let calls = 0;
    const game = createGame(() => calls++ === 0 ? 0.25 : 0.999999);
    expect(game.board[at(6, 8)]).toEqual(covered('red', 'general'));
    expect(toGameView(game).board[at(6, 8)]).toEqual({ faceUp: false, color: 'red' });
    const next = play(game, flip(6, 8));
    expect(next.board[at(6, 8)]).toEqual(up('red', 'general'));
    expect(next.turn).toBe(1);
  });

  it('exposes only the color of every covered piece to both players', () => {
    const view = toGameView(createGame(() => 0));
    const hidden = view.board.filter((square) => square && !square.faceUp);
    expect(hidden).toHaveLength(32);
    expect(hidden.every((square) => square && !square.faceUp &&
      !('rank' in square) && !('piece' in square) && !('cover' in square))).toBe(true);
    expect(view.board[at(9, 4)]).toEqual({ faceUp: false, color: 'red' });
    expect(view.board[at(0, 4)]).toEqual({ faceUp: false, color: 'black' });
    expect(JSON.stringify(view)).not.toMatch(/general|soldier|rook|elephant|advisor|horse|cannon/);
  });

  it('offers exactly the current player’s 16 flips, not covered-piece moves', () => {
    const game = createGame(() => 0);
    expect(legalActions(game)).toHaveLength(16);
    expect(legalActions(game).every((action) => action.type === 'flip' && squareColor(game.board[action.at]) === 'red')).toBe(true);
    expect(applyAction(game, move(6, 0, 5, 0)).ok).toBe(false);
    expect(applyAction(game, flip(3, 0)).ok).toBe(false);
    expect(applyAction(game, flip(4, 4)).ok).toBe(false);
    expect(applyAction(game, { type: 'flip', at: -1 }).ok).toBe(false);
    expect(applyAction(game, { type: 'flip', at: 90 }).ok).toBe(false);
  });
});

describe('flipping and secrecy', () => {
  it('flips in place, ends the turn, and only later moves as the revealed identity', () => {
    const game = position([[6, 0, covered('red', 'rook')], [3, 0, covered('black', 'elephant')]]);
    expect(legalMovesFrom(game.board, at(6, 0), 'red')).toEqual([]);
    expect(applyAction(game, move(6, 0, 6, 2)).ok).toBe(false);
    const first = play(game, flip(6, 0));
    expect(first.board[at(6, 0)]).toEqual(up('red', 'rook'));
    expect(first.turn).toBe(1);
    expect(first.lastAction).toEqual({ type: 'flip', at: at(6, 0), piece: { color: 'red', rank: 'rook' } });
    expect(applyAction(first, move(6, 0, 6, 2)).ok).toBe(false);
    expect(game.board[at(6, 0)]).toEqual(covered('red', 'rook'));

    const second = play(first, flip(3, 0));
    const third = play(second, move(6, 0, 6, 2));
    expect(third.board[at(6, 0)]).toBeNull();
    expect(third.board[at(6, 2)]).toEqual(up('red', 'rook'));
  });

  it('cannot flip an opponent, an empty point, or an already revealed piece', () => {
    const game = position([[6, 0, covered('red', 'rook')], [3, 0, covered('black', 'horse')]]);
    expect(applyAction(game, flip(3, 0)).ok).toBe(false);
    expect(applyAction(game, flip(5, 0)).ok).toBe(false);
    expect(applyAction(game, flip(9, 4)).ok).toBe(false);
  });

  it('does not change legal actions or public views when only covered identities differ', () => {
    const first = position([[9, 4, null], [6, 0, covered('red', 'general')], [6, 2, covered('red', 'rook')]]);
    const second = position([[9, 4, null], [6, 0, covered('red', 'rook')], [6, 2, covered('red', 'general')]]);
    expect(toGameView(first)).toEqual(toGameView(second));
    expect(legalActions(first)).toEqual(legalActions(second));
    expect(isInCheck(first.board, 'red')).toBe(false);
    expect(isInCheck(second.board, 'red')).toBe(false);
    expect(toGameView(first).board[at(6, 0)]).toEqual({ faceUp: false, color: 'red' });
  });

  it('allows an off-palace general to be flipped but keeps its movement palace-limited', () => {
    const game = position([[9, 4, null], [6, 0, covered('red', 'general')]]);
    const next = play(game, flip(6, 0));
    expect(next.board[at(6, 0)]).toEqual(up('red', 'general'));
    expect(legalMovesFrom(next.board, at(6, 0), 'red')).toEqual([]);
    expect(next.outcome).toBeNull();
  });

  it('allows a general to be flipped into check without leaking its hidden identity', () => {
    const game = position([
      [9, 4, null], [7, 4, covered('red', 'general')], [7, 0, up('black', 'rook')],
    ]);
    expect(isInCheck(game.board, 'red')).toBe(false);
    expect(legalMovesFrom(game.board, at(7, 0), 'black')).not.toContain(at(7, 4));
    const revealed = play(game, flip(7, 4));
    expect(revealed.turn).toBe(1);
    expect(isInCheck(revealed.board, 'red')).toBe(true);
    const captured = play(revealed, move(7, 0, 7, 4));
    expect(captured.outcome).toEqual({ winner: 1, reason: 'general-captured' });
  });

  it('does not permit a flip instead of escaping an existing check', () => {
    const game = position([[4, 4, up('black', 'rook')], [8, 0, up('red', 'rook')], [6, 0, covered('red', 'horse')]]);
    expect(isInCheck(game.board, 'red')).toBe(true);
    expect(legalActions(game)).not.toContainEqual(flip(6, 0));
    expect(applyAction(game, flip(6, 0)).ok).toBe(false);
    expect(applyAction(game, move(8, 0, 8, 1)).ok).toBe(false);
    expect(legalMovesFrom(game.board, at(8, 0), 'red')).toContain(at(8, 4));
    expect(isInCheck(play(game, move(8, 0, 8, 4)).board, 'red')).toBe(false);
  });
});

describe('revealed xiangqi movement and covered immunity', () => {
  it('restricts a general to orthogonal steps inside its palace', () => {
    const game = position([
      [9, 4, null], [7, 3, up('red', 'general')], [0, 3, null], [0, 5, up('black', 'general')],
    ]);
    const moves = legalMovesFrom(game.board, at(7, 3), 'red');
    expect(moves).toEqual(expect.arrayContaining([at(7, 4), at(8, 3)]));
    expect(moves).not.toContain(at(6, 3));
    expect(moves).not.toContain(at(7, 2));
    expect(moves).not.toContain(at(8, 4));
  });

  it('restricts advisors to diagonal steps inside their palace', () => {
    const game = position([[9, 3, up('red', 'advisor')]]);
    expect(legalMovesFrom(game.board, at(9, 3), 'red')).toEqual([at(8, 4)]);
  });

  it('blocks an elephant’s eye and prevents it landing across the river', () => {
    const blocked = position([[9, 2, up('red', 'elephant')], [8, 3, covered('red', 'cannon')]]);
    expect(legalMovesFrom(blocked.board, at(9, 2), 'red')).toContain(at(7, 0));
    expect(legalMovesFrom(blocked.board, at(9, 2), 'red')).not.toContain(at(7, 4));
    const river = position([[5, 4, up('red', 'elephant')], [4, 0, up('black', 'elephant')]]);
    expect(legalMovesFrom(river.board, at(5, 4), 'red')).toEqual(expect.arrayContaining([at(7, 2), at(7, 6)]));
    expect(legalMovesFrom(river.board, at(5, 4), 'red')).not.toContain(at(3, 2));
    expect(legalMovesFrom(river.board, at(4, 0), 'black')).not.toContain(at(6, 2));
  });

  it('blocks the horse leg with either color of covered piece', () => {
    const game = position([[5, 4, up('red', 'horse')], [4, 4, covered('black', 'rook')]]);
    const moves = legalMovesFrom(game.board, at(5, 4), 'red');
    expect(moves).toEqual(expect.arrayContaining([at(7, 3), at(7, 5), at(4, 2), at(6, 6)]));
    expect(moves).not.toContain(at(3, 3));
    expect(moves).not.toContain(at(3, 5));
  });

  it('stops a rook at a covered enemy, then allows capture after it is flipped', () => {
    const game = position([[5, 4, up('red', 'rook')], [5, 6, covered('black', 'horse')], [5, 7, up('black', 'soldier')]]);
    const moves = legalMovesFrom(game.board, at(5, 4), 'red');
    expect(moves).toContain(at(5, 5));
    expect(moves).not.toContain(at(5, 6));
    expect(moves).not.toContain(at(5, 7));
    expect(applyAction(game, move(5, 4, 5, 6)).ok).toBe(false);

    const revealed = position([[5, 4, up('red', 'rook')], [5, 6, up('black', 'horse')], [5, 7, up('black', 'soldier')]]);
    expect(legalMovesFrom(revealed.board, at(5, 4), 'red')).toContain(at(5, 6));
    const next = play(revealed, move(5, 4, 5, 6));
    expect(next.captures).toEqual([{ color: 'black', rank: 'horse' }]);
    expect(next.outcome).toBeNull();
  });

  it.each<[Rank, number, number, number, number]>([
    ['soldier', 4, 4, 3, 4],
    ['horse', 5, 4, 3, 3],
    ['elephant', 9, 2, 7, 0],
    ['advisor', 9, 3, 8, 4],
    ['general', 9, 4, 8, 4],
  ])('prevents a revealed %s landing on a covered enemy', (rank, fromRow, fromColumn, toRow, toColumn) => {
    const hidden = position([[fromRow, fromColumn, up('red', rank)], [toRow, toColumn, covered('black', 'horse')]]);
    const visible = position([[fromRow, fromColumn, up('red', rank)], [toRow, toColumn, up('black', 'horse')]]);
    expect(legalMovesFrom(hidden.board, at(fromRow, fromColumn), 'red')).not.toContain(at(toRow, toColumn));
    expect(legalMovesFrom(visible.board, at(fromRow, fromColumn), 'red')).toContain(at(toRow, toColumn));
  });

  it('allows a covered cannon screen but not a covered cannon target', () => {
    const game = position([
      [5, 1, up('red', 'cannon')], [5, 0, up('black', 'soldier')],
      [5, 3, covered('red', 'horse')], [5, 6, covered('black', 'rook')], [5, 7, up('black', 'horse')],
    ]);
    const moves = legalMovesFrom(game.board, at(5, 1), 'red');
    expect(moves).toEqual(expect.arrayContaining([at(5, 2), at(3, 1)]));
    expect(moves).not.toContain(at(5, 0));
    expect(moves).not.toContain(at(5, 4));
    expect(moves).not.toContain(at(5, 6));
    expect(moves).not.toContain(at(5, 7));
    const revealed = position([[5, 1, up('red', 'cannon')], [5, 3, covered('red', 'horse')], [5, 6, up('black', 'rook')]]);
    expect(legalMovesFrom(revealed.board, at(5, 1), 'red')).toContain(at(5, 6));
  });

  it('moves soldiers forward and sideways only after crossing the river', () => {
    const game = position([
      [6, 0, up('red', 'soldier')], [4, 8, up('red', 'soldier')],
      [3, 0, up('black', 'soldier')], [5, 0, up('black', 'soldier')],
    ]);
    expect(legalMovesFrom(game.board, at(6, 0), 'red')).toEqual([at(5, 0)]);
    expect(legalMovesFrom(game.board, at(4, 8), 'red').sort((a, b) => a - b)).toEqual([at(3, 8), at(4, 7)]);
    expect(legalMovesFrom(game.board, at(3, 0), 'black')).toEqual([at(4, 0)]);
    expect(legalMovesFrom(game.board, at(5, 0), 'black').sort((a, b) => a - b)).toEqual([at(5, 1), at(6, 0)]);
  });

  it('allows captures regardless of piece rank', () => {
    const game = position([[4, 4, up('red', 'soldier')], [3, 4, up('black', 'rook')]]);
    const next = play(game, move(4, 4, 3, 4));
    expect(next.board[at(3, 4)]).toEqual(up('red', 'soldier'));
    expect(next.captures).toEqual([{ color: 'black', rank: 'rook' }]);
  });
});

describe('check and game end', () => {
  it('ignores attacks by covered pieces and checks only a revealed general', () => {
    const hiddenAttacker = position([[9, 0, covered('black', 'rook')]]);
    expect(isInCheck(hiddenAttacker.board, 'red')).toBe(false);
    const visibleAttacker = position([[9, 0, up('black', 'rook')]]);
    expect(isInCheck(visibleAttacker.board, 'red')).toBe(true);
    const hiddenGeneral = position([[9, 4, covered('red', 'general')], [9, 0, up('black', 'rook')]]);
    expect(isInCheck(hiddenGeneral.board, 'red')).toBe(false);
  });

  it('enforces flying generals only when both have been revealed', () => {
    const game = position([[0, 3, null], [0, 4, up('black', 'general')], [5, 4, up('red', 'rook')]]);
    expect(legalMovesFrom(game.board, at(5, 4), 'red')).not.toContain(at(5, 3));
    const open = game.board.slice();
    open[at(5, 4)] = null;
    expect(isInCheck(open, 'red')).toBe(true);
    expect(isInCheck(open, 'black')).toBe(true);
    open[at(9, 4)] = covered('red', 'general');
    expect(isInCheck(open, 'red')).toBe(false);
    expect(isInCheck(open, 'black')).toBe(false);
  });

  it('wins by capturing a revealed general, including with a flying general', () => {
    const game = position([[0, 3, null], [5, 3, up('black', 'general')], [5, 0, up('red', 'rook')]]);
    const won = play(game, move(5, 0, 5, 3));
    expect(won.outcome).toEqual({ winner: 0, reason: 'general-captured' });
    expect(won.captures).toEqual([{ color: 'black', rank: 'general' }]);
    expect(applyAction(won, move(5, 3, 5, 4)).ok).toBe(false);
    expect(legalActions(won)).toEqual([]);

    const flying = position([[0, 3, null], [0, 4, up('black', 'general')]]);
    expect(legalMovesFrom(flying.board, at(9, 4), 'red')).toContain(at(0, 4));
    expect(play(flying, move(9, 4, 0, 4)).outcome).toEqual({ winner: 0, reason: 'general-captured' });
  });

  it('wins by checkmating a revealed general even if the defender has covered pieces', () => {
    const game = position([
      [0, 3, null], [0, 4, up('black', 'general')], [1, 3, up('red', 'rook')],
      [1, 5, up('red', 'rook')], [3, 0, up('red', 'rook')], [6, 4, up('red', 'soldier')],
      [3, 8, covered('black', 'horse')],
    ]);
    const next = play(game, move(3, 0, 3, 4));
    expect(next.outcome).toEqual({ winner: 0, reason: 'checkmate' });
    expect(next.board[at(0, 4)]).toEqual(up('black', 'general'));
    expect(legalActions(next)).toEqual([]);
  });

  it('also awards checkmate to black', () => {
    const game = position([
      [0, 3, null], [0, 4, up('black', 'general')], [8, 3, up('black', 'rook')],
      [8, 5, up('black', 'rook')], [6, 8, up('black', 'rook')], [3, 4, up('black', 'soldier')],
    ], 1);
    expect(play(game, move(6, 8, 6, 4)).outcome).toEqual({ winner: 1, reason: 'checkmate' });
  });

  it('treats stalemate without check as a loss', () => {
    const game = position([
      [0, 3, null], [0, 4, up('black', 'general')], [2, 3, up('red', 'rook')],
      [2, 5, up('red', 'rook')], [1, 0, up('red', 'rook')], [6, 4, up('red', 'soldier')],
    ]);
    const next = play(game, move(6, 4, 5, 4));
    expect(isInCheck(next.board, 'black')).toBe(false);
    expect(next.outcome).toEqual({ winner: 0, reason: 'stalemate' });
  });

  it('does not declare stalemate if an own covered piece may still be flipped', () => {
    const game = position([
      [0, 3, null], [0, 4, up('black', 'general')], [2, 3, up('red', 'rook')],
      [2, 5, up('red', 'rook')], [1, 0, up('red', 'rook')], [6, 4, up('red', 'soldier')],
      [3, 8, covered('black', 'elephant')],
    ]);
    const next = play(game, move(6, 4, 5, 4));
    expect(next.outcome).toBeNull();
    expect(legalActions(next)).toContainEqual(flip(3, 8));
  });

  it('does not automatically end repeated positions', () => {
    let game = position([[9, 0, up('red', 'rook')], [0, 8, up('black', 'rook')]]);
    for (let i = 0; i < 3; i += 1) {
      game = play(game, move(9, 0, 8, 0));
      game = play(game, move(0, 8, 1, 8));
      game = play(game, move(8, 0, 9, 0));
      game = play(game, move(1, 8, 0, 8));
    }
    expect(game.outcome).toBeNull();
  });
});

describe('complete games', () => {
  it('preserves turn-taking, capture accounting, hidden identities, and move safety', () => {
    for (let seed = 1; seed <= 3; seed += 1) {
      let value = seed;
      const random = () => ((value = (Math.imul(1664525, value) + 1013904223) | 0) >>> 0) / 2 ** 32;
      let game = createGame(random);
      let hiddenCount = 32;
      for (let ply = 0; ply < 100 && !game.outcome; ply += 1) {
        const actions = legalActions(game);
        expect(actions.length).toBeGreaterThan(0);
        const action = actions[Math.floor(random() * actions.length)];
        const color = game.colors[game.turn];
        const previousTurn = game.turn;
        const previousCount = game.board.filter(Boolean).length;
        if (action.type === 'move') {
          const target = game.board[action.to];
          expect(!target || target.faceUp).toBe(true);
        }
        game = play(game, action);
        expect(game.turn).not.toBe(previousTurn);
        if (action.type === 'flip') {
          expect(game.board[action.at]?.faceUp).toBe(true);
          expect(squareColor(game.board[action.at])).toBe(color);
        } else {
          expect(game.board[action.to]?.faceUp).toBe(true);
          expect(squareColor(game.board[action.to])).toBe(color);
          expect(isInCheck(game.board, color)).toBe(false);
        }
        expect(game.board.filter(Boolean).length + game.captures.length).toBe(32);
        const remainingHidden = game.board.filter((square) => square && !square.faceUp).length;
        expect(remainingHidden).toBe(hiddenCount - (action.type === 'flip' ? 1 : 0));
        if (action.type === 'flip') expect(game.board.filter(Boolean)).toHaveLength(previousCount);
        hiddenCount = remainingHidden;
        const generalsOnBoard = game.board.filter((square) => square &&
          (square.faceUp ? square.piece.rank : square.rank) === 'general').length;
        expect(generalsOnBoard + game.captures.filter((piece) => piece.rank === 'general').length).toBe(2);
        for (const square of toGameView(game).board) {
          if (square && !square.faceUp) {
            expect(square).not.toHaveProperty('rank');
            expect(square).not.toHaveProperty('cover');
          }
        }
      }
    }
  });
});
