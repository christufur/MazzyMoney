-- CreateEnum
CREATE TYPE "public"."AlertType" AS ENUM ('SPENDING_THRESHOLD', 'BUDGET_EXCEEDED', 'BUDGET_APPROACHING');

-- CreateTable
CREATE TABLE "public"."budget_alerts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "thresholdPercent" DOUBLE PRECISION NOT NULL,
    "alertType" "public"."AlertType" NOT NULL DEFAULT 'SPENDING_THRESHOLD',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."budget_alert_notifications" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "budgetName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "thresholdPercent" DOUBLE PRECISION NOT NULL,
    "currentPercent" DOUBLE PRECISION NOT NULL,
    "spent" DOUBLE PRECISION NOT NULL,
    "budgetAmount" DOUBLE PRECISION NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emailSent" BOOLEAN NOT NULL DEFAULT false,
    "emailSentAt" TIMESTAMP(3),

    CONSTRAINT "budget_alert_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "budget_alerts_userId_budgetId_alertType_key" ON "public"."budget_alerts"("userId", "budgetId", "alertType");

-- AddForeignKey
ALTER TABLE "public"."budget_alerts" ADD CONSTRAINT "budget_alerts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."budget_alerts" ADD CONSTRAINT "budget_alerts_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "public"."budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."budget_alert_notifications" ADD CONSTRAINT "budget_alert_notifications_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "public"."budget_alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."budget_alert_notifications" ADD CONSTRAINT "budget_alert_notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
