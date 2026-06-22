import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CasesModule } from './cases/cases.module';
import { FilesModule } from './files/files.module';
import { PlansModule } from './plans/plans.module';
import { LogsModule } from './logs/logs.module';
import { AlgoModule } from './algo/algo.module';
import { InstrumentsModule } from './instruments/instruments.module';
import { MeasurementsModule } from './measurements/measurements.module';
import { TaylorModule } from './taylor/taylor.module';
import { ExecutionModule } from './execution/execution.module';
import { PermsModule } from './perms/perms.module';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    PrismaModule,
    StorageModule,
    AuthModule,
    UsersModule,
    CasesModule,
    FilesModule,
    PlansModule,
    LogsModule,
    AlgoModule,
    InstrumentsModule,
    MeasurementsModule,
    TaylorModule,
    ExecutionModule,
    PermsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
