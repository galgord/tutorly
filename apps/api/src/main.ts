import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService);

  app.use(cookieParser());
  app.enableCors({
    origin: [config.get('WEB_ORIGIN')],
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });

  const port = config.get('PORT');
  await app.listen(port);
  app.get(Logger).log(`api listening on http://localhost:${port}`);
}

void bootstrap();
