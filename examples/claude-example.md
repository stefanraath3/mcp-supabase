# Using the Supabase MCP Server with Claude

This guide shows how to use your Supabase MCP Server with Claude through Claude.app.

## Prerequisites

1. The Supabase MCP Server running
2. A Claude.app account with API access
3. Your database configuration properly set up

## Steps to Connect

1. Start your MCP server using one of the following methods:

   **For command-line integration (stdio):**

   ```bash
   npm start
   ```

   **For HTTP/SSE (recommended for Claude.app):**

   ```bash
   npm run start:http
   ```

2. Once your server is running with HTTP/SSE on port 3000, you can access it at:

   ```
   http://localhost:3000
   ```

3. In Claude.app, use the "Connect to MCP Server" feature (when available) to connect to your local server.

## Example Prompts for Claude

Once connected to your MCP server, you can use prompts like these with Claude:

### Exploring Database Structure

```
Please use the connected MCP server to:
1. List all tables in the database
2. Show me the schema for the "users" table (or any table you identify in step 1)
3. Identify any relationships between tables
```

### Running SQL Queries

```
Using the MCP server, please:
1. Show me the schema for the "products" table
2. Run a query to get the top 5 most expensive products
3. Find any tables related to the products table
4. Explain the relationships you found
```

### Data Analysis

```
I'd like to analyze the "orders" table in our database. Using the MCP server:
1. Get basic statistics about the table
2. Find the most recent orders
3. Calculate the average order value
4. Identify any trends or patterns in the data
```

### Using Prompts

```
Please use the "data-summary" prompt with the table name "customers" to provide a comprehensive overview of our customer data.
```

## Tips for Effective Use

1. **Start with exploration**: First ask Claude to list tables and explore schemas before running specific queries.

2. **Use read-only queries**: Remember that the MCP server only allows read-only queries for security reasons.

3. **Leverage relationships**: Ask Claude to find and explain relationships between tables to better understand the database structure.

4. **Use the built-in prompts**: The MCP server includes specialized prompts for table exploration, data summaries, and relationship analysis.

5. **Combine with Claude's capabilities**: Claude can not only retrieve data but also analyze it, visualize it (through descriptions), and make recommendations based on the findings.

## Troubleshooting

If you encounter issues:

1. Check that your server is running and accessible
2. Verify your database connection credentials in the `.env` file
3. Ensure you have the correct permissions for your Supabase database
4. Check the server logs for any error messages

## Next Steps

- Customize the server by adding more specialized tools or prompts
- Deploy the server to a public endpoint for remote access
- Integrate with other MCP clients besides Claude
