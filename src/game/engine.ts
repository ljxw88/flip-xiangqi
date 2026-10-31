export const BOARD_ROWS = 10;
export const BOARD_COLUMNS = 9;
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
export type CoveredRank = Exclude<Rank, 'general'>;

export interface Piece {
  readonly color: Color;
  readonly rank: Rank;
}

// A covered piece's color and starting-square role are public; its rank is not.
export type Square =
  | { readonly faceUp: false; readonly color: Color; readonly cover: CoveredRank; readonly rank: CoveredRank }
  | { readonly faceUp: true; readonly piece: Piece }
  | null;

export type PublicSquare =
  | { readonly faceUp: false; readonly color: Color; readonly cover: CoveredRank }
  | { readonly faceUp: true; readonly piece: Piece }
  | null;

export interface Outcome {
  readonly winner: Player;
  readonly reason: 'checkmate' | 'stalemate';
}

export interface LastMove {
  readonly from: number;
  readonly to: number;
  readonly piece: Piece;
  readonly captured: Piece | null;
  readonly capturedWasHidden: boolean;
}

export interface Capture {
  readonly piece: Piece;
  readonly wasHidden: boolean;
}

export interface GameView {
  readonly board: readonly PublicSquare[];
  readonly turn: Player;
  readonly colors: readonly [Color, Color];
  readonly outcome: Outcome | null;
  readonly lastMove: LastMove | null;
  readonly captures: readonly Capture[];
}

export interface GameState extends GameView {
  readonly board: readonly Square[];
}

export type Action = { readonly type: 'move'; readonly from: number; readonly to: number };

export type ActionResult =
  | { readonly ok: true; readonly state: GameState }
  | { readonly ok: false; readonly error: string };

const BACK_RANK: readonly Rank[] = [
  'rook', 'horse', 'elephant', 'advisor', 'general', 'advisor', 'elephant', 'horse', 'rook',
];

const DIRECTIONS: readonly [number, number][] = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
];

export function oppositeColor(color: Color): Color {
  return color === 'red' ? 'black' : 'red';
}

export function otherPlayer(player: Player): Player {
  return player === 0 ? 1 : 0;
}

function inBounds(row: number, column: number): boolean {
  return row >= 0 && row < BOARD_ROWS && column >= 0 && column < BOARD_COLUMNS;
}

function indexAt(row: number, column: number): number {
  return row * BOARD_COLUMNS + column;
}

function inPalace(row: number, column: number, color: Color): boolean {
  return column >= 3 && column <= 5 && (color === 'red' ? row >= 7 && row <= 9 : row >= 0 && row <= 2);
}

export function squareColor(square: PublicSquare): Color | null {
  if (!square) return null;
  return square.faceUp ? square.piece.color : square.color;
}

/** Create the standard setup, shuffling each side's 15 non-generals independently. */
export function createGame(random: () => number = Math.random): GameState {
  const board: Square[] = Array(BOARD_SIZE).fill(null);

  for (const color of ['red', 'black'] as const) {
    const homeRow = color === 'red' ? 9 : 0;
    const cannonRow = color === 'red' ? 7 : 2;
    const soldierRow = color === 'red' ? 6 : 3;
    const slots: Array<{ index: number; cover: CoveredRank }> = [];

    BACK_RANK.forEach((rank, column) => {
      const index = indexAt(homeRow, column);
      if (rank === 'general') board[index] = { faceUp: true, piece: { color, rank } };
      else slots.push({ index, cover: rank });
    });
    for (const column of [1, 7]) slots.push({ index: indexAt(cannonRow, column), cover: 'cannon' });
    for (const column of [0, 2, 4, 6, 8]) slots.push({ index: indexAt(soldierRow, column), cover: 'soldier' });

    const ranks = slots.map((slot) => slot.cover);
    for (let i = ranks.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [ranks[i], ranks[j]] = [ranks[j], ranks[i]];
    }
    slots.forEach(({ index, cover }, i) => {
      board[index] = { faceUp: false, color, cover, rank: ranks[i] };
    });
  }

  return { board, turn: 0, colors: ['red', 'black'], outcome: null, lastMove: null, captures: [] };
}

/** Pseudo-legal moves include attacks on a general and do not check the mover's own general. */
function pseudoMovesFrom(board: readonly PublicSquare[], from: number): number[] {
  const source = board[from];
  if (!source) return [];
  const color = squareColor(source)!;
  const rank = source.faceUp ? source.piece.rank : source.cover;
  const row = Math.floor(from / BOARD_COLUMNS);
  const column = from % BOARD_COLUMNS;
  const destinations: number[] = [];

  function add(rowTo: number, columnTo: number): void {
    if (!inBounds(rowTo, columnTo)) return;
    const to = indexAt(rowTo, columnTo);
    if (squareColor(board[to]) !== color) destinations.push(to);
  }

  if (rank === 'general') {
    for (const [dr, dc] of DIRECTIONS) {
      if (inPalace(row + dr, column + dc, color)) add(row + dr, column + dc);
    }
    // Flying generals attack one another along an unobstructed file.
    for (const dr of [-1, 1]) {
      for (let r = row + dr; inBounds(r, column); r += dr) {
        const target = board[indexAt(r, column)];
        if (!target) continue;
        if (target.faceUp && target.piece.rank === 'general' && target.piece.color !== color) {
          const to = indexAt(r, column);
          if (!destinations.includes(to)) destinations.push(to);
        }
        break;
      }
    }
  } else if (rank === 'advisor') {
    for (const dr of [-1, 1]) {
      for (const dc of [-1, 1]) {
        if (inPalace(row + dr, column + dc, color)) add(row + dr, column + dc);
      }
    }
  } else if (rank === 'elephant') {
    for (const dr of [-2, 2]) {
      for (const dc of [-2, 2]) {
        const r = row + dr;
        const c = column + dc;
        if (!inBounds(r, c) || (color === 'red' ? r < 5 : r > 4)) continue;
        if (!board[indexAt(row + dr / 2, column + dc / 2)]) add(r, c);
      }
    }
  } else if (rank === 'horse') {
    for (const [dr, dc] of DIRECTIONS) {
      const legRow = row + dr;
      const legColumn = column + dc;
      if (!inBounds(legRow, legColumn) || board[indexAt(legRow, legColumn)]) continue;
      if (dr !== 0) {
        add(row + 2 * dr, column - 1);
        add(row + 2 * dr, column + 1);
      } else {
        add(row - 1, column + 2 * dc);
        add(row + 1, column + 2 * dc);
      }
    }
  } else if (rank === 'rook' || rank === 'cannon') {
    for (const [dr, dc] of DIRECTIONS) {
      let screenFound = false;
      for (let r = row + dr, c = column + dc; inBounds(r, c); r += dr, c += dc) {
        const to = indexAt(r, c);
        const target = board[to];
        if (!target) {
          if (!screenFound) destinations.push(to);
        } else if (rank === 'rook') {
          if (squareColor(target) !== color) destinations.push(to);
          break;
        } else if (!screenFound) {
          screenFound = true;
        } else {
          if (squareColor(target) !== color) destinations.push(to);
          break;
        }
      }
    }
  } else {
    add(row + (color === 'red' ? -1 : 1), column);
    const crossedRiver = color === 'red' ? row <= 4 : row >= 5;
    if (crossedRiver) {
      add(row, column - 1);
      add(row, column + 1);
    }
  }

  return destinations;
}

/** Covered pieces threaten using their starting-square role, just as they move. */
export function isInCheck(board: readonly PublicSquare[], color: Color): boolean {
  const general = board.findIndex((square) =>
    square?.faceUp && square.piece.color === color && square.piece.rank === 'general');
  if (general < 0) return true;
  return board.some((square, from) =>
    squareColor(square) === oppositeColor(color) && pseudoMovesFrom(board, from).includes(general));
}

/** Legal destinations use only public information, including self-check and flying generals. */
export function legalMovesFrom(board: readonly PublicSquare[], from: number, color: Color): number[] {
  if (!Number.isInteger(from) || from < 0 || from >= BOARD_SIZE) return [];
  const source = board[from];
  if (!source || squareColor(source) !== color) return [];

  return pseudoMovesFrom(board, from).filter((to) => {
    const target = board[to];
    // The game ends at checkmate, before a general is actually captured.
    if (target?.faceUp && target.piece.rank === 'general') return false;
    const next = board.slice();
    next[to] = source;
    next[from] = null;
    return !isInCheck(next, color);
  });
}

export function legalActions(game: GameView): Action[] {
  if (game.outcome) return [];
  const color = game.colors[game.turn];
  const actions: Action[] = [];
  game.board.forEach((square, from) => {
    if (squareColor(square) !== color) return;
    for (const to of legalMovesFrom(game.board, from, color)) actions.push({ type: 'move', from, to });
  });
  return actions;
}

function identity(square: Exclude<Square, null>): Piece {
  return square.faceUp ? square.piece : { color: square.color, rank: square.rank };
}

/** Validate and apply a move without mutating the previous state. */
export function applyAction(game: GameState, action: Action): ActionResult {
  if (game.outcome) return { ok: false, error: 'The game is already over.' };
  if (action.type !== 'move' || !legalMovesFrom(game.board, action.from, game.colors[game.turn]).includes(action.to)) {
    return { ok: false, error: 'That is not a legal move.' };
  }

  const board = game.board.slice();
  const source = board[action.from]!;
  const target = board[action.to];
  const moved = { ...identity(source) };
  const captured = target ? { ...identity(target) } : null;
  const capturedWasHidden = Boolean(target && !target.faceUp);
  board[action.to] = { faceUp: true, piece: moved };
  board[action.from] = null;

  const next: GameState = {
    board,
    turn: otherPlayer(game.turn),
    colors: game.colors,
    outcome: null,
    lastMove: {
      from: action.from,
      to: action.to,
      piece: moved,
      captured,
      capturedWasHidden,
    },
    captures: captured ? [...game.captures, { piece: captured, wasHidden: capturedWasHidden }] : game.captures,
  };
  if (legalActions(next).length === 0) {
    return {
      ok: true,
      state: {
        ...next,
        outcome: {
          winner: game.turn,
          reason: isInCheck(board, next.colors[next.turn]) ? 'checkmate' : 'stalemate',
        },
      },
    };
  }
  return { ok: true, state: next };
}

/** Copy only public information, revealing captured pieces but not covered ranks. */
export function toGameView(game: GameState): GameView {
  return {
    board: game.board.map((square): PublicSquare => {
      if (!square) return null;
      if (!square.faceUp) return { faceUp: false, color: square.color, cover: square.cover };
      return { faceUp: true, piece: { ...square.piece } };
    }),
    turn: game.turn,
    colors: [...game.colors],
    outcome: game.outcome ? { ...game.outcome } : null,
    lastMove: game.lastMove ? {
      ...game.lastMove,
      piece: { ...game.lastMove.piece },
      captured: game.lastMove.captured ? { ...game.lastMove.captured } : null,
    } : null,
    captures: game.captures.map((capture) => ({ ...capture, piece: { ...capture.piece } })),
  };
}
