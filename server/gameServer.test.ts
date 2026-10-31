import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket, { type WebSocketServer } from 'ws';
import { BOARD_COLUMNS, BOARD_SIZE, createGame, type GameState, type Square } from '../src/game/engine';
import type { ClientMessage, ServerMessage } from '../src/multiplayer/protocol';
import { createRoomServer } from './gameServer';

const at = (row: number, column: number) => row * BOARD_COLUMNS + column;
type MessageOf<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;

class TestClient {
  readonly socket: WebSocket;
  private messages: ServerMessage[] = [];
  private waiters: Array<{
    matches: (message: ServerMessage) => boolean;
    resolve: (message: ServerMessage) => void;
  }> = [];

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.on('error', () => {});
    this.socket.on('message', (data) => {
      const message = JSON.parse(data.toString()) as ServerMessage;
      const index = this.waiters.findIndex((waiter) => waiter.matches(message));
      if (index >= 0) {
        const [waiter] = this.waiters.splice(index, 1);
        waiter.resolve(message);
      } else {
        this.messages.push(message);
      }
    });
  }

  send(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  next<T extends ServerMessage['type']>(
    type: T,
    predicate: (message: MessageOf<T>) => boolean = () => true,
  ): Promise<MessageOf<T>> {
    const matches = (message: ServerMessage): message is MessageOf<T> =>
      message.type === type && predicate(message as MessageOf<T>);
    const index = this.messages.findIndex(matches);
    if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0] as MessageOf<T>);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 2000);
      this.waiters.push({
        matches,
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message as MessageOf<T>);
        },
      });
    });
  }
}

function customPosition(entries: Array<[number, number, Square]>): GameState {
  const board: Square[] = Array(BOARD_SIZE).fill(null);
  board[at(9, 4)] = { faceUp: true, piece: { color: 'red', rank: 'general' } };
  board[at(0, 3)] = { faceUp: true, piece: { color: 'black', rank: 'general' } };
  for (const [row, column, square] of entries) board[at(row, column)] = square;
  return { board, turn: 0, colors: ['red', 'black'], outcome: null, lastAction: null, captures: [] };
}

describe('WebSocket rooms', () => {
  let server: WebSocketServer;
  let url: string;
  let clients: TestClient[];

  async function startServer(gameFactory?: () => GameState): Promise<void> {
    server = createRoomServer({ port: 0, host: '127.0.0.1', reconnectGraceMs: 1000, gameFactory });
    await once(server, 'listening');
    url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
  }

  async function useGameFactory(gameFactory: () => GameState): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await startServer(gameFactory);
  }

  async function connect(): Promise<TestClient> {
    const client = new TestClient(url);
    clients.push(client);
    await once(client.socket, 'open');
    return client;
  }

  async function pair() {
    const host = await connect();
    host.send({ type: 'create' });
    const hostSeat = await host.next('joined');
    const waiting = await host.next('state');
    const guest = await connect();
    guest.send({ type: 'join', room: hostSeat.room });
    const guestSeat = await guest.next('joined');
    const joined = await guest.next('state');
    await host.next('state', (message) => message.connected[1]);
    return { host, guest, hostSeat, guestSeat, waiting, joined };
  }

  beforeEach(async () => {
    clients = [];
    await startServer();
  });

  afterEach(async () => {
    for (const client of clients) client.socket.terminate();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('does not allow flips while a room is waiting for its second player', async () => {
    const host = await connect();
    host.send({ type: 'create' });
    await host.next('joined');
    expect((await host.next('state')).connected).toEqual([true, false]);
    host.send({ type: 'action', action: { type: 'flip', at: at(6, 0) } });
    expect((await host.next('error')).message).toMatch(/both players/i);
  });

  it('assigns sides, conceals both players’ covered identities and enforces legal turns', async () => {
    const { host, guest, hostSeat, guestSeat, waiting, joined } = await pair();
    expect(hostSeat.player).toBe(0);
    expect(guestSeat.player).toBe(1);
    expect(hostSeat.room).toMatch(/^[0-9A-F]{8}$/);
    expect(waiting.connected).toEqual([true, false]);
    expect(joined.connected).toEqual([true, true]);
    expect(joined.game.board).toHaveLength(90);
    expect(joined.game.colors).toEqual(['red', 'black']);
    expect(joined.game.board[at(9, 4)]).toEqual({ faceUp: false, color: 'red' });
    expect(joined.game.board[at(0, 4)]).toEqual({ faceUp: false, color: 'black' });
    const hidden = joined.game.board.filter((square) => square && !square.faceUp);
    expect(hidden).toHaveLength(32);
    expect(hidden.every((square) => square && !square.faceUp &&
      !('rank' in square) && !('piece' in square) && !('cover' in square))).toBe(true);
    expect(joined.game.board[at(6, 0)]).toEqual({ faceUp: false, color: 'red' });
    expect(joined.game.board[at(3, 0)]).toEqual({ faceUp: false, color: 'black' });

    const third = await connect();
    third.send({ type: 'join', room: hostSeat.room });
    expect((await third.next('error')).message).toMatch(/two players/i);
    guest.send({ type: 'action', action: { type: 'flip', at: at(3, 0) } });
    expect((await guest.next('error')).message).toMatch(/not your turn/i);
    host.send({ type: 'action', action: { type: 'flip', at: at(3, 0) } });
    expect((await host.next('error')).message).toMatch(/not a legal action/i);
    host.send({ type: 'action', action: { type: 'move', from: at(6, 0), to: at(5, 0) } });
    expect((await host.next('error')).message).toMatch(/not a legal action/i);

    host.send({ type: 'action', action: { type: 'flip', at: at(6, 0) } });
    const first = await guest.next('state', (message) => message.game.turn === 1);
    const firstForHost = await host.next('state', (message) => message.game.turn === 1);
    expect(first.game).toEqual(firstForHost.game);
    expect(first.game.board[at(6, 0)]).toMatchObject({ faceUp: true, piece: { color: 'red' } });
    expect(first.game.board[at(5, 0)]).toBeNull();
    expect(first.game.lastAction).toMatchObject({ type: 'flip', at: at(6, 0) });
    expect(first.game.board[at(3, 0)]).toEqual({ faceUp: false, color: 'black' });
    host.send({ type: 'action', action: { type: 'move', from: at(6, 0), to: at(5, 0) } });
    expect((await host.next('error')).message).toMatch(/not your turn/i);
    guest.send({ type: 'action', action: { type: 'flip', at: at(3, 0) } });
    const second = await host.next('state', (message) => message.game.board[at(3, 0)]?.faceUp === true);
    expect(second.game.turn).toBe(0);
  });

  it('flips in place, ends the turn, and later moves using the revealed identity', async () => {
    const game = customPosition([
      [6, 0, { faceUp: false, color: 'red', rank: 'rook' }],
      [3, 0, { faceUp: false, color: 'black', rank: 'elephant' }],
    ]);
    await useGameFactory(() => game);
    const { host, guest, joined } = await pair();
    expect(joined.game.board[at(6, 0)]).toEqual({ faceUp: false, color: 'red' });
    host.send({ type: 'action', action: { type: 'move', from: at(6, 0), to: at(6, 2) } });
    expect((await host.next('error')).message).toMatch(/not a legal action/i);
    host.socket.send(JSON.stringify({
      type: 'action', action: { type: 'flip', at: at(6, 0), rank: 'general', to: at(6, 2) },
    }));
    const revealed = await guest.next('state', (message) => message.game.turn === 1);
    expect(revealed.game.board[at(6, 0)]).toEqual({ faceUp: true, piece: { color: 'red', rank: 'rook' } });
    expect(revealed.game.board[at(6, 2)]).toBeNull();
    guest.send({ type: 'action', action: { type: 'flip', at: at(3, 0) } });
    await host.next('state', (message) => message.game.turn === 0 && message.game.lastAction !== null);
    host.send({ type: 'action', action: { type: 'move', from: at(6, 0), to: at(6, 2) } });
    const movedAgain = await guest.next('state', (message) => message.game.board[at(6, 2)]?.faceUp === true);
    expect(movedAgain.game.board[at(6, 2)]).toEqual({ faceUp: true, piece: { color: 'red', rank: 'rook' } });
  });

  it('rejects moves exposing the general even when the piece movement itself is valid', async () => {
    const game = customPosition([
      [0, 3, null], [0, 4, { faceUp: true, piece: { color: 'black', rank: 'general' } }],
      [5, 4, { faceUp: true, piece: { color: 'red', rank: 'rook' } }],
    ]);
    await useGameFactory(() => game);
    const { host, guest } = await pair();
    host.send({ type: 'action', action: { type: 'move', from: at(5, 4), to: at(5, 3) } });
    expect((await host.next('error')).message).toMatch(/not a legal action/i);
    host.send({ type: 'action', action: { type: 'move', from: at(5, 4), to: at(4, 4) } });
    const next = await guest.next('state', (message) => message.game.turn === 1);
    expect(next.game.board[at(4, 4)]).toEqual({ faceUp: true, piece: { color: 'red', rank: 'rook' } });
  });

  it('does not allow a flip as a substitute for escaping check', async () => {
    const game = {
      ...customPosition([
        [0, 3, null], [0, 4, { faceUp: true, piece: { color: 'black', rank: 'general' } }],
        [4, 4, { faceUp: true, piece: { color: 'red', rank: 'rook' } }],
        [3, 8, { faceUp: false, color: 'black', rank: 'soldier' }],
      ]),
      turn: 1 as const,
    };
    await useGameFactory(() => game);
    const { host, guest } = await pair();
    guest.send({ type: 'action', action: { type: 'flip', at: at(3, 8) } });
    expect((await guest.next('error')).message).toMatch(/not a legal action/i);
    guest.send({ type: 'action', action: { type: 'move', from: at(0, 4), to: at(0, 3) } });
    const escaped = await host.next('state', (message) => message.game.turn === 0 && message.game.lastAction !== null);
    expect(escaped.game.board[at(3, 8)]).toEqual({ faceUp: false, color: 'black' });
  });

  it('rejects capture of a covered enemy until its owner flips it', async () => {
    const game = customPosition([
      [5, 0, { faceUp: true, piece: { color: 'red', rank: 'rook' } }],
      [6, 8, { faceUp: false, color: 'red', rank: 'soldier' }],
      [5, 3, { faceUp: false, color: 'black', rank: 'horse' }],
    ]);
    await useGameFactory(() => game);
    const { host, guest, joined } = await pair();
    expect(joined.game.board[at(5, 3)]).toEqual({ faceUp: false, color: 'black' });
    host.send({ type: 'action', action: { type: 'move', from: at(5, 0), to: at(5, 3) } });
    expect((await host.next('error')).message).toMatch(/not a legal action/i);
    host.send({ type: 'action', action: { type: 'flip', at: at(6, 8) } });
    await guest.next('state', (message) => message.game.turn === 1);
    guest.send({ type: 'action', action: { type: 'flip', at: at(5, 3) } });
    const flipped = await host.next('state', (message) => message.game.board[at(5, 3)]?.faceUp === true);
    expect(flipped.game.board[at(5, 3)]).toEqual({ faceUp: true, piece: { color: 'black', rank: 'horse' } });
    host.send({ type: 'action', action: { type: 'move', from: at(5, 0), to: at(5, 3) } });
    const [forHost, forGuest] = await Promise.all([
      host.next('state', (message) => message.game.captures.length === 1),
      guest.next('state', (message) => message.game.captures.length === 1),
    ]);
    expect(forHost.game).toEqual(forGuest.game);
    expect(forGuest.game.lastAction).toMatchObject({
      type: 'move', piece: { color: 'red', rank: 'rook' }, captured: { color: 'black', rank: 'horse' },
    });
    expect(forGuest.game.captures).toEqual([{ color: 'black', rank: 'horse' }]);
  });

  it('pauses on disconnect and resumes the same seat and game with its session token', async () => {
    const { host, guest, hostSeat } = await pair();
    host.send({ type: 'action', action: { type: 'flip', at: at(6, 0) } });
    const before = await guest.next('state', (message) => message.game.turn === 1);
    host.socket.close();
    expect((await guest.next('state', (message) => !message.connected[0])).connected).toEqual([false, true]);
    guest.send({ type: 'action', action: { type: 'flip', at: at(3, 0) } });
    expect((await guest.next('error')).message).toMatch(/both players/i);

    const intruder = await connect();
    intruder.send({ type: 'join', room: hostSeat.room, token: 'incorrect' });
    expect((await intruder.next('error')).message).toMatch(/cannot rejoin/i);

    const resumed = await connect();
    resumed.send({ type: 'join', room: hostSeat.room, token: hostSeat.token });
    expect((await resumed.next('joined')).player).toBe(0);
    const after = await resumed.next('state');
    expect(after.connected).toEqual([true, true]);
    expect(after.game).toEqual(before.game);
    guest.send({ type: 'action', action: { type: 'flip', at: at(3, 0) } });
    expect((await resumed.next('state', (message) => message.game.board[at(3, 0)]?.faceUp === true)).game.turn).toBe(0);
  });

  it('rejects malformed flip and move messages and an early rematch', async () => {
    const { host } = await pair();
    host.socket.send('not json');
    expect((await host.next('error')).message).toMatch(/invalid message/i);
    host.socket.send(JSON.stringify({ type: 'action', action: { type: 'move', from: '54', to: 45 } }));
    expect((await host.next('error')).message).toMatch(/invalid action/i);
    host.socket.send(JSON.stringify({ type: 'action', action: { type: 'flip', at: '54' } }));
    expect((await host.next('error')).message).toMatch(/invalid action/i);
    host.send({ type: 'rematch' });
    expect((await host.next('error')).message).toMatch(/finish the current game/i);
  });

  it('broadcasts checkmate and lets either connected player start a fresh rematch', async () => {
    const game = customPosition([
      [0, 3, null], [0, 4, { faceUp: true, piece: { color: 'black', rank: 'general' } }],
      [1, 3, { faceUp: true, piece: { color: 'red', rank: 'rook' } }],
      [1, 5, { faceUp: true, piece: { color: 'red', rank: 'rook' } }],
      [3, 0, { faceUp: true, piece: { color: 'red', rank: 'rook' } }],
      [6, 4, { faceUp: true, piece: { color: 'red', rank: 'soldier' } }],
    ]);
    let gamesCreated = 0;
    await useGameFactory(() => gamesCreated++ === 0 ? game : createGame(() => 0));
    const { host, guest } = await pair();
    host.send({ type: 'action', action: { type: 'move', from: at(3, 0), to: at(3, 4) } });
    const won = await guest.next('state', (message) => message.game.outcome !== null);
    expect(won.game.outcome).toEqual({ winner: 0, reason: 'checkmate' });
    expect(won.game.board[at(0, 4)]).toEqual({ faceUp: true, piece: { color: 'black', rank: 'general' } });
    guest.send({ type: 'rematch' });
    const rematch = await host.next('state', (message) => message.game.lastAction === null && message.game.board.filter(Boolean).length === 32);
    expect(rematch.game.turn).toBe(0);
    expect(rematch.game.colors).toEqual(['red', 'black']);
    expect(rematch.game.outcome).toBeNull();
    expect(rematch.game.board.filter((square) => square && !square.faceUp)).toHaveLength(32);
  });

  it('reveals a covered general even into check, then broadcasts its capture as a win', async () => {
    const game = customPosition([
      [9, 4, null], [7, 4, { faceUp: false, color: 'red', rank: 'general' }],
      [7, 0, { faceUp: true, piece: { color: 'black', rank: 'rook' } }],
    ]);
    await useGameFactory(() => game);
    const { host, guest, joined } = await pair();
    expect(joined.game.board[at(7, 4)]).toEqual({ faceUp: false, color: 'red' });
    host.send({ type: 'action', action: { type: 'flip', at: at(7, 4) } });
    const revealed = await guest.next('state', (message) => message.game.turn === 1);
    expect(revealed.game.board[at(7, 4)]).toEqual({ faceUp: true, piece: { color: 'red', rank: 'general' } });
    guest.send({ type: 'action', action: { type: 'move', from: at(7, 0), to: at(7, 4) } });
    const won = await host.next('state', (message) => message.game.outcome !== null);
    expect(won.game.outcome).toEqual({ winner: 1, reason: 'general-captured' });
    expect(won.game.captures).toEqual([{ color: 'red', rank: 'general' }]);
  });

  it('keeps a room after a quick reconnect, then expires it after everyone leaves', async () => {
    const { host, guest, hostSeat, guestSeat } = await pair();
    const hostClosed = once(host.socket, 'close');
    const guestClosed = once(guest.socket, 'close');
    host.socket.terminate();
    guest.socket.terminate();
    await Promise.all([hostClosed, guestClosed]);
    await new Promise((resolve) => setTimeout(resolve, 25));

    const resumedHost = await connect();
    resumedHost.send({ type: 'join', room: hostSeat.room, token: hostSeat.token });
    expect((await resumedHost.next('joined')).player).toBe(0);
    await resumedHost.next('state');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const resumedGuest = await connect();
    resumedGuest.send({ type: 'join', room: hostSeat.room, token: guestSeat.token });
    expect((await resumedGuest.next('joined')).player).toBe(1);
    await resumedGuest.next('state');

    const resumedHostClosed = once(resumedHost.socket, 'close');
    const resumedGuestClosed = once(resumedGuest.socket, 'close');
    resumedHost.socket.terminate();
    resumedGuest.socket.terminate();
    await Promise.all([resumedHostClosed, resumedGuestClosed]);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const latecomer = await connect();
    latecomer.send({ type: 'join', room: hostSeat.room, token: hostSeat.token });
    expect((await latecomer.next('error')).message).toMatch(/expired/i);
  });
});
