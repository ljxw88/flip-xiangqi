import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
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
  if (!square.faceUp) return `${position}, covered piece`;
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
  const [largeBoard, setLargeBoard] = useState(false);
  return (
    <div className="board-shell">
      <div className="board-scroll" role="region" aria-label="Game board; scroll horizontally when enlarged" tabIndex={largeBoard ? 0 : undefined}>
        <div className={`board-frame${largeBoard ? ' board-frame--large' : ''}`}>
          <div className="board" role="group" aria-label="Nine by ten xiangqi board, black palace at the top and red palace at the bottom; colors are mixed">
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
                const flipped = game.lastAction?.type === 'flip' && game.lastAction.at === index;
                const moved = game.lastAction?.type === 'move' && game.lastAction.to === index;
                const from = moved && game.lastAction?.type === 'move' ? game.lastAction.from : index;
                const travel = moved ? {
                  '--travel-x': `${((from % BOARD_COLUMNS) - (index % BOARD_COLUMNS)) * 100 / 0.84}%`,
                  '--travel-y': `${(Math.floor(from / BOARD_COLUMNS) - Math.floor(index / BOARD_COLUMNS)) * 100 / 0.84}%`,
                } as CSSProperties : undefined;
                const classes = [
                  'square',
                  selected === index ? 'square--selected' : '',
                  destinations.includes(index) ? 'square--destination' : '',
                  game.lastAction && (game.lastAction.type === 'flip'
                    ? game.lastAction.at === index
                    : game.lastAction.from === index || game.lastAction.to === index) ? 'square--last-move' : '',
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
                    aria-pressed={square?.faceUp ? selected === index : undefined}
                    title={label}
                  >
                    {square && !square.faceUp && <span className="piece piece--hidden" aria-hidden="true">暗</span>}
                    {square?.faceUp && (
                      <span className={`piece piece--${square.piece.color}${flipped ? ' piece--flip' : ''}${moved ? ' piece--travel' : ''}`} style={travel} aria-hidden="true">
                        {symbols[square.piece.rank][square.piece.color]}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <div className="board-toolbar">
        <span>{largeBoard ? 'Swipe ↔' : ''}</span>
        <button className="board-zoom" type="button" aria-pressed={largeBoard} onClick={() => setLargeBoard((current) => !current)}>
          {largeBoard ? 'Fit' : 'Zoom'}
        </button>
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
  const [boardMessage, setBoardMessage] = useState('');
  const [joinCode, setJoinCode] = useState(initialRoom ?? '');
  const [copyMessage, setCopyMessage] = useState('');
  const [sheet, setSheet] = useState<'online' | 'rules' | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const wasConnected = useRef(false);
  const room = useRoom();

  useEffect(() => {
    if (initialRoom) room.join(initialRoom);
  }, [initialRoom, room.join]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (sheet && !dialog.open) dialog.showModal();
    else if (!sheet && dialog.open) dialog.close();
  }, [sheet]);

  const bothConnected = room.connected[0] && room.connected[1];
  useEffect(() => {
    if (bothConnected && !wasConnected.current && sheet === 'online') setSheet(null);
    wasConnected.current = bothConnected;
  }, [bothConnected, sheet]);

  useEffect(() => {
    if (mode === 'online' && (room.status === 'failed' || room.status === 'disconnected')) setSheet('online');
  }, [mode, room.status]);

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
  const activeSelection = game?.pendingFlip ?? selected;
  const destinations = activeSelection !== null && game && currentColor
    ? legalMovesFrom(game.board, activeSelection, currentColor)
    : [];
  const checked = Boolean(game && currentColor && isInCheck(game.board, currentColor));
  const opponentColor = currentColor === 'red' ? 'black' : 'red';
  const opponentChecked = Boolean(game && currentColor && isInCheck(game.board, opponentColor));

  useEffect(() => {
    setSelected(null);
    setBoardMessage('');
  }, [mode, game?.turn, game?.pendingFlip, Boolean(game?.outcome), room.status]);

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
    setBoardMessage('');
  }

  function handleSquare(index: number) {
    if (!game || !canPlay) return;
    const square = game.board[index];
    if (activeSelection !== null && destinations.includes(index)) {
      perform({ type: 'move', from: activeSelection, to: index });
    } else if (game.pendingFlip !== null) {
      setBoardMessage('Move it or end your turn.');
    } else if (square && !square.faceUp) {
      if (!checked) perform({ type: 'flip', at: index });
    } else if (square && squareColor(square) === currentColor) {
      setSelected((current) => current === index ? null : index);
      setBoardMessage('');
    } else {
      setSelected(null);
      setBoardMessage('');
    }
  }

  function startLocal() {
    room.leave();
    setLocalGame(createGame());
    setSelected(null);
    setMode('local');
    setSheet(null);
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
      if (room.pending) return 'Sending…';
      return room.player === game.turn ? 'Your turn' : 'Their turn';
    }
    return `${colorName(game.colors[game.turn])} to play`;
  }

  function guidance(): string {
    if (!game) return room.status === 'connecting' ? 'Joining room…' : 'Choose a game.';
    if (game.outcome?.reason === 'general-captured') {
      const action = game.lastAction;
      if (action?.type === 'move' && action.captured?.piece.color === action.piece.color) {
        return 'Own general captured.';
      }
      return action?.type === 'move' && action.captured?.wasHidden
        ? 'Covered general captured!' : 'General captured!';
    }
    if (game.outcome?.reason === 'checkmate') return 'Checkmate!';
    if (game.outcome?.reason === 'stalemate') return 'No legal moves.';
    if (mode === 'online' && room.status !== 'connected') return 'Reconnect to continue.';
    if (mode === 'online' && (!room.connected[0] || !room.connected[1])) {
      return 'Waiting for your opponent.';
    }
    if (game.pendingFlip !== null) {
      if (mode === 'online' && room.player !== game.turn) return 'They may move or end their turn.';
      if (boardMessage) return boardMessage;
      if (checked) return 'Check! Move it or end your turn.';
      return destinations.length ? 'Move it or end your turn.' : 'No move. End your turn.';
    }
    if (checked) return 'Check! Protect your general.';
    if (opponentChecked) return `${colorName(opponentColor)} is in check!`;
    if (mode === 'online' && room.player !== game.turn) return 'Waiting…';
    if (boardMessage) return boardMessage;
    const square = selected === null ? null : game.board[selected];
    if (square) return destinations.length ? 'Choose a destination.' : 'No legal moves.';
    return 'Flip any · move yours';
  }

  return (
    <main className="app-shell">
      <header className="site-header">
        <div className="brand-mark" aria-hidden="true">棋</div>
        <h1>翻转象棋 <span>· Flip</span></h1>
        <nav className="game-tools" aria-label="Game controls">
          <button className="tool-button" type="button" onClick={startLocal} aria-label="New hotseat game" title="New hotseat game">↻</button>
          <button className={`tool-button tool-button--online${mode === 'online' ? ' tool-button--active' : ''}`} type="button" onClick={() => setSheet('online')} aria-label="Online room" title="Online room">VS</button>
          <button className="tool-button" type="button" onClick={() => setSheet('rules')} aria-label="How to play" title="How to play">?</button>
        </nav>
      </header>

      <section className="play-area" aria-label="Game">
        <div className={`game-heading${checked && !game?.outcome ? ' game-heading--check' : ''}`} role="status" aria-live="polite">
          <span className={`color-dot color-dot--${currentColor ?? 'unknown'}`} aria-hidden="true" />
          <div className="turn-copy">
            <p className="eyebrow">{game?.outcome ? 'Game over' : currentColor ? `${colorName(currentColor)} · ${mode === 'online' ? 'Online' : 'Hotseat'}` : 'Online'}</p>
            <h2>{heading()}</h2>
            <p>{guidance()}</p>
          </div>
          {game && game.pendingFlip !== null && canPlay && (
            <button className="button button--finish" type="button" onClick={() => perform({ type: 'end-turn' })}>End turn</button>
          )}
          {game?.outcome && (mode === 'local' ? (
            <button className="button button--primary" type="button" onClick={startLocal}>Again</button>
          ) : (
            <button className="button button--primary" type="button" onClick={() => room.send({ type: 'rematch' })}
              disabled={!room.connected[0] || !room.connected[1] || room.pending}>Rematch</button>
          ))}
        </div>

        {game ? (
          <Board game={game} selected={activeSelection} destinations={destinations} canPlay={canPlay} onSquare={handleSquare} />
        ) : (
          <div className="board-placeholder">{room.status === 'connecting' ? 'Connecting…' : 'No room connected'}</div>
        )}

        {game?.lastAction?.type === 'move' && game.lastAction.captured && (
          <p className="capture-note" role="status" aria-live="polite">
            Captured {game.lastAction.captured.piece.color === game.lastAction.piece.color ? 'own ' : ''}
            {colorName(game.lastAction.captured.piece.color)} {game.lastAction.captured.piece.rank}{' '}
            {symbols[game.lastAction.captured.piece.rank][game.lastAction.captured.piece.color]}
            {game.lastAction.captured.wasHidden ? ' · revealed' : ''}
          </p>
        )}
        {game && game.captures.length > 0 && (
          <div className="captured-list" aria-label="Captured pieces">
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
      </section>

      <dialog className="sheet" ref={dialogRef} aria-labelledby="sheet-title" onClose={() => setSheet(null)}
        onClick={(event) => { if (event.target === event.currentTarget) setSheet(null); }}>
        <div className="sheet-header">
          <h2 id="sheet-title">{sheet === 'rules' ? 'How to play' : 'Play online'}</h2>
          <button className="tool-button" type="button" onClick={() => setSheet(null)} aria-label="Close">×</button>
        </div>
        {sheet === 'rules' && (
          <div className="rules-panel">
            <ol>
              <li>Red plays first. Generals, advisors and elephants start face-up; every other piece is covered and colors are mixed.</li>
              <li>Flip any covered piece. If it is yours, move it now or end your turn; otherwise your turn ends.</li>
              <li>Move only your revealed pieces. You may capture any covered piece, even your own.</li>
              <li>Use xiangqi movement. Capture or checkmate the enemy general to win; capturing your own general loses.</li>
              <li>A covered general cannot be checked. In check, move to safety; no legal action is a loss.</li>
            </ol>
          </div>
        )}
        {sheet === 'online' && (
          <div className="online-panel">
            {mode === 'online' && room.room && room.player !== null ? (
              <div className="room-details">
                <p className="room-code">Room <strong>{room.room}</strong></p>
                <label htmlFor="room-link">Invite link</label>
                <div className="copy-row">
                  <input id="room-link" value={roomLink(room.room)} readOnly onFocus={(event) => event.currentTarget.select()} />
                  <button className="button button--secondary" type="button" onClick={() => copyLink(room.room!)}>Copy</button>
                </div>
                <p className="small-note" aria-live="polite">{copyMessage || (bothConnected ? 'Both players connected.' : 'Share with a friend.')}</p>
              </div>
            ) : (
              <>
                <button className="button button--primary button--wide" type="button" onClick={createRoom} disabled={room.status === 'connecting'}>Create room</button>
                <form className="join-form" onSubmit={joinRoom}>
                  <label htmlFor="room-code">Join with a code</label>
                  <div className="copy-row">
                    <input id="room-code" value={joinCode} onChange={(event) => setJoinCode(event.currentTarget.value.toUpperCase())}
                      placeholder="8-character code" maxLength={8} pattern="[0-9A-Fa-f]{8}" autoComplete="off" spellCheck={false} required />
                    <button className="button button--secondary" type="submit">Join</button>
                  </div>
                </form>
              </>
            )}
            {mode === 'online' && room.error && <p className="error" role="alert">{room.error}</p>}
            {mode === 'online' && (room.status === 'disconnected' || room.status === 'failed') && (
              <button className="button button--secondary button--wide reconnect" type="button"
                onClick={() => room.room ? room.join(room.room) : room.create()}>{room.room ? 'Reconnect' : 'Try again'}</button>
            )}
          </div>
        )}
      </dialog>
    </main>
  );
}
