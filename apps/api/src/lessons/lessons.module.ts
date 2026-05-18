import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GoogleIntegrationModule } from '../integrations/google/google-integration.module';
import { LessonService } from './lesson.service';
import { LessonsController } from './lessons.controller';

@Module({
  imports: [AuthModule, GoogleIntegrationModule],
  controllers: [LessonsController],
  providers: [LessonService],
  exports: [LessonService],
})
export class LessonsModule {}
