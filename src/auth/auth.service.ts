// src/auth/auth.service.ts
import { Injectable, UnauthorizedException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

import { Tenant } from '../tenants/tenant.entity';
import { User } from '../users/user.entity';
import { RegisterTenantDto } from './dto/register-tenant.dto';
import { LoginDto } from './dto/login.dto';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../notifications/email.service';
import { classifyDeviceType } from '../notifications/utils/device-type.util';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Tenant)
    private tenantRepository: Repository<Tenant>,

    @InjectRepository(User)
    private userRepository: Repository<User>,

    private jwtService: JwtService,
    private auditService: AuditService,
    private emailService: EmailService,
  ) {}

  // 1. Cadastra uma nova Construtora (Tenant) junto com o seu primeiro Administrador
  async registerTenant(dto: RegisterTenantDto) {
    // Validação de unicidade do Slug da Construtora
    const existingTenant = await this.tenantRepository.findOne({ where: { slug: dto.tenantSlug } });
    if (existingTenant) {
      throw new BadRequestException('Este slug de construtora já está em uso.');
    }

    // Validação de unicidade do E-mail do Administrador
    const existingUser = await this.userRepository.findOne({ where: { email: dto.userEmail } });
    if (existingUser) {
      throw new BadRequestException('Este e-mail de usuário já está cadastrado.');
    }

    // Criptografa a senha com Bcrypt
    const salt = await bcrypt.genSalt(10);
    const passwordHashed = await bcrypt.hash(dto.userPasswordHash, salt);

    // Salva a Construtora (Tenant) no Banco de Dados
    const tenant = this.tenantRepository.create({
      name: dto.tenantName,
      slug: dto.tenantSlug,
      primary_color: dto.primaryColor || '#E31C1C',
      secondary_color: dto.secondaryColor || '#000000',
    });
    const savedTenant = await this.tenantRepository.save(tenant);

    // Salva o primeiro Usuário (como Diretoria Nível 1) vinculado a este Tenant
    const user = this.userRepository.create({
      tenant_id: savedTenant.id,
      name: dto.userName,
      nome_guerra: dto.userNomeGuerra,
      email: dto.userEmail,
      password_hash: passwordHashed,
      role: 'diretoria_level_1',
      status: 'active',
    });
    await this.userRepository.save(user);

    return {
      message: 'Construtora e Administrador cadastrados com sucesso!',
      tenantId: savedTenant.id,
    };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Usuário não encontrado.');

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) throw new BadRequestException('A senha atual está incorreta.');
    if (currentPassword === newPassword) throw new BadRequestException('A nova senha deve ser diferente da senha atual.');
    if (newPassword === '12345678') throw new BadRequestException('Escolha uma senha diferente da senha temporária padrão.');

    user.password_hash = await bcrypt.hash(newPassword, await bcrypt.genSalt(10));
    user.must_change_password = false;
    user.password_reset_expires_at = null;
    user.session_version = (user.session_version || 0) + 1;
    user.session_version_mobile = (user.session_version_mobile || 0) + 1;
    user.session_version_web = (user.session_version_web || 0) + 1;
    await this.userRepository.save(user);

    void this.auditService.record({ tenantId: user.tenant_id, actorUserId: user.id, actorRole: user.role, actorEmail: user.email }, {
      action: 'PASSWORD_CHANGED', entityType: 'USER', entityId: user.id, reason: 'Senha alterada pelo próprio usuário',
    });
    return { message: 'Senha alterada com sucesso. Faça login novamente.' };
  }

  async resetPassword(actor: { id: string; role: string; email?: string }, targetUserId: string, tenantId: string, reason?: string) {
    const target = await this.userRepository.findOne({ where: { id: targetUserId, tenant_id: tenantId } });
    if (!target) throw new BadRequestException('Usuário não encontrado neste tenant.');
    if (target.id === actor.id) throw new BadRequestException('Para alterar sua própria senha, utilize a opção Alterar senha.');
    if (actor.role === 'gerencia_level_2' && (target.role !== 'corretor_level_3' || target.manager_id !== actor.id)) {
      throw new ForbiddenException('A Gerência só pode redefinir senhas de Corretores da própria equipe.');
    }
    if (!['diretoria_level_1', 'gerencia_level_2', 'platform_admin_level_0'].includes(actor.role)) {
      throw new ForbiddenException('Seu perfil não pode redefinir senhas.');
    }

    const temporaryPassword = crypto.randomBytes(9).toString('base64url').slice(0, 12);
    target.password_hash = await bcrypt.hash(temporaryPassword, await bcrypt.genSalt(10));
    target.must_change_password = true;
    const expires = new Date();
    expires.setMinutes(expires.getMinutes() + 30);
    target.password_reset_expires_at = expires;
    target.session_version = (target.session_version || 0) + 1;
    target.session_version_mobile = (target.session_version_mobile || 0) + 1;
    target.session_version_web = (target.session_version_web || 0) + 1;
    await this.userRepository.save(target);

    void this.auditService.record({ tenantId, actorUserId: actor.id, actorRole: actor.role, actorEmail: actor.email }, {
      action: 'PASSWORD_RESET_REQUESTED', entityType: 'USER', entityId: target.id,
      reason: reason || 'Redefinição administrativa de senha',
      afterData: { targetEmail: target.email, expiresAt: expires.toISOString() },
    });

    return { message: 'Senha temporária criada. Ela expira em 30 minutos e exigirá troca no próximo acesso.', temporaryPassword, expiresAt: expires.toISOString() };
  }

  // Recuperação de senha pela tela de login: gera senha temporária e envia por e-mail (Resend)
  async forgotPassword(email: string) {
    if (!email || !email.trim()) {
      throw new BadRequestException('Informe seu e-mail cadastrado para recuperar a senha.');
    }

    const user = await this.userRepository.findOne({ where: { email: email.trim().toLowerCase() } });
    if (!user) {
      throw new BadRequestException('E-mail não cadastrado. Verifique o endereço informado.');
    }
    if (user.removed_at || user.status === 'inactive') {
      throw new BadRequestException('Este usuário está inativo ou foi removido da operação. Contate a Diretoria.');
    }

    const temporaryPassword = crypto.randomBytes(9).toString('base64url').slice(0, 12);
    user.password_hash = await bcrypt.hash(temporaryPassword, await bcrypt.genSalt(10));
    user.must_change_password = true;
    const expires = new Date();
    expires.setMinutes(expires.getMinutes() + 30);
    user.password_reset_expires_at = expires;
    user.session_version = (user.session_version || 0) + 1;
    user.session_version_mobile = (user.session_version_mobile || 0) + 1;
    user.session_version_web = (user.session_version_web || 0) + 1;
    await this.userRepository.save(user);

    const tenant = await this.tenantRepository.findOne({ where: { id: user.tenant_id } });

    const emailSent = await this.emailService.sendPasswordResetToEmail({
      name: user.nome_guerra || user.name,
      email: user.email,
      temporaryPassword,
      tenantName: tenant?.name,
      expiresAt: expires,
    });

    void this.auditService.record({ tenantId: user.tenant_id, actorUserId: user.id, actorRole: user.role, actorEmail: user.email }, {
      action: 'PASSWORD_FORGOT_REQUESTED',
      entityType: 'AUTHENTICATION',
      entityId: user.id,
      reason: 'Recuperação de senha solicitada pela tela de login',
      afterData: { targetEmail: user.email, expiresAt: expires.toISOString(), emailSent },
    });

    if (!emailSent) {
      throw new BadRequestException('Não foi possível enviar o e-mail de recuperação. Tente novamente em instantes.');
    }

    return {
      message: 'Enviamos para o seu e-mail uma senha temporária. Ela expira em 30 minutos e você deverá definir uma nova senha no primeiro acesso.',
    };
  }

  async validateActiveSession(userId: string, tenantId: string, tokenSessionVersion: number): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id: userId, tenant_id: tenantId } });
    if (!user || user.removed_at || user.status === 'inactive' || (user.session_version || 0) !== (tokenSessionVersion || 0)) {
      throw new UnauthorizedException('Sessão inválida: usuário removido, inativo ou sessão revogada.');
    }
    return user;
  }

  // 2. Realiza o login, valida a senha e assina o token seguro JWT
  async login(dto: LoginDto) {
    // Busca o usuário pelo e-mail. O tenant é carregado explicitamente abaixo
    // para manter o login robusto mesmo quando a relação TypeORM não é materializada.
    const user = await this.userRepository.findOne({
      where: { email: dto.email },
    });

    if (!user) {
      void this.auditService.record({}, {
        action: 'LOGIN_FAILURE',
        entityType: 'AUTHENTICATION',
        success: false,
        errorCode: 'EMAIL_NOT_FOUND',
        metadata: { email: dto.email },
      });
      throw new UnauthorizedException('E-mail não cadastrado. Verifique o endereço informado ou cadastre-se.');
    }

    if (user.removed_at || user.status === 'inactive') {
      void this.auditService.record({ tenantId: user.tenant_id, actorUserId: user.id, actorRole: user.role, actorEmail: user.email }, {
        action: user.removed_at ? 'LOGIN_BLOCKED_REMOVED_USER' : 'LOGIN_BLOCKED_INACTIVE_USER', entityType: 'AUTHENTICATION', entityId: user.id, success: false,
        reason: user.removed_at ? 'Usuário removido pela gestão' : 'Usuário inativo ou aguardando aprovação',
      });
      throw new UnauthorizedException(user.removed_at ? 'Este usuário foi removido da operação.' : 'Este usuário está inativo ou ainda aguarda aprovação.');
    }

    // Compara a senha enviada com a senha criptografada do banco
    const isPasswordValid = await bcrypt.compare(dto.passwordHash, user.password_hash);
    if (!isPasswordValid) {
      void this.auditService.record({
        tenantId: user.tenant_id,
        actorUserId: user.id,
        actorRole: user.role,
        actorEmail: user.email,
      }, {
        action: 'LOGIN_FAILURE',
        entityType: 'AUTHENTICATION',
        entityId: user.id,
        success: false,
        errorCode: 'INVALID_PASSWORD',
      });
      throw new UnauthorizedException('Senha incorreta. Verifique e tente novamente.');
    }

    const tenant = await this.tenantRepository.findOne({
      where: { id: user.tenant_id },
    });
    if (!tenant) {
      void this.auditService.record({
        actorUserId: user.id,
        actorRole: user.role,
        actorEmail: user.email,
      }, {
        action: 'LOGIN_FAILURE',
        entityType: 'AUTHENTICATION',
        entityId: user.id,
        success: false,
        errorCode: 'TENANT_NOT_FOUND',
      });
      throw new UnauthorizedException('E-mail ou senha incorretos.');
    }

    if (user.must_change_password && user.password_reset_expires_at && user.password_reset_expires_at < new Date()) {
      throw new UnauthorizedException('A senha temporária expirou. Solicite uma nova redefinição à gestão.');
    }

    // Define o conteúdo (payload) do token.
    // Login NÃO revoga sessões anteriores: sessões web/mobile podem coexistir.
    // A revogação continua via troca de senha, reset/recuperação e remoção de usuário.
    const deviceType = classifyDeviceType(dto.userAgent);

    const payload = {
      sub: user.id,
      tenant_id: user.tenant_id,
      role: user.role,
      session_version: user.session_version || 0,
      device_type: deviceType,
      must_change_password: !!user.must_change_password,
    };

    // Assina o token seguro
    const token = this.jwtService.sign(payload);

    void this.auditService.record({
      tenantId: user.tenant_id,
      actorUserId: user.id,
      actorRole: user.role,
      actorEmail: user.email,
    }, {
      action: 'LOGIN_SUCCESS',
      entityType: 'AUTHENTICATION',
      entityId: user.id,
      metadata: { tenantId: user.tenant_id },
    });

    // Retorna o token de acesso e os dados de estilização dinâmica para o app
    return {
      access_token: token,
      user: {
        id: user.id,
        name: user.name,
        nome_guerra: user.nome_guerra,
        role: user.role,
        must_change_password: !!user.must_change_password,
      },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        primary_color: tenant.primary_color,
        secondary_color: tenant.secondary_color,
        logo_url: tenant.logo_url,
        settings: tenant.settings || {},
      },
    };
  }

  async getMe(userId: string, tenantId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user || user.tenant_id !== tenantId) {
      throw new UnauthorizedException('Sessão inválida.');
    }
    const tenant = await this.tenantRepository.findOne({ where: { id: tenantId } });
    if (!tenant) {
      throw new UnauthorizedException('Tenant não encontrado.');
    }
    return {
      user: {
        id: user.id,
        name: user.name,
        nome_guerra: user.nome_guerra,
        role: user.role,
        must_change_password: !!user.must_change_password,
      },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        primary_color: tenant.primary_color,
        secondary_color: tenant.secondary_color,
        logo_url: tenant.logo_url,
        settings: tenant.settings || {},
      },
    };
  }
}