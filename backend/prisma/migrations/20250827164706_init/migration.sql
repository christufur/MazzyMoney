-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "plaidAccessToken" TEXT,
    "plaidItemId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PlaidAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mask" TEXT,
    "type" TEXT NOT NULL,
    "subtype" TEXT,
    "officialName" TEXT,
    "balances" JSONB NOT NULL,

    CONSTRAINT "PlaidAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Transaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plaidAccountId" TEXT NOT NULL,
    "plaidTransactionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "category" TEXT,
    "pending" BOOLEAN NOT NULL,
    "rawData" JSONB NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_plaidItemId_key" ON "public"."User"("plaidItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_plaidTransactionId_key" ON "public"."Transaction"("plaidTransactionId");

-- AddForeignKey
ALTER TABLE "public"."PlaidAccount" ADD CONSTRAINT "PlaidAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Transaction" ADD CONSTRAINT "Transaction_plaidAccountId_fkey" FOREIGN KEY ("plaidAccountId") REFERENCES "public"."PlaidAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Fixed index creation to match table/column names in this migration
CREATE INDEX IF NOT EXISTS "idx_Transaction_user_date" ON "public"."Transaction"("userId", "date" DESC);

CREATE INDEX IF NOT EXISTS "idx_Transaction_account_date" ON "public"."Transaction"("plaidAccountId", "date" DESC);

CREATE INDEX IF NOT EXISTS "idx_Transaction_category" ON "public"."Transaction"("category");

CREATE INDEX IF NOT EXISTS "idx_PlaidAccount_user" ON "public"."PlaidAccount"("userId");

CREATE INDEX IF NOT EXISTS "idx_User_plaid_item" ON "public"."User"("plaidItemId");