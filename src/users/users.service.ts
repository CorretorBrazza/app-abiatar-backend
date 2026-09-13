// src/users/users.service.ts
import { Injectable, OnModuleInit, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, LessThanOrEqual, Raw, IsNull, In, Not, Brackets } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { Cron, CronExpression } from '@nestjs/schedule';

import { User } from './user.entity';
import { Presence } from '../presences/entities/presence.entity';
import { Tenant } from '../tenants/tenant.entity';
import { OnboardingLink } from './entities/onboarding-link.entity';
import { RegisterBrokerDto } from './dto/register-broker.dto';
import { CreateManagerDto } from './dto/create-manager.dto';
import { CreateReceptionistDto } from './dto/create-receptionist.dto';
import { ApproveBrokerDto } from './dto/approve-broker.dto';
import { TransferBrokerDto, UpdateBrokerLeadPauseDto, UpdateBrokerProfileDto, UpdateBrokerStageDto } from './dto/update-broker-profile.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../notifications/email.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,

    @InjectRepository(OnboardingLink)
    private linkRepository: Repository<OnboardingLink>,

    @InjectRepository(Tenant)
    private tenantRepository: Repository<Tenant>,
    private notificationsService: NotificationsService,
    private emailService: EmailService,
    private auditService: AuditService,
    private readonly realtimeService: RealtimeService,
  ) {}

  async onModuleInit() {
    try {
      await this.userRepository.query(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS broker_stage varchar(32) NOT NULL DEFAULT 'corretor_creci';
      `);
      await this.userRepository.query(`
        ALTER TABLE users 
        ALTER COLUMN creci DROP NOT NULL;
      `);
      await this.userRepository.query(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS approved_by_hr boolean NOT NULL DEFAULT true;
      `);
      console.log('[USERS] Schema auto-healing garantido com sucesso (broker_stage, creci nullable & approved_by_hr).');
    } catch (err) {
      console.error('[USERS] Aviso ao executar auto-healing de schema:', err);
    }
  }

  private normalizeNomeGuerra(value: string): string {
    return value.trim().replace(/\s+/g, ' ').toLocaleUpperCase('pt-BR');
  }

  // Cria um gerente somente a partir de uma diretoria autenticada.
  async createManager(dto: CreateManagerDto, tenantId: string) {
    const normalizedNomeGuerra = this.normalizeNomeGuerra(dto.nomeGuerra);
    const existingEmail = await this.userRepository.findOne({ where: { email: dto.email } });
    if (existingEmail) {
      throw new BadRequestException('Este e-mail de usuário já está cadastrado.');
    }

    const existingNomeGuerra = await this.userRepository.findOne({
      where: { nome_guerra: Raw((alias) => `LOWER(${alias}) = LOWER(:nomeGuerra)`, { nomeGuerra: normalizedNomeGuerra }), tenant_id: tenantId },
    });
    if (existingNomeGuerra) {
      throw new BadRequestException(`O nome de guerra '${normalizedNomeGuerra}' já está em uso nesta empresa.`);
    }

    const passwordHashed = await bcrypt.hash(dto.passwordHash, await bcrypt.genSalt(10));
    const manager = this.userRepository.create({
      tenant_id: tenantId,
      name: dto.name,
      nome_guerra: normalizedNomeGuerra,
      email: dto.email,
      password_hash: passwordHashed,
      role: 'gerencia_level_2',
      status: 'active',
    });
    const savedManager = await this.userRepository.save(manager);
    this.realtimeService.publish({ eventType: 'manager.created', tenantId, aggregateId: savedManager.id, payload: { userId: savedManager.id, role: savedManager.role, name: savedManager.name } });
    void this.auditService.record({ tenantId }, {
      action: 'USER_CREATED',
      entityType: 'USER',
      entityId: savedManager.id,
      afterData: {
        name: savedManager.name,
        nome_guerra: savedManager.nome_guerra,
        email: savedManager.email,
        role: savedManager.role,
      },
      metadata: { createdRole: savedManager.role },
    });

    return {
      message: 'Gerente cadastrado com sucesso!',
      user: {
        id: savedManager.id,
        name: savedManager.name,
        nome_guerra: savedManager.nome_guerra,
        email: savedManager.email,
        role: savedManager.role,
      },
    };
  }

  async createReceptionist(dto: CreateReceptionistDto, tenantId: string) {
    const normalizedNomeGuerra = this.normalizeNomeGuerra(dto.nomeGuerra);
    const existingEmail = await this.userRepository.findOne({ where: { email: dto.email } });
    if (existingEmail) {
      throw new BadRequestException('Este e-mail de usuário já está cadastrado.');
    }

    const existingNomeGuerra = await this.userRepository.findOne({
      where: { nome_guerra: Raw((alias) => `LOWER(${alias}) = LOWER(:nomeGuerra)`, { nomeGuerra: normalizedNomeGuerra }), tenant_id: tenantId },
    });
    if (existingNomeGuerra) {
      throw new BadRequestException(`O nome de guerra '${normalizedNomeGuerra}' já está em uso nesta empresa.`);
    }

    const passwordHashed = await bcrypt.hash(dto.passwordHash, await bcrypt.genSalt(10));
    const receptionist = this.userRepository.create({
      tenant_id: tenantId,
      name: dto.name,
      nome_guerra: normalizedNomeGuerra,
      email: dto.email,
      password_hash: passwordHashed,
      role: 'recepcao_level_3',
      status: 'active',
      must_change_password: true,
    });
    const savedReceptionist = await this.userRepository.save(receptionist);
    this.realtimeService.publish({ eventType: 'reception.created', tenantId, aggregateId: savedReceptionist.id, payload: { userId: savedReceptionist.id, role: savedReceptionist.role, name: savedReceptionist.name } });
    void this.auditService.record({ tenantId }, {
      action: 'USER_CREATED',
      entityType: 'USER',
      entityId: savedReceptionist.id,
      afterData: {
        name: savedReceptionist.name,
        nome_guerra: savedReceptionist.nome_guerra,
        email: savedReceptionist.email,
        role: savedReceptionist.role,
      },
      metadata: { createdRole: savedReceptionist.role },
    });

    return {
      message: 'Recepção cadastrada com sucesso!',
      user: {
        id: savedReceptionist.id,
        name: savedReceptionist.name,
        nome_guerra: savedReceptionist.nome_guerra,
        email: savedReceptionist.email,
        role: savedReceptionist.role,
      },
    };
  }

  async createRhUser(dto: CreateManagerDto, tenantId: string) {
    const normalizedNomeGuerra = this.normalizeNomeGuerra(dto.nomeGuerra);
    const existingEmail = await this.userRepository.findOne({ where: { email: dto.email } });
    if (existingEmail) {
      throw new BadRequestException('Este e-mail de usuário já está cadastrado.');
    }

    const existingNomeGuerra = await this.userRepository.findOne({
      where: { nome_guerra: Raw((alias) => `LOWER(${alias}) = LOWER(:nomeGuerra)`, { nomeGuerra: normalizedNomeGuerra }), tenant_id: tenantId },
    });
    if (existingNomeGuerra) {
      throw new BadRequestException(`O nome de guerra '${normalizedNomeGuerra}' já está em uso nesta empresa.`);
    }

    const passwordHashed = await bcrypt.hash(dto.passwordHash, await bcrypt.genSalt(10));
    const rhUser = this.userRepository.create({
      tenant_id: tenantId,
      name: dto.name,
      nome_guerra: normalizedNomeGuerra,
      email: dto.email,
      password_hash: passwordHashed,
      role: 'rh_level_2',
      status: 'active',
      must_change_password: true,
    });
    const savedRh = await this.userRepository.save(rhUser);
    this.realtimeService.publish({ eventType: 'rh.created', tenantId, aggregateId: savedRh.id, payload: { userId: savedRh.id, role: savedRh.role, name: savedRh.name } });
    void this.auditService.record({ tenantId }, {
      action: 'USER_CREATED',
      entityType: 'USER',
      entityId: savedRh.id,
      afterData: {
        name: savedRh.name,
        nome_guerra: savedRh.nome_guerra,
        email: savedRh.email,
        role: savedRh.role,
      },
      metadata: { createdRole: savedRh.role },
    });

    return {
      message: 'Usuário de RH cadastrado com sucesso!',
      user: {
        id: savedRh.id,
        name: savedRh.name,
        nome_guerra: savedRh.nome_guerra,
        email: savedRh.email,
        role: savedRh.role,
      },
    };
  }

  async getOnboardingInviteInfo(token: string) {
    const link = await this.linkRepository.findOne({ where: { token, valid_until: MoreThan(new Date()), is_used: false }, relations: { manager: true } });
    if (!link) throw new BadRequestException('O convite é inválido, expirou ou já foi utilizado.');
    return {
      invited_role: link.invited_role,
      valid_until: link.valid_until,
      manager: link.manager ? { id: link.manager.id, nome_guerra: link.manager.nome_guerra } : null,
    };
  }

  async listActiveManagers(tenantId: string) {
    return this.userRepository.find({
      where: { tenant_id: tenantId, role: 'gerencia_level_2', status: 'active' },
      select: { id: true, name: true, nome_guerra: true, email: true, role: true, status: true },
      order: { nome_guerra: 'ASC' },
    });
  }

  // A Diretoria pode convidar Gerente ou Corretor; a Gerência só pode convidar Corretor para si mesma.
  async createOnboardingLink(actor: { id: string; role: string; email?: string }, tenantId: string, dto: { invitedRole: 'gerencia_level_2' | 'corretor_level_3'; managerId?: string }) {
    let managerId: string | null = null;
    if (actor.role === 'diretoria_level_1' || actor.role === 'platform_admin_level_0') {
      if (dto.invitedRole === 'corretor_level_3') {
        if (!dto.managerId) throw new BadRequestException('Para convidar um Corretor, selecione obrigatoriamente um Gerente.');
        const manager = await this.userRepository.findOne({ where: { id: dto.managerId, tenant_id: tenantId, role: 'gerencia_level_2', status: 'active' } });
        if (!manager) throw new BadRequestException('O Gerente selecionado não está ativo neste tenant.');
        managerId = manager.id;
      } else if (dto.managerId) {
        throw new BadRequestException('Convite de Gerente não deve possuir gerente responsável.');
      }
    } else if (actor.role === 'gerencia_level_2') {
      if (dto.invitedRole !== 'corretor_level_3') throw new BadRequestException('A Gerência só pode convidar Corretores.');
      managerId = actor.id;
    } else {
      throw new NotFoundException('Operação de convite não disponível para este perfil.');
    }

    const token = crypto.randomBytes(16).toString('hex');
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 7);
    const savedLink = await this.linkRepository.save(this.linkRepository.create({
      tenant_id: tenantId,
      manager_id: managerId,
      inviter_id: actor.id,
      invited_role: dto.invitedRole,
      token,
      valid_until: validUntil,
      is_used: false,
    }));

    void this.auditService.record({ tenantId, actorUserId: actor.id, actorRole: actor.role, actorEmail: actor.email }, {
      action: 'ONBOARDING_LINK_CREATED',
      entityType: 'ONBOARDING_LINK',
      entityId: savedLink.id,
      afterData: { invitedRole: savedLink.invited_role, managerId: savedLink.manager_id, validUntil: savedLink.valid_until },
      reason: 'Convite hierárquico criado',
    });
    const baseUrl = (process.env.FRONTEND_URL || 'https://abiatar.bitimob.com.br').replace(/\/$/, '');
    return { token: savedLink.token, invited_role: savedLink.invited_role, manager_id: savedLink.manager_id, valid_until: savedLink.valid_until, onboarding_url: `${baseUrl}/cadastro/${savedLink.token}` };
  }

  async registerManager(dto: { token: string; name: string; nomeGuerra: string; email: string; passwordHash: string }) {
    const normalizedNomeGuerra = this.normalizeNomeGuerra(dto.nomeGuerra);
    const link = await this.linkRepository.findOne({ where: { token: dto.token, valid_until: MoreThan(new Date()), is_used: false } });
    if (!link || link.invited_role !== 'gerencia_level_2') throw new BadRequestException('O convite de Gerente é inválido, expirou ou já foi utilizado.');
    const existingEmail = await this.userRepository.findOne({ where: { email: dto.email } });
    if (existingEmail) throw new BadRequestException('Este e-mail de usuário já está cadastrado.');
    const existingNomeGuerra = await this.userRepository.findOne({ where: { nome_guerra: Raw((alias) => `LOWER(${alias}) = LOWER(:nomeGuerra)`, { nomeGuerra: normalizedNomeGuerra }), tenant_id: link.tenant_id } });
    if (existingNomeGuerra) throw new BadRequestException(`O nome de guerra '${normalizedNomeGuerra}' já está em uso nesta empresa.`);
    const managerEntity: User = this.userRepository.create({
      tenant_id: link.tenant_id,
      manager_id: null,
      name: dto.name,
      nome_guerra: normalizedNomeGuerra,
      email: dto.email,
      password_hash: await bcrypt.hash(dto.passwordHash, await bcrypt.genSalt(10)),
      role: 'gerencia_level_2',
      status: 'active',
    });
    const manager = await this.userRepository.save(managerEntity);
    link.is_used = true;
    await this.linkRepository.save(link);
    void this.auditService.record({ tenantId: link.tenant_id, actorUserId: manager.id, actorRole: manager.role, actorEmail: manager.email }, { action: 'INVITATION_ACCEPTED', entityType: 'USER', entityId: manager.id, afterData: { role: manager.role, invitedBy: link.inviter_id }, reason: 'Convite de Gerente aceito' });
    return { message: 'Cadastro de Gerente concluído com sucesso.', user: { id: manager.id, name: manager.name, nome_guerra: manager.nome_guerra, email: manager.email, role: manager.role } };
  }

  async getPublicManagers(tenantSlug?: string) {
    let tenant: Tenant | null = null;
    try {
      if (tenantSlug?.trim()) {
        tenant = await this.tenantRepository.findOne({ where: { slug: tenantSlug.trim() } });
      }
      if (!tenant) {
        tenant = await this.tenantRepository.findOne({ where: { slug: 'abiatar-teste' } });
      }
      if (!tenant) {
        tenant = await this.tenantRepository.findOne({ order: { created_at: 'ASC' } });
      }
    } catch (err) {
      console.error('[USERS] Erro ao buscar tenant em getPublicManagers:', err);
    }

    let managers: User[] = [];
    try {
      if (tenant) {
        managers = await this.userRepository.find({
          where: { tenant_id: tenant.id, role: 'gerencia_level_2', status: 'active', removed_at: IsNull() },
          select: { id: true, name: true, nome_guerra: true },
          order: { nome_guerra: 'ASC' },
        });
      }

      if (managers.length === 0) {
        managers = await this.userRepository.find({
          where: { role: 'gerencia_level_2', status: 'active', removed_at: IsNull() },
          select: { id: true, name: true, nome_guerra: true },
          order: { nome_guerra: 'ASC' },
        });
      }
    } catch (err) {
      console.error('[USERS] Erro ao buscar gerentes em getPublicManagers:', err);
    }

    return {
      tenant: tenant ? {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        primary_color: tenant.primary_color,
        logo_url: tenant.logo_url,
      } : null,
      managers: managers.map((m) => ({
        id: m.id,
        name: m.name,
        nome_guerra: m.nome_guerra || m.name,
      })),
    };
  }

  // 2. Corretor se cadastra (Rota Pública: Aceita seleção de Gerente OU Token de Convite)
  async registerBroker(dto: RegisterBrokerDto) {
    const normalizedNomeGuerra = this.normalizeNomeGuerra(dto.nomeGuerra);
    let tenantId: string;
    let managerId: string;
    let link: any = null;

    if (dto.token?.trim()) {
      // Validação por convite legado
      link = await this.linkRepository.findOne({
        where: { 
          token: dto.token.trim(), 
          valid_until: MoreThan(new Date()),
          is_used: false 
        },
      });

      if (!link) {
        throw new BadRequestException('O link de cadastro é inválido, expirou ou já foi utilizado.');
      }
      if (link.invited_role !== 'corretor_level_3' || !link.manager_id) {
        throw new BadRequestException('Este convite não é destinado ao cadastro de Corretor.');
      }

      tenantId = link.tenant_id;
      managerId = link.manager_id;
    } else if (dto.managerId) {
      // Cadastro sem convite: com seleção direta do Gerente
      const manager = await this.userRepository.findOne({
        where: { id: dto.managerId, role: 'gerencia_level_2', status: 'active', removed_at: IsNull() },
      });
      if (!manager) {
        throw new BadRequestException('O Gerente selecionado não está ativo ou não foi encontrado.');
      }
      tenantId = manager.tenant_id;
      managerId = manager.id;
    } else {
      throw new BadRequestException('Selecione o seu Gerente responsável para concluir o cadastro.');
    }

    const stage = dto.brokerStage || 'corretor_creci';
    if (stage === 'estagiario' && (!dto.creci || !dto.creci.trim())) {
      throw new BadRequestException('O CRECI de Estágio é obrigatório para corretores estagiários.');
    }
    if (stage === 'corretor_creci' && (!dto.creci || !dto.creci.trim())) {
      throw new BadRequestException('O CRECI profissional é obrigatório.');
    }

    // Validação de unicidade do Nome de Guerra RESTRITA a esta construtora
    const existingNomeGuerra = await this.userRepository.findOne({
      where: { 
        nome_guerra: Raw((alias) => `LOWER(${alias}) = LOWER(:nomeGuerra)`, { nomeGuerra: normalizedNomeGuerra }),
        tenant_id: tenantId
      },
    });
    if (existingNomeGuerra) {
      throw new BadRequestException(`O nome de guerra '${normalizedNomeGuerra}' já está em uso por outro corretor.`);
    }

    // Validação de e-mail único
    const existingEmail = await this.userRepository.findOne({ where: { email: dto.email.trim().toLowerCase() } });
    if (existingEmail) {
      throw new BadRequestException('Este e-mail de usuário já está cadastrado.');
    }

    // Criptografa a senha do corretor
    const salt = await bcrypt.genSalt(10);
    const passwordHashed = await bcrypt.hash(dto.passwordHash, salt);

    const chosenManager = await this.userRepository.findOne({
      where: { id: managerId, tenant_id: tenantId },
      select: { id: true, name: true, nome_guerra: true },
    });
    const currentTenant = await this.tenantRepository.findOne({ where: { id: tenantId } });

    // Cria o registro do Corretor (Status: Inativo, aguardando triagem do RH)
    const broker: User = this.userRepository.create({
      tenant_id: tenantId,
      manager_id: managerId,
      name: dto.name.trim(),
      nome_guerra: normalizedNomeGuerra,
      email: dto.email.trim().toLowerCase(),
      password_hash: passwordHashed,
      creci: dto.creci ? dto.creci.trim().toUpperCase() : null,
      broker_stage: stage,
      role: 'corretor_level_3',
      status: 'inactive', // Fica inativo até que seja aprovado
      approved_by_hr: false, // Fica false aguardando triagem documental do RH
    });

    const saved: User = await this.userRepository.save(broker);
    if (link) {
      link.is_used = true;
      await this.linkRepository.save(link);
    }

    // Dispara e-mail com resumo e documentos para o RH via Resend (não bloqueante)
    void this.emailService.sendBrokerRegistrationToHr({
      brokerName: saved.name,
      brokerNomeGuerra: saved.nome_guerra,
      brokerEmail: saved.email,
      brokerStage: saved.broker_stage || 'treinamento',
      creci: saved.creci,
      managerName: chosenManager?.name || 'Gerência',
      managerNomeGuerra: chosenManager?.nome_guerra || chosenManager?.name || 'Gerência',
      tenantName: currentTenant?.name || 'ABIATAR',
      documents: dto.documents,
    });

    // Notifica Diretoria e RH em tempo real (SSE)
    this.realtimeService.publish({
      eventType: 'broker.registered_pending_hr',
      tenantId,
      aggregateId: saved.id,
      payload: {
        brokerId: saved.id,
        brokerName: saved.nome_guerra,
        managerId,
        managerNomeGuerra: chosenManager?.nome_guerra || chosenManager?.name,
        stage: saved.broker_stage,
      },
    });

    return {
      message: 'Seu cadastro e documentos foram enviados com sucesso! Aguarde a validação do RH para liberação junto ao seu Gerente.',
    };
  }

  private async resolvePageSize(tenantId: string, requested?: number) {
    const configured = Number((await this.tenantRepository.findOne({ where: { id: tenantId }, select: { settings: true } }))?.settings?.pagination?.managementPageSize);
    return Math.min(100, Math.max(5, Number(requested) || configured || 25));
  }

  async listManagementUsers(role: string, tenantId: string, query: { page?: number; pageSize?: number; search?: string; status?: string } = {}) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = await this.resolvePageSize(tenantId, query.pageSize);
    const qb = this.userRepository.createQueryBuilder('user')
      .where('user.tenant_id = :tenantId', { tenantId })
      .andWhere('user.role = :role', { role })
      .andWhere('user.removed_at IS NULL');
    if (query.status && ['active', 'inactive', 'grace_period'].includes(query.status)) qb.andWhere('user.status = :status', { status: query.status });
    const search = query.search?.trim();
    if (search) qb.andWhere(new Brackets((sub) => sub.where('LOWER(user.name) LIKE LOWER(:search)', { search: `%${search}%` }).orWhere('LOWER(user.nome_guerra) LIKE LOWER(:search)', { search: `%${search}%` }).orWhere('LOWER(user.email) LIKE LOWER(:search)', { search: `%${search}%` })));
    const [data, total] = await qb.select(['user.id', 'user.name', 'user.nome_guerra', 'user.email', 'user.role', 'user.status', 'user.manager_id']).orderBy('user.nome_guerra', 'ASC').skip((page - 1) * pageSize).take(pageSize).getManyAndCount();
    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getManagementUser(userId: string, tenantId: string) {
    const user = await this.userRepository.findOne({
      where: { id: userId, tenant_id: tenantId, role: In(['gerencia_level_2', 'recepcao_level_3', 'rh_level_1', 'rh_level_2']), removed_at: IsNull() },
      select: { id: true, name: true, nome_guerra: true, email: true, role: true, status: true, manager_id: true },
    });
    if (!user) throw new NotFoundException('Usuário de gestão não encontrado.');
    return user;
  }

  async removeManagementUser(userId: string, reason: string, actor: { sub: string; role: string }, tenantId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId, tenant_id: tenantId, role: In(['gerencia_level_2', 'recepcao_level_3', 'rh_level_1', 'rh_level_2']), removed_at: IsNull() } });
    if (!user) throw new NotFoundException('Usuário de gestão não encontrado ou já removido.');
    const before = { status: user.status, role: user.role, manager_id: user.manager_id };
    user.status = 'inactive';
    user.leads_paused = true;
    user.leads_pause_reason = reason.trim();
    user.removed_at = new Date();
    user.removed_by = actor.sub;
    user.session_version = (user.session_version || 0) + 1;
    const saved = await this.userRepository.save(user);
    void this.auditService.record({ tenantId, actorUserId: actor.sub, actorRole: actor.role }, {
      action: 'USER_REMOVED', entityType: 'USER', entityId: saved.id, beforeData: before,
      afterData: { status: saved.status, role: saved.role, removed_at: saved.removed_at, manager_id: saved.manager_id }, reason: reason.trim(),
    });
    return { message: 'Usuário removido da operação sem apagar o histórico.', userId: saved.id, role: saved.role };
  }

  async updateManagementUser(
    userId: string,
    dto: { name?: string; nomeGuerra?: string; email?: string; password?: string; mustChangePassword?: boolean },
    tenantId: string,
  ) {
    const user = await this.userRepository.findOne({ where: { id: userId, tenant_id: tenantId, role: In(['gerencia_level_2', 'recepcao_level_3', 'rh_level_1', 'rh_level_2']), removed_at: IsNull() } });
    if (!user) throw new NotFoundException('Usuário de gestão não encontrado.');
    if (dto.name?.trim()) user.name = dto.name.trim();
    if (dto.nomeGuerra?.trim()) {
      const normalized = this.normalizeNomeGuerra(dto.nomeGuerra);
      const existing = await this.userRepository.findOne({ where: { tenant_id: tenantId, nome_guerra: Raw((alias) => `LOWER(${alias}) = LOWER(:nomeGuerra)`, { nomeGuerra: normalized }), id: Not(userId) } });
      if (existing) throw new BadRequestException('Este Nome de Guerra já está em uso nesta empresa.');
      user.nome_guerra = normalized;
    }
    if (dto.email?.trim()) {
      const normalizedEmail = dto.email.trim().toLowerCase();
      const existingEmail = await this.userRepository.findOne({ where: { email: normalizedEmail } });
      if (existingEmail && existingEmail.id !== userId) throw new BadRequestException('Este e-mail já está cadastrado.');
      user.email = normalizedEmail;
    }
    if (dto.password) {
      user.password_hash = await bcrypt.hash(dto.password, await bcrypt.genSalt(10));
      user.session_version = (user.session_version || 0) + 1;
      user.session_version_mobile = (user.session_version_mobile || 0) + 1;
      user.session_version_web = (user.session_version_web || 0) + 1;
    }
    if (dto.mustChangePassword !== undefined) {
      user.must_change_password = dto.mustChangePassword;
      user.password_reset_expires_at = null;
    }
    const saved = await this.userRepository.save(user);
    void this.auditService.record({ tenantId }, {
      action: 'USER_PROFILE_UPDATED',
      entityType: 'USER',
      entityId: saved.id,
      afterData: { name: saved.name, nome_guerra: saved.nome_guerra, email: saved.email, role: saved.role, must_change_password: saved.must_change_password },
    });
    return {
      message: 'Perfil atualizado com sucesso.',
      user: {
        id: saved.id,
        name: saved.name,
        nome_guerra: saved.nome_guerra,
        email: saved.email,
        role: saved.role,
        must_change_password: saved.must_change_password,
      },
    };
  }

  // 3. Diretoria / RH lista os corretores pendentes de aprovação do tenant
  async findPendingApprovals(managerId: string | null, tenantId: string): Promise<User[]> {
    return this.userRepository.find({
      where: { tenant_id: tenantId, role: 'corretor_level_3', status: 'inactive', removed_at: IsNull() },
      order: { name: 'ASC' },
    });
  }

  // Lista corretores aguardando aprovação pela Diretoria / RH
  async findPendingHrReview(tenantId: string): Promise<any[]> {
    const brokers = await this.userRepository.find({
      where: {
        tenant_id: tenantId,
        role: 'corretor_level_3',
        status: 'inactive',
        removed_at: IsNull(),
      },
      order: { created_at: 'DESC' },
    });

    const managers = await this.userRepository.find({
      where: { tenant_id: tenantId, role: 'gerencia_level_2', status: 'active', removed_at: IsNull() },
      select: { id: true, name: true, nome_guerra: true },
    });
    const managerMap = new Map(managers.map((m) => [m.id, m]));

    return brokers.map((b) => ({
      id: b.id,
      name: b.name,
      nome_guerra: b.nome_guerra,
      email: b.email,
      creci: b.creci,
      broker_stage: b.broker_stage || 'treinamento',
      manager_id: b.manager_id,
      manager_nome_guerra: b.manager_id ? (managerMap.get(b.manager_id)?.nome_guerra || managerMap.get(b.manager_id)?.name || null) : null,
      approved_by_hr: b.approved_by_hr,
      created_at: b.created_at,
    }));
  }

  // RH / Diretoria aprova o cadastro e ativa o corretor imediatamente (liberando check-in)
  async approveBrokerByHr(
    brokerId: string,
    actor: { sub: string; role: string },
    tenantId: string,
    carenciaDays: number = 0,
  ) {
    if (!['diretoria_level_1', 'platform_admin_level_0', 'rh_level_2', 'rh_level_1'].includes(actor.role)) {
      throw new ForbiddenException('Somente a Diretoria e o RH podem aprovar cadastros de corretores.');
    }

    const broker = await this.userRepository.findOne({
      where: { id: brokerId, tenant_id: tenantId, role: 'corretor_level_3', status: 'inactive', removed_at: IsNull() },
    });
    if (!broker) throw new NotFoundException('Corretor não encontrado na fila de triagem ou já aprovado.');

    broker.approved_by_hr = true;

    // Define carência e status
    const carenciaExpiration = new Date();
    carenciaExpiration.setDate(carenciaExpiration.getDate() + carenciaDays);

    if (carenciaDays === 0) {
      broker.status = 'active';
      broker.carencia_ends_at = null;
    } else {
      broker.status = 'grace_period';
      broker.carencia_ends_at = carenciaExpiration;
    }

    // Calcula a vigência do estágio: Treinamento = 90 dias, Estagiário = 180 dias, CRECI = sem validade fixa
    const now = new Date();
    if (broker.broker_stage === 'treinamento') {
      const exp = new Date(now);
      exp.setDate(exp.getDate() + 90);
      broker.stage_expires_at = exp;
    } else if (broker.broker_stage === 'estagiario') {
      const exp = new Date(now);
      exp.setDate(exp.getDate() + 180);
      broker.stage_expires_at = exp;
    } else {
      broker.stage_expires_at = null;
    }

    const saved = await this.userRepository.save(broker);

    // Notifica o gerente responsável informando que um novo corretor foi aprovado para sua equipe
    if (saved.manager_id) {
      this.realtimeService.publish({
        eventType: 'broker.approved',
        tenantId,
        aggregateId: saved.id,
        payload: {
          brokerId: saved.id,
          brokerName: saved.nome_guerra,
          managerId: saved.manager_id,
          stage: saved.broker_stage,
          status: saved.status,
        },
      });

      void this.notificationsService.sendToUser(
        saved.manager_id,
        tenantId,
        'Novo corretor integrado à equipe',
        `O corretor ${saved.nome_guerra} foi aprovado pela Diretoria/RH e já está ativo na sua equipe.`,
        { type: 'broker_approved', brokerId: saved.id },
      );
    }

    // Notifica o próprio corretor
    const approvalMessage = carenciaDays === 0
      ? 'Seu cadastro foi aprovado pela Diretoria/RH sem carência. Você está liberado para realizar check-in e atuar nos plantões.'
      : `Seu cadastro foi aprovado pela Diretoria/RH. Sua carência de leads termina em ${carenciaExpiration.toLocaleDateString('pt-BR')}.`;
    void this.notificationsService.sendToUser(
      saved.id,
      tenantId,
      'Cadastro aprovado',
      approvalMessage,
      { type: 'broker_approved', brokerId: saved.id, carenciaDays, brokerStage: saved.broker_stage, approvedBy: actor.sub, approvedByRole: actor.role },
    );

    void this.auditService.record({ tenantId, actorUserId: actor.sub, actorRole: actor.role }, {
      action: 'BROKER_DIRECTOR_APPROVED', entityType: 'USER', entityId: saved.id,
      afterData: { brokerId: saved.id, nome_guerra: saved.nome_guerra, manager_id: saved.manager_id, status: saved.status, approved_by_hr: true },
      reason: 'Cadastro aprovado e ativado pela Diretoria/RH',
    });

    return {
      message: `Corretor ${saved.nome_guerra} aprovado com sucesso pela Diretoria/RH e liberado para check-in!`,
      broker: { id: saved.id, nome_guerra: saved.nome_guerra, stage: saved.broker_stage, status: saved.status },
    };
  }

  // RH / Diretoria ajusta dados do corretor antes de aprovar
  async updateBrokerByHr(
    brokerId: string,
    dto: { name?: string; nomeGuerra?: string; creci?: string; brokerStage?: 'treinamento' | 'estagiario' | 'corretor_creci'; managerId?: string },
    actor: { sub: string; role: string },
    tenantId: string,
  ) {
    if (!['diretoria_level_1', 'platform_admin_level_0', 'rh_level_2', 'rh_level_1'].includes(actor.role)) {
      throw new ForbiddenException('Somente a Diretoria e o RH podem ajustar dados na triagem.');
    }

    const broker = await this.userRepository.findOne({
      where: { id: brokerId, tenant_id: tenantId, role: 'corretor_level_3', status: 'inactive', removed_at: IsNull() },
    });
    if (!broker) throw new NotFoundException('Corretor não encontrado na fila de triagem.');

    if (dto.nomeGuerra) {
      const normalized = this.normalizeNomeGuerra(dto.nomeGuerra);
      const existing = await this.userRepository.findOne({
        where: { nome_guerra: Raw((alias) => `LOWER(${alias}) = LOWER(:nomeGuerra)`, { nomeGuerra: normalized }), tenant_id: tenantId, id: Not(broker.id) },
      });
      if (existing) throw new BadRequestException(`O nome de guerra '${normalized}' já está em uso nesta empresa.`);
      broker.nome_guerra = normalized;
    }

    if (dto.name !== undefined) broker.name = dto.name.trim();
    if (dto.creci !== undefined) broker.creci = dto.creci ? dto.creci.trim().toUpperCase() : null;
    if (dto.brokerStage !== undefined) broker.broker_stage = dto.brokerStage;
    if (dto.managerId !== undefined) {
      const manager = await this.userRepository.findOne({ where: { id: dto.managerId, tenant_id: tenantId, role: 'gerencia_level_2', status: 'active' } });
      if (!manager) throw new BadRequestException('O gerente selecionado não é válido ou não está ativo.');
      broker.manager_id = manager.id;
    }

    const saved = await this.userRepository.save(broker);
    return {
      message: 'Dados do corretor atualizados com sucesso pelo RH.',
      broker: { id: saved.id, name: saved.name, nome_guerra: saved.nome_guerra, creci: saved.creci, broker_stage: saved.broker_stage, manager_id: saved.manager_id },
    };
  }

  // RH / Diretoria solicita correção de documentos enviando e-mail ao corretor (com instrução fixa de envio)
  async notifyBrokerDocumentCorrection(
    brokerId: string,
    dto: { message: string },
    actor: { sub: string; role: string },
    tenantId: string,
  ) {
    if (!['diretoria_level_1', 'platform_admin_level_0', 'rh_level_2', 'rh_level_1'].includes(actor.role)) {
      throw new ForbiddenException('Somente a Diretoria e o RH podem solicitar correção de documentos.');
    }

    const broker = await this.userRepository.findOne({
      where: { id: brokerId, tenant_id: tenantId, role: 'corretor_level_3' },
    });
    if (!broker || broker.removed_at) throw new NotFoundException('Corretor não encontrado ou já removido.');

    const manager = broker.manager_id ? await this.userRepository.findOne({ where: { id: broker.manager_id, tenant_id: tenantId } }) : null;
    const currentTenant = await this.tenantRepository.findOne({ where: { id: tenantId } });

    const sent = await this.emailService.sendBrokerDocumentCorrectionRequest({
      brokerName: broker.name,
      brokerNomeGuerra: broker.nome_guerra,
      brokerEmail: broker.email,
      brokerStage: broker.broker_stage || 'treinamento',
      managerNomeGuerra: manager?.nome_guerra || manager?.name || 'Sem gerente',
      tenantName: currentTenant?.name || 'ABIATAR',
      message: dto.message.trim(),
    });

    void this.auditService.record({ tenantId, actorUserId: actor.sub, actorRole: actor.role }, {
      action: 'BROKER_DOC_CORRECTION_REQUESTED', entityType: 'USER', entityId: broker.id,
      beforeData: { brokerEmail: broker.email, status: broker.status },
      afterData: { brokerEmail: broker.email, message: dto.message.trim(), emailSent: sent },
      reason: 'Solicitação de correção de documentos enviada por e-mail ao corretor',
    });

    return {
      message: sent
        ? `Correção solicitada por e-mail para ${broker.nome_guerra}.`
        : 'Não foi possível enviar o e-mail (verifique a configuração de e-mail). A solicitação foi registrada.',
      brokerEmail: broker.email,
      emailSent: sent,
    };
  }

  // RH / Diretoria exclui definitivamente (Hard Delete) para liberar Nome de Guerra e E-mail imediatamente
  async hardDeleteBroker(brokerId: string, actor: { sub: string; role: string }, tenantId: string) {
    if (!['diretoria_level_1', 'platform_admin_level_0', 'rh_level_2', 'rh_level_1'].includes(actor.role)) {
      throw new ForbiddenException('Somente a Diretoria e o RH podem excluir cadastros.');
    }

    const broker = await this.userRepository.findOne({
      where: { id: brokerId, tenant_id: tenantId, role: 'corretor_level_3' },
    });
    if (!broker) throw new NotFoundException('Corretor não encontrado.');

    const beforeInfo = { id: broker.id, name: broker.name, nome_guerra: broker.nome_guerra, email: broker.email };

    // Hard delete no banco de dados para liberar imediatamente o Nome de Guerra e E-mail
    await this.userRepository.delete({ id: broker.id, tenant_id: tenantId });

    void this.auditService.record({ tenantId, actorUserId: actor.sub, actorRole: actor.role }, {
      action: 'BROKER_HARD_DELETED', entityType: 'USER', entityId: broker.id,
      beforeData: beforeInfo,
      reason: 'Cadastro excluído definitivamente na triagem para liberação de Nome de Guerra',
    });

    return {
      message: `Cadastro de ${beforeInfo.nome_guerra} excluído com sucesso. O Nome de Guerra e E-mail foram liberados.`,
    };
  }

  // 4. Diretoria / RH aprova o corretor e define a faixa de carência (0, 7, 15 ou 30 dias)
  async approveBroker(
    brokerId: string,
    dto: ApproveBrokerDto,
    approver: { sub: string; role: string },
    tenantId: string,
  ) {
    if (!['diretoria_level_1', 'platform_admin_level_0', 'rh_level_2', 'rh_level_1'].includes(approver.role)) {
      throw new ForbiddenException('Somente a Diretoria e o RH podem aprovar Corretores.');
    }

    const broker = await this.userRepository.findOne({
      where: { id: brokerId, tenant_id: tenantId, role: 'corretor_level_3' },
    });

    if (!broker) {
      throw new NotFoundException('Corretor não encontrado neste tenant.');
    }

    if (broker.status !== 'inactive') {
      throw new BadRequestException('Este corretor já foi aprovado ou está ativo.');
    }

    broker.approved_by_hr = true;

    // Calcula a data exata em que a carência de leads vai expirar
    const carenciaExpiration = new Date();
    carenciaExpiration.setDate(carenciaExpiration.getDate() + dto.carenciaDays);

    if (dto.carenciaDays === 0) {
      broker.status = 'active';
      broker.carencia_ends_at = null;
    } else {
      broker.status = 'grace_period';
      broker.carencia_ends_at = carenciaExpiration;
    }

    if (dto.brokerStage) {
      broker.broker_stage = dto.brokerStage;
    }

    // Calcula a vigência do estágio: Treinamento = 90 dias, Estagiário = 180 dias, CRECI = sem validade fixa
    const now = new Date();
    if (broker.broker_stage === 'treinamento') {
      const exp = new Date(now);
      exp.setDate(exp.getDate() + 90);
      broker.stage_expires_at = exp;
    } else if (broker.broker_stage === 'estagiario') {
      const exp = new Date(now);
      exp.setDate(exp.getDate() + 180);
      broker.stage_expires_at = exp;
    } else {
      broker.stage_expires_at = null;
    }

    await this.userRepository.save(broker);
    this.realtimeService.publish({
      eventType: 'broker.approved',
      tenantId,
      aggregateId: broker.id,
      payload: {
        brokerId: broker.id,
        managerId: broker.manager_id,
        status: broker.status,
        brokerStage: broker.broker_stage,
        stageExpiresAt: broker.stage_expires_at,
        carenciaEndsAt: broker.carencia_ends_at,
      },
    });
    const approvalMessage = dto.carenciaDays === 0
      ? 'Seu cadastro foi aprovado sem carência. Você poderá atuar conforme as regras de presença e elegibilidade.'
      : `Seu cadastro foi aprovado. Sua carência termina em ${carenciaExpiration.toLocaleDateString('pt-BR')}.`;
    void this.notificationsService.sendToUser(
      broker.id,
      tenantId,
      'Cadastro aprovado',
      approvalMessage,
      { type: 'broker_approved', brokerId: broker.id, carenciaDays: dto.carenciaDays, brokerStage: broker.broker_stage, approvedBy: approver.sub, approvedByRole: approver.role },
    );

    return {
      message: dto.carenciaDays === 0
        ? `Corretor '${broker.nome_guerra}' aprovado sem carência.`
        : `Corretor '${broker.nome_guerra}' aprovado com sucesso! Carência definida por ${dto.carenciaDays} dias.`,
      carencia_ends_at: broker.carencia_ends_at,
      broker_stage: broker.broker_stage,
      stage_expires_at: broker.stage_expires_at,
    };
  }

  private enrichBrokerCompliance(broker: any) {
    const now = new Date();
    let daysUntilExpiry: number | null = null;
    let isStageExpired = false;
    let daysSinceLastCheckin: number | null = null;
    let isInactive90d = false;
    let suspensionReason: string | null = null;

    if (broker.stage_expires_at) {
      const exp = new Date(broker.stage_expires_at);
      const diffMs = exp.getTime() - now.getTime();
      daysUntilExpiry = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      if (daysUntilExpiry <= 0) {
        isStageExpired = true;
        suspensionReason = 'Estágio Vencido (Apenas Diretoria pode renovar/promover)';
      }
    }

    const lastActivity = broker.last_checkin_at || broker.created_at;
    if (lastActivity) {
      const actDate = new Date(lastActivity);
      const diffMs = now.getTime() - actDate.getTime();
      daysSinceLastCheckin = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      if (broker.broker_stage === 'corretor_creci' && daysSinceLastCheckin >= 90) {
        isInactive90d = true;
        suspensionReason = 'Inativo há mais de 90 dias sem check-in';
      }
    }

    const isSuspended = isStageExpired || isInactive90d || (broker.status === 'inactive' && !broker.removed_at);

    return {
      ...broker,
      stage_expires_at: broker.stage_expires_at || null,
      days_until_stage_expiry: daysUntilExpiry,
      is_stage_expired: isStageExpired,
      last_checkin_at: broker.last_checkin_at || null,
      days_since_last_checkin: daysSinceLastCheckin,
      is_inactive_90d: isInactive90d,
      suspension_reason: suspensionReason,
      is_suspended: isSuspended,
    };
  }

  private async getBrokerForManagement(
    brokerId: string,
    actor: { sub: string; role: string },
    tenantId: string,
  ): Promise<User> {
    const broker = await this.userRepository.findOne({
      where: { id: brokerId, tenant_id: tenantId, role: 'corretor_level_3' },
    });
    if (!broker || broker.removed_at) throw new NotFoundException('Corretor não encontrado ou já removido.');
    if (actor.role === 'gerencia_level_2' && broker.manager_id !== actor.sub) {
      throw new NotFoundException('Corretor não pertence à sua gerência.');
    }
    if (!['diretoria_level_1', 'gerencia_level_2', 'platform_admin_level_0', 'rh_level_2', 'rh_level_1'].includes(actor.role)) {
      throw new BadRequestException('Perfil sem permissão para gerenciar Corretores.');
    }
    return broker;
  }

  async getBrokerManagementProfile(brokerId: string, actor: { sub: string; role: string }, tenantId: string) {
    const broker = await this.getBrokerForManagement(brokerId, actor, tenantId);
    const manager = broker.manager_id ? await this.userRepository.findOne({ where: { id: broker.manager_id, tenant_id: tenantId } }) : null;
    const enriched = this.enrichBrokerCompliance(broker);
    return {
      id: broker.id,
      name: broker.name,
      nome_guerra: broker.nome_guerra,
      email: broker.email,
      creci: broker.creci,
      broker_stage: broker.broker_stage || 'corretor_creci',
      role: broker.role,
      status: broker.status,
      manager_id: broker.manager_id,
      manager_nome_guerra: manager?.nome_guerra || null,
      leads_paused: broker.leads_paused,
      leads_pause_reason: broker.leads_pause_reason,
      removed_at: broker.removed_at,
      carencia_ends_at: broker.carencia_ends_at,
      stage_expires_at: enriched.stage_expires_at,
      days_until_stage_expiry: enriched.days_until_stage_expiry,
      is_stage_expired: enriched.is_stage_expired,
      last_checkin_at: enriched.last_checkin_at,
      days_since_last_checkin: enriched.days_since_last_checkin,
      is_inactive_90d: enriched.is_inactive_90d,
      suspension_reason: enriched.suspension_reason,
      is_suspended: enriched.is_suspended,
      created_at: broker.created_at,
      updated_at: broker.updated_at,
    };
  }

  async updateBrokerProfile(
    brokerId: string,
    dto: UpdateBrokerProfileDto,
    actor: { sub: string; role: string },
    tenantId: string,
  ) {
    const broker = await this.getBrokerForManagement(brokerId, actor, tenantId);
    const before = { name: broker.name, nome_guerra: broker.nome_guerra, email: broker.email, creci: broker.creci, broker_stage: broker.broker_stage };
    if (dto.email && dto.email !== broker.email) {
      const existingEmail = await this.userRepository.findOne({ where: { email: dto.email } });
      if (existingEmail && existingEmail.id !== broker.id) throw new BadRequestException('Este e-mail já está em uso.');
    }
    if (dto.nomeGuerra) {
      const normalized = this.normalizeNomeGuerra(dto.nomeGuerra);
      const existing = await this.userRepository.findOne({
        where: { nome_guerra: Raw((alias) => `LOWER(${alias}) = LOWER(:nomeGuerra)`, { nomeGuerra: normalized }), tenant_id: tenantId },
      });
      if (existing && existing.id !== broker.id) throw new BadRequestException(`O nome de guerra '${normalized}' já está em uso nesta empresa.`);
      broker.nome_guerra = normalized;
    }
    if (dto.name !== undefined) broker.name = dto.name.trim();
    if (dto.email !== undefined) broker.email = dto.email.trim().toLowerCase();
    if (dto.creci !== undefined) broker.creci = dto.creci ? dto.creci.trim().toUpperCase() : null;
    if (dto.brokerStage !== undefined) broker.broker_stage = dto.brokerStage;
    const saved = await this.userRepository.save(broker);
    void this.auditService.record({ tenantId, actorUserId: actor.sub, actorRole: actor.role }, {
      action: 'BROKER_PROFILE_UPDATED', entityType: 'USER', entityId: saved.id, beforeData: before,
      afterData: { name: saved.name, nome_guerra: saved.nome_guerra, email: saved.email, creci: saved.creci, broker_stage: saved.broker_stage },
    });
    return this.getBrokerManagementProfile(saved.id, actor, tenantId);
  }

  async updateBrokerStage(
    brokerId: string,
    dto: UpdateBrokerStageDto,
    actor: { sub: string; role: string },
    tenantId: string,
  ) {
    if (!['diretoria_level_1', 'platform_admin_level_0', 'rh_level_2', 'rh_level_1'].includes(actor.role)) {
      throw new ForbiddenException('Somente a Diretoria e o RH podem renovar ou promover estágios de Corretores.');
    }
    const broker = await this.getBrokerForManagement(brokerId, actor, tenantId);
    const before = {
      broker_stage: broker.broker_stage,
      stage_expires_at: broker.stage_expires_at,
      creci: broker.creci,
      status: broker.status,
    };

    const now = new Date();

    if (dto.brokerStage) {
      broker.broker_stage = dto.brokerStage;
      if (dto.brokerStage === 'corretor_creci') {
        broker.stage_expires_at = null;
      } else if (dto.brokerStage === 'estagiario' && !dto.newExpiresAt && !dto.extendDays) {
        const exp = new Date(now);
        exp.setDate(exp.getDate() + 180);
        broker.stage_expires_at = exp;
      } else if (dto.brokerStage === 'treinamento' && !dto.newExpiresAt && !dto.extendDays) {
        const exp = new Date(now);
        exp.setDate(exp.getDate() + 90);
        broker.stage_expires_at = exp;
      }
    }

    if (dto.creci !== undefined) {
      broker.creci = dto.creci ? dto.creci.trim().toUpperCase() : null;
    }

    if (dto.extendDays && Number(dto.extendDays) > 0) {
      const baseDate = (broker.stage_expires_at && new Date(broker.stage_expires_at) > now)
        ? new Date(broker.stage_expires_at)
        : new Date(now);
      baseDate.setDate(baseDate.getDate() + Number(dto.extendDays));
      broker.stage_expires_at = baseDate;
    } else if (dto.newExpiresAt) {
      broker.stage_expires_at = new Date(dto.newExpiresAt);
    }

    // Se o corretor estava inativo/suspenso por vencimento de estágio ou inatividade, reativa imediatamente
    if (broker.status === 'inactive' && !broker.removed_at) {
      broker.status = 'active';
      broker.leads_paused = false;
      broker.leads_pause_reason = null;
    }

    const saved = await this.userRepository.save(broker);

    this.realtimeService.publish({
      eventType: 'broker.stage_upgraded',
      tenantId,
      aggregateId: saved.id,
      payload: {
        brokerId: saved.id,
        managerId: saved.manager_id,
        brokerStage: saved.broker_stage,
        stageExpiresAt: saved.stage_expires_at,
        creci: saved.creci,
        status: saved.status,
      },
    });

    void this.auditService.record({ tenantId, actorUserId: actor.sub, actorRole: actor.role }, {
      action: 'BROKER_STAGE_UPDATED',
      entityType: 'USER',
      entityId: saved.id,
      beforeData: before,
      afterData: {
        broker_stage: saved.broker_stage,
        stage_expires_at: saved.stage_expires_at,
        creci: saved.creci,
        status: saved.status,
      },
      reason: dto.reason || `Estágio/Vigência atualizado para '${saved.broker_stage}' pela Diretoria`,
    });

    return this.getBrokerManagementProfile(saved.id, actor, tenantId);
  }

  async setBrokerLeadPause(
    brokerId: string,
    paused: boolean,
    dto: UpdateBrokerLeadPauseDto,
    actor: { sub: string; role: string },
    tenantId: string,
  ) {
    const broker = await this.getBrokerForManagement(brokerId, actor, tenantId);
    const before = { leads_paused: broker.leads_paused, leads_pause_reason: broker.leads_pause_reason };
    broker.leads_paused = paused;
    broker.leads_pause_reason = paused ? dto.reason.trim() : null;
    const saved = await this.userRepository.save(broker);
    void this.auditService.record({ tenantId, actorUserId: actor.sub, actorRole: actor.role }, {
      action: paused ? 'BROKER_LEADS_PAUSED' : 'BROKER_LEADS_RESUMED', entityType: 'USER', entityId: saved.id,
      beforeData: before, afterData: { leads_paused: saved.leads_paused, leads_pause_reason: saved.leads_pause_reason }, reason: dto.reason,
    });
    return this.getBrokerManagementProfile(saved.id, actor, tenantId);
  }

  async removeBroker(brokerId: string, reason: string, actor: { sub: string; role: string }, tenantId: string) {
    const broker = await this.getBrokerForManagement(brokerId, actor, tenantId);
    broker.status = 'inactive';
    broker.leads_paused = true;
    broker.leads_pause_reason = reason.trim();
    broker.removed_at = new Date();
    broker.removed_by = actor.sub;
    broker.session_version = (broker.session_version || 0) + 1;
    const saved = await this.userRepository.save(broker);
    void this.auditService.record({ tenantId, actorUserId: actor.sub, actorRole: actor.role }, {
      action: 'BROKER_REMOVED', entityType: 'USER', entityId: saved.id,
      beforeData: { status: 'active', manager_id: saved.manager_id },
      afterData: { status: saved.status, removed_at: saved.removed_at, manager_id: saved.manager_id }, reason: reason.trim(),
    });
    return { message: 'Corretor removido da operação sem apagar o histórico.', brokerId: saved.id };
  }

  async transferBroker(
    brokerId: string,
    dto: TransferBrokerDto,
    actor: { sub: string; role: string },
    tenantId: string,
  ) {
    if (!['diretoria_level_1', 'platform_admin_level_0'].includes(actor.role)) {
      throw new BadRequestException('Somente a Diretoria pode transferir Corretores.');
    }
    const broker = await this.getBrokerForManagement(brokerId, actor, tenantId);
    const manager = await this.userRepository.findOne({ where: { id: dto.managerId, tenant_id: tenantId, role: 'gerencia_level_2', status: 'active' } });
    if (!manager || manager.removed_at) throw new BadRequestException('O Gerente selecionado não está ativo neste tenant.');
    const beforeManagerId = broker.manager_id;
    broker.manager_id = manager.id;
    const saved = await this.userRepository.save(broker);
    void this.auditService.record({ tenantId, actorUserId: actor.sub, actorRole: actor.role }, {
      action: 'BROKER_TRANSFERRED', entityType: 'USER', entityId: saved.id,
      beforeData: { manager_id: beforeManagerId }, afterData: { manager_id: saved.manager_id, manager_nome_guerra: manager.nome_guerra }, reason: dto.reason || null,
    });
    return this.getBrokerManagementProfile(saved.id, actor, tenantId);
  }

  // 5. Gerente lista os corretores ativos e em carência do seu time
  async findTeam(managerId: string, tenantId: string, query: { page?: number; pageSize?: number; search?: string; status?: string } = {}) {
    return this.listBrokerScope(tenantId, { managerId, ...query });
  }

  // Lista todos os Corretores ativos e em carência do tenant para a Diretoria.
  async listActiveBrokersForDirector(tenantId: string, query: { page?: number; pageSize?: number; search?: string; status?: string; managerId?: string } = {}) {
    return this.listBrokerScope(tenantId, query);
  }

  private async listBrokerScope(tenantId: string, query: { page?: number; pageSize?: number; search?: string; status?: string; managerId?: string } = {}) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = await this.resolvePageSize(tenantId, query.pageSize);
    const qb = this.userRepository.createQueryBuilder('user')
      .where('user.tenant_id = :tenantId', { tenantId })
      .andWhere('user.role = :role', { role: 'corretor_level_3' })
      .andWhere('user.removed_at IS NULL');
    if (query.managerId) qb.andWhere('user.manager_id = :managerId', { managerId: query.managerId });
    if (query.status && ['active', 'grace_period', 'inactive'].includes(query.status)) qb.andWhere('user.status = :status', { status: query.status });
    else qb.andWhere('user.status IN (:...statuses)', { statuses: ['active', 'grace_period'] });
    const search = query.search?.trim();
    if (search) qb.andWhere(new Brackets((sub) => sub.where('LOWER(user.name) LIKE LOWER(:search)', { search: `%${search}%` }).orWhere('LOWER(user.nome_guerra) LIKE LOWER(:search)', { search: `%${search}%` }).orWhere('LOWER(user.email) LIKE LOWER(:search)', { search: `%${search}%` })));
    const [rawUsers, total] = await qb.orderBy('user.name', 'ASC').skip((page - 1) * pageSize).take(pageSize).getManyAndCount();
    const data = rawUsers.map((user) => this.enrichBrokerCompliance(user));
    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  // Lista de corretores para a Recepção efetuar o check-in manual (Plano B)
  async listBrokersForReception(receptionistId: string, tenantId: string) {
    const caller = await this.userRepository.findOne({ where: { id: receptionistId, tenant_id: tenantId } });
    if (!caller || !['recepcao_level_3', 'diretoria_level_1', 'gerencia_level_2', 'platform_admin_level_0'].includes(caller.role)) {
      throw new ForbiddenException('Acesso restrito à Recepção, Diretoria, Gerência ou Admin da plataforma.');
    }

    const brokers = await this.userRepository.find({
      where: { tenant_id: tenantId, role: 'corretor_level_3', removed_at: IsNull(), status: In(['active', 'grace_period']) },
      order: { nome_guerra: 'ASC' },
      select: {
        id: true,
        nome_guerra: true,
        name: true,
        creci: true,
        broker_stage: true,
        status: true,
        stage_expires_at: true,
      },
    });

    const presenceRepo = this.userRepository.manager.getRepository(Presence);
    const activePresences = await presenceRepo.find({
      where: { tenant_id: tenantId, status: In(['online', 'absent']) },
    });
    const byBroker = new Map<string, Presence>();
    for (const presence of activePresences) {
      if (!byBroker.has(presence.broker_id)) byBroker.set(presence.broker_id, presence);
    }

    return brokers.map((broker) => {
      const presence = byBroker.get(broker.id);
      return {
        id: broker.id,
        nomeGuerra: broker.nome_guerra,
        name: broker.name,
        creci: broker.creci,
        brokerStage: broker.broker_stage,
        status: broker.status,
        stageExpired: !!broker.stage_expires_at && new Date(broker.stage_expires_at) <= new Date(),
        activePresence: presence ? { presenceId: presence.id, boothId: presence.booth_id, status: presence.status } : null,
      };
    });
  }

  // 6. Motor Agendador Cron: Roda automaticamente todas as noites à meia-noite
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleDailyBrokerComplianceCron() {
    console.log('[CRON] Iniciando verificação diária de conformidade de corretores (carências e estágios)...');
    await this.processCarenciaExpirations();
    await this.processStageExpirationsAndInactivity();
  }

  // 7. Método Auxiliar para processar as carências vencidas
  async processCarenciaExpirations() {
    const now = new Date();
    const expiredBrokers = await this.userRepository.find({
      where: {
        status: 'grace_period',
        carencia_ends_at: LessThanOrEqual(now),
      },
    });

    let activatedCount = 0;
    for (const broker of expiredBrokers) {
      broker.status = 'active';
      await this.userRepository.save(broker);
      activatedCount++;
      console.log(`[CRON] Carência encerrada para o corretor '${broker.nome_guerra}'. Usuário ativado!`);
    }

    return {
      processedBrokers: expiredBrokers.length,
      activatedCount,
    };
  }

  // Processa automaticamente suspensões por vencimento de estágio ou 90 dias sem check-in
  async processStageExpirationsAndInactivity() {
    const now = new Date();
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const activeBrokers = await this.userRepository.find({
      where: {
        role: 'corretor_level_3',
        status: In(['active', 'grace_period']),
        removed_at: IsNull(),
      },
    });

    let suspendedStageCount = 0;
    let suspendedInactivityCount = 0;

    for (const broker of activeBrokers) {
      let shouldSuspend = false;
      let reason = '';

      // 1. Regra de Vencimento de Estágio (Treinamento / Estagiário)
      if (broker.stage_expires_at && new Date(broker.stage_expires_at) <= now) {
        shouldSuspend = true;
        reason = `Estágio '${broker.broker_stage}' expirado em ${new Date(broker.stage_expires_at).toLocaleDateString('pt-BR')}.`;
        suspendedStageCount++;
      }
      // 2. Regra de Inatividade de Corretor CRECI (> 90 dias sem check-in)
      else if (broker.broker_stage === 'corretor_creci') {
        const lastAct = broker.last_checkin_at || broker.created_at;
        if (lastAct && new Date(lastAct) <= ninetyDaysAgo) {
          shouldSuspend = true;
          reason = 'Inativo há mais de 90 dias consecutivos sem check-in em plantão.';
          suspendedInactivityCount++;
        }
      }

      if (shouldSuspend) {
        broker.status = 'inactive';
        broker.leads_paused = true;
        broker.leads_pause_reason = reason;
        broker.session_version = (broker.session_version || 0) + 1;
        await this.userRepository.save(broker);

        this.realtimeService.publish({
          eventType: 'broker.suspended',
          tenantId: broker.tenant_id,
          aggregateId: broker.id,
          payload: { brokerId: broker.id, managerId: broker.manager_id, reason },
        });

        void this.auditService.record({ tenantId: broker.tenant_id }, {
          action: 'BROKER_SUSPENDED_COMPLIANCE',
          entityType: 'USER',
          entityId: broker.id,
          reason,
        });

        console.log(`[COMPLIANCE] Corretor '${broker.nome_guerra}' suspenso: ${reason}`);
      }
    }

    return {
      processedBrokers: activeBrokers.length,
      suspendedStageCount,
      suspendedInactivityCount,
    };
  }
  // Adicione este método dentro de UsersService, em src/users/users.service.ts

   // 8. Retorna a Fila de Leads / Roleta ativa em tempo real (com isolamento por equipe de gerência) [6, 10]
  async getRealTimeLeadsQueue(tenantId: string, actor?: { sub: string; role: string }) {
    const isManager = actor?.role === 'gerencia_level_2';
    
    // A. Busca os corretores (Nível 3) do tenant ou restrito à equipe do gerente logado
    const brokers = await this.userRepository.find({
      where: isManager
        ? { tenant_id: tenantId, role: 'corretor_level_3', manager_id: actor!.sub, removed_at: IsNull() }
        : { tenant_id: tenantId, role: 'corretor_level_3', removed_at: IsNull() },
      order: { name: 'ASC' },
    });

    const queue: any[] = [];
    const presenceByBroker = new Map<string, any>();

    for (const broker of brokers) {
      // B. Busca o gerente associado para exibir o nome de guerra
      let managerName = 'Sem Gerente';
      if (broker.manager_id) {
        const manager = await this.userRepository.findOne({ where: { id: broker.manager_id } });
        if (manager) {
          managerName = manager.nome_guerra;
        }
      }

      // C. Busca a presença ativa ("online") ou suspensa ("absent") deste corretor
      const activePresence = await this.userRepository.manager.getRepository('presences').findOne({
        where: [
          { broker_id: broker.id, tenant_id: tenantId, status: 'online' },
          { broker_id: broker.id, tenant_id: tenantId, status: 'absent' },
        ],
        relations: { booth: true },
        order: { check_in_at: 'DESC' },
      }) as any;

      presenceByBroker.set(broker.id, activePresence || null);

      const isPresent = activePresence?.status === 'online';
      const isSuspended = activePresence?.status === 'absent';
      const isOutOfCarencia = broker.status === 'active'; // Ativo = fora da carência [10]

      // D. REGRA DE OURO: Habilitado se presente + fora de carência + leads não pausados + não removido
      const isHabilitado = isPresent && isOutOfCarencia && !broker.leads_paused && !broker.removed_at;

      const minutesActive = activePresence
        ? Math.max(0, Math.floor((Date.now() - new Date(activePresence.validation_starts_at || activePresence.check_in_at).getTime()) / 1000 / 60))
        : 0;

      queue.push({
        brokerId: broker.id,
        nomeGuerra: broker.nome_guerra,
        managerName: managerName,
        statusPresenca: isSuspended
          ? `🟠 SUSPENSO (${activePresence.booth?.name || 'Plantão'})`
          : (isPresent ? `🟢 ONLINE (${activePresence.booth?.name || 'Plantão'})` : '🔴 OFFLINE'),
        statusCarencia: broker.removed_at ? '⚫ REMOVIDO' : (broker.status === 'grace_period' ? '🟡 EM CARÊNCIA' : (isOutOfCarencia ? '🟢 ATIVO' : '🔴 INATIVO')),
        leadsPaused: broker.leads_paused,
        isHabilitado: isHabilitado ? '🟢 HABILITADO' : '🔴 BLOQUEADO',
        roletaName: activePresence?.roleta_name || null,
        roletaEntryType: activePresence?.roleta_entry_type || null,
        roletaPosition: activePresence?.roleta_position || null,
        checkInAt: activePresence?.check_in_at || null,
        statusPresence: activePresence?.status || null,
        suspendedAt: activePresence?.check_out_at || null,
        minutesActive,
        minimumRequiredMinutes: activePresence?.minimum_period_minutes || 120,
        dataAtualizacao: new Date().toLocaleDateString('pt-BR'),
      });
    }

    // E. Recalcula a posição EFEITVA da fila por roleta/plantão, desconsiderando corretores já atendidos.
    // Assim, quando a Recepção atende o 1º, o 2º sobe automaticamente em todos os dashboards.
    const roletaGroups = new Map<string, any[]>();
    for (const item of queue) {
      const key = item.roletaName ? `${item.roletaName}` : '';
      if (!key) continue;
      if (!roletaGroups.has(key)) roletaGroups.set(key, []);
      roletaGroups.get(key)!.push(item);
    }
    const roletaEffectivePosition = new Map<string, number>();
    for (const [key, group] of roletaGroups) {
      group.sort((a, b) => {
        const aPos = a.roletaPosition ?? Number.MAX_SAFE_INTEGER;
        const bPos = b.roletaPosition ?? Number.MAX_SAFE_INTEGER;
        if (aPos === bPos) return a.nomeGuerra.localeCompare(b.nomeGuerra);
        return aPos - bPos;
      });
      let position = 1;
      for (const item of group) {
        const presence = presenceByBroker.get(item.brokerId);
        if (presence?.attended_at) continue; // Já atendido: sai da posição e os demais sobem
        roletaEffectivePosition.set(item.brokerId, position);
        item.roletaPosition = position;
        position++;
      }
    }

    // Ordenação da fila de leads: primeiro os habilitados por posição na roleta, depois pontualidade, depois nome
    queue.sort((a, b) => {
      if (a.isHabilitado === '🟢 HABILITADO' && b.isHabilitado !== '🟢 HABILITADO') return -1;
      if (a.isHabilitado !== '🟢 HABILITADO' && b.isHabilitado === '🟢 HABILITADO') return 1;
      const aPos = a.roletaPosition ?? Number.MAX_SAFE_INTEGER;
      const bPos = b.roletaPosition ?? Number.MAX_SAFE_INTEGER;
      if (aPos !== bPos) return aPos - bPos;
      return a.nomeGuerra.localeCompare(b.nomeGuerra);
    });

    return {
      message: 'Fila de distribuição de leads da Roleta carregada.',
      queue,
    };
  }

  async seedCleanHierarchy(tenantId: string, actor: { id: string; role: string }) {
    if (actor.role !== 'diretoria_level_1' && actor.role !== 'platform_admin_level_0') {
      throw new BadRequestException('Apenas a Diretoria pode executar a limpeza e pulverização da base.');
    }

    const tenant = await this.tenantRepository.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant não encontrado.');

    try {
      // 1. Garante o diretor antes de tudo
      const defaultPasswordHash = await bcrypt.hash('12345678', 10);
      const director = await this.userRepository.findOne({
        where: { tenant_id: tenantId, email: 'diretor@abiatar.test' },
      });
      if (director) {
        director.password_hash = defaultPasswordHash;
        director.must_change_password = false;
        director.status = 'active';
        director.removed_at = null;
        await this.userRepository.save(director);
      }
      const directorId = director?.id || actor.id;

      // 2. Limpa tabelas dependentes e desvincula foreign keys em ordem correta
      await this.userRepository.query(`UPDATE booths SET manager_id = NULL, published_by = $2 WHERE tenant_id = $1`, [tenantId, directorId]);
      await this.userRepository.query(`UPDATE booth_rule_sets SET created_by = $2 WHERE tenant_id = $1`, [tenantId, directorId]);
      await this.userRepository.query(`UPDATE users SET manager_id = NULL WHERE tenant_id = $1`, [tenantId]);
      await this.userRepository.query(`UPDATE booth_holidays SET created_by = $2 WHERE tenant_id = $1`, [tenantId, directorId]);
      await this.userRepository.query(`UPDATE audit_logs SET actor_user_id = $2 WHERE tenant_id = $1`, [tenantId, directorId]);
      await this.userRepository.query(`DELETE FROM booth_receptionists WHERE tenant_id = $1`, [tenantId]);
      await this.userRepository.query(`DELETE FROM dead_mans_switch_logs WHERE tenant_id = $1`, [tenantId]);
      await this.userRepository.query(`DELETE FROM presences WHERE tenant_id = $1`, [tenantId]);
      await this.userRepository.query(`DELETE FROM message_recipients WHERE tenant_id = $1`, [tenantId]);
      await this.userRepository.query(`DELETE FROM messages WHERE tenant_id = $1`, [tenantId]);
      await this.userRepository.query(`DELETE FROM manager_onboarding_links WHERE tenant_id = $1`, [tenantId]);
      await this.userRepository.query(`DELETE FROM push_device_tokens WHERE tenant_id = $1`, [tenantId]);
      await this.userRepository.query(`DELETE FROM users WHERE tenant_id = $1 AND email != 'diretor@abiatar.test'`, [tenantId]);

      // 3. Cria os 2 Gerentes
      // Gerente 1
      const gerente1 = this.userRepository.create({
        tenant_id: tenantId,
        name: 'Carlos Roberto Silva',
        nome_guerra: 'GERENTE CARLOS',
        email: 'gerente1@abiatar.test',
        password_hash: defaultPasswordHash,
        role: 'gerencia_level_2',
        status: 'active',
        must_change_password: false,
        leads_paused: false,
      });
      const savedGerente1 = await this.userRepository.save(gerente1);

      // Gerente 2
      const gerente2 = this.userRepository.create({
        tenant_id: tenantId,
        name: 'Mariana Souza Santos',
        nome_guerra: 'GERENTE MARIANA',
        email: 'gerente2@abiatar.test',
        password_hash: defaultPasswordHash,
        role: 'gerencia_level_2',
        status: 'active',
        must_change_password: false,
        leads_paused: false,
      });
      const savedGerente2 = await this.userRepository.save(gerente2);

      // 4. Cria os Corretores
      // Corretor 1 (Abaixo de Gerente 1) - CRECI Pleno
      const corretor1 = this.userRepository.create({
        tenant_id: tenantId,
        name: 'Lucas Oliveira Costa',
        nome_guerra: 'LUCAS OLIVEIRA',
        email: 'corretor1@abiatar.test',
        password_hash: defaultPasswordHash,
        role: 'corretor_level_3',
        manager_id: savedGerente1.id,
        creci: '184920-F',
        broker_stage: 'corretor_creci',
        status: 'active',
        must_change_password: false,
        leads_paused: false,
      });
      const savedCorretor1 = await this.userRepository.save(corretor1);

      // Corretor 2 (Abaixo de Gerente 1) - Estagiário
      const corretor2 = this.userRepository.create({
        tenant_id: tenantId,
        name: 'Fernanda Lima Rocha',
        nome_guerra: 'FERNANDA LIMA',
        email: 'corretor2@abiatar.test',
        password_hash: defaultPasswordHash,
        role: 'corretor_level_3',
        manager_id: savedGerente1.id,
        creci: 'EST-45892',
        broker_stage: 'estagiario',
        status: 'active',
        must_change_password: false,
        leads_paused: false,
      });
      const savedCorretor2 = await this.userRepository.save(corretor2);

      // Corretor 3 (Abaixo de Gerente 2) - CRECI Pleno
      const corretor3 = this.userRepository.create({
        tenant_id: tenantId,
        name: 'Rafael Mendes Alves',
        nome_guerra: 'RAFAEL MENDES',
        email: 'corretor3@abiatar.test',
        password_hash: defaultPasswordHash,
        role: 'corretor_level_3',
        manager_id: savedGerente2.id,
        creci: '219403-F',
        broker_stage: 'corretor_creci',
        status: 'active',
        must_change_password: false,
        leads_paused: false,
      });
      const savedCorretor3 = await this.userRepository.save(corretor3);

      // Recepção de apoio para testes no estande
      const recepcao = this.userRepository.create({
        tenant_id: tenantId,
        name: 'Camila Recepção',
        nome_guerra: 'RECEPCAO',
        email: 'recepcao@abiatar.test',
        password_hash: defaultPasswordHash,
        role: 'recepcao_level_3',
        status: 'active',
        must_change_password: false,
      });
      const savedRecepcao = await this.userRepository.save(recepcao);

      return {
        message: 'Base limpa e pulverizada com sucesso!',
        tenant: tenant.name,
        director: director?.email || 'diretor@abiatar.test',
        managers: [
          { id: savedGerente1.id, name: savedGerente1.name, nomeGuerra: savedGerente1.nome_guerra, email: savedGerente1.email },
          { id: savedGerente2.id, name: savedGerente2.name, nomeGuerra: savedGerente2.nome_guerra, email: savedGerente2.email },
        ],
        brokers: [
          { id: savedCorretor1.id, name: savedCorretor1.name, nomeGuerra: savedCorretor1.nome_guerra, email: savedCorretor1.email, manager: 'GERENTE CARLOS (gerente1@abiatar.test)', creci: savedCorretor1.creci, stage: savedCorretor1.broker_stage },
          { id: savedCorretor2.id, name: savedCorretor2.name, nomeGuerra: savedCorretor2.nome_guerra, email: savedCorretor2.email, manager: 'GERENTE CARLOS (gerente1@abiatar.test)', creci: savedCorretor2.creci, stage: savedCorretor2.broker_stage },
          { id: savedCorretor3.id, name: savedCorretor3.name, nomeGuerra: savedCorretor3.nome_guerra, email: savedCorretor3.email, manager: 'GERENTE MARIANA (gerente2@abiatar.test)', creci: savedCorretor3.creci, stage: savedCorretor3.broker_stage },
        ],
        reception: { id: savedRecepcao.id, email: savedRecepcao.email },
        defaultPassword: 'Todas as contas configuradas com senha: 12345678',
      };
    } catch (err: any) {
      console.error('[SEED ERROR]', err);
      throw new BadRequestException(err?.message || 'Falha ao executar limpeza e seed da base.');
    }
  }

  async cleanForFieldTest(tenantId: string, actor: { id: string; role: string }) {
    if (actor.role !== 'diretoria_level_1' && actor.role !== 'platform_admin_level_0') {
      throw new BadRequestException('Apenas a Diretoria pode preparar o ambiente para testes em campo.');
    }

    const tenant = await this.tenantRepository.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant não encontrado.');

    try {
      const defaultPasswordHash = await bcrypt.hash('12345678', 10);
      
      // 1. Garante Diretor ativo
      let director = await this.userRepository.findOne({
        where: { tenant_id: tenantId, role: 'diretoria_level_1' },
      });
      if (director) {
        director.password_hash = defaultPasswordHash;
        director.must_change_password = false;
        director.status = 'active';
        director.removed_at = null;
        await this.userRepository.save(director);
      }
      const directorId = director?.id || actor.id;

      // 2. Garante Recepção ativa
      let recepcao = await this.userRepository.findOne({
        where: { tenant_id: tenantId, email: 'recepcao@abiatar.test' },
      });
      if (!recepcao) {
        recepcao = this.userRepository.create({
          tenant_id: tenantId,
          name: 'Recepção Central',
          nome_guerra: 'RECEPCAO',
          email: 'recepcao@abiatar.test',
          password_hash: defaultPasswordHash,
          role: 'recepcao_level_3',
          status: 'active',
          must_change_password: false,
          leads_paused: false,
        });
        await this.userRepository.save(recepcao);
      } else {
        recepcao.password_hash = defaultPasswordHash;
        recepcao.must_change_password = false;
        recepcao.status = 'active';
        recepcao.removed_at = null;
        await this.userRepository.save(recepcao);
      }

      // 3. Limpa dependências
      await this.userRepository.query(`UPDATE booths SET manager_id = NULL, published_by = $2 WHERE tenant_id = $1`, [tenantId, directorId]);
      await this.userRepository.query(`UPDATE booth_rule_sets SET created_by = $2 WHERE tenant_id = $1`, [tenantId, directorId]);
      await this.userRepository.query(`UPDATE users SET manager_id = NULL WHERE tenant_id = $1`, [tenantId]);
      await this.userRepository.query(`UPDATE booth_holidays SET created_by = $2 WHERE tenant_id = $1`, [tenantId, directorId]);
      await this.userRepository.query(`UPDATE booth_special_schedules SET created_by = $2 WHERE tenant_id = $1`, [tenantId, directorId]);
      await this.userRepository.query(`UPDATE audit_logs SET actor_user_id = $2 WHERE tenant_id = $1`, [tenantId, directorId]);
      await this.userRepository.query(`DELETE FROM dead_mans_switch_logs WHERE tenant_id = $1`, [tenantId]);
      await this.userRepository.query(`DELETE FROM presences WHERE tenant_id = $1`, [tenantId]);
      await this.userRepository.query(`DELETE FROM message_recipients WHERE tenant_id = $1`, [tenantId]);
      await this.userRepository.query(`DELETE FROM messages WHERE tenant_id = $1`, [tenantId]);
      await this.userRepository.query(`DELETE FROM manager_onboarding_links WHERE tenant_id = $1`, [tenantId]);
      await this.userRepository.query(`DELETE FROM push_device_tokens WHERE tenant_id = $1`, [tenantId]);

      // 4. Exclui TODOS os gerentes e corretores do tenant
      await this.userRepository.query(
        `DELETE FROM users WHERE tenant_id = $1 AND role IN ('gerencia_level_2', 'corretor_level_3')`,
        [tenantId],
      );

      // 5. Consulta usuários remanescentes
      const remainingUsers = await this.userRepository.find({
        where: { tenant_id: tenantId },
        select: { id: true, name: true, nome_guerra: true, email: true, role: true, status: true },
      });

      void this.auditService.record(
        { tenantId, actorUserId: actor.id, actorRole: actor.role },
        {
          action: 'USERS_CLEANED_FOR_FIELD_TEST',
          entityType: 'USER',
          entityId: 'bulk',
          afterData: { remainingUsersCount: remainingUsers.length },
          reason: 'Ambiente limpo para início dos testes em campo com corretores e gerentes reais (mantidos apenas Diretoria e Recepção)',
        },
      );

      return {
        message: 'Ambiente pronto para testes em campo! Todos os gerentes e corretores fictícios foram removidos. Restam apenas Diretor e Recepção.',
        users: remainingUsers,
      };
    } catch (error) {
      console.error('[CLEAN_FIELD_TEST] Falha ao limpar usuários:', error);
      throw new BadRequestException('Falha ao limpar usuários para o teste em campo: ' + (error instanceof Error ? error.message : String(error)));
    }
  }
}