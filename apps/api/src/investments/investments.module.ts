import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InvestmentsController } from './investments.controller';
import { InvestmentsService } from './investments.service';

@Module({
  imports: [AuthModule],
  controllers: [InvestmentsController],
  providers: [InvestmentsService],
  exports: [InvestmentsService],
})
export class InvestmentsModule {}
