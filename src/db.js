// Load environment variables from .env file
require("dotenv").config();

const { Pool } = require("pg");

// Use the direct connection string from environment variables
const connectionString =
  process.env.DB_CONNECTION_STRING ||
  `postgresql://${process.env.PGUSER}:${process.env.PGPASSWORD}@${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE}`;

// Log connection attempt (without the password)
const sanitizedConnectionString = connectionString.replace(/:[^:@]+@/, ":***@");
console.log(
  `Attempting to connect to PostgreSQL with: ${sanitizedConnectionString}`
);

// Create a connection pool using the connection string
const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false, // Required for Supabase's self-signed certificates
  },
  // Transaction pooler doesn't support prepared statements
  // Important: disable prepared statements for Supabase pooler
  statement_timeout: 10000, // 10 second statement timeout
  connectionTimeoutMillis: 15000, // 15 second connection timeout
  query_timeout: 15000, // 15 second query timeout
  max: 5, // Maximum number of clients in the pool
});

// Add error handler to the pool
pool.on("error", (err) => {
  console.error("Unexpected error on idle client", err);
});

// Test the connection when the module is loaded
pool.query("SELECT NOW()", (err, res) => {
  if (err) {
    console.error("Database connection failed:", err.stack);
  } else {
    console.log("Database connected:", res.rows[0].now);
  }
});

// Helper function to execute queries with proper error handling
async function query(text, params = [], retries = 3) {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // For transaction pooler, we need to use a specific query format
      const queryConfig = {
        text: text,
        values: params,
        // Disable prepared statements (critical for transaction pooler compatibility)
        name: "",
      };

      const result = await pool.query(queryConfig);
      return result;
    } catch (error) {
      lastError = error;

      // Only retry on connection errors, not on query syntax errors
      const isConnectionError =
        error.code === "ECONNREFUSED" ||
        error.code === "ETIMEDOUT" ||
        error.code === "57P01" || // database admin shutdown
        error.code === "57P02" || // crash shutdown
        error.code === "57P03" || // cannot connect now
        error.message.includes("Connection terminated") ||
        error.message.includes("connection to server was lost");

      if (!isConnectionError || attempt === retries) {
        console.error(
          `Query error (attempt ${attempt}/${retries}):`,
          error.message
        );
        throw error;
      }

      // Wait before retrying (exponential backoff)
      const delay = Math.min(100 * Math.pow(2, attempt - 1), 1000);
      console.log(
        `Connection issue, retrying in ${delay}ms (attempt ${attempt}/${retries})...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// Function to list all tables in the database
async function listTables() {
  const sql = `
    SELECT tablename 
    FROM pg_catalog.pg_tables 
    WHERE schemaname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
    ORDER BY tablename;
  `;

  const result = await query(sql);
  return result.rows.map((row) => row.tablename);
}

// Function to get schema details for a specific table
async function getTableSchema(tableName) {
  // Get column information
  const columnsSql = `
    SELECT 
      column_name, 
      data_type, 
      is_nullable,
      column_default
    FROM 
      information_schema.columns
    WHERE 
      table_name = $1
    ORDER BY 
      ordinal_position;
  `;

  // Get primary key information
  const pkSql = `
    SELECT
      kcu.column_name
    FROM
      information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
    WHERE
      tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_name = $1;
  `;

  // Get foreign key information
  const fkSql = `
    SELECT
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name
    FROM
      information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
    WHERE
      tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = $1;
  `;

  // Get indices information
  const indicesSql = `
    SELECT
      indexname,
      indexdef
    FROM
      pg_indexes
    WHERE
      tablename = $1;
  `;

  try {
    const [columnsResult, pkResult, fkResult, indicesResult] =
      await Promise.all([
        query(columnsSql, [tableName]),
        query(pkSql, [tableName]),
        query(fkSql, [tableName]),
        query(indicesSql, [tableName]),
      ]);

    return {
      tableName,
      columns: columnsResult.rows,
      primaryKeys: pkResult.rows.map((row) => row.column_name),
      foreignKeys: fkResult.rows,
      indices: indicesResult.rows,
    };
  } catch (error) {
    console.error(
      `Error fetching schema for table ${tableName}:`,
      error.message
    );
    throw error;
  }
}

// Function to get basic statistics about a table
async function analyzeTable(tableName) {
  // Get row count
  const countSql = `SELECT COUNT(*) as count FROM "${tableName}";`;

  // Get column statistics
  const statsSql = `
    SELECT
      column_name,
      data_type,
      (
        SELECT COUNT(*)
        FROM "${tableName}"
        WHERE "${column_name}" IS NULL
      ) AS null_count
    FROM
      information_schema.columns
    WHERE
      table_name = $1;
  `;

  try {
    const [countResult, statsResult] = await Promise.all([
      query(countSql),
      query(statsSql, [tableName]),
    ]);

    const totalRows = parseInt(countResult.rows[0].count);

    // Add null percentage to each column stat
    const columnStats = statsResult.rows.map((col) => ({
      ...col,
      null_count: parseInt(col.null_count),
      null_percentage:
        totalRows > 0
          ? ((parseInt(col.null_count) / totalRows) * 100).toFixed(2) + "%"
          : "0%",
    }));

    return {
      tableName,
      rowCount: totalRows,
      columnStats,
    };
  } catch (error) {
    console.error(`Error analyzing table ${tableName}:`, error.message);
    throw error;
  }
}

// Function to find tables related to a given table (through foreign keys)
async function findRelatedTables(tableName) {
  // Tables that this table references (outgoing foreign keys)
  const referencedTablesSql = `
    SELECT
      ccu.table_name AS related_table,
      kcu.column_name AS from_column,
      ccu.column_name AS to_column,
      'outgoing' AS relationship_type
    FROM
      information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
    WHERE
      tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = $1;
  `;

  // Tables that reference this table (incoming foreign keys)
  const referencingTablesSql = `
    SELECT
      kcu.table_name AS related_table,
      kcu.column_name AS from_column,
      ccu.column_name AS to_column,
      'incoming' AS relationship_type
    FROM
      information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
    WHERE
      tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = $1;
  `;

  try {
    const [referencedResult, referencingResult] = await Promise.all([
      query(referencedTablesSql, [tableName]),
      query(referencingTablesSql, [tableName]),
    ]);

    return {
      tableName,
      relationships: [...referencedResult.rows, ...referencingResult.rows],
    };
  } catch (error) {
    console.error(
      `Error finding related tables for ${tableName}:`,
      error.message
    );
    throw error;
  }
}

// Function to execute a read-only query safely
async function executeReadOnlyQuery(sql) {
  // Check if the query is attempting to modify data
  const normalizedSql = sql.trim().toLowerCase();

  if (
    normalizedSql.startsWith("insert") ||
    normalizedSql.startsWith("update") ||
    normalizedSql.startsWith("delete") ||
    normalizedSql.startsWith("drop") ||
    normalizedSql.startsWith("alter") ||
    normalizedSql.startsWith("create") ||
    normalizedSql.includes("set schema")
  ) {
    throw new Error("Only read-only queries are allowed");
  }

  try {
    // Execute with a read-only transaction to ensure safety
    await query("BEGIN TRANSACTION READ ONLY");
    const result = await query(sql);
    await query("COMMIT");
    return result;
  } catch (error) {
    await query("ROLLBACK");
    throw error;
  }
}

module.exports = {
  query,
  listTables,
  getTableSchema,
  analyzeTable,
  findRelatedTables,
  executeReadOnlyQuery,
};
