import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { CsrfGuard } from './csrf.guard';
import { MagicLinkService } from './magic-link.service';
import { SessionService } from './session.service';

@Module({
  controllers: [AuthController],
  providers: [MagicLinkService, SessionService, AuthGuard, CsrfGuard],
  exports: [MagicLinkService, SessionService, AuthGuard, CsrfGuard],
})
export class AuthModule {}
