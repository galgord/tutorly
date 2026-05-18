import { Module, type Provider } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { ConfigService } from '../../config/config.service';
import { GOOGLE_CALENDAR_CLIENT } from './google-calendar.client';
import { FakeGoogleCalendarClient } from './google-calendar.fake';
import { RealGoogleCalendarClient } from './google-calendar.real';
import { GoogleIntegrationController } from './google-integration.controller';
import { GoogleIntegrationService } from './google-integration.service';
import { OAuthStateService } from './oauth-state.service';
import { TestFakeGoogleController } from './test-fake-google.controller';

/**
 * Integration module wiring. The GoogleCalendarClient implementation is
 * chosen at provider-construction time:
 *  - tests + dev without real Google envs  →  FakeGoogleCalendarClient
 *  - dev/prod with real Google envs         →  RealGoogleCalendarClient
 *
 * Either way the consumer code references `GOOGLE_CALENDAR_CLIENT` via DI,
 * so swapping implementations doesn't ripple through the codebase.
 */
const googleClientProvider: Provider = {
  provide: GOOGLE_CALENDAR_CLIENT,
  useFactory: (config: ConfigService): FakeGoogleCalendarClient | RealGoogleCalendarClient => {
    const haveRealCreds =
      !!config.get('GOOGLE_CLIENT_ID') &&
      !!config.get('GOOGLE_CLIENT_SECRET') &&
      !!config.get('GOOGLE_OAUTH_REDIRECT_URI');
    return haveRealCreds
      ? new RealGoogleCalendarClient(config)
      : new FakeGoogleCalendarClient();
  },
  inject: [ConfigService],
};

// Test seed route is only mounted off-production.
const testControllers = process.env.NODE_ENV === 'production' ? [] : [TestFakeGoogleController];

@Module({
  imports: [AuthModule],
  controllers: [GoogleIntegrationController, ...testControllers],
  providers: [GoogleIntegrationService, OAuthStateService, googleClientProvider],
  exports: [GoogleIntegrationService, OAuthStateService, googleClientProvider],
})
export class GoogleIntegrationModule {}
