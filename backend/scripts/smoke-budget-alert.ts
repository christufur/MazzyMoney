import path from 'path';
import { config as loadEnv } from 'dotenv';
import bcrypt from 'bcryptjs';

import { prisma } from '../src/lib/prisma';
import { BudgetAlertService } from '../src/services/budgetAlertService';

// Load environment variables (defaults to backend/.env)
loadEnv({
  path: process.env.DOTENV_CONFIG_PATH || path.resolve(__dirname, '../.env')
});

async function main() {
  const recipient = process.env.TEST_EMAIL_TO || process.env.ALERT_TEST_EMAIL;

  if (!recipient) {
    throw new Error(
      'Please set TEST_EMAIL_TO (or ALERT_TEST_EMAIL) in your environment so the alert knows where to send.'
    );
  }

  console.log('Using alert recipient:', recipient);

  const now = new Date();
  const startDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const endDate = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
  const slug = `smtp-smoke-${Date.now()}`;

  const user = await prisma.user.upsert({
    where: { email: recipient },
    update: {},
    create: {
      email: recipient,
      fullName: 'SMTP Smoke Test User',
      passwordHash: await bcrypt.hash('SuperSecure!42', 10)
    }
  });

  const account = await prisma.account.upsert({
    where: { plaidAccountId: slug },
    update: {},
    create: {
      plaidAccountId: slug,
      userId: user.id,
      name: 'SMTP Smoke Checking',
      type: 'checking',
      subtype: 'checking',
      mask: '0000'
    }
  });

  const budget = await prisma.budget.create({
    data: {
      userId: user.id,
      name: `SMTP Smoke Budget ${new Date().toISOString().slice(0, 10)}`,
      category: 'Dining',
      amount: 100,
      period: 'MONTHLY',
      startDate,
      endDate,
      isActive: true
    }
  });

  await BudgetAlertService.ensureDefaultAlerts(budget);

  const alert = await prisma.budgetAlert.upsert({
    where: {
      userId_budgetId_alertType: {
        userId: user.id,
        budgetId: budget.id,
        alertType: 'BUDGET_APPROACHING'
      }
    },
    update: {
      thresholdPercent: 1,
      isEnabled: true,
      emailEnabled: true
    },
    create: {
      userId: user.id,
      budgetId: budget.id,
      alertType: 'BUDGET_APPROACHING',
      thresholdPercent: 1,
      isEnabled: true,
      emailEnabled: true
    }
  });

  // Create a transaction that blows past the 1% threshold (50% of budget)
  await prisma.transaction.create({
    data: {
      plaidTransactionId: `${slug}-tx`,
      userId: user.id,
      accountId: account.id,
      name: 'Test Restaurant Charge',
      merchantName: 'Budget Alert Bistro',
      amount: 50,
      date: now,
      authorizedDate: now,
      primaryCategory: budget.category,
      detailedCategory: 'Dining',
      categories: ['Food & Dining', 'Restaurants']
    }
  });

  console.log('Created user, budget, alert, and transaction. Evaluating alerts…');

  await BudgetAlertService.evaluateUserBudgets(user.id);

  const notification = await prisma.budgetAlertNotification.findFirst({
    where: {
      alertId: alert.id
    },
    orderBy: { sentAt: 'desc' }
  });

  if (!notification) {
    console.log('No notification record found. Check budget thresholds/spending.');
  } else {
    console.log('Notification stored:', {
      thresholdPercent: notification.thresholdPercent,
      currentPercent: notification.currentPercent,
      emailSent: notification.emailSent,
      emailSentAt: notification.emailSentAt
    });
  }

  console.log('If emailSent is true, check your inbox for the alert.');
}

main()
  .catch((error) => {
    console.error('Budget alert smoke test failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

