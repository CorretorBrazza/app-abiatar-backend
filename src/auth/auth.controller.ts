// src/auth/auth.controller.ts
import { Controller, Post, Body, UseGuards, Param } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterTenantDto } from './dto/register-tenant.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { TenantId } from './decorators/tenant-id.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register-tenant')
  async registerTenant(@Body() registerTenantDto: RegisterTenantDto) {
    return this.authService.registerTenant(registerTenantDto);
  }

  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() currentUser: { sub: string },
  ) {
    return this.authService.changePassword(currentUser.sub, dto.currentPassword, dto.newPassword);
  }

  @Post('reset-password/:userId')
  @UseGuards(JwtAuthGuard)
  async resetPassword(
    @Body() body: { reason?: string },
    @CurrentUser() currentUser: { sub: string; role: string; email?: string },
    @TenantId() tenantId: string,
    @Param('userId') userId: string,
  ) {
    return this.authService.resetPassword({ id: currentUser.sub, role: currentUser.role, email: currentUser.email }, userId, tenantId, body?.reason);
  }
}