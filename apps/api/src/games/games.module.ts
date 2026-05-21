import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LlmModule } from '../integrations/anthropic/llm.module';
import { StudentsModule } from '../students/students.module';
import { BankTopupService } from './bank-topup.service';
import { DifficultyBackfillService } from './difficulty-backfill.service';
import { GameGenerationQueue } from './game-generation.queue';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';

@Module({
  imports: [AuthModule, LlmModule, StudentsModule],
  controllers: [GamesController],
  providers: [GamesService, GameGenerationQueue, DifficultyBackfillService, BankTopupService],
  exports: [GamesService, GameGenerationQueue, BankTopupService],
})
export class GamesModule {}
