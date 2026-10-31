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
export interface Piece {
  readonly color: Color;
  readonly rank: Rank;
}

// A covered piece's color is public; its identity, including a general, is not.
export type Square =
  | { readonly faceUp: false; readonly color: Color; readonly rank: Rank }
  | { readonly faceUp: true; readonly piece: Piece }
  | null;

export type PublicSquare =
  | { readonly faceUp: false; readonly color: Color }
  | { readonly faceUp: true; readonly piece: Piece }
  | null;

export interface Outcome {
  readonly winner: Player;
  readonly reason: 'general-captured' | 'checkmate' | 'stalemate';
}

export type LastAction =
  | { readonly type: 'flip'; readonly at: number; readonly piece: Piece }
  | { readonly type: 'move'; readonly from: number; readonly to: number; readonly piece: Piece; readonly captured: Piece | null };

export interface GameView {
  readonly board: readonly PublicSquare[];
  readonly turn: Player;
  readonly colors: readonly [Color, Color];
  readonly outcome: Outcome | null;
  readonly lastAction: LastAction | null;
  readonly captures: readonly Piece[];
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

/** Shuffle each side's 16 identities, including its general, over its starting points. */
export function createGame(random: () => number = Math.random): GameState {
  const board: Square[] = Array(BOARD_SIZE).fill(null);

  for (const color of ['red', 'black'] as const) {
    const homeRow = color === 'red' ? 9 : 0;
    const cannonRow = color === 'red' ? 7 : 2;
    const soldierRow = color === 'red' ? 6 : 3;
    const slots: Array<{ index: number; rank: Rank }> = [];

    BACK_RANK.forEach((rank, column) => {
      slots.push({ index: indexAt(homeRow, column), rank });
    });
    for (const column of [1, 7]) slots.push({ index: indexAt(cannonRow, column), rank: 'cannon' });
    for (const column of [0, 2, 4, 6, 8]) slots.push({ index: indexAt(soldierRow, column), rank: 'soldier' });

    const ranks = slots.map((slot) => slot.rank);
    for (let i = ranks.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [ranks[i], ranks[j]] = [ranks[j], ranks[i]];
    }
    slots.forEach(({ index }, i) => {
      board[index] = { faceUp: false, color, rank: ranks[i] };
    });
  }

  return { board, turn: 0, colors: ['red', 'black'], outcome: null, lastAction: null, captures: [] };
}

/** Pseudo-legal moves include attacks on a general and do not check the mover's own general. */
function pseudoMovesFrom(board: readonly PublicSquare[], from: number): number[] {
  const source = board[from];
  if (!source?.faceUp) return [];
  const { color, rank } = source.piece;
  const row = Math.floor(from / BOARD_COLUMNS);
  const column = from % BOARD_COLUMNS;
  const destinations: number[] = [];

  function add(rowTo: number, columnTo: number): void {
    if (!inBounds(rowTo, columnTo)) return;
    const to = indexAt(rowTo, columnTo);
    const target = board[to];
    if (!target || (target.faceUp && target.piece.color !== color)) destinations.push(to);
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
          if (target.faceUp && target.piece.color !== color) destinations.push(to);
          break;
        } else if (!screenFound) {
          screenFound = true;
        } else {
          if (target.faceUp && target.piece.color !== color) destinations.push(to);
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

/** Only revealed pieces attack; a still-covered general cannot be in check. */
export function isInCheck(board: readonly PublicSquare[], color: Color): boolean {
  const general = board.findIndex((square) =>
    square?.faceUp && square.piece.color === color && square.piece.rank === 'general');
  if (general < 0) return false;
  return board.some((square, from) =>
    squareColor(square) === oppositeColor(color) && pseudoMovesFrom(board, from).includes(general));
}

/** Legal destinations use only public information, including self-check and flying generals. */
export function legalMovesFrom(board: readonly PublicSquare[], from: number, color: Color): number[] {
  if (!Number.isInteger(from) || from < 0 || from >= BOARD_SIZE) return [];
  const source = board[from];
  if (!source?.faceUp || source.piece.color !== color) return [];

  return pseudoMovesFrom(board, from).filter((to) => {
    const next = board.slice();
    next[to] = source;
    next[from] = null;
    return !isInCheck(next, color);
  });
}

export function legalActions(game: GameView): Action[] {
  if (game.outcome) return [];
  const color = game.colors[game.turn];
  const checked = isInCheck(game.board, color);
  const actions: Action[] = [];
  game.board.forEach((square, from) => {
    if (squareColor(square) !== color) return;
    if (square && !square.faceUp) {
      if (!checked) actions.push({ type: 'flip', at: from });
    } else {
      for (const to of legalMovesFrom(game.board, from, color)) actions.push({ type: 'move', from, to });
    }
  });
  return actions;
}

/** Validate and apply exactly one flip or move without mutating the previous state. */
export function applyAction(game: GameState, action: Action): ActionResult {
  if (game.outcome) return { ok: false, error: 'The game is already over.' };
  const board = game.board.slice();
  const color = game.colors[game.turn];
  let lastAction: LastAction;
  let captured: Piece | null = null;

  if (action.type === 'flip') {
    const square = board[action.at];
    if (!Number.isInteger(action.at) || action.at < 0 || action.at >= BOARD_SIZE ||
      !square || square.faceUp || square.color !== color || isInCheck(board, color)) {
      return { ok: false, error: 'That is not a legal action.' };
    }
    const piece: Piece = { color: square.color, rank: square.rank };
    board[action.at] = { faceUp: true, piece };
    lastAction = { type: 'flip', at: action.at, piece };
  } else if (action.type === 'move') {
    if (!legalMovesFrom(board, action.from, color).includes(action.to)) {
      return { ok: false, error: 'That is not a legal action.' };
    }
    const source = board[action.from];
    const target = board[action.to];
    if (!source?.faceUp || (target && !target.faceUp)) {
      return { ok: false, error: 'That is not a legal action.' };
    }
    const piece = { ...source.piece };
    captured = target ? { ...target.piece } : null;
    board[action.to] = { faceUp: true, piece };
    board[action.from] = null;
    lastAction = { type: 'move', from: action.from, to: action.to, piece, captured };
  } else {
    return { ok: false, error: 'That is not a legal action.' };
  }

  const next: GameState = {
    board,
    turn: otherPlayer(game.turn),
    colors: game.colors,
    outcome: null,
    lastAction,
    captures: captured ? [...game.captures, captured] : game.captures,
  };
  if (captured?.rank === 'general') {
    return { ok: true, state: { ...next, outcome: { winner: game.turn, reason: 'general-captured' } } };
  }
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

/** Copy only public information; no covered identity is sent to either player. */
export function toGameView(game: GameState): GameView {
  return {
    board: game.board.map((square): PublicSquare => {
      if (!square) return null;
      if (!square.faceUp) return { faceUp: false, color: square.color };
      return { faceUp: true, piece: { ...square.piece } };
    }),
    turn: game.turn,
    colors: [...game.colors],
    outcome: game.outcome ? { ...game.outcome } : null,
    lastAction: game.lastAction?.type === 'flip' ? {
      ...game.lastAction,
      piece: { ...game.lastAction.piece },
    } : game.lastAction ? {
      ...game.lastAction,
      piece: { ...game.lastAction.piece },
      captured: game.lastAction.captured ? { ...game.lastAction.captured } : null,
    } : null,
    captures: game.captures.map((piece) => ({ ...piece })),
  };
}
