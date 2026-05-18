import { Injectable } from '@nestjs/common';
import { type Env, loadEnv } from './env';

@Injectable()
export class ConfigService {
  private readonly env: Env;

  constructor() {
    this.env = loadEnv();
  }

  get<K extends keyof Env>(key: K): Env[K] {
    return this.env[key];
  }

  isProd(): boolean {
    return this.env.NODE_ENV === 'production';
  }
}
