import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LlmModule } from '../integrations/anthropic/llm.module';
import { DifficultyBackfillService } from './difficulty-backfill.service';
import { GameGenerationQueue } from './game-generation.queue';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';

@Module({
  imports: [AuthModule, LlmModule],
  controllers: [GamesController],
  providers: [GamesService, GameGenerationQueue, DifficultyBackfillService],
  exports: [GamesService, GameGenerationQueue],
})
export class GamesModule {}
