import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule, configureApp } from './app.ts';
import type { Env } from './env.ts';

const app = configureApp(await NestFactory.create<NestExpressApplication>(AppModule));
const config = app.get<ConfigService<Env, true>>(ConfigService);
await app.listen(config.get('PORT', { infer: true }));
