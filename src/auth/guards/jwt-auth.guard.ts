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
    let token: string | undefined;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (request.query?.token) {
      token = request.query.token as string;
    }

    if (!token) {
      throw new UnauthorizedException('Token de autenticação não fornecido ou inválido.');
    }
    try {
      const payload = await this.jwtService.verifyAsync(token, { secret: process.env.JWT_SECRET });
      const user = await this.dataSource.getRepository(User).findOne({
        where: { id: payload.sub, tenant_id: payload.tenant_id },
      });
      const currentSessionVersion =
        payload.device_type === 'mobile'
          ? user?.session_version_mobile || 0
          : payload.device_type === 'web'
          ? user?.session_version_web || 0
          : user?.session_version || 0;
      if (!user || user.removed_at || user.status === 'inactive' || currentSessionVersion !== (payload.session_version || 0)) {
        throw new UnauthorizedException('Sessão inválida: usuário removido, inativo ou sessão revogada.');
      }
      request.user = {
        ...payload,
        role: user.role,
        tenant_id: user.tenant_id,
        session_version: payload.session_version,
        device_type: payload.device_type || 'web',
      };
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Token de autenticação expirado ou inválido.');
    }
  }
}
