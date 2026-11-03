import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import cors from 'cors'; 
import cron from 'node-cron';
import { prisma } from './lib/prisma';
import { TransactionSyncService } from './services/transactionSyncService';

// Import routes
import authRoutes from './routes/auth';
import plaidRoutes from './routes/plaid';
import transactionRoutes from './routes/transactions';
import { accountsRouter } from './routes/accounts';
import budgets from './routes/budgets';
import analyticsRoutes from './routes/analytics';

dotenv.config();

export const app = express();
const port = process.env.PORT || 8000;

// Middleware
app.use(express.json());
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
}));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/plaid', plaidRoutes);
app.use('/api/transactions', transactionRoutes); // New cached transactions route
app.use('/api/accounts', accountsRouter); // New cached accounts route
app.use('/api/budgets', budgets);
app.use('/api/analytics', analyticsRoutes);


// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({ 
    message: 'Money App Backend is running!',
    version: '2.0.0',
    features: ['sync', 'caching', 'background-jobs']
  });
});

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