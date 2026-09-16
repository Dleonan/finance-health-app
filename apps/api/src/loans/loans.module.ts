import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LoansController } from './loans.controller';
import { LoansService } from './loans.service';

@Module({
  imports: [AuthModule],
  controllers: [LoansController],
  providers: [LoansService],
  exports: [LoansService],
})
export class LoansModule {}
