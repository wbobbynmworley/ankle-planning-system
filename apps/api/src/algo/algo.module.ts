import { Module } from '@nestjs/common';
import { AlgoService } from './algo.service';

@Module({
  providers: [AlgoService],
  exports: [AlgoService],
})
export class AlgoModule {}
