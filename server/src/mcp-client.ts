import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport";
import dotenv from "dotenv";
import OpenAI from "openai";
import pino from "pino";
import { z } from "zod";
dotenv.config();

class MCPClient {
    private mcp: Client;
    private transport: Transport | null = null;
    tools: any[] = [];
    logger: pino.Logger;

    constructor(logger: pino.Logger) {
        this.mcp = new Client({ name: 'mcp-client', version: '1.0.0' });
        this.logger = logger.child({ module: 'mcp-client' });
    }

    async connect(serverUrl: string) {
        try {
            this.transport = new SSEClientTransport(new URL(serverUrl));
            await this.mcp.connect(this.transport);

            const toolsResult = await this.mcp.listTools();
            this.tools = toolsResult.tools.map((tool) => {
                return openAiToolAdapter({
                    name: tool.name,
                    description: tool.description,
                    input_schema: tool.inputSchema,
                });
            });
        } catch (e) {
            console.log('Failed to connect to MCP server: ', e);
            throw e;
        }
    }

    // async processQuery(query: string) {
    //     const messages: any[] = [
    //         {
    //             role: 'user",
    //             content: query,
    //         },
    //     ];

    //     console.log("Tools: ", JSON.stringify(this.tools, null, 2));

    //     let response = await this.openai.chat.completions.create({
    //         model: "gpt-3.5-turbo",
    //         max_tokens: 1000,
    //         messages,
    //         tools: this.tools,
    //     });

    //     const finalText: string[] = [];
    //     const toolResults: any[] = [];

    //     console.log('Response from OpenAI: ', JSON.stringify(response.choices, null, 2));
    //     response.choices.map(async (choice: any) => {
    //         const message = choice.message;
    //         if (message.tool_calls) {
    //             toolResults.push(
    //                 await this.callTools(message.tool_calls, toolResults, finalText)
    //             );
    //         } else {
    //             finalText.push(message.content || "xx");
    //         }
    //     });

    //     response = await this.openai.chat.completions.create({
    //         model: "gpt-3.5-turbo",
    //         max_tokens: 1000,
    //         messages,
    //     });

    //     finalText.push(
    //         response.choices[0].message.content || "??"
    //     );

    //     return finalText.join("\n");
    // }

    async callTools(tool_calls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]) {
        const toolResults = [];
        for (const tool_call of tool_calls) {
            // Type guard to check if it's a function tool call
            if ('function' in tool_call) {
                const toolName = tool_call.function.name;
                const args = tool_call.function.arguments;

                this.logger.info(`🛠️ Calling tool ${toolName} with args ${JSON.stringify(args)}`);

                const toolResult = await this.mcp.callTool({
                    name: toolName,
                    arguments: JSON.parse(args),
                });

                toolResults.push({
                    name: toolName,
                    result: toolResult,
                });
            }
        }
        return toolResults;
    }

    async close() {
        await this.mcp.close();
    }
}

export function openAiToolAdapter(tool: {
    name: string;
    description?: string;
    input_schema: any;
}) {
    const schema = z.object(tool.input_schema);

    return {
        type: "function",
        function: {
            name: tool.name,
            description: tool.description,
            parameters: {
                type: "object",
                properties: tool.input_schema.properties,
                required: tool.input_schema.required,
            },
        },
    };
}