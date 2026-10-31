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
  type CoveredRank,
  type GameState,
  type Player,
  type Rank,
  type Square,
} from './engine';

const at = (row: number, column: number) => row * BOARD_COLUMNS + column;
const up = (color: Color, rank: Rank): Square => ({ faceUp: true, piece: { color, rank } });
const covered = (color: Color, cover: CoveredRank, rank: CoveredRank): Square =>
  ({ faceUp: false, color, cover, rank });

function position(entries: Array<[number, number, Square]>, turn: Player = 0): GameState {
  const board: Square[] = Array(BOARD_SIZE).fill(null);
  board[at(9, 4)] = up('red', 'general');
  board[at(0, 3)] = up('black', 'general');
  for (const [row, column, square] of entries) board[at(row, column)] = square;
  return { board, turn, colors: ['red', 'black'], outcome: null, lastMove: null, captures: [] };
}

function play(game: GameState, from: number, to: number): GameState {
  const result = applyAction(game, { type: 'move', from, to });
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

describe('full-board setup', () => {
  it('places standard starting positions with only the two generals face-up', () => {
    const game = createGame(() => 0);
    expect([BOARD_ROWS, BOARD_COLUMNS, BOARD_SIZE]).toEqual([10, 9, 90]);
    expect(game.turn).toBe(0);
    expect(game.colors).toEqual(['red', 'black']);
    expect(game.lastMove).toBeNull();
    expect(game.board.filter(Boolean)).toHaveLength(32);

    const back = ['rook', 'horse', 'elephant', 'advisor', 'general', 'advisor', 'elephant', 'horse', 'rook'];
    for (const [color, home, cannon, soldier] of [
      ['black', 0, 2, 3], ['red', 9, 7, 6],
    ] as const) {
      back.forEach((role, column) => {
        const square = game.board[at(home, column)];
        expect(squareColor(square)).toBe(color);
        if (role === 'general') expect(square).toEqual(up(color, 'general'));
        else expect(square).toMatchObject({ faceUp: false, color, cover: role });
      });
      for (const column of [1, 7]) {
        expect(game.board[at(cannon, column)]).toMatchObject({ faceUp: false, color, cover: 'cannon' });
      }
      for (const column of [0, 2, 4, 6, 8]) {
        expect(game.board[at(soldier, column)]).toMatchObject({ faceUp: false, color, cover: 'soldier' });
      }
      const hidden = game.board.filter((square) => square && !square.faceUp && square.color === color);
      expect(hidden).toHaveLength(15);
      const counts: Record<string, number> = {};
      for (const square of hidden) {
        if (!square || square.faceUp) throw new Error('Expected a covered piece');
        counts[square.rank] = (counts[square.rank] ?? 0) + 1;
      }
      expect(counts).toEqual({ rook: 2, horse: 2, elephant: 2, advisor: 2, cannon: 2, soldier: 5 });
    }
    expect(game.board.filter((square) => square?.faceUp)).toHaveLength(2);
    expect(game.board[at(4, 4)]).toBeNull();
    expect(game.board[at(5, 4)]).toBeNull();
  });

  it('shuffles true identities within each color, not the starting positions', () => {
    const shuffled = createGame(() => 0);
    const unchangedOrder = createGame(() => 0.999999);
    expect(shuffled.board).not.toEqual(unchangedOrder.board);
    for (let index = 0; index < BOARD_SIZE; index += 1) {
      const a = shuffled.board[index];
      const b = unchangedOrder.board[index];
      expect(squareColor(a)).toBe(squareColor(b));
      if (a && !a.faceUp && b && !b.faceUp) {
        expect(a.cover).toBe(b.cover);
        expect(b.rank).toBe(b.cover);
      }
    }
  });

  it('shuffles the two colors separately', () => {
    let calls = 0;
    const game = createGame(() => calls++ < 14 ? 0 : 0.999999);
    const red = game.board.filter((square) => square && !square.faceUp && square.color === 'red');
    const black = game.board.filter((square) => square && !square.faceUp && square.color === 'black');
    expect(red.some((square) => square && !square.faceUp && square.rank !== square.cover)).toBe(true);
    expect(black.every((square) => square && !square.faceUp && square.rank === square.cover)).toBe(true);
  });

  it('has no flip action and does not let red move black pieces', () => {
    const game = createGame(() => 0);
    expect(legalActions(game).length).toBeGreaterThan(0);
    expect(legalActions(game).every((action) => action.type === 'move')).toBe(true);
    expect(applyAction(game, { type: 'flip', at: at(6, 0) } as unknown as Action).ok).toBe(false);
    expect(applyAction(game, { type: 'move', from: at(3, 0), to: at(4, 0) }).ok).toBe(false);
    expect(applyAction(game, { type: 'move', from: -1, to: 0 }).ok).toBe(false);
    expect(applyAction(game, { type: 'move', from: at(6, 0), to: 90 }).ok).toBe(false);
  });
});

describe('covered pieces and revelations', () => {
  it.each<[CoveredRank, CoveredRank, number, number, number, number]>([
    ['rook', 'horse', 9, 0, 8, 0],
    ['horse', 'rook', 9, 1, 7, 2],
    ['elephant', 'soldier', 9, 2, 7, 0],
    ['advisor', 'rook', 9, 3, 8, 4],
    ['cannon', 'advisor', 7, 1, 7, 4],
    ['soldier', 'elephant', 6, 0, 5, 0],
  ])('moves a covered %s as its starting role and reveals %s', (cover, rank, fromRow, fromColumn, toRow, toColumn) => {
    const game = position([[fromRow, fromColumn, covered('red', cover, rank)]]);
    const next = play(game, at(fromRow, fromColumn), at(toRow, toColumn));
    expect(next.board[at(toRow, toColumn)]).toEqual(up('red', rank));
  });

  it('moves first as its starting-square role, then reveals and moves as its true identity', () => {
    const game = position([[6, 0, covered('red', 'soldier', 'elephant')]]);
    expect(legalMovesFrom(game.board, at(6, 0), 'red')).toEqual([at(5, 0)]);
    expect(applyAction(game, { type: 'move', from: at(6, 0), to: at(4, 2) }).ok).toBe(false);

    const next = play(game, at(6, 0), at(5, 0));
    expect(next.board[at(6, 0)]).toBeNull();
    expect(next.board[at(5, 0)]).toEqual(up('red', 'elephant'));
    expect(next.turn).toBe(1);
    expect(legalMovesFrom(next.board, at(5, 0), 'red')).toContain(at(7, 2));
    expect(legalMovesFrom(next.board, at(5, 0), 'red')).not.toContain(at(4, 0));
    expect(game.board[at(6, 0)]).toEqual(covered('red', 'soldier', 'elephant'));
  });

  it('reveals both a moving and a captured covered piece while leaving the screen hidden', () => {
    const game = position([
      [7, 1, covered('red', 'cannon', 'horse')],
      [2, 1, covered('black', 'cannon', 'soldier')],
      [0, 1, covered('black', 'horse', 'advisor')],
    ]);
    const next = play(game, at(7, 1), at(0, 1));
    expect(next.board[at(0, 1)]).toEqual(up('red', 'horse'));
    expect(next.lastMove).toEqual({
      from: at(7, 1), to: at(0, 1),
      piece: { color: 'red', rank: 'horse' },
      captured: { color: 'black', rank: 'advisor' }, capturedWasHidden: true,
    });
    const view = toGameView(next);
    expect(view.lastMove?.captured).toEqual({ color: 'black', rank: 'advisor' });
    expect(view.board[at(2, 1)]).toEqual({ faceUp: false, color: 'black', cover: 'cannon' });
    expect(view.captures).toEqual([{ piece: { color: 'black', rank: 'advisor' }, wasHidden: true }]);
    const later = play(next, at(2, 1), at(2, 2));
    expect(toGameView(later).captures).toEqual(view.captures);
  });

  it('does not reveal identities or change legal hints when only hidden ranks differ', () => {
    const first = position([[6, 0, covered('red', 'soldier', 'elephant')]]);
    const second = position([[6, 0, covered('red', 'soldier', 'rook')]]);
    const view = toGameView(first);
    expect(view).toEqual(toGameView(second));
    expect(view.board[at(6, 0)]).toEqual({ faceUp: false, color: 'red', cover: 'soldier' });
    expect(JSON.stringify(view)).not.toContain('elephant');
    expect(legalMovesFrom(view.board, at(6, 0), 'red')).toEqual(legalMovesFrom(second.board, at(6, 0), 'red'));
  });

  it('records visible captures without ending the game while the enemy general has legal moves', () => {
    const game = position([[5, 0, up('red', 'rook')], [5, 2, up('black', 'soldier')]]);
    const next = play(game, at(5, 0), at(5, 2));
    expect(next.outcome).toBeNull();
    expect(next.captures).toEqual([{ piece: { color: 'black', rank: 'soldier' }, wasHidden: false }]);
    expect(next.lastMove?.capturedWasHidden).toBe(false);
  });
});

describe('xiangqi movement', () => {
  it('restricts generals to one orthogonal point in their own palace', () => {
    const game = position([
      [9, 4, null], [7, 3, up('red', 'general')],
      [0, 3, null], [0, 5, up('black', 'general')],
    ]);
    const moves = legalMovesFrom(game.board, at(7, 3), 'red');
    expect(moves).toEqual(expect.arrayContaining([at(7, 4), at(8, 3)]));
    expect(moves).not.toContain(at(6, 3));
    expect(moves).not.toContain(at(7, 2));
    expect(moves).not.toContain(at(8, 4));
  });

  it('restricts advisors to diagonal steps inside their own palace', () => {
    const game = position([[9, 3, up('red', 'advisor')]]);
    expect(legalMovesFrom(game.board, at(9, 3), 'red')).toEqual([at(8, 4)]);
  });

  it('blocks the elephant eye and prevents crossing the river', () => {
    const blocked = position([[9, 2, up('red', 'elephant')], [8, 3, covered('red', 'horse', 'cannon')]]);
    expect(legalMovesFrom(blocked.board, at(9, 2), 'red')).toContain(at(7, 0));
    expect(legalMovesFrom(blocked.board, at(9, 2), 'red')).not.toContain(at(7, 4));

    const river = position([[5, 4, up('red', 'elephant')], [4, 0, up('black', 'elephant')]]);
    const redMoves = legalMovesFrom(river.board, at(5, 4), 'red');
    expect(redMoves).toEqual(expect.arrayContaining([at(7, 2), at(7, 6)]));
    expect(redMoves).not.toContain(at(3, 2));
    expect(redMoves).not.toContain(at(3, 6));
    expect(legalMovesFrom(river.board, at(4, 0), 'black')).not.toContain(at(6, 2));
  });

  it('uses the horse leg, including a covered piece as a blocker', () => {
    const game = position([[5, 4, up('red', 'horse')], [4, 4, covered('red', 'soldier', 'rook')]]);
    const moves = legalMovesFrom(game.board, at(5, 4), 'red');
    expect(moves).toEqual(expect.arrayContaining([at(7, 3), at(7, 5), at(4, 2), at(6, 6)]));
    expect(moves).not.toContain(at(3, 3));
    expect(moves).not.toContain(at(3, 5));
  });

  it('lets a rook travel along open lines and capture, but not pass, covered pieces', () => {
    const game = position([
      [5, 4, up('red', 'rook')], [5, 2, covered('red', 'soldier', 'horse')],
      [5, 6, covered('black', 'soldier', 'horse')], [5, 7, up('black', 'soldier')],
    ]);
    const moves = legalMovesFrom(game.board, at(5, 4), 'red');
    expect(moves).toEqual(expect.arrayContaining([at(5, 3), at(5, 5), at(5, 6), at(8, 4)]));
    expect(moves).not.toContain(at(5, 2));
    expect(moves).not.toContain(at(5, 7));
    expect(moves).not.toContain(at(6, 3));
  });

  it('moves a cannon freely without capturing and captures only over exactly one screen', () => {
    const game = position([
      [5, 1, up('red', 'cannon')], [5, 0, up('black', 'soldier')],
      [5, 3, covered('red', 'soldier', 'horse')], [5, 6, covered('black', 'soldier', 'rook')],
      [5, 7, up('black', 'horse')],
    ]);
    const moves = legalMovesFrom(game.board, at(5, 1), 'red');
    expect(moves).toEqual(expect.arrayContaining([at(5, 2), at(5, 6), at(3, 1)]));
    expect(moves).not.toContain(at(5, 0));
    expect(moves).not.toContain(at(5, 3));
    expect(moves).not.toContain(at(5, 4));
    expect(moves).not.toContain(at(5, 7));

    const friendlyTarget = position([
      [5, 1, up('red', 'cannon')], [5, 3, covered('black', 'soldier', 'horse')],
      [5, 6, covered('red', 'soldier', 'rook')], [5, 7, up('black', 'horse')],
    ]);
    const blocked = legalMovesFrom(friendlyTarget.board, at(5, 1), 'red');
    expect(blocked).not.toContain(at(5, 6));
    expect(blocked).not.toContain(at(5, 7));
  });

  it('moves soldiers forward, allowing sideways moves only after crossing the river', () => {
    const game = position([
      [6, 0, up('red', 'soldier')], [4, 8, up('red', 'soldier')],
      [3, 0, up('black', 'soldier')], [5, 0, up('black', 'soldier')],
    ]);
    expect(legalMovesFrom(game.board, at(6, 0), 'red')).toEqual([at(5, 0)]);
    expect(legalMovesFrom(game.board, at(4, 8), 'red').sort((a, b) => a - b)).toEqual([at(3, 8), at(4, 7)]);
    expect(legalMovesFrom(game.board, at(3, 0), 'black')).toEqual([at(4, 0)]);
    expect(legalMovesFrom(game.board, at(5, 0), 'black').sort((a, b) => a - b)).toEqual([at(5, 1), at(6, 0)]);
  });
});

describe('check and game end', () => {
  it('detects threats from a covered piece by its cover, not its secret identity', () => {
    const checking = position([
      [0, 3, null], [0, 4, up('black', 'general')], [5, 4, up('red', 'soldier')],
      [9, 0, covered('black', 'rook', 'soldier')],
    ]);
    const harmless = position([
      [0, 3, null], [0, 4, up('black', 'general')], [5, 4, up('red', 'soldier')],
      [9, 0, covered('black', 'horse', 'rook')],
    ]);
    expect(isInCheck(checking.board, 'red')).toBe(true);
    expect(isInCheck(toGameView(checking).board, 'red')).toBe(true);
    expect(isInCheck(harmless.board, 'red')).toBe(false);
  });

  it('uses the revealed identity for check immediately after the first move', () => {
    const game = position([[7, 1, covered('red', 'cannon', 'rook')]]);
    const next = play(game, at(7, 1), at(0, 1));
    expect(next.board[at(0, 1)]).toEqual(up('red', 'rook'));
    expect(isInCheck(next.board, 'black')).toBe(true);
    expect(next.outcome).toBeNull();
  });

  it('rejects moves that leave the general in check but allows blocking the check', () => {
    const game = position([[4, 4, up('black', 'rook')], [8, 0, up('red', 'rook')]]);
    expect(isInCheck(game.board, 'red')).toBe(true);
    expect(legalMovesFrom(game.board, at(8, 0), 'red')).not.toContain(at(8, 1));
    expect(applyAction(game, { type: 'move', from: at(8, 0), to: at(8, 1) }).ok).toBe(false);
    expect(legalMovesFrom(game.board, at(8, 0), 'red')).toContain(at(8, 4));
    expect(isInCheck(play(game, at(8, 0), at(8, 4)).board, 'red')).toBe(false);
  });

  it('enforces flying generals and cannot capture a general directly', () => {
    const game = position([
      [0, 3, null], [0, 4, up('black', 'general')], [5, 4, up('red', 'rook')],
    ]);
    const moves = legalMovesFrom(game.board, at(5, 4), 'red');
    expect(moves).not.toContain(at(5, 3));
    expect(moves).toContain(at(4, 4));
    expect(moves).not.toContain(at(0, 4));
    expect(applyAction(game, { type: 'move', from: at(5, 4), to: at(0, 4) }).ok).toBe(false);
    const open = game.board.slice();
    open[at(5, 4)] = null;
    expect(isInCheck(open, 'red')).toBe(true);
    expect(isInCheck(open, 'black')).toBe(true);
  });

  it('ends on checkmate rather than eliminating or capturing the general', () => {
    const game = position([
      [0, 3, null], [0, 4, up('black', 'general')], [1, 3, up('red', 'rook')],
      [1, 5, up('red', 'rook')], [3, 0, up('red', 'rook')], [6, 4, up('red', 'soldier')],
    ]);
    expect(isInCheck(game.board, 'black')).toBe(false);
    const next = play(game, at(3, 0), at(3, 4));
    expect(next.outcome).toEqual({ winner: 0, reason: 'checkmate' });
    expect(next.board[at(0, 4)]).toEqual(up('black', 'general'));
    expect(legalActions(next)).toEqual([]);
    expect(applyAction(next, { type: 'move', from: at(0, 4), to: at(0, 3) }).ok).toBe(false);
  });

  it('also awards checkmate to black', () => {
    const game = position([
      [0, 3, null], [0, 4, up('black', 'general')], [8, 3, up('black', 'rook')],
      [8, 5, up('black', 'rook')], [6, 8, up('black', 'rook')], [3, 4, up('black', 'soldier')],
    ], 1);
    const next = play(game, at(6, 8), at(6, 4));
    expect(next.outcome).toEqual({ winner: 1, reason: 'checkmate' });
  });

  it('treats stalemate without check as a loss for the side to move', () => {
    const game = position([
      [0, 3, null], [0, 4, up('black', 'general')], [2, 3, up('red', 'rook')],
      [2, 5, up('red', 'rook')], [1, 0, up('red', 'rook')], [6, 4, up('red', 'soldier')],
    ]);
    const next = play(game, at(6, 4), at(5, 4));
    expect(isInCheck(next.board, 'black')).toBe(false);
    expect(next.outcome).toEqual({ winner: 0, reason: 'stalemate' });
  });

  it('does not declare stalemate if a covered piece can still make a legal move', () => {
    const game = position([
      [0, 3, null], [0, 4, up('black', 'general')], [2, 3, up('red', 'rook')],
      [2, 5, up('red', 'rook')], [1, 0, up('red', 'rook')], [6, 4, up('red', 'soldier')],
      [3, 8, covered('black', 'soldier', 'elephant')],
    ]);
    const next = play(game, at(6, 4), at(5, 4));
    expect(next.outcome).toBeNull();
    expect(legalActions(next)).toContainEqual({ type: 'move', from: at(3, 8), to: at(4, 8) });
  });

  it('does not automatically end repeated positions', () => {
    let game = position([[9, 0, up('red', 'rook')], [0, 8, up('black', 'rook')]]);
    for (let i = 0; i < 3; i += 1) {
      game = play(game, at(9, 0), at(8, 0));
      game = play(game, at(0, 8), at(1, 8));
      game = play(game, at(8, 0), at(9, 0));
      game = play(game, at(1, 8), at(0, 8));
    }
    expect(game.outcome).toBeNull();
  });
});

describe('complete games', () => {
  it('preserves generals, capture accounting, secrecy, and king safety during shuffled play', () => {
    for (let seed = 1; seed <= 3; seed += 1) {
      let value = seed;
      const random = () => ((value = (Math.imul(1664525, value) + 1013904223) | 0) >>> 0) / 2 ** 32;
      let game = createGame(random);
      let hiddenCount = 30;
      for (let ply = 0; ply < 80 && !game.outcome; ply += 1) {
        const actions = legalActions(game);
        expect(actions.length).toBeGreaterThan(0);
        const action = actions[Math.floor(random() * actions.length)];
        const color = game.colors[game.turn];
        game = play(game, action.from, action.to);
        expect(game.board[action.to]?.faceUp).toBe(true);
        expect(squareColor(game.board[action.to])).toBe(color);
        expect(isInCheck(game.board, color)).toBe(false);
        expect(game.board.filter(Boolean).length + game.captures.length).toBe(32);
        expect(game.board.filter((square) => square?.faceUp && square.piece.rank === 'general')).toHaveLength(2);
        const remainingHidden = game.board.filter((square) => square && !square.faceUp).length;
        expect(remainingHidden).toBeLessThanOrEqual(hiddenCount);
        hiddenCount = remainingHidden;
        for (const square of toGameView(game).board) {
          if (square && !square.faceUp) expect(square).not.toHaveProperty('rank');
        }
      }
    }
  });
});
