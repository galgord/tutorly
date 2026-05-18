import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { HealthController } from './health/health.controller';
import { GamesModule } from './games/games.module';
import { GoogleIntegrationModule } from './integrations/google/google-integration.module';
import { LessonsModule } from './lessons/lessons.module';
import { QuotaModule } from './quota/quota.module';
import { MailerModule } from './mailer/mailer.module';
import { MeModule } from './me/me.module';
import { RequestIdMiddleware } from './middleware/request-id.middleware';
import { PrismaModule } from './prisma/prisma.module';
import { StudentsModule } from './students/students.module';
import { VoiceModule } from './voice/voice.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuditModule,
    MailerModule,
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true, sync: true } },
        redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body.email'],
        customProps: (req) => ({ requestId: (req as { requestId?: string }).requestId }),
      },
    }),
    ThrottlerModule.forRoot([
      // Coarse per-IP safety net. The real auth-abuse protection is the
      // Postgres-backed per-email limit in MagicLinkService (3/min/email).
      // Bumped for parallel E2E runs from a single CI runner IP.
      {
        name: 'global',
        ttl: 60_000,
        limit: process.env.NODE_ENV === 'test' ? 1000 : 300,
      },
    ]),
    ScheduleModule.forRoot(),
    AuthModule,
    MeModule,
    StudentsModule,
    GoogleIntegrationModule,
    LessonsModule,
    GamesModule,
    VoiceModule,
    QuotaModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
