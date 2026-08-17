import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';

export interface AuditContext {
  tenantId?: string | null;
  boothId?: string | null;
  actorUserId?: string | null;
  actorRole?: string | null;
  actorEmail?: string | null;
  sessionId?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuditEvent {
  action: string;
  entityType?: string;
  entityId?: string;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
  reason?: string | null;
  success?: boolean;
  errorCode?: string | null;
  metadata?: Record<string, unknown> | null;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepository: Repository<AuditLog>,
  ) {}

  async record(context: AuditContext, event: AuditEvent): Promise<AuditLog> {
    const auditLog = this.auditRepository.create({
      tenant_id: context.tenantId || null,
      booth_id: context.boothId || null,
      actor_user_id: context.actorUserId || null,
      actor_role: context.actorRole || null,
      actor_email_snapshot: context.actorEmail || null,
      session_id: context.sessionId || null,
      request_id: context.requestId || null,
      action: event.action,
      entity_type: event.entityType || null,
      entity_id: event.entityId || null,
      before_data: this.sanitize(event.beforeData),
      after_data: this.sanitize(event.afterData),
      reason: event.reason || null,
      ip_address: context.ipAddress || null,
      user_agent: context.userAgent || null,
      success: event.success !== false,
      error_code: event.errorCode || null,
      metadata: this.sanitize(event.metadata),
    });

    try {
      return await this.auditRepository.save(auditLog);
    } catch (error) {
      // A auditoria nunca deve derrubar o fluxo operacional durante uma migração.
      // O erro fica no log técnico para correção imediata; depois da migration,
      // os eventos passam a ser persistidos normalmente.
      console.error(
        '[AUDIT] Falha ao persistir evento:',
        error instanceof Error ? error.message : String(error),
      );
      return auditLog;
    }
  }

  private sanitize(
    value?: Record<string, unknown> | null,
  ): Record<string, unknown> | null {
    if (!value) return null;

    const blocked = /password|token|secret|private.?key|authorization|cookie|credential/i;
    const output: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(value)) {
      if (blocked.test(key)) {
        output[key] = '[REDACTED]';
        continue;
      }

      if (item && typeof item === 'object' && !Array.isArray(item)) {
        output[key] = this.sanitize(item as Record<string, unknown>);
      } else if (Array.isArray(item)) {
        output[key] = item.map((entry) =>
          entry && typeof entry === 'object'
            ? this.sanitize(entry as Record<string, unknown>)
            : entry,
        );
      } else {
        output[key] = item;
      }
    }

    return output;
  }
}
