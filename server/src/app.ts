import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { pino } from 'pino';
import { RTSession } from './session.js';

const logger = pino({
  level: process.env.LOG_LEVEL || 'debug',
  transport: { target: 'pino-pretty', options: { colorize: true } },
});

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url!, `http://${request.headers.host}`);
  if (pathname === '/realtime') {
    logger.debug({ pathname }, 'Handling WebSocket upgrade request');
    wss.handleUpgrade(request, socket, head, (ws) => {
      logger.debug('WebSocket upgrade successful');
      wss.emit('connection', ws, request);
    });
  } else {
    logger.warn({ pathname }, 'Invalid WebSocket path - destroying connection');
    socket.destroy();
  }
});

wss.on('connection', (ws: WebSocket) => {
  logger.info('New WebSocket connection established');

  const handleInitMessage = (message: any) => {
    if (!message) {
      logger.warn('Received empty message');
      return;
    }

    try {
      const messageString = Buffer.isBuffer(message) ? message.toString('utf8') : message.toString();
      const parsed = JSON.parse(messageString);
      if (parsed.type === 'init') {
        new RTSession(ws, logger, parsed.instructions); // RTSession takes over all further messages
        ws.off('message', handleInitMessage); // Explicitly remove this listener
      }
    } catch (error) {
      logger.error({ error, message: message.toString() }, 'Failed to process init message');
    }
  };

  ws.on('message', handleInitMessage);
  ws.on('close', () => logger.info('WebSocket connection closed'));
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => logger.info(`Server started on http://localhost:${PORT}`));