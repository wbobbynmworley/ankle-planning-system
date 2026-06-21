import { Module } from '@nestjs/common';
import { PlansService } from './plans.service';
import { PlansController } from './plans.controller';
import { AlgoModule } from '../algo/algo.module';
import { TaylorModule } from '../taylor/taylor.module';
import { InstrumentsModule } from '../instruments/instruments.module';

@Module({
  imports: [AlgoModule, TaylorModule, InstrumentsModule],
  providers: [PlansService],
  controllers: [PlansController],
  exports: [PlansService],
})
export class PlansModule {}
