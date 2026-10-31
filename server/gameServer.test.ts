import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket, { type WebSocketServer } from 'ws';
import { BOARD_SIZE, createGame, type GameState, type Square } from '../src/game/engine';
import type { ClientMessage, ServerMessage } from '../src/multiplayer/protocol';
import { createRoomServer } from './gameServer';

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

describe('WebSocket rooms', () => {
  let server: WebSocketServer;
  let url: string;
  let clients: TestClient[];

  async function connect(): Promise<TestClient> {
    const client = new TestClient(url);
    clients.push(client);
    await once(client.socket, 'open');
    return client;
  }

  beforeEach(async () => {
    clients = [];
    server = createRoomServer({ port: 0, host: '127.0.0.1', reconnectGraceMs: 1000 });
    await once(server, 'listening');
    url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
  });

  afterEach(async () => {
    for (const client of clients) client.socket.terminate();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('assigns seats, conceals hidden identities, and enforces alternating legal turns', async () => {
    const host = await connect();
    host.send({ type: 'create' });
    const hostSeat = await host.next('joined');
    expect(hostSeat.player).toBe(0);
    expect(hostSeat.room).toMatch(/^[0-9A-F]{8}$/);
    const waiting = await host.next('state');
    expect(waiting.connected).toEqual([true, false]);
    expect(waiting.game.board).toEqual(Array(32).fill({ faceUp: false }));

    host.send({ type: 'action', action: { type: 'flip', at: 0 } });
    expect((await host.next('error')).message).toMatch(/both players/i);

    const guest = await connect();
    guest.send({ type: 'join', room: hostSeat.room });
    expect((await guest.next('joined')).player).toBe(1);
    expect((await guest.next('state')).connected).toEqual([true, true]);
    await host.next('state', (message) => message.connected[1]);

    const third = await connect();
    third.send({ type: 'join', room: hostSeat.room });
    expect((await third.next('error')).message).toMatch(/two players/i);

    guest.send({ type: 'action', action: { type: 'flip', at: 0 } });
    expect((await guest.next('error')).message).toMatch(/not your turn/i);

    host.send({ type: 'action', action: { type: 'flip', at: 0 } });
    const firstFlip = await guest.next('state', (message) => message.game.turn === 1);
    const revealed = firstFlip.game.board[0];
    expect(revealed?.faceUp).toBe(true);
    if (!revealed || !revealed.faceUp) throw new Error('Expected a revealed piece');
    expect(firstFlip.game.colors[0]).toBe(revealed.piece.color);
    expect(firstFlip.game.colors[1]).not.toBe(revealed.piece.color);
    expect(firstFlip.game.board.slice(1)).toEqual(Array(31).fill({ faceUp: false }));

    guest.send({ type: 'action', action: { type: 'flip', at: 0 } });
    expect((await guest.next('error')).message).toMatch(/not a legal move/i);
    guest.send({ type: 'action', action: { type: 'flip', at: 1 } });
    const secondFlip = await host.next('state', (message) => message.game.board[1]?.faceUp === true);
    expect(secondFlip.game.turn).toBe(0);
  });

  it('pauses when a player disconnects and resumes the same seat and game with its session token', async () => {
    const host = await connect();
    host.send({ type: 'create' });
    const hostSeat = await host.next('joined');
    await host.next('state');

    const guest = await connect();
    guest.send({ type: 'join', room: hostSeat.room });
    await guest.next('joined');
    await guest.next('state');
    await host.next('state', (message) => message.connected[1]);

    host.send({ type: 'action', action: { type: 'flip', at: 7 } });
    const before = await guest.next('state', (message) => message.game.turn === 1);
    host.socket.close();
    expect((await guest.next('state', (message) => !message.connected[0])).connected).toEqual([false, true]);
    guest.send({ type: 'action', action: { type: 'flip', at: 8 } });
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
    guest.send({ type: 'action', action: { type: 'flip', at: 8 } });
    expect((await resumed.next('state', (message) => message.game.board[8]?.faceUp === true)).game.turn).toBe(0);
  });

  it('rejects malformed messages and does not allow a game in progress to be reset', async () => {
    const host = await connect();
    host.socket.send('not json');
    expect((await host.next('error')).message).toMatch(/invalid message/i);
    host.send({ type: 'create' });
    const { room } = await host.next('joined');
    await host.next('state');

    const guest = await connect();
    guest.send({ type: 'join', room });
    await guest.next('joined');
    await guest.next('state');
    await host.next('state', (message) => message.connected[1]);
    host.socket.send(JSON.stringify({ type: 'action', action: { type: 'flip', at: '0' } }));
    expect((await host.next('error')).message).toMatch(/invalid action/i);
    host.send({ type: 'rematch' });
    expect((await host.next('error')).message).toMatch(/finish the current game/i);
  });

  it('broadcasts a win and lets either connected player start a fresh rematch', async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    const board: Square[] = Array(BOARD_SIZE).fill(null);
    board[0] = { faceUp: true, piece: { color: 'red', rank: 'soldier' } };
    board[1] = { faceUp: true, piece: { color: 'black', rank: 'general' } };
    board[8] = { faceUp: false, piece: { color: 'red', rank: 'general' } };
    const almostFinished: GameState = { board, turn: 0, colors: ['red', 'black'], outcome: null };
    let gamesCreated = 0;
    server = createRoomServer({
      port: 0,
      host: '127.0.0.1',
      gameFactory: () => gamesCreated++ === 0 ? almostFinished : createGame(() => 0),
    });
    await once(server, 'listening');
    url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;

    const host = await connect();
    host.send({ type: 'create' });
    const { room } = await host.next('joined');
    await host.next('state');
    const guest = await connect();
    guest.send({ type: 'join', room });
    await guest.next('joined');
    await guest.next('state');
    await host.next('state', (message) => message.connected[1]);

    host.send({ type: 'action', action: { type: 'move', from: 0, to: 1 } });
    const won = await guest.next('state', (message) => message.game.outcome !== null);
    expect(won.game.outcome).toEqual({ winner: 0, reason: 'elimination' });
    expect(won.game.board[8]).toEqual({ faceUp: false });
    guest.send({ type: 'rematch' });
    const rematch = await host.next('state', (message) => message.game.colors[0] === null);
    expect(rematch.game.turn).toBe(0);
    expect(rematch.game.colors).toEqual([null, null]);
    expect(rematch.game.outcome).toBeNull();
    expect(rematch.game.board).toEqual(Array(32).fill({ faceUp: false }));
  });

  it('keeps a room after a quick reconnect, then expires it after everyone leaves', async () => {
    const host = await connect();
    host.send({ type: 'create' });
    const hostSeat = await host.next('joined');
    await host.next('state');
    const guest = await connect();
    guest.send({ type: 'join', room: hostSeat.room });
    const guestSeat = await guest.next('joined');
    await guest.next('state');

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
