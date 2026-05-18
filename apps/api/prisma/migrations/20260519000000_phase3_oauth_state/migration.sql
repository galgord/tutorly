-- CreateTable
CREATE TABLE "OAuthState" (
    "state" TEXT NOT NULL,
    "tutorId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'google',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("state")
);

-- CreateIndex
CREATE INDEX "OAuthState_tutorId_idx" ON "OAuthState"("tutorId");

-- CreateIndex
CREATE INDEX "OAuthState_expiresAt_idx" ON "OAuthState"("expiresAt");
