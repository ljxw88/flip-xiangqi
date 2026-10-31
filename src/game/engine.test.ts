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
const trueColor = (square: Square): Color | null => square ? (square.faceUp ? square.piece.color : square.color) : null;

function position(entries: Array<[number, number, Square]>, turn: Player = 0): GameState {
  const board: Square[] = Array(BOARD_SIZE).fill(null);
  board[at(9, 4)] = up('red', 'general');
  board[at(0, 3)] = up('black', 'general');
  for (const [row, column, square] of entries) board[at(row, column)] = square;
  return { board, turn, colors: ['red', 'black'], outcome: null, lastAction: null, captures: [], pendingFlip: null };
}

function play(game: GameState, action: Action): GameState {
  const result = applyAction(game, action);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

const move = (fromRow: number, fromColumn: number, toRow: number, toColumn: number): Action =>
  ({ type: 'move', from: at(fromRow, fromColumn), to: at(toRow, toColumn) });
const flip = (row: number, column: number): Action => ({ type: 'flip', at: at(row, column) });
const endTurn: Action = { type: 'end-turn' };

describe('opening setup', () => {
  const FACE_UP_RANKS: readonly Rank[] = ['general', 'advisor', 'elephant'];
  const seeded = (seed: number) => {
    let value = seed;
    return () => ((value = (Math.imul(1664525, value) + 1013904223) | 0) >>> 0) / 2 ** 32;
  };

  it('reveals generals, advisors and elephants and covers the other 22 pieces on standard points', () => {
    const game = createGame(() => 0);
    expect([BOARD_ROWS, BOARD_COLUMNS, BOARD_SIZE]).toEqual([10, 9, 90]);
    expect(game.turn).toBe(0);
    expect(game.colors).toEqual(['red', 'black']);
    expect(game.lastAction).toBeNull();
    expect(game.pendingFlip).toBeNull();
    expect(game.board.filter(Boolean)).toHaveLength(32);

    for (const [home, cannon, soldier] of [[0, 2, 3], [9, 7, 6]] as const) {
      for (let column = 0; column < 9; column += 1) expect(game.board[at(home, column)]).not.toBeNull();
      for (const column of [1, 7]) expect(game.board[at(cannon, column)]).toMatchObject({ faceUp: false });
      for (const column of [0, 2, 4, 6, 8]) expect(game.board[at(soldier, column)]).not.toBeNull();
    }
    for (const color of ['red', 'black'] as const) {
      const revealed: Record<string, number> = {};
      const hidden: Record<string, number> = {};
      for (const square of game.board) {
        if (!square || trueColor(square) !== color) continue;
        if (square.faceUp) revealed[square.piece.rank] = (revealed[square.piece.rank] ?? 0) + 1;
        else hidden[square.rank] = (hidden[square.rank] ?? 0) + 1;
      }
      expect(revealed).toEqual({ general: 1, advisor: 2, elephant: 2 });
      expect(hidden).toEqual({ horse: 2, rook: 2, cannon: 2, soldier: 5 });
    }
    expect(game.board[at(4, 4)]).toBeNull();
    expect(game.board[at(5, 4)]).toBeNull();
  });

  it('mixes both colors across both halves without changing the 32 points', () => {
    const game = createGame(() => 0.999999);
    const top = game.board.slice(0, 5 * BOARD_COLUMNS);
    const bottom = game.board.slice(5 * BOARD_COLUMNS);
    for (const half of [top, bottom]) {
      expect(half.some((square) => trueColor(square) === 'red')).toBe(true);
      expect(half.some((square) => trueColor(square) === 'black')).toBe(true);
    }
  });

  it('places revealed elephants only on legal landings, keeps the rest covered, and never strands any piece', () => {
    const elephants = {
      red: [at(9, 2), at(9, 6), at(7, 0), at(7, 4), at(7, 8), at(5, 2), at(5, 6)],
      black: [at(0, 2), at(0, 6), at(2, 0), at(2, 4), at(2, 8), at(4, 2), at(4, 6)],
    };
    for (let seed = 1; seed <= 80; seed += 1) {
      const game = createGame(seeded(seed));
      for (const [color, row] of [['black', 0], ['red', 9]] as const) {
        expect(game.board[at(row, 3)]).toEqual(up(color, 'advisor'));
        expect(game.board[at(row, 4)]).toEqual(up(color, 'general'));
        expect(game.board[at(row, 5)]).toEqual(up(color, 'advisor'));
      }
      game.board.forEach((square, index) => {
        if (!square) return;
        const color = square.faceUp ? square.piece.color : square.color;
        const rank = square.faceUp ? square.piece.rank : square.rank;
        expect(square.faceUp).toBe(FACE_UP_RANKS.includes(rank));
        if (rank === 'elephant') expect(elephants[color]).toContain(index);
        const empty: Square[] = Array(BOARD_SIZE).fill(null);
        empty[index] = up(color, rank);
        expect(legalMovesFrom(empty, index, color).length).toBeGreaterThan(0);
      });
    }
  });

  it('always keeps generals centered and advisors beside them on their home rank', () => {
    for (const random of [() => 0, () => 0.5, () => 0.999999]) {
      const game = createGame(random);
      for (const [color, row] of [['black', 0], ['red', 9]] as const) {
        expect(game.board[at(row, 4)]).toEqual(up(color, 'general'));
        expect(game.board[at(row, 3)]).toEqual(up(color, 'advisor'));
        expect(game.board[at(row, 5)]).toEqual(up(color, 'advisor'));
      }
    }
    const game = createGame(() => 0.999999);
    expect(applyAction(game, flip(9, 4)).ok).toBe(false);
  });

  it('shows the revealed palace pieces publicly but hides the color and rank of every covered piece', () => {
    const view = toGameView(createGame(() => 0));
    const hidden = view.board.filter((square) => square && !square.faceUp);
    expect(hidden).toHaveLength(22);
    expect(hidden.every((square) => square && !square.faceUp &&
      !('color' in square) && !('rank' in square) && !('piece' in square) && !('cover' in square))).toBe(true);
    const shown = view.board.filter((square) => square?.faceUp);
    expect(shown).toHaveLength(10);
    expect(shown.every((square) => square?.faceUp && FACE_UP_RANKS.includes(square.piece.rank))).toBe(true);
  });

  it('offers flips of all 22 covered pieces plus moves of red revealed pieces at the start', () => {
    const game = createGame(() => 0);
    const actions = legalActions(game);
    expect(actions.filter((action) => action.type === 'flip')).toHaveLength(22);
    const moves = actions.filter((action) => action.type === 'move');
    expect(moves.length).toBeGreaterThan(0);
    for (const action of moves) {
      if (action.type !== 'move') continue;
      const square = game.board[action.from];
      expect(square?.faceUp && square.piece.color === 'red').toBe(true);
    }
    expect(applyAction(game, move(0, 4, 1, 4)).ok).toBe(false);
    const black = game.board.findIndex((square) => square && !square.faceUp && trueColor(square) === 'black');
    const flipped = play(game, { type: 'flip', at: black });
    expect(flipped.turn).toBe(1);
    expect(flipped.pendingFlip).toBeNull();
    expect(applyAction(game, endTurn).ok).toBe(false);
    expect(applyAction(game, flip(4, 4)).ok).toBe(false);
    expect(applyAction(game, { type: 'flip', at: -1 }).ok).toBe(false);
    expect(applyAction(game, { type: 'flip', at: 90 }).ok).toBe(false);
  });
});

describe('flipping and secrecy', () => {
  it('flips in place and may move that piece immediately in the same turn', () => {
    const game = position([[6, 0, covered('red', 'rook')], [3, 0, covered('black', 'elephant')]]);
    expect(legalMovesFrom(game.board, at(6, 0), 'red')).toEqual([]);
    expect(applyAction(game, move(6, 0, 6, 2)).ok).toBe(false);
    const first = play(game, flip(6, 0));
    expect(first.board[at(6, 0)]).toEqual(up('red', 'rook'));
    expect(first.turn).toBe(0);
    expect(first.pendingFlip).toBe(at(6, 0));
    expect(first.lastAction).toEqual({ type: 'flip', at: at(6, 0), piece: { color: 'red', rank: 'rook' } });
    expect(applyAction(first, flip(3, 0)).ok).toBe(false);
    expect(applyAction(first, move(9, 4, 8, 4)).ok).toBe(false);
    expect(game.board[at(6, 0)]).toEqual(covered('red', 'rook'));
    const moved = play(first, move(6, 0, 6, 2));
    expect(moved.board[at(6, 0)]).toBeNull();
    expect(moved.board[at(6, 2)]).toEqual(up('red', 'rook'));
    expect(moved.turn).toBe(1);
    expect(moved.pendingFlip).toBeNull();
  });

  it('may end the turn without moving the newly flipped piece', () => {
    const game = position([[6, 0, covered('red', 'rook')], [3, 0, covered('black', 'elephant')]]);
    const first = play(game, flip(6, 0));
    expect(legalActions(first)).toContainEqual(endTurn);
    const passed = play(first, endTurn);
    expect(passed.turn).toBe(1);
    expect(passed.pendingFlip).toBeNull();
    expect(passed.board[at(6, 0)]).toEqual(up('red', 'rook'));
    expect(applyAction(passed, endTurn).ok).toBe(false);
  });

  it('can end the turn when the newly flipped piece has no legal move', () => {
    const game = position([
      [9, 4, covered('red', 'general')], [8, 4, up('red', 'soldier')],
      [9, 3, up('red', 'advisor')], [9, 5, up('red', 'advisor')],
    ]);
    const flipped = play(game, flip(9, 4));
    expect(legalActions(flipped)).toEqual([endTurn]);
    expect(play(flipped, endTurn).turn).toBe(1);
  });

  it.each<Color>(['red', 'black'])('may capture a covered %s piece immediately after flipping', (color) => {
    const game = position([[6, 0, covered('red', 'rook')], [6, 2, covered(color, 'horse')], [6, 4, up('red', 'soldier')]]);
    const flipped = play(game, flip(6, 0));
    expect(applyAction(flipped, flip(6, 2)).ok).toBe(false);
    expect(applyAction(flipped, move(6, 4, 5, 4)).ok).toBe(false);
    const next = play(flipped, move(6, 0, 6, 2));
    expect(next.turn).toBe(1);
    expect(next.captures).toEqual([{ piece: { color, rank: 'horse' }, wasHidden: true }]);
  });

  it('cannot flip an empty point or an already revealed piece', () => {
    const game = position([[6, 0, covered('red', 'rook')], [3, 0, covered('black', 'horse')]]);
    expect(applyAction(game, flip(5, 0)).ok).toBe(false);
    expect(applyAction(game, flip(9, 4)).ok).toBe(false);
  });

  it('ends the turn immediately when the flipped piece belongs to the opponent', () => {
    const game = position([[3, 0, covered('black', 'horse')], [6, 0, covered('red', 'rook')]]);
    const next = play(game, flip(3, 0));
    expect(next.board[at(3, 0)]).toEqual(up('black', 'horse'));
    expect(next.turn).toBe(1);
    expect(next.pendingFlip).toBeNull();
    expect(legalMovesFrom(next.board, at(3, 0), 'red')).toEqual([]);
    expect(applyAction(next, endTurn).ok).toBe(false);
    expect(play(next, move(3, 0, 5, 1)).turn).toBe(0);
  });

  it('also ends black’s turn immediately after flipping a red piece', () => {
    const game = position([[6, 0, covered('red', 'rook')]], 1);
    const next = play(game, flip(6, 0));
    expect(next.board[at(6, 0)]).toEqual(up('red', 'rook'));
    expect(next.turn).toBe(0);
    expect(next.pendingFlip).toBeNull();
  });

  it('immediately adjudicates checkmate after flipping the opponent’s general', () => {
    const game = position([
      [0, 3, null], [0, 4, covered('black', 'general')], [1, 3, up('red', 'rook')],
      [1, 5, up('red', 'rook')], [3, 4, up('red', 'rook')], [6, 4, up('red', 'soldier')],
    ]);
    const next = play(game, flip(0, 4));
    expect(next.turn).toBe(1);
    expect(next.pendingFlip).toBeNull();
    expect(next.outcome).toEqual({ winner: 0, reason: 'checkmate' });
  });

  it('allows an opponent flip to reveal an attack on the flipping player’s general', () => {
    const game = position([[4, 4, covered('black', 'rook')]]);
    expect(isInCheck(game.board, 'red')).toBe(false);
    const next = play(game, flip(4, 4));
    expect(next.turn).toBe(1);
    expect(isInCheck(next.board, 'red')).toBe(true);
    expect(play(next, move(4, 4, 9, 4)).outcome).toEqual({ winner: 1, reason: 'general-captured' });
  });

  it('never lets a player move a revealed piece of the opposing color', () => {
    const game = position([[3, 0, up('black', 'horse')]]);
    expect(legalMovesFrom(game.board, at(3, 0), 'red')).toEqual([]);
    expect(applyAction(game, move(3, 0, 5, 1)).ok).toBe(false);
  });

  it('does not change legal actions or public views when only covered identities differ', () => {
    const first = position([[9, 4, null], [6, 0, covered('red', 'general')], [6, 2, covered('red', 'rook')]]);
    const second = position([[9, 4, null], [6, 0, covered('red', 'rook')], [6, 2, covered('red', 'general')]]);
    const swappedColor = position([[9, 4, null], [6, 0, covered('black', 'rook')], [6, 2, covered('red', 'general')]]);
    expect(toGameView(first)).toEqual(toGameView(second));
    expect(toGameView(first)).toEqual(toGameView(swappedColor));
    expect(legalActions(first)).toEqual(legalActions(second));
    expect(legalActions(first)).toEqual(legalActions(swappedColor));
    expect(isInCheck(first.board, 'red')).toBe(false);
    expect(isInCheck(second.board, 'red')).toBe(false);
    expect(toGameView(first).board[at(6, 0)]).toEqual({ faceUp: false });
  });

  it('allows a flipped general to move immediately within its palace', () => {
    const game = position([[9, 4, covered('red', 'general')]]);
    const next = play(game, flip(9, 4));
    expect(next.board[at(9, 4)]).toEqual(up('red', 'general'));
    const moved = play(next, move(9, 4, 8, 4));
    expect(moved.board[at(8, 4)]).toEqual(up('red', 'general'));
    expect(moved.turn).toBe(1);
  });

  it('allows a general to be flipped into check without leaking its hidden identity', () => {
    const game = position([
      [9, 4, null], [7, 4, covered('red', 'general')], [7, 0, up('black', 'rook')],
    ]);
    expect(isInCheck(game.board, 'red')).toBe(false);
    expect(legalMovesFrom(game.board, at(7, 0), 'black')).toContain(at(7, 4));
    const revealed = play(game, flip(7, 4));
    expect(revealed.turn).toBe(0);
    expect(isInCheck(revealed.board, 'red')).toBe(true);
    const saved = play(revealed, move(7, 4, 8, 4));
    expect(saved.turn).toBe(1);
    expect(isInCheck(saved.board, 'red')).toBe(false);
    const passed = play(revealed, endTurn);
    const captured = play(passed, move(7, 0, 7, 4));
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

  it('waits until the flip chain ends before declaring checkmate', () => {
    const game = position([
      [0, 3, null], [0, 4, up('black', 'general')], [1, 3, up('red', 'rook')],
      [1, 5, up('red', 'rook')], [3, 4, covered('red', 'rook')], [6, 4, up('red', 'soldier')],
    ]);
    const flipped = play(game, flip(3, 4));
    expect(isInCheck(flipped.board, 'black')).toBe(true);
    expect(flipped.outcome).toBeNull();
    expect(flipped.turn).toBe(0);
    expect(play(flipped, endTurn).outcome).toEqual({ winner: 0, reason: 'checkmate' });
  });
});

describe('revealed xiangqi movement and covered captures', () => {
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

  it('lets a rook capture a covered enemy and reveals its identity', () => {
    const game = position([[5, 4, up('red', 'rook')], [5, 6, covered('black', 'horse')], [5, 7, up('black', 'soldier')]]);
    const moves = legalMovesFrom(game.board, at(5, 4), 'red');
    expect(moves).toContain(at(5, 5));
    expect(moves).toContain(at(5, 6));
    expect(moves).not.toContain(at(5, 7));
    const next = play(game, move(5, 4, 5, 6));
    expect(next.board[at(5, 6)]).toEqual(up('red', 'rook'));
    expect(next.captures).toEqual([{ piece: { color: 'black', rank: 'horse' }, wasHidden: true }]);
    expect(toGameView(next).captures).toEqual(next.captures);
    expect(toGameView(game).board[at(5, 6)]).toEqual({ faceUp: false });
    expect(next.outcome).toBeNull();
  });

  it('allows self-capture of a covered piece, but not a revealed friendly piece', () => {
    const game = position([[5, 4, up('red', 'rook')], [5, 6, covered('red', 'horse')]]);
    const next = play(game, move(5, 4, 5, 6));
    expect(next.captures).toEqual([{ piece: { color: 'red', rank: 'horse' }, wasHidden: true }]);
    expect(next.board[at(5, 6)]).toEqual(up('red', 'rook'));
    const friendly = position([[5, 4, up('red', 'rook')], [5, 6, up('red', 'horse')]]);
    expect(legalMovesFrom(friendly.board, at(5, 4), 'red')).not.toContain(at(5, 6));
    expect(applyAction(friendly, move(5, 4, 5, 6)).ok).toBe(false);
  });

  it.each<[Rank, number, number, number, number]>([
    ['soldier', 4, 4, 3, 4],
    ['horse', 5, 4, 3, 3],
    ['elephant', 9, 2, 7, 0],
    ['advisor', 9, 3, 8, 4],
    ['general', 9, 4, 8, 4],
  ])('lets a revealed %s capture a covered piece of either color', (rank, fromRow, fromColumn, toRow, toColumn) => {
    for (const color of ['red', 'black'] as const) {
      const game = position([[fromRow, fromColumn, up('red', rank)], [toRow, toColumn, covered(color, 'horse')]]);
      expect(legalMovesFrom(game.board, at(fromRow, fromColumn), 'red')).toContain(at(toRow, toColumn));
      const next = play(game, move(fromRow, fromColumn, toRow, toColumn));
      expect(next.captures).toEqual([{ piece: { color, rank: 'horse' }, wasHidden: true }]);
    }
  });

  it('lets a cannon capture either color of covered target over exactly one screen', () => {
    const game = position([
      [5, 1, up('red', 'cannon')], [5, 0, up('black', 'soldier')],
      [5, 3, covered('red', 'horse')], [5, 6, covered('black', 'rook')], [5, 7, up('black', 'horse')],
    ]);
    const moves = legalMovesFrom(game.board, at(5, 1), 'red');
    expect(moves).toEqual(expect.arrayContaining([at(5, 2), at(3, 1)]));
    expect(moves).not.toContain(at(5, 0));
    expect(moves).not.toContain(at(5, 4));
    expect(moves).toContain(at(5, 6));
    expect(moves).not.toContain(at(5, 7));
    expect(play(game, move(5, 1, 5, 6)).captures).toEqual([{ piece: { color: 'black', rank: 'rook' }, wasHidden: true }]);
    const friendly = position([[5, 1, up('red', 'cannon')], [5, 3, covered('black', 'horse')], [5, 6, covered('red', 'rook')]]);
    expect(play(friendly, move(5, 1, 5, 6)).captures).toEqual([{ piece: { color: 'red', rank: 'rook' }, wasHidden: true }]);
    const revealedFriendly = position([[5, 1, up('red', 'cannon')], [5, 3, covered('black', 'horse')], [5, 6, up('red', 'rook')]]);
    expect(legalMovesFrom(revealedFriendly.board, at(5, 1), 'red')).not.toContain(at(5, 6));
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
    expect(next.captures).toEqual([{ piece: { color: 'black', rank: 'rook' }, wasHidden: false }]);
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
    expect(won.captures).toEqual([{ piece: { color: 'black', rank: 'general' }, wasHidden: false }]);
    expect(applyAction(won, move(5, 3, 5, 4)).ok).toBe(false);
    expect(legalActions(won)).toEqual([]);

    const flying = position([[0, 3, null], [0, 4, up('black', 'general')]]);
    expect(legalMovesFrom(flying.board, at(9, 4), 'red')).toContain(at(0, 4));
    expect(play(flying, move(9, 4, 0, 4)).outcome).toEqual({ winner: 0, reason: 'general-captured' });
  });

  it('wins when a covered enemy general is captured and revealed', () => {
    const game = position([[0, 3, null], [5, 3, covered('black', 'general')], [5, 0, up('red', 'rook')]]);
    expect(isInCheck(game.board, 'black')).toBe(false);
    const won = play(game, move(5, 0, 5, 3));
    expect(won.outcome).toEqual({ winner: 0, reason: 'general-captured' });
    expect(toGameView(won).captures).toEqual([{ piece: { color: 'black', rank: 'general' }, wasHidden: true }]);
  });

  it('loses on self-capture of a covered general without revealing it through legal hints', () => {
    const generalAtTarget = position([
      [9, 4, null], [5, 0, up('red', 'rook')], [5, 3, covered('red', 'general')], [6, 0, covered('red', 'horse')],
    ]);
    const generalElsewhere = position([
      [9, 4, null], [5, 0, up('red', 'rook')], [5, 3, covered('red', 'horse')], [6, 0, covered('red', 'general')],
    ]);
    expect(toGameView(generalAtTarget)).toEqual(toGameView(generalElsewhere));
    expect(legalMovesFrom(generalAtTarget.board, at(5, 0), 'red'))
      .toEqual(legalMovesFrom(generalElsewhere.board, at(5, 0), 'red'));
    const lost = play(generalAtTarget, move(5, 0, 5, 3));
    expect(lost.outcome).toEqual({ winner: 1, reason: 'general-captured' });
    expect(lost.captures).toEqual([{ piece: { color: 'red', rank: 'general' }, wasHidden: true }]);
  });

  it('also awards red the win if black captures its own covered general', () => {
    const game = position([
      [0, 3, null], [4, 0, up('black', 'rook')], [4, 2, covered('black', 'general')],
    ], 1);
    const lost = play(game, move(4, 0, 4, 2));
    expect(lost.outcome).toEqual({ winner: 0, reason: 'general-captured' });
    expect(lost.captures).toEqual([{ piece: { color: 'black', rank: 'general' }, wasHidden: true }]);
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

  it('does not declare stalemate if any covered piece may still be flipped', () => {
    const game = position([
      [0, 3, null], [0, 4, up('black', 'general')], [2, 3, up('red', 'rook')],
      [2, 5, up('red', 'rook')], [1, 0, up('red', 'rook')], [6, 4, up('red', 'soldier')],
      [3, 8, covered('red', 'elephant')],
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
      let hiddenCount = 22;
      for (let ply = 0; ply < 100 && !game.outcome; ply += 1) {
        const actions = legalActions(game);
        expect(actions.length).toBeGreaterThan(0);
        const action = actions[Math.floor(random() * actions.length)];
        const color = game.colors[game.turn];
        const previousTurn = game.turn;
        const previousCount = game.board.filter(Boolean).length;
        const flipped = action.type === 'flip' ? game.board[action.at] : null;
        const target = action.type === 'move' ? game.board[action.to] : null;
        if (target?.faceUp) expect(target.piece.color).not.toBe(color);
        const capturedHidden = Boolean(target && !target.faceUp);
        game = play(game, action);
        if (action.type === 'flip') {
          if (!flipped || flipped.faceUp) throw new Error('Expected a covered piece');
          expect(game.turn).toBe(flipped.color === color ? previousTurn : previousTurn === 0 ? 1 : 0);
          expect(game.pendingFlip).toBe(flipped.color === color ? action.at : null);
          expect(game.board[action.at]?.faceUp).toBe(true);
          expect(squareColor(game.board[action.at])).toBe(flipped.color);
        } else if (action.type === 'move') {
          expect(game.turn).not.toBe(previousTurn);
          expect(game.pendingFlip).toBeNull();
          expect(game.board[action.to]?.faceUp).toBe(true);
          expect(squareColor(game.board[action.to])).toBe(color);
          expect(isInCheck(game.board, color)).toBe(false);
        } else {
          expect(game.turn).not.toBe(previousTurn);
          expect(game.pendingFlip).toBeNull();
        }
        expect(game.board.filter(Boolean).length + game.captures.length).toBe(32);
        const remainingHidden = game.board.filter((square) => square && !square.faceUp).length;
        expect(remainingHidden).toBe(hiddenCount - (action.type === 'flip' || capturedHidden ? 1 : 0));
        if (action.type === 'flip') expect(game.board.filter(Boolean)).toHaveLength(previousCount);
        hiddenCount = remainingHidden;
        const generalsOnBoard = game.board.filter((square) => square &&
          (square.faceUp ? square.piece.rank : square.rank) === 'general').length;
        expect(generalsOnBoard + game.captures.filter((capture) => capture.piece.rank === 'general').length).toBe(2);
        for (const square of toGameView(game).board) {
          if (square && !square.faceUp) {
            expect(square).not.toHaveProperty('rank');
            expect(square).not.toHaveProperty('color');
            expect(square).not.toHaveProperty('cover');
          }
        }
      }
    }
  });
});
