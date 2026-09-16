-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "DataProvider" AS ENUM ('PLUGGY');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('PENDING', 'CONNECTED', 'SYNCING', 'STALE', 'ERROR', 'REAUTH_REQUIRED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('CHECKING', 'SAVINGS', 'CREDIT_CARD', 'INVESTMENT', 'LOAN', 'OTHER');

-- CreateEnum
CREATE TYPE "TransactionDirection" AS ENUM ('INFLOW', 'OUTFLOW');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "CreditCardBillStatus" AS ENUM ('OPEN', 'CLOSED', 'PAID', 'OVERDUE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DataQuality" AS ENUM ('COMPLETE', 'PARTIAL', 'STALE', 'ESTIMATED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "DataAvailability" AS ENUM ('AVAILABLE', 'UNAVAILABLE', 'ESTIMATED', 'STALE', 'INSUFFICIENT_HISTORY');

-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "DataProvenance" AS ENUM ('OBSERVED', 'ESTIMATED', 'USER_DECLARED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "locale" TEXT NOT NULL DEFAULT 'pt-BR',
    "baseCurrency" TEXT NOT NULL DEFAULT 'BRL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "deviceName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Connection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "DataProvider" NOT NULL DEFAULT 'PLUGGY',
    "providerItemId" TEXT NOT NULL,
    "institution" TEXT,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "lastSyncedAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" "DataProvider" NOT NULL DEFAULT 'PLUGGY',
    "providerAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AccountKind" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "currentBalance" DECIMAL(18,2),
    "availableBalance" DECIMAL(18,2),
    "creditLimit" DECIMAL(18,2),
    "lastProviderSyncAt" TIMESTAMP(3),
    "transactionCursor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "provider" "DataProvider" NOT NULL DEFAULT 'PLUGGY',
    "providerTransactionId" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "merchantRaw" TEXT,
    "merchantNormalized" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "direction" "TransactionDirection" NOT NULL,
    "providerCategoryId" TEXT,
    "userCategoryId" TEXT,
    "status" TEXT,
    "billId" TEXT,
    "installmentNumber" INTEGER,
    "installmentTotal" INTEGER,
    "isTransfer" BOOLEAN NOT NULL DEFAULT false,
    "isRecurringCandidate" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "rawFingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditCardBill" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "provider" "DataProvider" NOT NULL DEFAULT 'PLUGGY',
    "providerBillId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "closingDate" TIMESTAMP(3),
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "minimumPayment" DECIMAL(18,2),
    "status" "CreditCardBillStatus" NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditCardBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Investment" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" "DataProvider" NOT NULL DEFAULT 'PLUGGY',
    "providerInvestmentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Investment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestmentSnapshot" (
    "id" TEXT NOT NULL,
    "investmentId" TEXT NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL,
    "balance" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvestmentSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "provider" "DataProvider" NOT NULL DEFAULT 'PLUGGY',
    "providerLoanId" TEXT NOT NULL,
    "name" TEXT,
    "principal" DECIMAL(18,2),
    "outstandingBalance" DECIMAL(18,2),
    "installment" DECIMAL(18,2),
    "interestRate" DECIMAL(12,6),
    "nextDueDate" TIMESTAMP(3),
    "remainingInstallments" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountBalanceSnapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL,
    "currentBalance" DECIMAL(18,2),
    "availableBalance" DECIMAL(18,2),
    "creditLimit" DECIMAL(18,2),

    CONSTRAINT "AccountBalanceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "categoryId" TEXT NOT NULL,
    "limit" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetAmount" DECIMAL(18,2) NOT NULL,
    "currentAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "targetDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualFact" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" DECIMAL(18,2),
    "textValue" TEXT,
    "provenance" "DataProvenance" NOT NULL DEFAULT 'USER_DECLARED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManualFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" "DataProvider" NOT NULL DEFAULT 'PLUGGY',
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "itemId" TEXT,
    "clientUserId" TEXT,
    "resourceId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "payloadHash" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "status" "SyncRunStatus" NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "accountsProcessed" INTEGER NOT NULL DEFAULT 0,
    "transactionsProcessed" INTEGER NOT NULL DEFAULT 0,
    "billsProcessed" INTEGER NOT NULL DEFAULT 0,
    "investmentsProcessed" INTEGER NOT NULL DEFAULT 0,
    "loansProcessed" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "triggerEventId" TEXT,
    "triggerEventType" TEXT,
    "resourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL,
    "liquidAssets" DECIMAL(18,2) NOT NULL,
    "investedAssets" DECIMAL(18,2) NOT NULL,
    "liabilities" DECIMAL(18,2) NOT NULL,
    "netWorth" DECIMAL(18,2) NOT NULL,
    "monthlyIncome" DECIMAL(18,2),
    "monthlyExpenses" DECIMAL(18,2),
    "dataQuality" "DataQuality" NOT NULL DEFAULT 'PARTIAL',

    CONSTRAINT "FinancialSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialHealthAssessment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score" INTEGER,
    "coverage" DECIMAL(5,4) NOT NULL,
    "confidence" "Confidence" NOT NULL,
    "status" "DataAvailability" NOT NULL,
    "version" TEXT NOT NULL,
    "components" JSONB NOT NULL,

    CONSTRAINT "FinancialHealthAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Connection_userId_idx" ON "Connection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Connection_provider_providerItemId_key" ON "Connection"("provider", "providerItemId");

-- CreateIndex
CREATE INDEX "Account_connectionId_idx" ON "Account"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_connectionId_provider_providerAccountId_key" ON "Account"("connectionId", "provider", "providerAccountId");

-- CreateIndex
CREATE INDEX "Transaction_accountId_postedAt_idx" ON "Transaction"("accountId", "postedAt");

-- CreateIndex
CREATE INDEX "Transaction_postedAt_idx" ON "Transaction"("postedAt");

-- CreateIndex
CREATE INDEX "Transaction_userCategoryId_idx" ON "Transaction"("userCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_accountId_provider_providerTransactionId_key" ON "Transaction"("accountId", "provider", "providerTransactionId");

-- CreateIndex
CREATE INDEX "CreditCardBill_accountId_dueDate_idx" ON "CreditCardBill"("accountId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "CreditCardBill_accountId_provider_providerBillId_key" ON "CreditCardBill"("accountId", "provider", "providerBillId");

-- CreateIndex
CREATE INDEX "Investment_connectionId_idx" ON "Investment"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "Investment_connectionId_provider_providerInvestmentId_key" ON "Investment"("connectionId", "provider", "providerInvestmentId");

-- CreateIndex
CREATE INDEX "InvestmentSnapshot_investmentId_snapshotAt_idx" ON "InvestmentSnapshot"("investmentId", "snapshotAt");

-- CreateIndex
CREATE UNIQUE INDEX "InvestmentSnapshot_investmentId_snapshotAt_key" ON "InvestmentSnapshot"("investmentId", "snapshotAt");

-- CreateIndex
CREATE INDEX "Loan_connectionId_idx" ON "Loan"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "Loan_connectionId_provider_providerLoanId_key" ON "Loan"("connectionId", "provider", "providerLoanId");

-- CreateIndex
CREATE INDEX "AccountBalanceSnapshot_accountId_snapshotAt_idx" ON "AccountBalanceSnapshot"("accountId", "snapshotAt");

-- CreateIndex
CREATE UNIQUE INDEX "AccountBalanceSnapshot_accountId_snapshotAt_key" ON "AccountBalanceSnapshot"("accountId", "snapshotAt");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_userId_month_categoryId_key" ON "Budget"("userId", "month", "categoryId");

-- CreateIndex
CREATE INDEX "Category_parentId_idx" ON "Category"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_userId_name_key" ON "Category"("userId", "name");

-- CreateIndex
CREATE INDEX "CategoryRule_userId_enabled_priority_idx" ON "CategoryRule"("userId", "enabled", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "ManualFact_userId_key_key" ON "ManualFact"("userId", "key");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_receivedAt_idx" ON "WebhookEvent"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_eventId_key" ON "WebhookEvent"("provider", "eventId");

-- CreateIndex
CREATE INDEX "SyncRun_status_createdAt_idx" ON "SyncRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SyncRun_connectionId_status_idx" ON "SyncRun"("connectionId", "status");

-- CreateIndex
CREATE INDEX "FinancialSnapshot_userId_snapshotAt_idx" ON "FinancialSnapshot"("userId", "snapshotAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialSnapshot_userId_snapshotAt_key" ON "FinancialSnapshot"("userId", "snapshotAt");

-- CreateIndex
CREATE INDEX "FinancialHealthAssessment_userId_calculatedAt_idx" ON "FinancialHealthAssessment"("userId", "calculatedAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Connection" ADD CONSTRAINT "Connection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_billId_fkey" FOREIGN KEY ("billId") REFERENCES "CreditCardBill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditCardBill" ADD CONSTRAINT "CreditCardBill_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investment" ADD CONSTRAINT "Investment_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentSnapshot" ADD CONSTRAINT "InvestmentSnapshot_investmentId_fkey" FOREIGN KEY ("investmentId") REFERENCES "Investment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountBalanceSnapshot" ADD CONSTRAINT "AccountBalanceSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryRule" ADD CONSTRAINT "CategoryRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryRule" ADD CONSTRAINT "CategoryRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualFact" ADD CONSTRAINT "ManualFact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialSnapshot" ADD CONSTRAINT "FinancialSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialHealthAssessment" ADD CONSTRAINT "FinancialHealthAssessment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
