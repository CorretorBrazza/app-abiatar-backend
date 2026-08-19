import { Controller, Get, Sse, UseGuards } from '@nestjs/common';
import { Observable } from 'rxjs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantId } from '../auth/decorators/tenant-id.decorator';
import { RealtimeService } from './realtime.service';

@Controller('realtime')
export class RealtimeController {
  constructor(private readonly realtimeService: RealtimeService) {}

  @Get('stream')
  @Sse('stream')
  @UseGuards(JwtAuthGuard)
  stream(@TenantId() tenantId: string): Observable<MessageEvent> {
    return this.realtimeService.streamForTenant(tenantId);
  }
}
