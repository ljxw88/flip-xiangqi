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

// The authoritative board keeps covered colors and ranks private.
export type Square =
  | { readonly faceUp: false; readonly color: Color; readonly rank: Rank }
  | { readonly faceUp: true; readonly piece: Piece }
  | null;

export type PublicSquare =
  | { readonly faceUp: false }
  | { readonly faceUp: true; readonly piece: Piece }
  | null;

export interface Outcome {
  readonly winner: Player;
  readonly reason: 'general-captured' | 'checkmate' | 'stalemate';
}

export interface Capture {
  readonly piece: Piece;
  readonly wasHidden: boolean;
}

export type LastAction =
  | { readonly type: 'flip'; readonly at: number; readonly piece: Piece }
  | { readonly type: 'move'; readonly from: number; readonly to: number; readonly piece: Piece; readonly captured: Capture | null };

export interface GameView {
  readonly board: readonly PublicSquare[];
  readonly turn: Player;
  readonly colors: readonly [Color, Color];
  readonly outcome: Outcome | null;
  readonly lastAction: LastAction | null;
  readonly captures: readonly Capture[];
  /** A same-color flip may be followed by a move of this piece, or an explicit end-turn. */
  readonly pendingFlip: number | null;
}

export interface GameState extends GameView {
  readonly board: readonly Square[];
}

export type Action =
  | { readonly type: 'flip'; readonly at: number }
  | { readonly type: 'move'; readonly from: number; readonly to: number }
  | { readonly type: 'end-turn' };

export type ActionResult =
  | { readonly ok: true; readonly state: GameState }
  | { readonly ok: false; readonly error: string };

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
  return square?.faceUp ? square.piece.color : null;
}

function shuffle<T>(values: T[], random: () => number): void {
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
}

function advisorLanding(row: number, column: number, color: Color): boolean {
  const palaceStart = color === 'red' ? 7 : 0;
  const localRow = row - palaceStart;
  return (localRow === 1 && column === 4) ||
    ((localRow === 0 || localRow === 2) && (column === 3 || column === 5));
}

function elephantLanding(row: number, column: number, color: Color): boolean {
  const homeDistance = color === 'red' ? 9 - row : row;
  return ((homeDistance === 0 || homeDistance === 4) && (column === 2 || column === 6)) ||
    (homeDistance === 2 && (column === 0 || column === 4 || column === 8));
}

/** Placement must respect the piece's legal landing points and have a move on an otherwise empty board. */
function legalStartingPoint(rank: Rank, color: Color, index: number): boolean {
  const row = Math.floor(index / BOARD_COLUMNS);
  const column = index % BOARD_COLUMNS;
  if (rank === 'advisor' && !advisorLanding(row, column, color)) return false;
  if (rank === 'elephant' && !elephantLanding(row, column, color)) return false;
  const board: PublicSquare[] = Array(BOARD_SIZE).fill(null);
  board[index] = { faceUp: true, piece: { color, rank } };
  return pseudoMovesFrom(board, index).length > 0;
}

/** Deal both colors across the 32 standard points: generals, advisors and elephants face-up, the rest covered. */
export function createGame(random: () => number = Math.random): GameState {
  const board: Square[] = Array(BOARD_SIZE).fill(null);
  const slots: number[] = [];
  for (const row of [0, 9]) {
    for (let column = 0; column < BOARD_COLUMNS; column += 1) slots.push(indexAt(row, column));
  }
  for (const row of [2, 7]) {
    for (const column of [1, 7]) slots.push(indexAt(row, column));
  }
  for (const row of [3, 6]) {
    for (const column of [0, 2, 4, 6, 8]) slots.push(indexAt(row, column));
  }
  slots.sort((a, b) => a - b);

  // Generals and advisors stay on their standard home-rank points and start face-up.
  for (const color of ['red', 'black'] as const) {
    const homeRow = color === 'red' ? 9 : 0;
    for (const [column, rank] of [[3, 'advisor'], [4, 'general'], [5, 'advisor']] as const) {
      const index = indexAt(homeRow, column);
      if (!legalStartingPoint(rank, color, index)) throw new Error('No valid starting arrangement.');
      board[index] = { faceUp: true, piece: { color, rank } };
    }
  }

  // Reserve legal elephant landings (face-up), then shuffle all other pieces covered across the remaining points.
  for (const color of ['red', 'black'] as const) {
    const candidates = slots.filter((index) => !board[index] && legalStartingPoint('elephant', color, index));
    if (candidates.length < 2) throw new Error('No valid starting arrangement.');
    shuffle(candidates, random);
    for (const index of candidates.slice(0, 2)) board[index] = { faceUp: true, piece: { color, rank: 'elephant' } };
  }

  const remaining: Piece[] = [];
  for (const color of ['red', 'black'] as const) {
    for (const [rank, count] of [['rook', 2], ['horse', 2], ['cannon', 2], ['soldier', 5]] as const) {
      for (let i = 0; i < count; i += 1) remaining.push({ color, rank });
    }
  }
  shuffle(remaining, random);
  const free = slots.filter((index) => !board[index]);
  free.forEach((index, i) => {
    const piece = remaining[i];
    if (!legalStartingPoint(piece.rank, piece.color, index)) throw new Error('No valid starting arrangement.');
    board[index] = { faceUp: false, ...piece };
  });

  return { board, turn: 0, colors: ['red', 'black'], outcome: null, lastAction: null, captures: [], pendingFlip: null };
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
    if (!target || !target.faceUp || target.piece.color !== color) destinations.push(to);
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
          if (!target.faceUp || target.piece.color !== color) destinations.push(to);
          break;
        } else if (!screenFound) {
          screenFound = true;
        } else {
          if (!target.faceUp || target.piece.color !== color) destinations.push(to);
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
  const pendingFlip = game.pendingFlip;
  if (pendingFlip !== null) {
    return [
      { type: 'end-turn' },
      ...legalMovesFrom(game.board, pendingFlip, color).map((to): Action => ({
        type: 'move', from: pendingFlip, to,
      })),
    ];
  }
  const checked = isInCheck(game.board, color);
  const actions: Action[] = [];
  game.board.forEach((square, from) => {
    if (square && !square.faceUp) {
      if (!checked) actions.push({ type: 'flip', at: from });
    } else if (square?.piece.color === color) {
      for (const to of legalMovesFrom(game.board, from, color)) actions.push({ type: 'move', from, to });
    }
  });
  return actions;
}

/** Validate a move or the optional flip → move/end-turn chain without mutating the previous state. */
export function applyAction(game: GameState, action: Action): ActionResult {
  if (game.outcome) return { ok: false, error: 'The game is already over.' };
  const board = game.board.slice();
  const color = game.colors[game.turn];
  let lastAction: LastAction;
  let captured: Capture | null = null;

  if (action.type === 'flip') {
    const square = board[action.at];
    if (game.pendingFlip !== null || !Number.isInteger(action.at) || action.at < 0 || action.at >= BOARD_SIZE ||
      !square || square.faceUp || isInCheck(board, color)) {
      return { ok: false, error: 'That is not a legal action.' };
    }
    const piece: Piece = { color: square.color, rank: square.rank };
    board[action.at] = { faceUp: true, piece };
    lastAction = { type: 'flip', at: action.at, piece };
    if (piece.color === color) {
      return { ok: true, state: { ...game, board, pendingFlip: action.at, lastAction } };
    }
  } else if (action.type === 'move') {
    if ((game.pendingFlip !== null && action.from !== game.pendingFlip) ||
      !legalMovesFrom(board, action.from, color).includes(action.to)) {
      return { ok: false, error: 'That is not a legal action.' };
    }
    const source = board[action.from];
    const target = board[action.to];
    if (!source?.faceUp) {
      return { ok: false, error: 'That is not a legal action.' };
    }
    const piece = { ...source.piece };
    captured = target ? {
      piece: target.faceUp ? { ...target.piece } : { color: target.color, rank: target.rank },
      wasHidden: !target.faceUp,
    } : null;
    board[action.to] = { faceUp: true, piece };
    board[action.from] = null;
    lastAction = { type: 'move', from: action.from, to: action.to, piece, captured };
  } else if (action.type === 'end-turn') {
    if (game.pendingFlip === null || game.lastAction?.type !== 'flip' || game.lastAction.at !== game.pendingFlip) {
      return { ok: false, error: 'That is not a legal action.' };
    }
    lastAction = game.lastAction;
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
    pendingFlip: null,
  };
  if (captured?.piece.rank === 'general') {
    const winner = captured.piece.color === color ? otherPlayer(game.turn) : game.turn;
    return { ok: true, state: { ...next, outcome: { winner, reason: 'general-captured' } } };
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
      if (!square.faceUp) return { faceUp: false };
      return { faceUp: true, piece: { ...square.piece } };
    }),
    turn: game.turn,
    colors: [...game.colors],
    outcome: game.outcome ? { ...game.outcome } : null,
    pendingFlip: game.pendingFlip,
    lastAction: game.lastAction?.type === 'flip' ? {
      ...game.lastAction,
      piece: { ...game.lastAction.piece },
    } : game.lastAction ? {
      ...game.lastAction,
      piece: { ...game.lastAction.piece },
      captured: game.lastAction.captured ? {
        ...game.lastAction.captured,
        piece: { ...game.lastAction.captured.piece },
      } : null,
    } : null,
    captures: game.captures.map((capture) => ({ ...capture, piece: { ...capture.piece } })),
  };
}
