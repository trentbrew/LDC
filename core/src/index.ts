/**
 * CLI Entry Point - unified MCP + REST server
 * 
 * Modes:
 *   - MODE=mcp   - MCP server only (stdio)
 *   - MODE=http  - REST HTTP server only
 *   - MODE=both  - Both MCP (SSE) and HTTP (default)
 * 
 * Environment:
 *   - PORT       - HTTP server port (default: 3001)
 *   - MCP_PORT   - MCP SSE port (default: 3002)
 */
import { makeHttpServer } from "./server/http-server.js";
import { startMcpHost } from "./server/server.js";

const MODE = process.env.MODE ?? "both";
const HTTP_PORT = parseInt(process.env.PORT || "3001", 10);
const MCP_PORT = parseInt(process.env.MCP_PORT || "3002", 10);

async function main() {
  try {
    console.error(`Starting in ${MODE} mode...`);
    
    // Start HTTP REST server
    if (MODE === "http" || MODE === "both") {
      const httpServer = makeHttpServer();
      console.error(`✓ HTTP REST server running at http://localhost:${httpServer.port}`);
      console.error(`  POST /v1/evaluate - Evaluate LD-C document`);
      console.error(`  POST /v1/validate - Validate LD-C document`);
    }
    
    // Start MCP server
    if (MODE === "mcp") {
      // stdio mode for MCP clients
      await startMcpHost({ transportType: "stdio" });
      console.error(`✓ MCP server running on stdio`);
    } else if (MODE === "both") {
      // SSE mode when running alongside HTTP
      await startMcpHost({ transportType: "sse", port: MCP_PORT });
      console.error(`✓ MCP server running at http://localhost:${MCP_PORT}/sse`);
    }
    
    console.error("\nServer ready. Press Ctrl+C to stop.");
  } catch (error) {
    console.error("Error starting server:", error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on("SIGINT", () => {
  console.error("\nShutting down...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.error("\nShutting down...");
  process.exit(0);
});

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
}); 