export const BOARD_ROWS = 4;
export const BOARD_COLUMNS = 8;
export const BOARD_SIZE = BOARD_ROWS * BOARD_COLUMNS;

export type Color = 'red' | 'black';
export type Player = 0 | 1;
export type Rank =
  | 'general'
  | 'advisor'
  | 'elephant'
  | 'rook'
  | 'horse'
  | 'cannon'
  | 'soldier';

export interface Piece {
  readonly color: Color;
  readonly rank: Rank;
}

export type Square =
  | { readonly faceUp: false; readonly piece: Piece }
  | { readonly faceUp: true; readonly piece: Piece }
  | null;

// The identities of face-down pieces never need to be sent to a client.
export type PublicSquare =
  | { readonly faceUp: false }
  | { readonly faceUp: true; readonly piece: Piece }
  | null;

export interface Outcome {
  readonly winner: Player;
  readonly reason: 'elimination' | 'no-legal-moves';
}

export interface GameView {
  readonly board: readonly PublicSquare[];
  readonly turn: Player;
  readonly colors: readonly [Color | null, Color | null];
  readonly outcome: Outcome | null;
}

export interface GameState extends GameView {
  readonly board: readonly Square[];
}

export type Action =
  | { readonly type: 'flip'; readonly at: number }
  | { readonly type: 'move'; readonly from: number; readonly to: number };

export type ActionResult =
  | { readonly ok: true; readonly state: GameState }
  | { readonly ok: false; readonly error: string };

const PIECE_COUNTS: readonly [Rank, number][] = [
  ['general', 1],
  ['advisor', 2],
  ['elephant', 2],
  ['rook', 2],
  ['horse', 2],
  ['cannon', 2],
  ['soldier', 5],
];

const RANK_POWER: Record<Rank, number> = {
  general: 7,
  advisor: 6,
  elephant: 5,
  rook: 4,
  horse: 3,
  cannon: 2,
  soldier: 1,
};

const DIRECTIONS: readonly [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

export function oppositeColor(color: Color): Color {
  return color === 'red' ? 'black' : 'red';
}

export function otherPlayer(player: Player): Player {
  return player === 0 ? 1 : 0;
}

/** Create and Fisher–Yates shuffle all 32 pieces. Inject a random source for tests. */
export function createGame(random: () => number = Math.random): GameState {
  const board: Square[] = [];
  for (const color of ['red', 'black'] as const) {
    for (const [rank, count] of PIECE_COUNTS) {
      for (let i = 0; i < count; i += 1) {
        board.push({ faceUp: false, piece: { color, rank } });
      }
    }
  }

  for (let i = board.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [board[i], board[j]] = [board[j], board[i]];
  }

  return { board, turn: 0, colors: [null, null], outcome: null };
}

/** Rank comparison for ordinary captures. Cannons use their separate jump rule. */
export function canCaptureByRank(attacker: Rank, defender: Rank): boolean {
  if (attacker === 'soldier' && defender === 'general') return true;
  if (attacker === 'general' && defender === 'soldier') return false;
  return RANK_POWER[attacker] >= RANK_POWER[defender];
}

function inBounds(row: number, column: number): boolean {
  return row >= 0 && row < BOARD_ROWS && column >= 0 && column < BOARD_COLUMNS;
}

function indexAt(row: number, column: number): number {
  return row * BOARD_COLUMNS + column;
}

/** Destinations depend only on visible information, so this also works on a GameView. */
export function legalMovesFrom(
  board: readonly PublicSquare[],
  from: number,
  color: Color,
): number[] {
  if (!Number.isInteger(from) || from < 0 || from >= BOARD_SIZE) return [];
  const source = board[from];
  if (!source || !source.faceUp || source.piece.color !== color) return [];

  const row = Math.floor(from / BOARD_COLUMNS);
  const column = from % BOARD_COLUMNS;
  const destinations: number[] = [];

  for (const [dr, dc] of DIRECTIONS) {
    const adjacentRow = row + dr;
    const adjacentColumn = column + dc;
    if (!inBounds(adjacentRow, adjacentColumn)) continue;

    const adjacentIndex = indexAt(adjacentRow, adjacentColumn);
    const adjacent = board[adjacentIndex];
    if (!adjacent) {
      destinations.push(adjacentIndex);
    } else if (
      source.piece.rank !== 'cannon' &&
      adjacent.faceUp &&
      adjacent.piece.color !== color &&
      canCaptureByRank(source.piece.rank, adjacent.piece.rank)
    ) {
      destinations.push(adjacentIndex);
    }

    if (source.piece.rank !== 'cannon') continue;

    let screenFound = false;
    for (
      let r = adjacentRow, c = adjacentColumn;
      inBounds(r, c);
      r += dr, c += dc
    ) {
      const target = board[indexAt(r, c)];
      if (!target) continue;
      if (!screenFound) {
        screenFound = true;
      } else {
        if (target.faceUp && target.piece.color !== color) {
          destinations.push(indexAt(r, c));
        }
        break;
      }
    }
  }

  return destinations;
}

export function legalActions(game: GameView): Action[] {
  if (game.outcome) return [];
  const actions: Action[] = [];
  const color = game.colors[game.turn];

  game.board.forEach((square, index) => {
    if (square && !square.faceUp) {
      actions.push({ type: 'flip', at: index });
    } else if (square && color && square.piece.color === color) {
      for (const to of legalMovesFrom(game.board, index, color)) {
        actions.push({ type: 'move', from: index, to });
      }
    }
  });

  return actions;
}

function sameAction(a: Action, b: Action): boolean {
  if (a.type === 'flip' && b.type === 'flip') return a.at === b.at;
  if (a.type === 'move' && b.type === 'move') {
    return a.from === b.from && a.to === b.to;
  }
  return false;
}

/** Validate and apply a turn without mutating the previous state. */
export function applyAction(game: GameState, action: Action): ActionResult {
  if (game.outcome) return { ok: false, error: 'The game is already over.' };
  if (!legalActions(game).some((legal) => sameAction(legal, action))) {
    return { ok: false, error: 'That is not a legal move.' };
  }

  const board = game.board.slice();
  let colors = game.colors;

  if (action.type === 'flip') {
    const square = board[action.at];
    if (!square || square.faceUp) return { ok: false, error: 'That piece cannot be flipped.' };
    board[action.at] = { faceUp: true, piece: square.piece };
    if (colors[game.turn] === null) {
      const firstColor = game.turn === 0 ? square.piece.color : oppositeColor(square.piece.color);
      colors = [firstColor, oppositeColor(firstColor)];
    }
  } else {
    board[action.to] = board[action.from];
    board[action.from] = null;
  }

  const nextPlayer = otherPlayer(game.turn);
  const next: GameState = { board, turn: nextPlayer, colors, outcome: null };
  const enemyColor = colors[nextPlayer];
  if (enemyColor && !board.some((square) => square?.piece.color === enemyColor)) {
    return { ok: true, state: { ...next, outcome: { winner: game.turn, reason: 'elimination' } } };
  }
  if (legalActions(next).length === 0) {
    return { ok: true, state: { ...next, outcome: { winner: game.turn, reason: 'no-legal-moves' } } };
  }
  return { ok: true, state: next };
}

/** Copy only public information, omitting every face-down piece's identity. */
export function toGameView(game: GameState): GameView {
  return {
    board: game.board.map((square): PublicSquare => {
      if (!square) return null;
      if (!square.faceUp) return { faceUp: false };
      return { faceUp: true, piece: { ...square.piece } };
    }),
    turn: game.turn,
    colors: [...game.colors],
    outcome: game.outcome ? { ...game.outcome } : null,
  };
}
