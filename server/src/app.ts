//Based on https://learn.microsoft.com/en-us/azure/ai-services/openai/realtime-audio-quickstart?pivots=programming-language-javascript

import express from "express";
import { WebSocketServer } from "ws";
import http from "http";
import { pino } from "pino";
import { RTSession } from "./session.js";

const logger = pino({
  level: process.env.LOG_LEVEL || "debug",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
    },
  },
});

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const { pathname } = new URL(request.url!, `http://${request.headers.host}`);
  if (pathname === "/realtime") {
    logger.debug({ pathname }, "Handling WebSocket upgrade request");
    wss.handleUpgrade(request, socket, head, (ws) => {
      logger.debug("WebSocket upgrade successful");
      wss.emit("connection", ws, request);
    });
  } else {
    logger.warn({ pathname }, "Invalid WebSocket path - destroying connection");
    socket.destroy();
  }
});

wss.on("connection", (ws) => {
  logger.info("New WebSocket connection established");

  const handleMessage = (message: any) => {
    if (!message) {
      logger.warn('Received empty message');
      return;
    }

    let messageString = '';
    try {
      if (Buffer.isBuffer(message)) {
        messageString = message.toString('utf8');
        const parsedMessage = JSON.parse(messageString);
      
        if (parsedMessage.type === 'init' && messageString) {
          new RTSession(ws, logger, parsedMessage.instructions);
          ws.removeListener('message', handleMessage); // Remove the listener after processing the initial message
        }
      }
    } catch (error) {
      logger.error({ error, message, messageString }, 'Message processing error');
    }
  };

  ws.on("message", handleMessage);

  ws.on("close", () => {
    logger.info("WebSocket connection closed");
  });
});

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  logger.info(`Server started on http://localhost:${PORT}`);
});