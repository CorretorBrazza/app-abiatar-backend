import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { DevSecurityLogger } from './dev-security.logger';

@Injectable()
export class DevRequestLoggingMiddleware implements NestMiddleware {
  constructor(private readonly logger: DevSecurityLogger) {}

  use(request: Request, response: Response, next: NextFunction): void {
    if (process.env.NODE_ENV === 'production' || process.env.DEV_SECURITY_ENABLED === 'false') {
      next();
      return;
    }
    const requestId = String(request.header('x-request-id') || randomUUID());
    const started = Date.now();
    response.setHeader('x-request-id', requestId);
    response.on('finish', () => {
      const user = (request as Request & { user?: { sub?: string; role?: string; tenant_id?: string } }).user;
      this.logger.write({
        type: 'http_request',
        requestId,
        method: request.method,
        path: request.originalUrl,
        statusCode: response.statusCode,
        durationMs: Date.now() - started,
        actorUserId: user?.sub,
        actorRole: user?.role,
        tenantId: user?.tenant_id,
        ip: request.ip,
        userAgent: request.get('user-agent'),
      });
    });
    next();
  }
}
