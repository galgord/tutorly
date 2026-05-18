import { Module, type Provider } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import { TRANSCRIBER_CLIENT } from './whisper.client';
import { FakeTranscriberClient } from './whisper.fake';
import { RealOpenAIWhisperClient } from './whisper.real';

/**
 * Wiring for the Whisper transcriber client. Mirrors the LlmModule:
 * a factory provider chooses the real or fake client based on whether
 * the OPENAI_API_KEY is set. Tests + dev without the key get the fake,
 * which makes the full UI walkable without burning credit.
 *
 * Consumers reference `TRANSCRIBER_CLIENT` via DI so swapping
 * implementations doesn't ripple through the codebase.
 */
const transcriberProvider: Provider = {
  provide: TRANSCRIBER_CLIENT,
  useFactory: (
    config: ConfigService,
  ): FakeTranscriberClient | RealOpenAIWhisperClient => {
    const haveKey = !!config.get('OPENAI_API_KEY');
    return haveKey ? new RealOpenAIWhisperClient(config) : new FakeTranscriberClient();
  },
  inject: [ConfigService],
};

@Module({
  providers: [transcriberProvider],
  exports: [transcriberProvider],
})
export class WhisperModule {}
