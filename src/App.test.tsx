import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { createGame, toGameView, type GameView, type PublicSquare } from './game/engine';
import { useRoom } from './multiplayer/useRoom';

vi.mock('./multiplayer/useRoom', () => ({ useRoom: vi.fn() }));

function position(): GameView {
  const board: PublicSquare[] = Array(90).fill(null);
  board[85] = { faceUp: true, piece: { color: 'red', rank: 'general' } };
  board[3] = { faceUp: true, piece: { color: 'black', rank: 'general' } };
  board[54] = { faceUp: true, piece: { color: 'red', rank: 'rook' } };
  return { board, turn: 0, colors: ['red', 'black'], outcome: null, lastAction: null, captures: [], pendingFlip: null };
}

function mockRoom(overrides: Partial<ReturnType<typeof useRoom>> = {}) {
  vi.mocked(useRoom).mockReturnValue({
    status: 'connected',
    room: 'ABCD1234',
    player: 0,
    game: toGameView(createGame(() => 0.5)),
    connected: [true, true],
    pending: false,
    error: null,
    create: vi.fn(),
    join: vi.fn(),
    leave: vi.fn(),
    send: vi.fn(),
    ...overrides,
  });
}

function renderApp(search = '?room=ABCD1234') {
  vi.stubGlobal('window', { location: { search, href: `http://localhost/${search}` } });
  return renderToStaticMarkup(<App />);
}

beforeEach(() => mockRoom());
afterEach(() => vi.unstubAllGlobals());

describe('board status', () => {
  it('starts hotseat with a single turn phrase and no empty captures row', () => {
    const html = renderApp('');
    expect(html).toContain('Red to play</h2>');
    expect(html).not.toContain('Flip any · move yours');
    expect(html).not.toContain('aria-label="Captured pieces"');
  });

  it('shows connecting once without a placeholder board', () => {
    mockRoom({ status: 'connecting', game: null });
    const html = renderApp();
    expect(html.match(/Connecting…/g)).toHaveLength(1);
    expect(html).not.toContain('Nine by ten xiangqi board');
    expect(html).not.toContain('No room connected');
  });

  it('keeps the board visible but disabled while waiting for an opponent', () => {
    mockRoom({ connected: [true, false] });
    const html = renderApp();
    expect(html.match(/Waiting for opponent…/g)).toHaveLength(1);
    expect(html).not.toContain('Waiting for your opponent.');
    expect(html).toContain('Nine by ten xiangqi board');
    expect(html).toMatch(/<button(?=[^>]*disabled="")(?=[^>]*aria-label="Row 1, column 1)[^>]*>/);
  });

  it('shows the active player and the pending-flip action only to that player', () => {
    const game = { ...position(), pendingFlip: 54 };
    mockRoom({ game });
    const active = renderApp();
    expect(active).toContain('Your turn · Move this piece</h2>');
    expect(active).toContain('>End turn</button>');

    mockRoom({ game, player: 1 });
    const opponent = renderApp();
    expect(opponent).toContain('Their turn · Move or end turn</h2>');
    expect(opponent).not.toContain('>End turn</button>');

    mockRoom({ game, pending: true });
    const sending = renderApp();
    expect(sending).toContain('Sending…</h2>');
    expect(sending).not.toContain('>End turn</button>');
  });

  it('preserves check warnings, including a checked non-active player', () => {
    const game = position();
    const board = [...game.board];
    board[40] = { faceUp: true, piece: { color: 'black', rank: 'rook' } };
    mockRoom({ game: { ...game, board } });
    expect(renderApp()).toContain('Your turn · Check!</h2>');

    mockRoom({ game: { ...game, board, pendingFlip: 54 } });
    const afterFlip = renderApp();
    expect(afterFlip).toContain('Your turn · Check! Move it</h2>');
    expect(afterFlip).toContain('>End turn</button>');

    mockRoom({ game: { ...game, board, turn: 1 }, player: 1 });
    expect(renderApp()).toContain('Your turn · Red in check</h2>');
  });

  it('offers the end-turn action when the flipped piece has no legal move', () => {
    const game = position();
    const board = [...game.board];
    board[84] = { faceUp: true, piece: { color: 'red', rank: 'advisor' } };
    board[86] = { faceUp: true, piece: { color: 'red', rank: 'advisor' } };
    board[76] = { faceUp: true, piece: { color: 'red', rank: 'soldier' } };
    mockRoom({ game: { ...game, board, pendingFlip: 85 } });
    const html = renderApp();
    expect(html).toContain('Your turn · No legal move</h2>');
    expect(html).toContain('>End turn</button>');
  });

  it('identifies the winner and own-general capture alongside rematch', () => {
    const game = position();
    const captured = { piece: { color: 'red', rank: 'general' }, wasHidden: true } as const;
    mockRoom({ game: {
      ...game,
      outcome: { winner: 1, reason: 'general-captured' },
      lastAction: { type: 'move', from: 54, to: 85, piece: { color: 'red', rank: 'rook' }, captured },
      captures: [captured],
    } });
    const html = renderApp();
    expect(html).toContain('Black wins · Red self-capture</h2>');
    expect(html).toContain('>Rematch</button>');
    expect(html).toContain('aria-label="Black"');
  });

  it('distinguishes a covered general capture from checkmate and stalemate', () => {
    const game = position();
    const captured = { piece: { color: 'black', rank: 'general' }, wasHidden: true } as const;
    mockRoom({ game: {
      ...game,
      outcome: { winner: 0, reason: 'general-captured' },
      lastAction: { type: 'move', from: 54, to: 3, piece: { color: 'red', rank: 'rook' }, captured },
    } });
    expect(renderApp()).toContain('Red wins · Covered general</h2>');

    mockRoom({ game: { ...game, outcome: { winner: 0, reason: 'checkmate' } } });
    expect(renderApp()).toContain('Red wins · Checkmate</h2>');

    mockRoom({ game: { ...game, outcome: { winner: 1, reason: 'stalemate' } } });
    expect(renderApp()).toContain('Black wins · No legal moves</h2>');
  });

  it('exposes captured pieces and their revealed identities accessibly', () => {
    const captured = { piece: { color: 'red', rank: 'horse' }, wasHidden: true } as const;
    mockRoom({ game: { ...position(), captures: [captured] } });
    const html = renderApp();
    expect(html).toContain('aria-label="Captured pieces"');
    expect(html).toContain('aria-label="Red horse, revealed on capture"');
  });
});
