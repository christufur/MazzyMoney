import { execSync } from 'node:child_process';

// Bun loads .env first and .env.test on top, so these checks stop a run that would touch real data.
const url = process.env.DATABASE_URL ?? '';
if (!url.includes('_test')) {
  throw new Error(`Refusing to run tests: DATABASE_URL is not a _test database`);
}
if (process.env.PLAID_ENV !== 'sandbox') {
  throw new Error('Refusing to run tests: PLAID_ENV must be sandbox');
}

// Non-destructive: applies pending migrations. Tests clean up their own rows; `test:db:up` uses a tmpfs container.
execSync('bunx prisma migrate deploy', { stdio: 'pipe', env: process.env });
