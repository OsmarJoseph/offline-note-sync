import { Module } from '@nestjs/common';
import { DevController } from './dev.controller.ts';
import { SyncController } from './sync.controller.ts';
import { SyncRepository } from './sync.repository.ts';
import { SyncService } from './sync.service.ts';

@Module({
  controllers: [SyncController, DevController],
  providers: [SyncRepository, SyncService],
})
export class SyncModule {}
