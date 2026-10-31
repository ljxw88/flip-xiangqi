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

function gameStatus(html: string): string {
  const match = html.match(/<p role="status" aria-live="polite">([\s\S]*?)<\/p>/);
  expect(match).not.toBeNull();
  return match![1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function playerBar(html: string, color: 'Red' | 'Black'): string {
  const match = html.match(new RegExp(`<section(?=[^>]*aria-label="${color} player")[^>]*>[\\s\\S]*?<\\/section>`));
  expect(match).not.toBeNull();
  return match![0];
}

beforeEach(() => mockRoom());
afterEach(() => vi.unstubAllGlobals());

describe('board status', () => {
  it('starts hotseat with player bars surrounding the board and controls after them', () => {
    const html = renderApp('');
    expect(gameStatus(html)).toBe('Red to play');
    expect(html.indexOf('aria-label="Black player"')).toBeLessThan(html.indexOf('Nine by ten xiangqi board'));
    expect(html.indexOf('Nine by ten xiangqi board')).toBeLessThan(html.indexOf('aria-label="Red player"'));
    expect(html.indexOf('aria-label="Red player"')).toBeLessThan(html.indexOf('aria-label="Game controls"'));
    expect(playerBar(html, 'Black')).toContain('Waiting');
    expect(playerBar(html, 'Red')).toContain('To move');
    expect(html).not.toContain('Flip any · move yours');
    expect(html).not.toContain('pieces removed');
    expect(html).not.toContain('Join with a code');
  });

  it('shows connecting once without a placeholder board', () => {
    mockRoom({ status: 'connecting', game: null });
    const html = renderApp();
    expect(gameStatus(html)).toBe('Connecting…');
    expect(html).not.toContain('Nine by ten xiangqi board');
    expect(html).not.toContain('No room connected');
  });

  it('keeps the board visible but disabled while waiting for an opponent', () => {
    mockRoom({ connected: [true, false] });
    const html = renderApp();
    expect(gameStatus(html)).toBe('Waiting for opponent…');
    expect(playerBar(html, 'Red')).toContain('Paused');
    expect(html).not.toContain('Waiting for your opponent.');
    expect(html).toContain('Nine by ten xiangqi board');
    expect(html).toMatch(/<button(?=[^>]*disabled="")(?=[^>]*aria-label="Row 1, column 1)[^>]*>/);
  });

  it('shows the active player and the pending-flip action only to that player', () => {
    const game = { ...position(), pendingFlip: 54 };
    mockRoom({ game });
    const active = renderApp();
    expect(gameStatus(active)).toBe('Your turn · Move this piece');
    expect(playerBar(active, 'Red')).toContain('>You</span>');
    expect(playerBar(active, 'Black')).not.toContain('>You</span>');
    expect(active).toContain('>End turn</button>');

    mockRoom({ game, player: 1 });
    const opponent = renderApp();
    expect(gameStatus(opponent)).toBe('Their turn · Move or end turn');
    expect(playerBar(opponent, 'Black')).toContain('>You</span>');
    expect(opponent).not.toContain('>End turn</button>');

    mockRoom({ game, pending: true });
    const sending = renderApp();
    expect(gameStatus(sending)).toBe('Sending…');
    expect(sending).not.toContain('>End turn</button>');
  });

  it('preserves check warnings, including a checked non-active player', () => {
    const game = position();
    const board = [...game.board];
    board[40] = { faceUp: true, piece: { color: 'black', rank: 'rook' } };
    mockRoom({ game: { ...game, board } });
    expect(gameStatus(renderApp())).toBe('Your turn · Check!');
    expect(playerBar(renderApp(), 'Red')).toContain('>Check</span>');

    mockRoom({ game: { ...game, board, pendingFlip: 54 } });
    const afterFlip = renderApp();
    expect(gameStatus(afterFlip)).toBe('Your turn · Check! Move it');
    expect(afterFlip).toContain('>End turn</button>');

    mockRoom({ game: { ...game, board, turn: 1 }, player: 1 });
    expect(gameStatus(renderApp())).toBe('Your turn · Red in check');
    expect(playerBar(renderApp(), 'Red')).toContain('>Check</span>');
  });

  it('offers the end-turn action when the flipped piece has no legal move', () => {
    const game = position();
    const board = [...game.board];
    board[84] = { faceUp: true, piece: { color: 'red', rank: 'advisor' } };
    board[86] = { faceUp: true, piece: { color: 'red', rank: 'advisor' } };
    board[76] = { faceUp: true, piece: { color: 'red', rank: 'soldier' } };
    mockRoom({ game: { ...game, board, pendingFlip: 85 } });
    const html = renderApp();
    expect(gameStatus(html)).toBe('Your turn · No legal move');
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
    expect(gameStatus(html)).toBe('Black wins · Red self-capture. Red captured their own Red general, revealed on capture.');
    expect(html).toContain('>Rematch</button>');
    expect(playerBar(html, 'Black')).toContain('>Won</span>');
    expect(playerBar(html, 'Red')).toContain('>Lost</span>');
  });

  it('distinguishes a covered general capture from checkmate and stalemate', () => {
    const game = position();
    const captured = { piece: { color: 'black', rank: 'general' }, wasHidden: true } as const;
    mockRoom({ game: {
      ...game,
      outcome: { winner: 0, reason: 'general-captured' },
      lastAction: { type: 'move', from: 54, to: 3, piece: { color: 'red', rank: 'rook' }, captured },
    } });
    expect(gameStatus(renderApp())).toContain('Red wins · Covered general');

    mockRoom({ game: { ...game, outcome: { winner: 0, reason: 'checkmate' } } });
    expect(gameStatus(renderApp())).toBe('Red wins · Checkmate');

    mockRoom({ game: { ...game, outcome: { winner: 1, reason: 'stalemate' } } });
    expect(gameStatus(renderApp())).toBe('Black wins · No legal moves');
  });

  it('places removed enemy pieces on each player bar with accessible identities', () => {
    const redHorse = { piece: { color: 'red', rank: 'horse' }, wasHidden: true } as const;
    const blackSoldier = { piece: { color: 'black', rank: 'soldier' }, wasHidden: false } as const;
    mockRoom({ game: { ...position(), captures: [redHorse, blackSoldier] } });
    const html = renderApp();
    const blackBar = playerBar(html, 'Black');
    const redBar = playerBar(html, 'Red');
    expect(blackBar).toContain('aria-label="Red pieces removed"');
    expect(blackBar).toContain('aria-label="Red horse, revealed on capture"');
    expect(blackBar).not.toContain('aria-label="Black soldier"');
    expect(redBar).toContain('aria-label="Black pieces removed"');
    expect(redBar).toContain('aria-label="Black soldier"');
    expect(redBar).not.toContain('aria-label="Red horse');
  });

  it('announces a self-capture without attributing it to the opponent', () => {
    const captured = { piece: { color: 'red', rank: 'horse' }, wasHidden: true } as const;
    mockRoom({ game: {
      ...position(),
      turn: 1,
      lastAction: { type: 'move', from: 54, to: 45, piece: { color: 'red', rank: 'rook' }, captured },
      captures: [captured],
    }, player: 1 });
    const html = renderApp();
    expect(gameStatus(html)).toBe('Your turn. Red captured their own Red horse, revealed on capture.');
    expect(playerBar(html, 'Black')).toContain('aria-label="Red pieces removed"');
    expect(playerBar(html, 'Black')).toContain('aria-label="Red horse, revealed on capture"');
    expect(playerBar(html, 'Black')).not.toContain('captured by Black');
  });
});
