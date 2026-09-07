// src/notifications/notifications.controller.ts
import { Controller, Delete, Get, Param, Post, Body, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { SendOperationalPushDto } from './dto/send-operational-push.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TenantId } from '../auth/decorators/tenant-id.decorator';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('operational/targets')
  async listOperationalTargets(
    @CurrentUser('sub') senderId: string,
    @TenantId() tenantId: string,
  ) {
    return this.notificationsService.listOperationalTargets(senderId, tenantId);
  }

  @Post('operational')
  async sendOperationalPush(
    @Body() dto: SendOperationalPushDto,
    @CurrentUser('sub') senderId: string,
    @TenantId() tenantId: string,
  ) {
    return this.notificationsService.sendOperationalPush(dto, senderId, tenantId);
  }

  @Post('devices')
  async registerDevice(
    @Body() dto: RegisterPushTokenDto,
    @CurrentUser('sub') userId: string,
    @TenantId() tenantId: string,
  ) {
    return this.notificationsService.registerDeviceToken(dto, userId, tenantId);
  }

  @Get('devices/me')
  async listMyDevices(
    @CurrentUser('sub') userId: string,
    @TenantId() tenantId: string,
  ) {
    return this.notificationsService.listMyDevices(userId, tenantId);
  }

  @Delete('devices/:id')
  async revokeDevice(
    @Param('id') deviceId: string,
    @CurrentUser('sub') userId: string,
    @TenantId() tenantId: string,
  ) {
    return this.notificationsService.revokeDeviceToken(deviceId, userId, tenantId);
  }

  @Post('devices/deactivate')
  async deactivateDevice(
    @Body() body: { token?: string },
    @CurrentUser('sub') userId: string,
    @TenantId() tenantId: string,
  ) {
    return this.notificationsService.deactivateToken(body?.token || '', userId, tenantId);
  }
}
