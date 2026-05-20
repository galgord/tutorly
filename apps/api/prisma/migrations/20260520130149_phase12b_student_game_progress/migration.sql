-- CreateTable
CREATE TABLE "StudentGameProgress" (
    "studentId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "currentLevel" INTEGER NOT NULL DEFAULT 1,
    "playsCompleted" INTEGER NOT NULL DEFAULT 0,
    "nudgeCounter" INTEGER NOT NULL DEFAULT 0,
    "seenQuestionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastAccuracy" DOUBLE PRECISION,
    "lastLevelDelta" INTEGER NOT NULL DEFAULT 0,
    "lastPlayedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentGameProgress_pkey" PRIMARY KEY ("studentId","gameId")
);

-- CreateIndex
CREATE INDEX "StudentGameProgress_gameId_idx" ON "StudentGameProgress"("gameId");

-- AddForeignKey
ALTER TABLE "StudentGameProgress" ADD CONSTRAINT "StudentGameProgress_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentGameProgress" ADD CONSTRAINT "StudentGameProgress_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
