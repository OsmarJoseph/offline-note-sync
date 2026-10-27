import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DatabaseModule } from './db/database.module.ts';
import { validateEnv } from './env.ts';
import { SyncModule } from './sync.module.ts';

const MAX_REQUEST_BODY_SIZE = '8mb';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    DatabaseModule,
    SyncModule,
  ],
})
export class AppModule {}

export function configureApp(app: NestExpressApplication): NestExpressApplication {
  app.useBodyParser('json', { limit: MAX_REQUEST_BODY_SIZE });
  app.enableShutdownHooks();
  return app;
}
