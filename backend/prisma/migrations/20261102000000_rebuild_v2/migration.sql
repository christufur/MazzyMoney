-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('ACTIVE', 'SYNCING', 'LOGIN_REQUIRED', 'ERROR');

-- CreateEnum
CREATE TYPE "CategorySource" AS ENUM ('PLAID', 'RULE', 'USER');

-- CreateEnum
CREATE TYPE "RecurringStatus" AS ENUM ('ACTIVE', 'IGNORED');

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "isLiability" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isManual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "plaidItemId" TEXT,
ALTER COLUMN "plaidAccountId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "budgets" ADD COLUMN     "rollover" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "categorySource" "CategorySource" NOT NULL DEFAULT 'PLAID',
ADD COLUMN     "hidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isTransfer" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "merchantDisplay" TEXT,
ADD COLUMN     "pendingTransactionId" TEXT,
ADD COLUMN     "pfcDetailed" TEXT,
ADD COLUMN     "pfcPrimary" TEXT,
ADD COLUMN     "reviewed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "plaid_items" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "institutionName" TEXT NOT NULL,
    "cursor" TEXT,
    "status" "ItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plaid_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balance_snapshots" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "balance_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "matchMerchant" TEXT,
    "matchAmountMin" DOUBLE PRECISION,
    "matchAmountMax" DOUBLE PRECISION,
    "matchAccountId" TEXT,
    "setCategory" TEXT,
    "setMerchant" TEXT,
    "setTransfer" BOOLEAN,
    "setHidden" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_series" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "merchantKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "averageAmount" DOUBLE PRECISION NOT NULL,
    "intervalDays" INTEGER NOT NULL,
    "lastDate" DATE NOT NULL,
    "nextDate" DATE NOT NULL,
    "status" "RecurringStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_series_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plaid_items_itemId_key" ON "plaid_items"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "plaid_items_userId_institutionId_key" ON "plaid_items"("userId", "institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "balance_snapshots_accountId_date_key" ON "balance_snapshots"("accountId", "date");

-- CreateIndex
CREATE INDEX "rules_userId_priority_idx" ON "rules"("userId", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_series_userId_merchantKey_key" ON "recurring_series"("userId", "merchantKey");

-- CreateIndex
CREATE INDEX "transactions_userId_reviewed_idx" ON "transactions"("userId", "reviewed");

-- AddForeignKey
ALTER TABLE "plaid_items" ADD CONSTRAINT "plaid_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_plaidItemId_fkey" FOREIGN KEY ("plaidItemId") REFERENCES "plaid_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_snapshots" ADD CONSTRAINT "balance_snapshots_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_series" ADD CONSTRAINT "recurring_series_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Data: move each user's single Plaid connection into plaid_items and link their accounts.
INSERT INTO "plaid_items" ("id", "userId", "accessToken", "itemId", "institutionId", "institutionName", "status", "lastSyncAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, u."id", u."plaidAccessToken", u."plaidItemId",
       COALESCE(u."plaidInstitutionId", 'unknown'), COALESCE(u."plaidInstitutionName", 'Connected Bank'),
       CASE WHEN u."syncStatus" = 'TOKEN_EXPIRED' THEN 'LOGIN_REQUIRED'::"ItemStatus" ELSE 'ACTIVE'::"ItemStatus" END,
       u."lastSyncAt", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "users" u
WHERE u."plaidAccessToken" IS NOT NULL AND u."plaidItemId" IS NOT NULL;

UPDATE "accounts" a SET "plaidItemId" = p."id"
FROM "plaid_items" p
WHERE p."userId" = a."userId" AND a."plaidAccountId" IS NOT NULL;

UPDATE "accounts" SET "isLiability" = true WHERE "type" IN ('credit', 'loan');
