/**
 * REST HTTP Server - thin adapter over core handlers
 * Provides REST API endpoints that call the same handlers as MCP tools
 */
import { evaluate, validate } from "../core/handlers.js";
import { EvalInput } from "../core/schema.js";
import { randomUUID } from "crypto";

const PORT = parseInt(process.env.PORT || "3001", 10);
const START_TIME = Date.now();

/**
 * Create HTTP server with REST endpoints
 */
export function makeHttpServer() {
  return Bun.serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url);
      const reqId = randomUUID();
      
      // CORS headers
      const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, x-org-id, x-user-id, x-api-key-id, x-request-id",
        "X-Request-ID": reqId,
      };

      // Handle CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers });
      }

      // Health check
      if (url.pathname === "/health" && req.method === "GET") {
        return new Response(
          JSON.stringify({ 
            status: "ok", 
            version: "1.0.0",
            uptimeSec: Math.floor((Date.now() - START_TIME) / 1000)
          }),
          { headers }
        );
      }

      // Readiness check (for k8s/deployment)
      if (url.pathname === "/ready" && req.method === "GET") {
        // TODO: Check cold caches, policy store, etc.
        const ready = true; // Add real checks here
        
        if (!ready) {
          return new Response(
            JSON.stringify({ status: "not_ready" }),
            { status: 503, headers }
          );
        }

        return new Response(
          JSON.stringify({ 
            status: "ready",
            version: "1.0.0",
            checks: {
              runtime: "ok",
              policy: "ok",
              storage: "ok"
            }
          }),
          { headers }
        );
      }

      // Validate Content-Type for POST requests
      if (req.method === "POST") {
        const contentType = req.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          return new Response(
            JSON.stringify({
              value: null,
              diagnostics: [{
                code: "bad_request",
                message: "Content-Type must be application/json",
                severity: "error"
              }]
            }),
            { status: 415, headers }
          );
        }

        // Rate limiting
        const { checkRateLimit } = await import("../core/rate-limit.js");
        const orgId = req.headers.get("x-org-id") ?? "public";
        const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? 
                   req.headers.get("x-real-ip") ?? 
                   "unknown";

        const rateCheck = checkRateLimit(orgId, ip);
        if (!rateCheck.allowed) {
          return new Response(
            JSON.stringify({
              value: null,
              diagnostics: [{
                code: "rate_limited",
                message: `Rate limit exceeded: ${rateCheck.reason}`,
                severity: "error"
              }]
            }),
            { status: 429, headers: { ...headers, "Retry-After": "60" } }
          );
        }
      }

      // POST /v1/evaluate - evaluate an LD-C document
      if (url.pathname === "/v1/evaluate" && req.method === "POST") {
        try {
          const body = await req.json();
          
          // Extract auth from headers
          const auth = {
            orgId: req.headers.get("x-org-id") ?? "public",
            userId: req.headers.get("x-user-id") ?? undefined,
            keyId: req.headers.get("x-api-key-id") ?? undefined,
          };

          // Build input and call core handler (never throws)
          const input = { ...body, auth };
          const result = await evaluate(input, { reqId });
          
          // Return result (may contain diagnostics with errors)
          const status = result.diagnostics.some(d => d.severity === "error") ? 400 : 200;
          return new Response(JSON.stringify(result, null, 2), { status, headers });
        } catch (error: any) {
          // Should never happen (handlers don't throw), but catch anyway
          return new Response(
            JSON.stringify({ 
              value: null,
              diagnostics: [{ 
                code: "internal", 
                message: error.message, 
                severity: "error" 
              }]
            }),
            { status: 500, headers }
          );
        }
      }

      // POST /v1/validate - validate an LD-C document
      if (url.pathname === "/v1/validate" && req.method === "POST") {
        try {
          const body = await req.json();
          
          // Extract auth from headers
          const auth = {
            orgId: req.headers.get("x-org-id") ?? "public",
            userId: req.headers.get("x-user-id") ?? undefined,
            keyId: req.headers.get("x-api-key-id") ?? undefined,
          };

          // Build input and call core handler (never throws)
          const input = { ...body, auth };
          const result = await validate(input, { reqId });
          
          // Return result (may contain diagnostics with errors)
          const status = result.diagnostics.some(d => d.severity === "error") ? 400 : 200;
          return new Response(JSON.stringify(result, null, 2), { status, headers });
        } catch (error: any) {
          // Should never happen (handlers don't throw), but catch anyway
          return new Response(
            JSON.stringify({ 
              value: null,
              diagnostics: [{ 
                code: "internal", 
                message: error.message, 
                severity: "error" 
              }]
            }),
            { status: 500, headers }
          );
        }
      }

      // 404 for unknown routes
      return new Response(
        JSON.stringify({ error: "Not found" }),
        { status: 404, headers }
      );
    },
  });
}

// Start server if run directly
if (import.meta.main) {
  const server = makeHttpServer();
  console.error(`HTTP Server running at http://localhost:${server.port}`);
  console.error(`Endpoints:`);
  console.error(`  POST /v1/evaluate - Evaluate LD-C document`);
  console.error(`  POST /v1/validate - Validate LD-C document`);
  console.error(`  GET  /health      - Health check`);
} 