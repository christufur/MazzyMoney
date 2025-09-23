import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

const pool = new Pool({
	user: process.env.DB_USER,
	host: process.env.DB_HOST,
	database: process.env.DB_DATABASE,
	password: process.env.DB_PASSWORD,
	port: parseInt(process.env.DB_PORT || '5432', 10),
});

pool.on('error', (err: Error) => {
	console.error('Unexpected error on idle client', err);
	process.exit(-1);
});

export const connectDb = async () => {
	try {
		const client = await pool.connect();
		console.log('PostgreSQL connected!');
		client.release(); // Important: release the client back to the pool
	} catch (err) {
		console.error('PostgreSQL connection error:', err); // Fixed: was using 'error' instead of 'err'
		process.exit(1);
	}
};

export const query = (text: string, params?: any[]) => pool.query(text, params);