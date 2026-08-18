import { Injectable } from '@nestjs/common';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

@Injectable()
export class DevSecurityLogger {
  private enabled(): boolean {
    return process.env.NODE_ENV !== 'production' && process.env.DEV_SECURITY_ENABLED !== 'false';
  }

  write(event: Record<string, unknown>): void {
    if (!this.enabled()) return;
    const payload = JSON.stringify({
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      ...this.redact(event),
    });
    console.log(`[DEV_SECURITY] ${payload}`);
    const destination = process.env.DEV_SECURITY_LOG_FILE;
    if (destination) {
      mkdirSync(dirname(destination), { recursive: true });
      appendFileSync(destination, `${payload}\n`, { encoding: 'utf8', mode: 0o600 });
    }
  }

  private redact(value: unknown): any {
    if (Array.isArray(value)) return value.map((item) => this.redact(item));
    if (!value || typeof value !== 'object') return value;
    const output: Record<string, unknown> = {};
    const blocked = /password|token|secret|private.?key|authorization|cookie|credential/i;
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = blocked.test(key) ? '[REDACTED]' : this.redact(item);
    }
    return output;
  }
}
