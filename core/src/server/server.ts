/**
 * MCP Server - thin adapter over core handlers
 * Wires tools and resources to the FastMCP host
 */
import { FastMCP } from "fastmcp";
import { registerResources } from "../core/resources.js";
import { registerTools } from "../core/tools.js";
import { registerPrompts } from "../core/prompts.js";

/**
 * Create and configure the MCP server
 * This is a thin adapter - all business logic lives in core/handlers.ts
 */
export async function startMcpHost(opts: { transportType?: "stdio" | "sse"; port?: number } = {}) {
  try {
    // Create FastMCP server instance
    const server = new FastMCP({
      name: "LD-C MCP Server",
      version: "1.0.0"
    });

    // Register all resources, tools, and prompts
    // These are thin wrappers around core handlers
    registerResources(server);
    registerTools(server);
    registerPrompts(server);
    
    // Start the server with specified transport
    const transportType = opts.transportType ?? "stdio";
    
    if (transportType === "stdio") {
      server.start({ transportType: "stdio" });
      console.error("MCP Server running on stdio");
    } else if (transportType === "sse") {
      const port = opts.port ?? 3002;
      // @ts-ignore - FastMCP supports SSE but types may not be updated
      server.start({
        transportType: "sse",
        sse: { port, endpoint: "/sse" }
      });
      console.error(`MCP Server running at http://localhost:${port}`);
      console.error(`SSE endpoint: http://localhost:${port}/sse`);
    }
    
    return server;
  } catch (error) {
    console.error("Failed to initialize MCP server:", error);
    throw error;
  }
}

// Legacy export for backward compatibility
export default startMcpHost; 