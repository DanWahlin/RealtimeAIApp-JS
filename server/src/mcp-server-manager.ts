import express, { Application, Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { McpServer, PromptCallback, ReadResourceTemplateCallback, ResourceTemplate, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { pino } from 'pino';
import { z } from 'zod';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

export class MCPServerManager {
  private mcpServer: McpServer;
  private transports: Map<string, SSEServerTransport>;
  private logger: pino.Logger;
  private app?: Application;

  constructor(app: Application, logger: pino.Logger) {
    this.app = app;
    this.logger = logger.child({ module: 'mcp-server' });
    this.transports = new Map<string, SSEServerTransport>();
    
    // Initialize MCP server
    this.mcpServer = new McpServer(
      {
        name: 'echo',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );
  }

  private initializeResources(): void {
    this.mcpServer.resource('echo', new ResourceTemplate('echo://{message}', { list: undefined }),
      async (uri, { message }) => {
        if (!message) throw new Error('Message cannot be empty');
        return {
          contents: [
            {
              uri: uri.href,
              text: `Resource echo: ${message}`,
            },
          ],
        };
      }
    );

    this.mcpServer.tool('echo', { message: z.string() }, 
      async ({ message }) => {
        if (!message) throw new Error('Message cannot be empty');
        return {
          content: [{ type: 'text', text: `Tool echo: ${message}` }],
        };
      }
    );

    this.mcpServer.prompt('echo', { message: z.string() }, 
      ({ message }) => {
        if (!message) throw new Error('Message cannot be empty');
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Please process this message: ${message}`,
              },
            },
          ],
        };
      }
    );
  }

  private authenticate: express.RequestHandler = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader === `Bearer ${process.env.API_KEY}`) {
      next();
    } else {    
      res.status(401).json({ error: 'Unauthorized' });
    }
  }

  private useCors(req: Request, res: Response, next: NextFunction): void {
    const serverUrl = `${req.protocol}://${req.get('host')}`;
    const corsOptions: cors.CorsOptions = {
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        if (!origin || origin === serverUrl) {
          callback(null, true);
        } else {
          this.logger.warn(`🔥 CORS blocked request from origin: ${origin}`);
          callback(new Error('🔥 Not allowed by CORS'));
        }
      },
      methods: ['GET', 'POST'],
    };
    cors(corsOptions)(req, res, next);
  }
  
  private registerMcpServer(app: Application): McpServer {
    if (!app) {
      throw new Error('Express app instance is required.');
    }

    app.use((req, res, next) => this.useCors(req, res, next));

    app.get('/sse', /*this.authenticate, */ (req: Request, res: Response): void => {
      const clientId = crypto.randomUUID();
      const transport = new SSEServerTransport(`/messages/${clientId}`, res);

      try {
        this.transports.set(clientId, transport);
        this.mcpServer.connect(transport);

        // Send the client ID to the connected client
        transport.send({
          jsonrpc: '2.0',
          method: 'client-id',
          params: { clientId },
        });

        this.logger.info(`✅ MCP client connected with ID: ${clientId}`);

        res.on('close', () => {
          this.transports.delete(clientId);
          this.mcpServer.close();
          this.logger.info(`🔴 MCP client disconnected: ${clientId}`);
        });
      } catch (error) {
        this.logger.error(`🔥 Error establishing SSE connection for ${clientId}:`, error);
        res.status(500).json({ error: 'Failed to establish connection' });
      }
    });

    app.post('/messages/:clientId', this.authenticate, (req: Request, res: Response): void => {
      const clientId = req.params.clientId;
      const transport = this.transports.get(clientId);
      if (!transport) {
        this.logger.error(`🔥 Client transport not found: ${clientId}`);
        res.status(404).json({ error: 'Client transport not found' });
        return;
      }

      // Input validation: Ensure the request body is a non-empty object
      if (!req.body || typeof req.body !== 'object') {
        this.logger.error({ body: req.body }, `🔥 Invalid message format for client ${clientId}:`);
        res.status(400).json({ error: 'Invalid message format' });
        return;
      }

      try {
        transport.handlePostMessage(req, res);
      } catch (error) {
        this.logger.error({ error }, `🔥 Error handling message for client ${clientId}:`);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    return this.mcpServer;
  }

  start(port: string | number) {
    if (!this.app) {
      throw new Error('Express app not provided in constructor');
    }
    
    this.initializeResources();
    this.registerMcpServer(this.app);
    
    this.app.listen(port, () => {
        this.logger.info(`🟢 MCP server is running on http://localhost:${port}`);
    });
  }

  stop() {
    this.mcpServer.close();
  }

  getMcpServer(): McpServer {
    return this.mcpServer;
  }
  
  addResource(name: string, template: ResourceTemplate, handler: ReadResourceTemplateCallback) {
    this.mcpServer.resource(name, template, handler);
  }
  
  addTool(name: string, schema: any, handler: ToolCallback) { 
    this.mcpServer.tool(name, schema, handler);
  }
  
  addPrompt(name: string, schema: any, handler: PromptCallback) {
    this.mcpServer.prompt(name, schema, handler);
  }

}