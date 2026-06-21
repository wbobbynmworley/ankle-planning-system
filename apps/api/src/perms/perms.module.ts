import { Module } from '@nestjs/common';
import { PermsService } from './perms.service';
import { PermsController } from './perms.controller';

@Module({
  providers: [PermsService],
  controllers: [PermsController],
  exports: [PermsService],
})
export class PermsModule {}
