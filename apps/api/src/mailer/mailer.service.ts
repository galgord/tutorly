import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service';

export interface MagicLinkMail {
  to: string;
  url: string;
  locale: 'en' | 'pt' | 'he';
}

export const MAGIC_LINK_LOG_PREFIX = 'MAGIC_LINK';

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  async sendMagicLink(mail: MagicLinkMail): Promise<void> {
    if (this.config.get('MAILER') === 'console') {
      // Easy for local dev + Playwright: tail logs, regex out the URL.
      this.logger.log(`${MAGIC_LINK_LOG_PREFIX} to=${mail.to} url=${mail.url}`);
      return;
    }
    // Resend wiring lands in Phase 10. Fail loud rather than silently no-op
    // so a misconfigured prod doesn't pretend to send mail.
    throw new Error('MAILER=resend is not implemented yet (Phase 10).');
  }
}
