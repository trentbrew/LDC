import { FastMCP } from "fastmcp";
import { makeServices } from "./services/index.js";

/**
 * Register all resources with the MCP server
 * Resources provide access to artifacts and materializations
 * 
 * @param server The FastMCP server instance
 */
export function registerResources(server: FastMCP) {
  // LD-C Artifacts resource - list all artifacts for an org
  server.addResourceTemplate({
    uriTemplate: "ldc://artifacts/{orgId}",
    name: "LD-C Artifacts",
    mimeType: "application/json",
    description: "List all LD-C artifacts for an organization",
    arguments: [
      {
        name: "orgId",
        description: "Organization ID",
        required: true,
      },
    ],
    async load({ orgId }) {
      const { storage } = makeServices();
      const artifacts = await storage.listArtifacts({ orgId });
      
      return {
        text: JSON.stringify(artifacts, null, 2)
      };
    }
  });

  // LD-C Artifact resource - get a specific artifact
  server.addResourceTemplate({
    uriTemplate: "ldc://artifact/{orgId}/{id}",
    name: "LD-C Artifact",
    mimeType: "application/json",
    description: "Get a specific LD-C artifact by ID",
    arguments: [
      {
        name: "orgId",
        description: "Organization ID",
        required: true,
      },
      {
        name: "id",
        description: "Artifact ID",
        required: true,
      },
    ],
    async load({ orgId, id }) {
      const { storage } = makeServices();
      const artifact = await storage.getArtifact({ orgId, id });
      
      if (!artifact) {
        return {
          text: JSON.stringify({ error: "Artifact not found" }, null, 2)
        };
      }
      
      return {
        text: JSON.stringify(artifact, null, 2)
      };
    }
  });

  // Legacy example resource (kept for backward compatibility)
  server.addResourceTemplate({
    uriTemplate: "example://{id}",
    name: "Example Resource",
    mimeType: "text/plain",
    description: "Example resource for testing",
    arguments: [
      {
        name: "id",
        description: "Resource ID",
        required: true,
      },
    ],
    async load({ id }) {
      return {
        text: `This is an example resource with ID: ${id}`
      };
    }
  });
} 