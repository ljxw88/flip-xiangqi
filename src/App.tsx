import { useEffect, useState, type FormEvent } from 'react';
import {
  applyAction,
  BOARD_COLUMNS,
  BOARD_ROWS,
  createGame,
  isInCheck,
  legalMovesFrom,
  squareColor,
  toGameView,
  type Action,
  type Color,
  type GameView,
  type Player,
  type PublicSquare,
  type Rank,
} from './game/engine';
import { useRoom } from './multiplayer/useRoom';

const symbols: Record<Rank, Record<Color, string>> = {
  general: { red: '帅', black: '将' },
  advisor: { red: '仕', black: '士' },
  elephant: { red: '相', black: '象' },
  rook: { red: '车', black: '车' },
  horse: { red: '马', black: '马' },
  cannon: { red: '炮', black: '炮' },
  soldier: { red: '兵', black: '卒' },
};

function colorName(color: Color | null): string {
  return color === 'red' ? 'Red' : color === 'black' ? 'Black' : 'Unassigned';
}

function squareLabel(square: PublicSquare, index: number): string {
  const position = `Row ${Math.floor(index / BOARD_COLUMNS) + 1}, column ${(index % BOARD_COLUMNS) + 1}`;
  if (!square) return `${position}, empty`;
  if (!square.faceUp) return `${position}, ${colorName(square.color)} covered piece, moves as ${square.cover} until revealed`;
  return `${position}, ${colorName(square.piece.color)} ${square.piece.rank}, ${symbols[square.piece.rank][square.piece.color]}`;
}

interface BoardProps {
  game: GameView;
  selected: number | null;
  destinations: number[];
  canPlay: boolean;
  onSquare: (index: number) => void;
}

function Board({ game, selected, destinations, canPlay, onSquare }: BoardProps) {
  return (
    <div className="board-frame">
      <div className="board" role="group" aria-label="Nine by ten xiangqi board, black at the top and red at the bottom">
        <svg className="board-lines" viewBox="0 0 900 1000" aria-hidden="true">
          {Array.from({ length: BOARD_ROWS }, (_, row) => (
            <line key={`rank-${row}`} x1="50" y1={50 + 100 * row} x2="850" y2={50 + 100 * row} />
          ))}
          {Array.from({ length: BOARD_COLUMNS }, (_, column) => {
            const x = 50 + 100 * column;
            return column === 0 || column === BOARD_COLUMNS - 1 ? (
              <line key={`file-${column}`} x1={x} y1="50" x2={x} y2="950" />
            ) : (
              <g key={`file-${column}`}>
                <line x1={x} y1="50" x2={x} y2="450" />
                <line x1={x} y1="550" x2={x} y2="950" />
              </g>
            );
          })}
          <line x1="350" y1="50" x2="550" y2="250" />
          <line x1="550" y1="50" x2="350" y2="250" />
          <line x1="350" y1="750" x2="550" y2="950" />
          <line x1="550" y1="750" x2="350" y2="950" />
          <text x="240" y="519" textAnchor="middle">楚 河</text>
          <text x="660" y="519" textAnchor="middle">汉 界</text>
        </svg>
        <div className="board-intersections">
          {game.board.map((square, index) => {
            const classes = [
              'square',
              selected === index ? 'square--selected' : '',
              destinations.includes(index) ? 'square--destination' : '',
              game.lastMove && (game.lastMove.from === index || game.lastMove.to === index) ? 'square--last-move' : '',
            ].filter(Boolean).join(' ');
            const label = `${squareLabel(square, index)}${destinations.includes(index) ? ', legal destination' : ''}`;
            return (
              <button
                key={index}
                type="button"
                className={classes}
                onClick={() => onSquare(index)}
                disabled={!canPlay}
                aria-label={label}
                aria-pressed={square ? selected === index : undefined}
                title={label}
              >
                {square && !square.faceUp && (
                  <span className={`piece piece--hidden piece--hidden-${square.color}`} aria-hidden="true">暗</span>
                )}
                {square?.faceUp && (
                  <span className={`piece piece--${square.piece.color}`} aria-hidden="true">
                    {symbols[square.piece.rank][square.piece.color]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function roomLink(code: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set('room', code);
  return url.toString();
}

export default function App() {
  const [initialRoom] = useState(() => new URLSearchParams(window.location.search).get('room'));
  const [mode, setMode] = useState<'local' | 'online'>(initialRoom ? 'online' : 'local');
  const [localGame, setLocalGame] = useState(createGame);
  const [selected, setSelected] = useState<number | null>(null);
  const [joinCode, setJoinCode] = useState(initialRoom ?? '');
  const [copyMessage, setCopyMessage] = useState('');
  const room = useRoom();

  useEffect(() => {
    if (initialRoom) room.join(initialRoom);
  }, [initialRoom, room.join]);

  const game = mode === 'local' ? toGameView(localGame) : room.game;
  const canPlay = Boolean(
    game &&
    !game.outcome &&
    (mode === 'local' ||
      (room.status === 'connected' &&
        room.player === game.turn &&
        room.connected[0] &&
        room.connected[1] &&
        !room.pending)),
  );
  const currentColor = game?.colors[game.turn] ?? null;
  const destinations = selected !== null && game && currentColor
    ? legalMovesFrom(game.board, selected, currentColor)
    : [];
  const checked = Boolean(game && currentColor && isInCheck(game.board, currentColor));

  useEffect(() => {
    setSelected(null);
  }, [mode, game?.turn, Boolean(game?.outcome), room.status]);

  function perform(action: Action) {
    if (mode === 'online') {
      room.send({ type: 'action', action });
    } else {
      setLocalGame((current) => {
        const result = applyAction(current, action);
        return result.ok ? result.state : current;
      });
    }
    setSelected(null);
  }

  function handleSquare(index: number) {
    if (!game || !canPlay) return;
    const square = game.board[index];
    if (selected !== null && destinations.includes(index)) {
      perform({ type: 'move', from: selected, to: index });
    } else if (square && squareColor(square) === currentColor) {
      setSelected((current) => current === index ? null : index);
    } else {
      setSelected(null);
    }
  }

  function startLocal() {
    room.leave();
    setLocalGame(createGame());
    setSelected(null);
    setMode('local');
  }

  function createRoom() {
    setMode('online');
    setSelected(null);
    setCopyMessage('');
    room.create();
  }

  function joinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!joinCode.trim()) return;
    setMode('online');
    setSelected(null);
    setCopyMessage('');
    room.join(joinCode);
  }

  async function copyLink(code: string) {
    const link = roomLink(code);
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(link);
      setCopyMessage('Link copied.');
    } catch {
      const input = document.getElementById('room-link') as HTMLInputElement | null;
      input?.focus();
      input?.select();
      setCopyMessage('Select and copy the link above.');
    }
  }

  function heading(): string {
    if (!game) {
      return room.status === 'connecting' ? 'Connecting to the room…' : 'Your room is not connected';
    }
    if (game.outcome) return `Player ${game.outcome.winner + 1} wins!`;
    if (mode === 'online') {
      if (room.status === 'connecting') return 'Reconnecting…';
      if (room.status !== 'connected') return 'Connection lost';
      if (!room.connected[0] || !room.connected[1]) return 'Waiting for the other player';
      if (room.pending) return 'Sending your move…';
      return room.player === game.turn ? 'Your turn' : 'Opponent’s turn';
    }
    return `Player ${game.turn + 1}’s turn`;
  }

  function guidance(): string {
    if (!game) return 'Start the room server to play online, or choose hotseat play.';
    if (game.outcome?.reason === 'checkmate') return 'Checkmate — the opposing general cannot escape.';
    if (game.outcome?.reason === 'stalemate') return 'Stalemate — the player with no legal move loses.';
    if (mode === 'online' && room.status !== 'connected') return 'Reconnect to continue the same game.';
    if (mode === 'online' && (!room.connected[0] || !room.connected[1])) {
      return 'Share the room link below. The game pauses if either player disconnects.';
    }
    if (checked) return 'Check! The general must be protected.';
    if (mode === 'online' && room.player !== game.turn) return 'Waiting for your opponent to play.';
    const square = selected === null ? null : game.board[selected];
    if (square && !square.faceUp) {
      return `This covered piece moves as a ${square.cover}, then reveals its identity.${destinations.length ? '' : ' No legal moves.'}`;
    }
    if (square) return destinations.length ? 'Choose a highlighted destination.' : 'This piece has no legal moves.';
    return 'Select one of your pieces, then choose a highlighted destination.';
  }

  function playerCard(player: Player) {
    const color = game?.colors[player] ?? null;
    const active = game && !game.outcome && game.turn === player;
    return (
      <div key={player} className={`player-card${active ? ' player-card--active' : ''}`}>
        <span className={`color-dot color-dot--${color ?? 'unknown'}`} aria-hidden="true" />
        <div>
          <strong>Player {player + 1}{mode === 'online' && room.player === player ? ' · You' : ''}</strong>
          <span>{colorName(color)}{mode === 'online' && !room.connected[player] ? ' · Offline' : ''}</span>
        </div>
        {active && <span className="turn-badge">Turn</span>}
      </div>
    );
  }

  return (
    <main className="app-shell">
      <header className="site-header">
        <div className="brand-mark" aria-hidden="true">棋</div>
        <div>
          <p className="eyebrow">A little game of strategy &amp; luck</p>
          <h1>Jieqi <span>揭棋</span></h1>
        </div>
        <div className="mode-label">{mode === 'local' ? 'HOTSEAT' : 'ONLINE ROOM'}</div>
      </header>

      <div className="layout">
        <section className="play-area" aria-label="Game">
          <div className="game-heading" role="status" aria-live="polite">
            <div>
              <p className="eyebrow">{game?.outcome ? 'Game over' : 'Move · Reveal · Checkmate'}</p>
              <h2>{heading()}</h2>
              <p>{guidance()}</p>
            </div>
          </div>

          {game ? (
            <Board game={game} selected={selected} destinations={destinations} canPlay={canPlay} onSquare={handleSquare} />
          ) : (
            <div className="board-placeholder">Your game will appear here.</div>
          )}

          {game?.lastMove?.captured && (
            <p className="capture-note" role="status" aria-live="polite">
              Captured: {colorName(game.lastMove.captured.color)} {game.lastMove.captured.rank}{' '}
              ({symbols[game.lastMove.captured.rank][game.lastMove.captured.color]})
              {game.lastMove.capturedWasHidden ? ' — revealed on capture.' : '.'}
            </p>
          )}

          {game && game.captures.length > 0 && (
            <div className="captured-list" aria-label="Captured pieces">
              <strong>Captured</strong>
              {game.captures.map(({ piece, wasHidden }, index) => {
                const label = `${colorName(piece.color)} ${piece.rank}${wasHidden ? ', revealed on capture' : ''}`;
                return (
                  <span key={index} className={`captured-piece captured-piece--${piece.color}`} role="img" aria-label={label} title={label}>
                    {symbols[piece.rank][piece.color]}
                  </span>
                );
              })}
            </div>
          )}

          <div className="players" aria-label="Players">
            {playerCard(0)}
            {playerCard(1)}
          </div>

          {game?.outcome && (
            <div className="result-actions">
              {mode === 'local' ? (
                <button className="button button--primary" type="button" onClick={startLocal}>Play again</button>
              ) : (
                <button
                  className="button button--primary"
                  type="button"
                  onClick={() => room.send({ type: 'rematch' })}
                  disabled={!room.connected[0] || !room.connected[1] || room.pending}
                >Start rematch</button>
              )}
            </div>
          )}
        </section>

        <aside className="sidebar">
          <section className="panel">
            <p className="eyebrow">Play together</p>
            <h2>{mode === 'online' ? 'Online room' : 'Choose a game'}</h2>
            <div className="button-stack">
              <button className="button button--primary" type="button" onClick={createRoom}>
                {mode === 'online' ? 'Create new room' : 'Create online room'}
              </button>
              <button className="button button--secondary" type="button" onClick={startLocal}>
                {mode === 'online' ? 'Leave & play hotseat' : 'New hotseat game'}
              </button>
            </div>

            {mode === 'online' && room.room && room.player !== null && (
              <div className="room-details">
                <p className="room-code">Room <strong>{room.room}</strong></p>
                <label htmlFor="room-link">Invite your opponent</label>
                <div className="copy-row">
                  <input id="room-link" value={roomLink(room.room)} readOnly onFocus={(event) => event.currentTarget.select()} />
                  <button className="button button--secondary" type="button" onClick={() => copyLink(room.room!)}>Copy</button>
                </div>
                <p className="small-note" aria-live="polite">{copyMessage || 'Open this link in another browser.'}</p>
              </div>
            )}

            {mode === 'online' && room.error && <p className="error" role="alert">{room.error}</p>}
            {mode === 'online' && (room.status === 'disconnected' || room.status === 'failed') && (
              <button
                className="button button--secondary reconnect"
                type="button"
                onClick={() => room.room ? room.join(room.room) : room.create()}
              >{room.room ? 'Reconnect' : 'Try again'}</button>
            )}

            <form className="join-form" onSubmit={joinRoom}>
              <label htmlFor="room-code">Or join with a room code</label>
              <div className="copy-row">
                <input
                  id="room-code"
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.currentTarget.value.toUpperCase())}
                  placeholder="8-character code"
                  maxLength={8}
                  pattern="[0-9A-Fa-f]{8}"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
                <button className="button button--secondary" type="submit">Join</button>
              </div>
            </form>
          </section>

          <section className="panel rules-panel">
            <p className="eyebrow">The essentials</p>
            <h2>How to play</h2>
            <ol>
              <li>Red moves first. Only the generals start face-up; both sides’ other identities are hidden.</li>
              <li>A covered piece moves first as the piece normally on its starting point, then reveals its true identity.</li>
              <li>After that, it moves as its revealed piece. Covered pieces can block and be captured; captured identities are revealed.</li>
              <li>Use xiangqi movement, palace and river rules. Protect your general from check.</li>
              <li>Checkmate wins; a player with no legal move also loses.</li>
            </ol>
            <p className="rank-order"><strong>Remember</strong> Horses can be blocked at the leg; cannons capture over one screen. Generals may not face each other.</p>
          </section>
        </aside>
      </div>
      <footer>Made for playing together, one reveal at a time.</footer>
    </main>
  );
}
