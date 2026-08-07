import fs from 'fs';
import path from 'path';
import { Client } from 'pg';

async function seedDatabase() {
  console.log('================================================================');
  console.log('STARTING DATABASE MIGRATION & SEEDING (Neon PostgreSQL SSOT)');
  console.log('================================================================');

  // Load .env file manually if process.env.DATABASE_URL is not set
  let dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    const envPath = path.join(__dirname, '../.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8');
      const match = envContent.match(/DATABASE_URL="([^"]+)"/);
      if (match) {
        dbUrl = match[1];
      }
    }
  }

  if (!dbUrl) {
    console.error('ERROR: DATABASE_URL is not set in environment or .env file!');
    process.exit(1);
  }

  console.log('[1/3] Connecting to PostgreSQL database...');
  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('SUCCESS: Connected to PostgreSQL SSOT Database!');

    // Read schema.sql
    const schemaPath = path.join(__dirname, '../db/schema.sql');
    console.log(`\n[2/3] Executing DDL Schema: ${schemaPath}`);
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await client.query(schemaSql);
    console.log('SUCCESS: 22 SSOT Tables and DDL Schema created successfully!');

    // Read initial_seed.sql
    const seedPath = path.join(__dirname, '../db/seeds/initial_seed.sql');
    console.log(`\n[3/3] Executing Seed Data: ${seedPath}`);
    const seedSql = fs.readFileSync(seedPath, 'utf8');
    await client.query(seedSql);
    console.log('SUCCESS: 100% Native dRPC Seeds and Plans loaded successfully!');

    console.log('\n================================================================');
    console.log('DATABASE MIGRATION & SEEDING COMPLETED WITH 100% SUCCESS!');
    console.log('================================================================');
  } catch (error) {
    console.error('\nERROR Executing Database Seeding:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

seedDatabase();
