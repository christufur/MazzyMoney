import { prisma } from '../lib/prisma';
import { EmailService } from './emailService';
import { AlertType, Budget } from '../../prisma/generated/prisma';
import { COUNTED, cents } from './analyticsService';

export interface BudgetSpendingSnapshot {
  spent: number;
  remaining: number;
  percentUsed: number;
}

interface AlertContext {
  budget: Budget;
  snapshot: BudgetSpendingSnapshot;
  alertType: AlertType;
  thresholdPercent: number;
}

const DEFAULT_ALERTS: Array<{ alertType: AlertType; thresholdPercent: number }> = [
  { alertType: 'BUDGET_APPROACHING', thresholdPercent: 80 },
  { alertType: 'BUDGET_EXCEEDED', thresholdPercent: 100 }
];

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD'
});

export class BudgetAlertService {
  /**
   * Ensure default alerts exist for the given budget.
   */
  static async ensureDefaultAlerts(budget: Budget): Promise<void> {
    const existing = await prisma.budgetAlert.findMany({
      where: { budgetId: budget.id }
    });

    const operations = DEFAULT_ALERTS.filter(defaultAlert =>
      !existing.find(alert => alert.alertType === defaultAlert.alertType)
    ).map(alert =>
      prisma.budgetAlert.create({
        data: {
          userId: budget.userId,
          budgetId: budget.id,
          alertType: alert.alertType,
          thresholdPercent: alert.thresholdPercent
        }
      })
    );

    if (operations.length > 0) {
      await Promise.all(operations);
    }
  }

  /**
   * Evaluate all alerts for a given budget snapshot and send notifications when needed.
   */
  static async evaluateBudgetAlerts(
    budget: Budget,
    snapshot: BudgetSpendingSnapshot,
    opts: { userEmail?: string } = {}
  ): Promise<void> {
    await this.ensureDefaultAlerts(budget);

    const alerts = await prisma.budgetAlert.findMany({
      where: {
        budgetId: budget.id,
        isEnabled: true
      }
    });

    if (alerts.length === 0) {
      return;
    }

    const userEmail = opts.userEmail ?? await this.getUserEmail(budget.userId);

    for (const alert of alerts) {
      if (!this.shouldTriggerAlert({
        budget,
        snapshot,
        alertType: alert.alertType,
        thresholdPercent: alert.thresholdPercent
      })) {
        continue;
      }

      const notificationAlreadySent = await prisma.budgetAlertNotification.findFirst({
        where: {
          alertId: alert.id,
          sentAt: {
            gte: budget.startDate,
            ...(budget.endDate ? { lte: budget.endDate } : {})
          }
        }
      });

      if (notificationAlreadySent) {
        continue;
      }

      const notification = await prisma.budgetAlertNotification.create({
        data: {
          alertId: alert.id,
          userId: budget.userId,
          budgetName: budget.name,
          category: budget.category,
          thresholdPercent: alert.thresholdPercent,
          currentPercent: snapshot.percentUsed,
          spent: snapshot.spent,
          budgetAmount: budget.amount
        }
      });

      if (alert.emailEnabled && userEmail) {
        const sent = await EmailService.sendBudgetAlertEmail({
          to: userEmail,
          subject: this.buildEmailSubject(alert.alertType, budget.name),
          text: this.buildEmailBody({
            budget,
            snapshot,
            alertType: alert.alertType,
            thresholdPercent: alert.thresholdPercent
          }),
          html: this.buildEmailHtml({
            budget,
            snapshot,
            alertType: alert.alertType,
            thresholdPercent: alert.thresholdPercent
          })
        });

        if (sent) {
          await prisma.budgetAlertNotification.update({
            where: { id: notification.id },
            data: {
              emailSent: true,
              emailSentAt: new Date()
            }
          });
        }
      }
    }
  }

  static async evaluateUserBudgets(userId: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true }
    });

    if (!user) {
      return;
    }

    const budgets = await prisma.budget.findMany({
      where: {
        userId,
        isActive: true
      }
    });

    for (const budget of budgets) {
      const now = new Date();
      const effectiveEndDate = budget.endDate || now;

      let snapshot: BudgetSpendingSnapshot;

      if (now < budget.startDate || now > effectiveEndDate) {
        snapshot = {
          spent: 0,
          remaining: cents(budget.amount),
          percentUsed: 0
        };
      } else {
        const categorySpending = await prisma.transaction.aggregate({
          where: {
            userId: budget.userId,
            ...COUNTED,
            primaryCategory: budget.category,
            amount: { gt: 0 },
            date: {
              gte: budget.startDate,
              lte: effectiveEndDate
            }
          },
          _sum: { amount: true }
        });

        const spent = cents(categorySpending._sum.amount || 0);
        const remaining = cents(budget.amount - spent);
        const percentUsed = budget.amount > 0 ? (spent / budget.amount) * 100 : 0;

        snapshot = { spent, remaining, percentUsed };
      }

      await this.evaluateBudgetAlerts(budget, snapshot, { userEmail: user.email });
    }
  }

  private static shouldTriggerAlert(context: AlertContext): boolean {
    const { snapshot, alertType, thresholdPercent } = context;

    switch (alertType) {
      case 'BUDGET_EXCEEDED':
        return snapshot.percentUsed >= Math.min(100, thresholdPercent || 100);
      case 'BUDGET_APPROACHING':
      case 'SPENDING_THRESHOLD':
      default:
        return snapshot.percentUsed >= thresholdPercent;
    }
  }

  private static buildEmailSubject(alertType: AlertType, budgetName: string): string {
    const label = this.describeAlert(alertType);
    return `Budget Alert: ${budgetName} ${label}`;
  }

  private static buildEmailBody(context: AlertContext): string {
    const { budget, snapshot, thresholdPercent } = context;
    return [
      `Budget: ${budget.name} (${budget.category})`,
      `Threshold: ${thresholdPercent.toFixed(1)}%`,
      `Current usage: ${snapshot.percentUsed.toFixed(1)}%`,
      `Spent: ${currencyFormatter.format(snapshot.spent)} of ${currencyFormatter.format(budget.amount)}`,
      '',
      'Log in to your Money dashboard to review recent transactions and adjust your spending plan if needed.'
    ].join('\n');
  }

  private static buildEmailHtml(context: AlertContext): string {
    const { budget, snapshot, thresholdPercent } = context;
    return `
      <h2>Budget Alert: ${budget.name}</h2>
      <p>Your ${budget.category} budget has reached <strong>${snapshot.percentUsed.toFixed(1)}%</strong> of the allocated amount.</p>
      <ul>
        <li><strong>Threshold:</strong> ${thresholdPercent.toFixed(1)}%</li>
        <li><strong>Spent:</strong> ${currencyFormatter.format(snapshot.spent)} of ${currencyFormatter.format(budget.amount)}</li>
        <li><strong>Remaining:</strong> ${currencyFormatter.format(snapshot.remaining)}</li>
      </ul>
      <p>Visit your Money dashboard to review recent transactions and adjust your plan.</p>
    `;
  }

  private static describeAlert(alertType: AlertType): string {
    switch (alertType) {
      case 'BUDGET_EXCEEDED':
        return 'exceeded';
      case 'BUDGET_APPROACHING':
        return 'nearing limit';
      case 'SPENDING_THRESHOLD':
      default:
        return 'threshold reached';
    }
  }

  private static async getUserEmail(userId: string): Promise<string | undefined> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true }
    });

    return user?.email;
  }
}

