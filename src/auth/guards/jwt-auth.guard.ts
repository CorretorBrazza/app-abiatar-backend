import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { User } from '../../users/user.entity';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token de autenticação não fornecido ou inválido.');
    }

    const token = authHeader.split(' ')[1];
    try {
      const payload = await this.jwtService.verifyAsync(token, { secret: process.env.JWT_SECRET });
      const user = await this.dataSource.getRepository(User).findOne({
        where: { id: payload.sub, tenant_id: payload.tenant_id },
      });
      if (!user || user.removed_at || user.status === 'inactive' || (user.session_version || 0) !== (payload.session_version || 0)) {
        throw new UnauthorizedException('Sessão inválida: usuário removido, inativo ou sessão revogada.');
      }
      request.user = {
        ...payload,
        role: user.role,
        tenant_id: user.tenant_id,
        session_version: user.session_version || 0,
      };
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Token de autenticação expirado ou inválido.');
    }
  }
}
