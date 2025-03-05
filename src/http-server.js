// Load environment variables from .env file
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const server = require("./server");
const {
  SSEServerTransport,
} = require("@modelcontextprotocol/sdk/server/sse.js");

// Use a simple implementation that avoids the complex SSE logic
async function startHttpServer(port = 3000) {
  // Test database connection before starting server
  try {
    console.log("Initializing database connection...");
    const db = require("./db");
    const result = await db.query("SELECT NOW()");
    console.log("Database connection successful at", result.rows[0].now);
  } catch (error) {
    console.error("Failed to connect to database:", error);
    console.log(
      "Starting server anyway, but database functionality will be limited"
    );
  }

  // Create Express app
  const app = express();

  // Enable CORS
  app.use(cors());

  // Use JSON parser for all non-webhook routes
  app.use(bodyParser.json());

  // Serve static files from the public directory
  app.use(express.static("public"));

  // Simple health check endpoint
  app.get("/health", (req, res) => {
    res.json({ status: "ok", message: "MCP Server is running" });
  });

  // Alternative approach to test basic database connectivity
  app.get("/test-db", async (req, res) => {
    try {
      // Include connection parameters in response (without password)
      const connectionParams = {
        host: process.env.PGHOST,
        port: process.env.PGPORT,
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
      };

      console.log("Testing database connection with params:", connectionParams);

      const db = require("./db");
      const result = await db.query("SELECT NOW()");
      const tables = await db.listTables();

      res.json({
        status: "ok",
        message: "Database connection successful",
        timestamp: result.rows[0].now,
        connectionParams,
        tables,
      });
    } catch (error) {
      console.error("Database test failed:", error);

      res.status(500).json({
        status: "error",
        message: "Database connection failed",
        connectionParams: {
          host: process.env.PGHOST,
          port: process.env.PGPORT,
          database: process.env.PGDATABASE,
          user: process.env.PGUSER,
        },
        error: error.message,
        stack: error.stack,
      });
    }
  });

  // Start the server
  const httpServer = app.listen(port, () => {
    console.log(`HTTP server started on port ${port}`);
    console.log(`Health check available at http://localhost:${port}/health`);
    console.log(`Database test available at http://localhost:${port}/test-db`);
  });

  return httpServer;
}

// Start the HTTP server if this file is run directly
if (require.main === module) {
  const port = process.env.PORT || 3000;
  startHttpServer(port).catch((error) => {
    console.error("Error starting HTTP server:", error);
    process.exit(1);
  });
}

module.exports = { startHttpServer };
