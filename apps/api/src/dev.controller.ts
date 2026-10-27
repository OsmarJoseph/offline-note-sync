import { Controller, HttpCode, HttpStatus, Inject, NotFoundException, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.ts';
import { SyncService } from './sync.service.ts';

@Controller('dev')
export class DevController {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
    @Inject(SyncService) private readonly syncService: SyncService,
  ) {}

  @Post('reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetDatabase(): Promise<void> {
    if (!this.config.get('ENABLE_DEV_ROUTES', { infer: true })) {
      throw new NotFoundException();
    }
    await this.syncService.deleteAllNotesAndOperations();
  }
}
