import { createRoomServer } from './gameServer';

const port = Number(process.env.WS_PORT ?? 3001);
const host = process.env.WS_HOST ?? '127.0.0.1';
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('WS_PORT must be an integer between 1 and 65535.');
}

const server = createRoomServer({ port, host });
server.on('listening', () => {
  console.log(`Flip Xiangqi room server listening on ws://${host}:${port}/ws`);
});
server.on('error', (error) => {
  console.error('Room server error:', error.message);
  process.exitCode = 1;
});
