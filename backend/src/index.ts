// Updated src/index.ts
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

dotenv.config();

const app = express();
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
    
    // Check sync status
    const activeUsers = await prisma.user.count({
      where: { plaidItemId: { not: null } }
    });

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

// Background sync scheduler
const setupBackgroundSync = () => {
  console.log('Setting up background sync scheduler...');
  
  // Run every 4 hours during business hours (9 AM - 9 PM EST)
  cron.schedule('0 9,13,17,21 * * *', async () => {
    console.log('Starting scheduled background sync...');
    await runBackgroundSync();
  });

  // Also run a light sync every hour to catch new transactions
  cron.schedule('0 * * * *', async () => {
    console.log('Starting hourly sync for active users...');
    await runHourlySync();
  });
};

const runBackgroundSync = async () => {
  try {
    // Get all users with Plaid connections that haven't been synced in the last 2 hours
    const usersToSync = await prisma.user.findMany({
      where: {
        plaidItemId: { not: null },
        syncStatus: { notIn: ['SYNCING', 'TOKEN_EXPIRED'] },
        OR: [
          { lastSyncAt: null },
          { lastSyncAt: { lt: new Date(Date.now() - 2 * 60 * 60 * 1000) } }
        ]
      },
      select: { id: true, email: true }
    });

    console.log(`Found ${usersToSync.length} users to sync`);

    for (const user of usersToSync) {
      try {
        console.log(`Syncing user: ${user.email}`);
        const result = await TransactionSyncService.syncUserTransactions(user.id);
        
        if (result.success) {
          console.log(`✅ User ${user.email}: ${result.newTransactions} new transactions`);
        } else {
          console.log(`❌ User ${user.email}: ${result.error}`);
        }
      } catch (error) {
        console.error(`Failed to sync user ${user.email}:`, error);
      }
      
      // Add small delay between users to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log('Background sync completed');
  } catch (error) {
    console.error('Background sync failed:', error);
  }
};

const runHourlySync = async () => {
  try {
    // Only sync users who have been active recently (logged in within last 24 hours)
    // and haven't been synced in the last hour
    const activeUsers = await prisma.user.findMany({
      where: {
        plaidItemId: { not: null },
        syncStatus: { notIn: ['SYNCING', 'TOKEN_EXPIRED'] },
        lastSyncAt: { lt: new Date(Date.now() - 60 * 60 * 1000) }, // Last synced over 1 hour ago
        updatedAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Active in last 24 hours
      },
      select: { id: true, email: true }
    });

    console.log(`Found ${activeUsers.length} active users for hourly sync`);

    for (const user of activeUsers) {
      try {
        const result = await TransactionSyncService.syncUserTransactions(user.id);
        if (result.success && result.newTransactions > 0) {
          console.log(`✅ Hourly sync - User ${user.email}: ${result.newTransactions} new transactions`);
        }
      } catch (error) {
        console.error(`Hourly sync failed for user ${user.email}:`, error);
      }
      
      // Smaller delay for hourly sync
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    console.error('Hourly sync failed:', error);
  }
};

// Manual sync endpoint for testing
app.post('/api/admin/sync-all', async (req: Request, res: Response) => {
  // Add basic auth or API key check here in production
  const { adminKey } = req.body;
  
  if (adminKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('Manual sync triggered via admin endpoint');
    runBackgroundSync(); // Don't await - let it run in background
    
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

    // Setup background sync scheduler
    if (process.env.NODE_ENV !== 'test') {
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

startServer();