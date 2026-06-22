import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/** 全局存储模块：FilesService / PlansService 等都可直接注入 StorageService */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
