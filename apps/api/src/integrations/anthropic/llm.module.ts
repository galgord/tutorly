import { Module, type Provider } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import { LLM_CLIENT } from './llm.client';
import { FakeLlmClient } from './llm.fake';
import { RealAnthropicLlmClient } from './llm.real';

/**
 * Wiring for the LLM client. Mirrors the GoogleIntegrationModule pattern:
 * a factory provider chooses the real or fake client based on whether the
 * provider creds are present. Tests + dev without ANTHROPIC_API_KEY get the
 * fake, which makes the full UI walkable without burning credit.
 *
 * Consumers reference `LLM_CLIENT` via DI so swapping implementations
 * doesn't ripple through the codebase.
 */
const llmProvider: Provider = {
  provide: LLM_CLIENT,
  useFactory: (config: ConfigService): FakeLlmClient | RealAnthropicLlmClient => {
    const haveKey = !!config.get('ANTHROPIC_API_KEY');
    return haveKey ? new RealAnthropicLlmClient(config) : new FakeLlmClient();
  },
  inject: [ConfigService],
};

@Module({
  providers: [llmProvider],
  exports: [llmProvider],
})
export class LlmModule {}
