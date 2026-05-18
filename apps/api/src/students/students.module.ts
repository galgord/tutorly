import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PublicStudentController } from './public-student.controller';
import { StudentPurgeService } from './student-purge.service';
import { StudentService } from './student.service';
import { StudentTokenGuard } from './student-token.guard';
import { StudentsController, TrashStudentsController } from './students.controller';

@Module({
  imports: [AuthModule],
  controllers: [StudentsController, TrashStudentsController, PublicStudentController],
  providers: [StudentService, StudentTokenGuard, StudentPurgeService],
  exports: [StudentService],
})
export class StudentsModule {}
