import { FastMCP } from "fastmcp";
import { z } from "zod";
import { EvalInput, EvalOutput } from "./schema.js";
import { evaluate, validate } from "./handlers.js";
import * as services from "./services/index.js";

/**
 * Register all tools with the MCP server
 * MCP tools are thin wrappers around core handlers - no business logic here
 * 
 * @param server The FastMCP server instance
 */
export function registerTools(server: FastMCP) {
  // LD-C Evaluation tool
  server.addTool({
    name: "ldc.evaluate",
    description: "Deterministic LD-C evaluation with provenance and signing",
    parameters: z.object({
      doc: z.record(z.any()).describe("LD-C document to evaluate"),
      options: z.object({
        now: z.string().datetime().optional(),
        asOf: z.string().optional(),
        caps: z.record(z.array(z.string())).optional(),
        timeoutMs: z.number().int().positive().max(5_000).optional(),
        runtimeVersion: z.string().optional()
      }).optional().describe("Evaluation options"),
      // Auth is injected by MCP session, not passed by client
      orgId: z.string().optional().describe("Organization ID (defaults to 'public')"),
      userId: z.string().optional().describe("User ID"),
      keyId: z.string().optional().describe("API Key ID")
    }),
    execute: async (params) => {
      const auth = {
        orgId: params.orgId ?? "public",
        userId: params.userId,
        keyId: params.keyId
      };
      
      const input = {
        doc: params.doc,
        options: params.options,
        auth
      };
      
      return await evaluate(input);
    }
  });

  // LD-C Validation tool
  server.addTool({
    name: "ldc.validate",
    description: "Validate an LD-C document structure and schema",
    parameters: z.object({
      doc: z.record(z.any()).describe("LD-C document to validate"),
      orgId: z.string().optional().describe("Organization ID (defaults to 'public')"),
      userId: z.string().optional().describe("User ID"),
      keyId: z.string().optional().describe("API Key ID")
    }),
    execute: async (params) => {
      const auth = {
        orgId: params.orgId ?? "public",
        userId: params.userId,
        keyId: params.keyId
      };
      
      const input = {
        doc: params.doc,
        auth
      };
      
      const result = await validate(input);
      return JSON.stringify(result, null, 2);
    }
  });

  // Legacy greeting tool (kept for backward compatibility)
  server.addTool({
    name: "hello_world",
    description: "A simple hello world tool",
    parameters: z.object({
      name: z.string().describe("Name to greet")
    }),
    execute: async (params) => {
      const greeting = services.GreetingService.generateGreeting(params.name);
      return greeting;
    }
  });

  // Legacy farewell tool (kept for backward compatibility)
  server.addTool({
    name: "goodbye",
    description: "A simple goodbye tool",
    parameters: z.object({
      name: z.string().describe("Name to bid farewell to")
    }),
    execute: async (params) => {
      const farewell = services.GreetingService.generateFarewell(params.name);
      return farewell;
    }
  });
}