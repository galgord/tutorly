import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PublicStudentResponseSchema, type PublicStudentResponse } from '@tutor-app/shared';
import { StudentTokenGuard, type StudentTokenRequest } from './student-token.guard';

/**
 * Public student dashboard endpoints. Authorized by URL share token only —
 * NO session cookie, NO tutorId scoping. Mounted under `/s/:shareToken` and
 * throttled tighter than tutor routes to slow share-token brute-forcing.
 */
@Controller('s/:shareToken')
@UseGuards(StudentTokenGuard)
// 20 requests/min per IP — enough for a real student loading their dashboard,
// far too few to enumerate the 256-bit share-token space.
@Throttle({ default: { limit: 20, ttl: 60_000 } })
export class PublicStudentController {
  @Get('student')
  getStudent(@Req() req: StudentTokenRequest): PublicStudentResponse {
    // Guard guarantees req.student is populated.
    const student = req.student!;
    return PublicStudentResponseSchema.parse({ name: student.name });
  }
}
