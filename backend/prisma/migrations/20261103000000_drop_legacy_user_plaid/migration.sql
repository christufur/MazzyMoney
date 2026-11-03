-- DropForeignKey
ALTER TABLE "UserCategoryRule" DROP CONSTRAINT "UserCategoryRule_userId_fkey";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "lastSyncAt",
DROP COLUMN "plaidAccessToken",
DROP COLUMN "plaidInstitutionId",
DROP COLUMN "plaidInstitutionName",
DROP COLUMN "plaidItemId",
DROP COLUMN "syncStatus";

-- DropTable
DROP TABLE "UserCategoryRule";

-- DropEnum
DROP TYPE "SyncStatus";

