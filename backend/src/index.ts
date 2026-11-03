import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import cron from 'node-cron';
import { prisma } from './lib/prisma';
import { TransactionSyncService } from './services/transactionSyncService';
import { RecurringService } from './services/recurringService';

// Import routes
import authRoutes from './routes/auth';
import plaidRoutes from './routes/plaid';
import transactionRoutes from './routes/transactions';
import categoryRoutes from './routes/categories';
import { accountsRouter } from './routes/accounts';
import budgets from './routes/budgets';
import analyticsRoutes from './routes/analytics';
import recurringRoutes from './routes/recurring';
import { netWorthRouter } from './routes/networth';

dotenv.config();

export const app = express();
const port = process.env.PORT || 8000;

// Built frontend (served by this process so there is one origin, one port, no CORS).
const webDir = process.env.WEB_DIR ?? path.resolve(__dirname, '../../frontend/dist');
const hasWebBuild = fs.existsSync(path.join(webDir, 'index.html'));

// Middleware
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/plaid', plaidRoutes);
app.use('/api/transactions', transactionRoutes); // New cached transactions route
app.use('/api/categories', categoryRoutes); // The one display-category list
app.use('/api/accounts', accountsRouter); // New cached accounts route
app.use('/api/budgets', budgets);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/recurring', recurringRoutes);
app.use('/api/networth', netWorthRouter);

// Health check endpoint
app.get('/health', async (req: Request, res: Response) => {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;
    
    // Check sync status: one row per connected bank on the whole server (cost rule 6.5 #5).
    const activeUsers = await prisma.plaidItem.count();

    res.json({
      status: 'healthy',
      database: 'connected',
      activeUsers,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: 'Database connection failed'
    });
  }
});

// Background sync scheduler: one sweep every 4 hours, UTC, so the cron job and the dates agree.
const setupBackgroundSync = () => {
  console.log('Setting up background sync scheduler...');

  cron.schedule('0 */4 * * *', () => {
    console.log('Starting scheduled transaction sync...');
    TransactionSyncService.syncAll().catch((error) => {
      console.error('Scheduled transaction sync failed:', error);
    });
  }, { timezone: 'UTC' });

  // Recurring series are detected once a night, after the day's syncs have landed.
  cron.schedule('30 5 * * *', () => {
    console.log('Starting scheduled recurring refresh...');
    RecurringService.refreshAll().catch((error) => {
      console.error('Scheduled recurring refresh failed:', error);
    });
  }, { timezone: 'UTC' });
};

// Manual sync endpoint for testing
app.post('/api/admin/sync-all', async (req: Request, res: Response) => {
  // No key configured means the endpoint stays off, rather than accepting any key.
  const expectedAdminKey = process.env.ADMIN_API_KEY;

  if (!expectedAdminKey) {
    return res.status(503).json({ error: 'Admin endpoint disabled' });
  }

  if (req.body?.adminKey !== expectedAdminKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('Manual sync triggered via admin endpoint');
    TransactionSyncService.syncAll().catch((error) => {
      console.error('Admin sync failed:', error);
    });

    res.json({ 
      message: 'Background sync started',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start sync' });
  }
});

// Frontend: static assets plus the SPA fallback for client-side routes (/overview, /budgets, ...).
if (hasWebBuild) {
  app.use(express.static(webDir));

  // Any GET that is not an API call or the health check gets index.html so the router can take over.
  app.get(/^(?!\/api(?:\/|$)|\/health(?:\/|$)).*/, (req: Request, res: Response) => {
    res.sendFile(path.join(webDir, 'index.html'));
  });
} else {
  console.log(`⚠️  No frontend build found at ${webDir}; serving API only`);
}

// Start the server
const startServer = async () => {
  try {
    // Test database connection
    await prisma.$connect();
    console.log('✅ Database connected');

    // Recover Items left in SYNCING by a process that stopped mid-sync (H9).
    if (process.env.NODE_ENV !== 'test') {
      await TransactionSyncService.resetStuckSyncs();
      setupBackgroundSync();
    }

    app.listen(port, () => {
      console.log(`🚀 Server running on http://localhost:${port}`);
      console.log(`🏦 Money App Backend v2.0.0 with sync & caching`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down server...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down server...');
  await prisma.$disconnect();
  process.exit(0);
});

export { startServer };

if (require.main === module) {
  startServer();
}