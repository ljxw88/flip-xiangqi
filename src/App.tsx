import { useEffect, useState, type FormEvent } from 'react';
import {
  applyAction,
  BOARD_COLUMNS,
  createGame,
  legalMovesFrom,
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
  if (!square.faceUp) return `${position}, face-down piece`;
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
      <div className="board" role="group" aria-label="Four by eight game board">
        {game.board.map((square, index) => {
          const classes = [
            'square',
            selected === index ? 'square--selected' : '',
            destinations.includes(index) ? 'square--destination' : '',
          ].filter(Boolean).join(' ');
          const label = squareLabel(square, index);
          return (
            <button
              key={index}
              type="button"
              className={classes}
              onClick={() => onSquare(index)}
              disabled={!canPlay}
              aria-label={label}
              aria-pressed={square?.faceUp ? selected === index : undefined}
              title={label}
            >
              {square && !square.faceUp && <span className="piece piece--hidden" aria-hidden="true">暗</span>}
              {square?.faceUp && (
                <span className={`piece piece--${square.piece.color}`} aria-hidden="true">
                  {symbols[square.piece.rank][square.piece.color]}
                </span>
              )}
              {!square && <span className="empty-mark" aria-hidden="true" />}
            </button>
          );
        })}
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
    if (square && !square.faceUp) {
      perform({ type: 'flip', at: index });
    } else if (selected !== null && destinations.includes(index)) {
      perform({ type: 'move', from: selected, to: index });
    } else if (square?.faceUp && square.piece.color === currentColor) {
      setSelected((current) => current === index ? null : index);
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
    if (game.outcome?.reason === 'elimination') return 'All of the opponent’s pieces have been captured.';
    if (game.outcome?.reason === 'no-legal-moves') return 'The opponent has no legal action.';
    if (mode === 'online' && room.status !== 'connected') return 'Reconnect to continue the same game.';
    if (mode === 'online' && (!room.connected[0] || !room.connected[1])) {
      return 'Share the room link below. The game pauses if either player disconnects.';
    }
    if (!game.colors[0]) return 'The first flipped piece decides Player 1’s color.';
    if (mode === 'online' && room.player !== game.turn) return 'Waiting for your opponent to play.';
    return 'Flip a piece, or select one of yours and choose a highlighted square.';
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
          <h1>Flip Xiangqi <span>暗棋</span></h1>
        </div>
        <div className="mode-label">{mode === 'local' ? 'HOTSEAT' : 'ONLINE ROOM'}</div>
      </header>

      <div className="layout">
        <section className="play-area" aria-label="Game">
          <div className="game-heading" role="status" aria-live="polite">
            <div>
              <p className="eyebrow">{game?.outcome ? 'Game over' : 'Flip · Move · Capture'}</p>
              <h2>{heading()}</h2>
              <p>{guidance()}</p>
            </div>
          </div>

          {game ? (
            <Board game={game} selected={selected} destinations={destinations} canPlay={canPlay} onSquare={handleSquare} />
          ) : (
            <div className="board-placeholder">Your game will appear here.</div>
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
              <li>Flip any face-down piece. The first flip assigns the colors.</li>
              <li>On your turn, flip a piece or move yours one square orthogonally.</li>
              <li>Capture an enemy of equal or lower rank. A soldier captures a general, but not the reverse.</li>
              <li>A cannon captures by jumping exactly one piece, face-up or face-down.</li>
            </ol>
            <p className="rank-order"><strong>Rank</strong> 帅 / 将 &gt; 仕 / 士 &gt; 相 / 象 &gt; 车 &gt; 马 &gt; 炮 &gt; 兵 / 卒</p>
          </section>
        </aside>
      </div>
      <footer>Made for playing together, one flip at a time.</footer>
    </main>
  );
}
