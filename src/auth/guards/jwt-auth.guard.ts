// src/auth/guards/jwt-auth.guard.ts
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    // 1. Verifica se o cabeçalho Authorization foi enviado no formato Bearer
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token de autenticação não fornecido ou inválido.');
    }

    const token = authHeader.split(' ')[1];

    try {
      // 2. Decodifica e valida o token usando a nossa chave secreta
      const payload = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
      });

      // 3. Injeta as informações descriptografadas (sub, tenant_id, role) na requisição
      request.user = payload;
      return true;
    } catch (err) {
      throw new UnauthorizedException('Token de autenticação expirado ou inválido.');
    }
  }
}