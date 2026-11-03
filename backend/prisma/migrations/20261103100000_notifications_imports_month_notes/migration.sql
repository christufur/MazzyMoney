-- AlterTable
ALTER TABLE "recurring_series" ADD COLUMN     "amountChangedAt" TIMESTAMP(3),
ADD COLUMN     "previousAmount" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "importHash" TEXT,
ALTER COLUMN "plaidTransactionId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "notifyLargeOver" DOUBLE PRECISION,
ADD COLUMN     "notifyWeekly" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "ntfyTopic" TEXT;

-- CreateTable
CREATE TABLE "month_notes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "note" TEXT,
    "savingsTarget" DOUBLE PRECISION,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "month_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "month_notes_userId_month_key" ON "month_notes"("userId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "notification_logs_userId_kind_key_key" ON "notification_logs"("userId", "kind", "key");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_accountId_importHash_key" ON "transactions"("accountId", "importHash");

-- AddForeignKey
ALTER TABLE "month_notes" ADD CONSTRAINT "month_notes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

