import { Injectable } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';

export interface RealtimeEvent {
  eventId: string;
  eventType: string;
  tenantId: string;
  aggregateId?: string;
  occurredAt: string;
  version: number;
  payload: Record<string, unknown>;
}

@Injectable()
export class RealtimeService {
  private readonly events$ = new Subject<RealtimeEvent>();

  publish(event: Omit<RealtimeEvent, 'eventId' | 'occurredAt' | 'version'>): void {
    this.events$.next({
      eventId: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      version: 1,
      ...event,
    });
  }

  streamForTenant(tenantId: string): Observable<MessageEvent> {
    return this.events$.pipe(
      filter((event) => event.tenantId === tenantId),
      map((event) => ({ type: event.eventType, data: event } as MessageEvent)),
    );
  }
}
