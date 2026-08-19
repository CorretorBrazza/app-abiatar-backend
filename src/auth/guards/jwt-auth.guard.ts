import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/user.entity';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    @InjectRepository(User) private userRepository: Repository<User>,
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
      const user = await this.userRepository.findOne({ where: { id: payload.sub, tenant_id: payload.tenant_id } });
      if (!user || user.status === 'inactive' || user.removed_at) {
        throw new UnauthorizedException('Usuário inativo ou removido.');
      }
      if ((payload.session_version || 0) !== (user.session_version || 0)) {
        throw new UnauthorizedException('Sessão invalidada. Faça login novamente.');
      }

      const path = request.path || request.url || '';
      if (user.must_change_password && !path.endsWith('/auth/change-password')) {
        throw new ForbiddenException('Você precisa trocar a senha temporária antes de continuar.');
      }

      request.user = { ...payload, must_change_password: !!user.must_change_password };
      return true;
    } catch (err) {
      if (err instanceof ForbiddenException) throw err;
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('Token de autenticação expirado ou inválido.');
    }
  }
}
