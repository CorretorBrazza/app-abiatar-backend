// src/auth/auth.service.ts
import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';

import { Tenant } from '../tenants/tenant.entity';
import { User } from '../users/user.entity';
import { RegisterTenantDto } from './dto/register-tenant.dto';
import { LoginDto } from './dto/login.dto';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Tenant)
    private tenantRepository: Repository<Tenant>,

    @InjectRepository(User)
    private userRepository: Repository<User>,

    private jwtService: JwtService,
    private auditService: AuditService,
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
        errorCode: 'INVALID_CREDENTIALS',
        metadata: { email: dto.email },
      });
      throw new UnauthorizedException('E-mail ou senha incorretos.');
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
        errorCode: 'INVALID_CREDENTIALS',
      });
      throw new UnauthorizedException('E-mail ou senha incorretos.');
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

    // Define o conteúdo (payload) do token
    const payload = { 
      sub: user.id, 
      tenant_id: user.tenant_id, 
      role: user.role 
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
      },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        primary_color: tenant.primary_color,
        secondary_color: tenant.secondary_color,
        logo_url: tenant.logo_url,
      },
    };
  }
}