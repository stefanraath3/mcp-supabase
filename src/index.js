const server = require("./server");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");

async function main() {
  try {
    console.error("Starting Supabase MCP Server with stdio transport...");

    // Create stdio transport
    const transport = new StdioServerTransport();

    // Connect server to transport
    await server.connect(transport);

    console.error("Server connected and ready. Awaiting messages...");
  } catch (error) {
    console.error("Error starting server:", error);
    process.exit(1);
  }
}

main();
