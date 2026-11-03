import { prisma } from '../lib/prisma';
import { EmailService } from './emailService';
import { NotifyService, notificationMoney } from './notifyService';
import { AlertType, Budget } from '../../prisma/generated/prisma';
import { cents } from './analyticsService';

/**
 * What a budget looks like in the month being checked. `budgetForMonth` returns
 * more than this; the alerts only need these fields.
 */
export interface BudgetSpendingSnapshot {
  spent: number;
  remaining: number;
  percentUsed: number;
  /** `YYYY-MM`. Defaults to the current UTC month when missing. */
  month?: string;
  /** Monthly amount plus rollover. Defaults to `budget.amount` when missing. */
  available?: number;
  budgeted?: number;
  rolloverIn?: number;
}

interface AlertContext {
  budget: Budget;
  snapshot: BudgetSpendingSnapshot;
  alertType: AlertType;
  thresholdPercent: number;
  available: number;
}

const DEFAULT_ALERTS: Array<{ alertType: AlertType; thresholdPercent: number }> = [
  { alertType: 'BUDGET_APPROACHING', thresholdPercent: 80 },
  { alertType: 'BUDGET_EXCEEDED', thresholdPercent: 100 }
];

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD'
});

/** `YYYY-MM` for a date, read in UTC. */
const monthKey = (date: Date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

/** `[start, endExclusive)` as UTC dates for a `YYYY-MM` month. */
const monthRange = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number);
  return {
    start: new Date(Date.UTC(year, monthNumber - 1, 1)),
    endExclusive: new Date(Date.UTC(year, monthNumber, 1))
  };
};

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
   *
   * A budget repeats every month, so "already notified" means "already notified for
   * this budget, this alert, and this month" (matched on the notification's `sentAt`).
   */
  static async evaluateBudgetAlerts(
    budget: Budget,
    snapshot: BudgetSpendingSnapshot,
    opts: { userEmail?: string } = {}
  ): Promise<void> {
    await this.ensureDefaultAlerts(budget);

    const month = snapshot.month ?? monthKey(new Date());

    // Two phone pushes per month per budget, whatever the alert rows say: 90% (nearly
    // there) and 100% (over). `NotificationLog` holds the once-per-month claim.
    await this.pushThresholds(budget, snapshot, month);

    const alerts = await prisma.budgetAlert.findMany({
      where: {
        budgetId: budget.id,
        isEnabled: true
      }
    });

    if (alerts.length === 0) {
      return;
    }

    const { start, endExclusive } = monthRange(month);
    const available = cents(snapshot.available ?? budget.amount);
    const userEmail = opts.userEmail ?? await this.getUserEmail(budget.userId);

    for (const alert of alerts) {
      if (!this.shouldTriggerAlert({
        budget,
        snapshot,
        alertType: alert.alertType,
        thresholdPercent: alert.thresholdPercent,
        available
      })) {
        continue;
      }

      const notificationAlreadySent = await prisma.budgetAlertNotification.findFirst({
        where: {
          alertId: alert.id,
          sentAt: { gte: start, lt: endExclusive }
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
          budgetAmount: available
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
            thresholdPercent: alert.thresholdPercent,
            available
          }),
          html: this.buildEmailHtml({
            budget,
            snapshot,
            alertType: alert.alertType,
            thresholdPercent: alert.thresholdPercent,
            available
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

  /**
   * Push 90% and 100% in the current month, once each per budget.
   *
   * The email path below is driven by the `BudgetAlert` rows; the phone pushes are not,
   * because the household asked for these two thresholds regardless of how the alert
   * rows are configured. `NotificationLog` (unique on user + kind + key) is the record
   * that a month's push already went out.
   */
  private static async pushThresholds(
    budget: Budget,
    snapshot: BudgetSpendingSnapshot,
    month: string
  ): Promise<void> {
    if (month !== monthKey(new Date())) {
      return;
    }

    const available = cents(snapshot.available ?? budget.amount);
    const percent = snapshot.percentUsed;
    const key = `${budget.id}:${month}`;
    const remaining = cents(available - snapshot.spent);

    // One push per crossing: a budget that jumps straight past 100% gets the stronger
    // message, not both.
    if (percent >= 100) {
      await NotifyService.notify(budget.userId, {
        kind: 'budget-100',
        key,
        title: `${budget.category} is over budget`,
        message: `${budget.category} is over budget: ${notificationMoney(snapshot.spent)} spent of ${notificationMoney(available)}. Whatever is over rolls into next month.`,
        tags: ['warning'],
        priority: 4,
        click: '/budgets'
      });
      return;
    }

    if (percent >= 90) {
      await NotifyService.notify(budget.userId, {
        kind: 'budget-90',
        key,
        title: `${budget.category} is at ${Math.round(percent)}%`,
        message: `${budget.category} is at ${Math.round(percent)}%: ${notificationMoney(snapshot.spent)} spent of ${notificationMoney(available)}, ${notificationMoney(remaining)} left this month.`,
        tags: ['chart_with_upwards_trend'],
        priority: 3,
        click: '/budgets'
      });
    }
  }

  /**
   * Re-check every active budget of a user against the current month.
   *
   * `budgetSyncService` imports this module, so the calculator is loaded here
   * instead of at the top of the file to keep the import graph one-way.
   */
  static async evaluateUserBudgets(userId: string): Promise<void> {
    const { BudgetSyncService } = await import('./budgetSyncService');

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

    const month = BudgetSyncService.currentMonth();

    for (const budget of budgets) {
      const snapshot = await BudgetSyncService.budgetForMonth(budget, month);
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
    const { budget, snapshot, thresholdPercent, available } = context;
    return [
      `Budget: ${budget.name} (${budget.category})`,
      `Threshold: ${thresholdPercent.toFixed(1)}%`,
      `Current usage: ${snapshot.percentUsed.toFixed(1)}%`,
      `Spent: ${currencyFormatter.format(snapshot.spent)} of ${currencyFormatter.format(available)}`,
      '',
      'Log in to your Money dashboard to review recent transactions and adjust your spending plan if needed.'
    ].join('\n');
  }

  private static buildEmailHtml(context: AlertContext): string {
    const { budget, snapshot, thresholdPercent, available } = context;
    return `
      <h2>Budget Alert: ${budget.name}</h2>
      <p>Your ${budget.category} budget has reached <strong>${snapshot.percentUsed.toFixed(1)}%</strong> of the allocated amount.</p>
      <ul>
        <li><strong>Threshold:</strong> ${thresholdPercent.toFixed(1)}%</li>
        <li><strong>Spent:</strong> ${currencyFormatter.format(snapshot.spent)} of ${currencyFormatter.format(available)}</li>
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
