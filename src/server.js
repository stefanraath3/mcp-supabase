require("dotenv").config();
const {
  McpServer,
  ResourceTemplate,
} = require("@modelcontextprotocol/sdk/server/mcp.js");
const { z } = require("zod");
const db = require("./db");

// Create MCP server instance
const server = new McpServer({
  name: process.env.SERVER_NAME || "Supabase MCP Server",
  version: process.env.SERVER_VERSION || "1.0.0",
});

// RESOURCES

// Resource to list all tables in the database
server.resource("tables-list", "schema://tables", async (uri) => {
  try {
    const tables = await db.listTables();
    return {
      contents: [
        {
          uri: uri.href,
          text: `Database Tables:\n\n${tables
            .map((table) => `- ${table}`)
            .join("\n")}`,
        },
      ],
    };
  } catch (error) {
    return {
      contents: [
        {
          uri: uri.href,
          text: `Error retrieving tables: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Resource to get schema for a specific table
server.resource(
  "table-schema",
  new ResourceTemplate("schema://table/{tableName}", {
    list: "schema://tables",
  }),
  async (uri, { tableName }) => {
    try {
      const schema = await db.getTableSchema(tableName);

      // Format the schema information in a readable way
      const columnsText = schema.columns
        .map(
          (col) =>
            `- ${col.column_name} (${col.data_type})${
              col.is_nullable === "YES" ? " NULL" : " NOT NULL"
            }${
              schema.primaryKeys.includes(col.column_name) ? " PRIMARY KEY" : ""
            }`
        )
        .join("\n");

      const fkText =
        schema.foreignKeys.length > 0
          ? `\nForeign Keys:\n${schema.foreignKeys
              .map(
                (fk) =>
                  `- ${fk.column_name} -> ${fk.foreign_table_name}.${fk.foreign_column_name}`
              )
              .join("\n")}`
          : "\nNo Foreign Keys";

      const indicesText =
        schema.indices.length > 0
          ? `\nIndices:\n${schema.indices
              .map((idx) => `- ${idx.indexname}: ${idx.indexdef}`)
              .join("\n")}`
          : "\nNo Indices";

      return {
        contents: [
          {
            uri: uri.href,
            text: `Table: ${tableName}\n\nColumns:\n${columnsText}${fkText}${indicesText}`,
          },
        ],
      };
    } catch (error) {
      return {
        contents: [
          {
            uri: uri.href,
            text: `Error retrieving schema for table ${tableName}: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// TOOLS

// Tool to run a read-only SQL query
server.tool("query", { sql: z.string() }, async ({ sql }) => {
  try {
    const result = await db.executeReadOnlyQuery(sql);

    // Format the result as a table
    let formattedResult = "";

    if (result.rows.length > 0) {
      // Get column names from the first row
      const columns = Object.keys(result.rows[0]);

      // Create header row with column names
      formattedResult += columns.join(" | ") + "\n";
      formattedResult += columns.map(() => "---").join(" | ") + "\n";

      // Add data rows
      result.rows.forEach((row) => {
        formattedResult +=
          columns
            .map((col) => {
              const value = row[col];
              return value === null ? "NULL" : String(value);
            })
            .join(" | ") + "\n";
      });

      formattedResult += `\n${result.rows.length} rows returned`;
    } else {
      formattedResult = "Query returned no results";
    }

    return {
      content: [
        {
          type: "text",
          text: formattedResult,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error executing query: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Tool to analyze a table and get basic statistics
server.tool(
  "analyze-table",
  { tableName: z.string() },
  async ({ tableName }) => {
    try {
      const stats = await db.analyzeTable(tableName);

      // Format the statistics as text
      let formattedStats = `Table: ${tableName}\n\n`;
      formattedStats += `Row Count: ${stats.rowCount}\n\n`;
      formattedStats += "Column Statistics:\n";

      // Header
      formattedStats += "Column | Type | Null Count | Null %\n";
      formattedStats += "--- | --- | --- | ---\n";

      // Rows
      stats.columnStats.forEach((col) => {
        formattedStats += `${col.column_name} | ${col.data_type} | ${col.null_count} | ${col.null_percentage}\n`;
      });

      return {
        content: [
          {
            type: "text",
            text: formattedStats,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error analyzing table ${tableName}: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool to find related tables
server.tool(
  "find-related-tables",
  { tableName: z.string() },
  async ({ tableName }) => {
    try {
      const relatedTables = await db.findRelatedTables(tableName);

      let formattedRelationships = `Relationships for Table: ${tableName}\n\n`;

      if (relatedTables.relationships.length === 0) {
        formattedRelationships += "No relationships found";
      } else {
        // Group by relationship type for better organization
        const outgoing = relatedTables.relationships.filter(
          (r) => r.relationship_type === "outgoing"
        );
        const incoming = relatedTables.relationships.filter(
          (r) => r.relationship_type === "incoming"
        );

        if (outgoing.length > 0) {
          formattedRelationships +=
            "Outgoing Relationships (Tables this table references):\n";
          outgoing.forEach((rel) => {
            formattedRelationships += `- ${tableName}.${rel.from_column} -> ${rel.related_table}.${rel.to_column}\n`;
          });
          formattedRelationships += "\n";
        }

        if (incoming.length > 0) {
          formattedRelationships +=
            "Incoming Relationships (Tables that reference this table):\n";
          incoming.forEach((rel) => {
            formattedRelationships += `- ${rel.related_table}.${rel.from_column} -> ${tableName}.${rel.to_column}\n`;
          });
        }
      }

      return {
        content: [
          {
            type: "text",
            text: formattedRelationships,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error finding related tables for ${tableName}: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// PROMPTS

// Prompt for table exploration
server.prompt(
  "table-exploration",
  { tableName: z.string() },
  ({ tableName }) => ({
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `I want to explore the "${tableName}" table in our database. Please help me understand:

1. What is the schema of this table (column names, types, constraints)?
2. What relationships does this table have with other tables?
3. Can you provide some basic statistics about the data in this table?
4. What are some useful queries I could run to explore this table further?

Please use the available tools to gather this information and present it in a well-organized way.`,
          },
        ],
      },
    ],
  })
);

// Prompt for data summary
server.prompt(
  "data-summary",
  {
    tableName: z.string(),
    limit: z.number().optional(),
  },
  ({ tableName, limit = 10 }) => ({
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `I need a summary of the data in the "${tableName}" table. Please:

1. Get the table schema to understand what we're working with
2. Analyze the table for basic stats (row count, null values)
3. Run appropriate queries to show me a sample of ${limit} records
4. Identify any potential data quality issues
5. Suggest any insights or patterns that might be useful for further analysis

Please organize your findings in a clear and concise way.`,
          },
        ],
      },
    ],
  })
);

// Prompt for relationship analysis
server.prompt(
  "relationship-analysis",
  { tableName: z.string() },
  ({ tableName }) => ({
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `I need to understand how the "${tableName}" table relates to other tables in our database. Please:

1. Identify all tables that have foreign key relationships with this table
2. Show both incoming and outgoing relationships
3. Explain what these relationships mean in a business context
4. Provide example join queries to demonstrate how to use these relationships
5. Suggest how these relationships could be used for data analysis

Please use the appropriate tools to gather this information and present it in a clear, organized way.`,
          },
        ],
      },
    ],
  })
);

module.exports = server;
