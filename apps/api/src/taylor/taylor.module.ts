import { Module } from '@nestjs/common';
import { TaylorService } from './taylor.service';

@Module({
  providers: [TaylorService],
  exports: [TaylorService],
})
export class TaylorModule {}
