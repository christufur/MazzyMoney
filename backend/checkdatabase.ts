// scripts/checkDatabase.ts
// Quick script to check your database state

import { PrismaClient } from './prisma/generated/prisma';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function checkDatabase() {
  console.log('🔍 Checking database state...\n');

  try {
    // 1. Check users with Plaid connections
    const usersWithPlaid = await prisma.user.findMany({
      where: {
        plaidItemId: { not: null }
      },
      select: {
        id: true,
        email: true,
        plaidItemId: true,
        plaidInstitutionName: true,
        syncStatus: true,
        lastSyncAt: true,
        _count: {
          select: {
            accounts: true,
            transactions: true
          }
        }
      }
    });

    console.log(`👥 Users with Plaid connections: ${usersWithPlaid.length}\n`);

    for (const user of usersWithPlaid) {
      console.log(`📧 ${user.email}`);
      console.log(`   ID: ${user.id}`);
      console.log(`   Plaid Item: ${user.plaidItemId}`);
      console.log(`   Institution: ${user.plaidInstitutionName || 'Not set'}`);
      console.log(`   Sync Status: ${user.syncStatus}`);
      console.log(`   Last Sync: ${user.lastSyncAt ? user.lastSyncAt.toISOString() : 'Never'}`);
      console.log(`   Accounts: ${user._count.accounts}`);
      console.log(`   Transactions: ${user._count.transactions}`);
      console.log('   ---');
    }

    // 2. Check all accounts
    const allAccounts = await prisma.account.findMany({
      include: {
        user: {
          select: {
            email: true
          }
        }
      }
    });

    console.log(`\n🏦 Total accounts in database: ${allAccounts.length}\n`);

    for (const account of allAccounts) {
      console.log(`   ${account.name} (${account.type})`);
      console.log(`   User: ${account.user.email}`);
      console.log(`   Plaid ID: ${account.plaidAccountId}`);
      console.log(`   Balance: $${account.currentBalance}`);
      console.log(`   Active: ${account.isActive}`);
      console.log('   ---');
    }

    // 3. Check total transactions
    const transactionCount = await prisma.transaction.count();
    console.log(`\n💳 Total transactions: ${transactionCount}`);

    // 4. Check for any user with your specific plaid item ID
    const yourUser = await prisma.user.findFirst({
      where: {
        plaidItemId: "pqj9xga9neIzBa4v8Bn6SqakL6E4RpiLE9b5P" // Your item ID from debug
      },
      include: {
        accounts: true,
        transactions: {
          take: 5,
          orderBy: { date: 'desc' }
        }
      }
    });

    if (yourUser) {
      console.log(`\n🎯 Found your user: ${yourUser.email}`);
      console.log(`   Accounts in DB: ${yourUser.accounts.length}`);
      console.log(`   Recent transactions: ${yourUser.transactions.length}`);
      
      if (yourUser.accounts.length > 0) {
        console.log('\n   Account details:');
        yourUser.accounts.forEach(acc => {
          console.log(`   - ${acc.name}: $${acc.currentBalance} (${acc.type})`);
        });
      } else {
        console.log('\n   ❌ No accounts found in database for this user!');
        console.log('   This is why your accounts page shows 0 accounts.');
      }
    }

    console.log('\n✅ Database check complete!');

  } catch (error) {
    console.error('❌ Database check failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

checkDatabase().catch(console.error);

// To run this:
// 1. Save as scripts/checkDatabase.ts
// 2. Add to package.json: "check-db": "npx ts-node scripts/checkDatabase.ts"
// 3. Run: npm run check-db