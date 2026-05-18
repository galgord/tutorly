import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WhisperModule } from '../integrations/openai/whisper.module';
import { LessonsModule } from '../lessons/lessons.module';
import { AudioStorageService } from './audio-storage.service';
import { VoiceController } from './voice.controller';
import { WhisperJobQueue } from './whisper-job.queue';

@Module({
  imports: [AuthModule, WhisperModule, LessonsModule],
  controllers: [VoiceController],
  providers: [AudioStorageService, WhisperJobQueue],
  exports: [WhisperJobQueue, AudioStorageService],
})
export class VoiceModule {}
