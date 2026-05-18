import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GamesModule } from '../games/games.module';
import { AdminController } from './admin.controller';
import { QuotaService } from './quota.service';
import { TestQuotaController } from './test-quota.controller';

const testControllers = process.env.NODE_ENV === 'production' ? [] : [TestQuotaController];

/**
 * QuotaService is `@Global` so the GamesService can inject it without
 * creating a module-import cycle (QuotaModule imports GamesModule for the
 * AdminController's queue snapshot; if GamesModule also imported QuotaModule
 * we'd have a circular import).
 */
@Global()
@Module({
  imports: [AuthModule, GamesModule],
  controllers: [AdminController, ...testControllers],
  providers: [QuotaService],
  exports: [QuotaService],
})
export class QuotaModule {}
