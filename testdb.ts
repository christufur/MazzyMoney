import { connectDb, query } from './backend/src/database';

async function testConnection() {
  try {
    console.log('Testing database connection...');
    await connectDb();
    
    // Test a simple query
    const result = await query('SELECT NOW() as current_time');
    console.log('Database connected successfully!');
    console.log('Current time from database:', result.rows[0].current_time);
    
    // Test creating and querying a simple table
    await query(`
      CREATE TABLE IF NOT EXISTS test_table (
        id SERIAL PRIMARY KEY,
        message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await query(
      'INSERT INTO test_table (message) VALUES ($1)',
      ['Hello from Node.js!']
    );
    
    const testResult = await query('SELECT * FROM test_table ORDER BY created_at DESC LIMIT 1');
    console.log('Test record:', testResult.rows[0]);
    
    console.log('✅ Database test completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Database test failed:', error);
    process.exit(1);
  }
}

testConnection();