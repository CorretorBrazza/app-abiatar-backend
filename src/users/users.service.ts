// src/users/users.service.ts
import { Injectable, OnModuleInit, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, LessThanOrEqual, Raw, IsNull, In, Not, Brackets } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { Cron, CronExpression } from '@nestjs/schedule';

import { User } from './user.entity';
import { Tenant } from '../tenants/tenant.entity';
import { OnboardingLink } from './entities/onboarding-link.entity';
import { RegisterBrokerDto } from './dto/register-broker.dto';
import { CreateManagerDto } from './dto/create-manager.dto';
import { CreateReceptionistDto } from './dto/create-receptionist.dto';
import { ApproveBrokerDto } from './dto/approve-broker.dto';
import { TransferBrokerDto, UpdateBrokerLeadPauseDto, UpdateBrokerProfileDto, UpdateBrokerStageDto } from './dto/update-broker-profile.dto';
import { NotificationsService } from '../notifications/notifications.service';
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
      console.log('[USERS] Schema auto-healing garantido com sucesso (broker_stage & creci nullable).');
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

    // Cria o registro do Corretor (Status: Inativo, aguardando aprovação do Gerente)
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
      status: 'inactive', // Fica inativo até que o gerente aprove
    });

    const saved: User = await this.userRepository.save(broker);
    if (link) {
      link.is_used = true;
      await this.linkRepository.save(link);
    }

    // Notifica o gerente em tempo real e push
    this.realtimeService.publish({
      eventType: 'broker.registered',
      tenantId,
      aggregateId: saved.id,
      payload: {
        brokerId: saved.id,
        brokerName: saved.nome_guerra,
        managerId,
        stage: saved.broker_stage,
      },
    });

    void this.notificationsService.sendToUser(
      managerId,
      tenantId,
      'Novo corretor cadastrado',
      `O corretor ${saved.nome_guerra} solicitou cadastro na sua equipe. Acesse o painel para aprovar.`,
      { type: 'broker_registered', brokerId: saved.id },
    );

    return {
      message: 'Seu cadastro foi enviado! Aguarde a aprovação do seu gerente para acessar o sistema.',
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
      where: { id: userId, tenant_id: tenantId, role: In(['gerencia_level_2', 'recepcao_level_3']), removed_at: IsNull() },
      select: { id: true, name: true, nome_guerra: true, email: true, role: true, status: true, manager_id: true },
    });
    if (!user) throw new NotFoundException('Usuário de gestão não encontrado.');
    return user;
  }

  async removeManagementUser(userId: string, reason: string, actor: { sub: string; role: string }, tenantId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId, tenant_id: tenantId, role: In(['gerencia_level_2', 'recepcao_level_3']), removed_at: IsNull() } });
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

  async updateManagementUser(userId: string, dto: { name?: string; nomeGuerra?: string }, tenantId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId, tenant_id: tenantId, role: In(['gerencia_level_2', 'recepcao_level_3']), removed_at: IsNull() } });
    if (!user) throw new NotFoundException('Usuário de gestão não encontrado.');
    if (dto.name?.trim()) user.name = dto.name.trim();
    if (dto.nomeGuerra?.trim()) {
      const normalized = this.normalizeNomeGuerra(dto.nomeGuerra);
      const existing = await this.userRepository.findOne({ where: { tenant_id: tenantId, nome_guerra: Raw((alias) => `LOWER(${alias}) = LOWER(:nomeGuerra)`, { nomeGuerra: normalized }), id: Not(userId) } });
      if (existing) throw new BadRequestException('Este Nome de Guerra já está em uso nesta empresa.');
      user.nome_guerra = normalized;
    }
    const saved = await this.userRepository.save(user);
    void this.auditService.record({ tenantId }, { action: 'USER_PROFILE_UPDATED', entityType: 'USER', entityId: saved.id, afterData: { name: saved.name, nome_guerra: saved.nome_guerra, role: saved.role } });
    return { message: 'Perfil atualizado com sucesso.', user: { id: saved.id, name: saved.name, nome_guerra: saved.nome_guerra, email: saved.email, role: saved.role } };
  }

  // 3. Gerente lista os corretores pendentes de aprovação da sua equipe
  async findPendingApprovals(managerId: string | null, tenantId: string): Promise<User[]> {
    return this.userRepository.find({
      where: managerId
        ? { manager_id: managerId, tenant_id: tenantId, status: 'inactive', removed_at: IsNull() }
        : { tenant_id: tenantId, role: 'corretor_level_3', status: 'inactive', removed_at: IsNull() },
      order: { name: 'ASC' },
    });
  }

  // 4. Gerente aprova o corretor e define a faixa de carência (7, 15 ou 30 dias)
  async approveBroker(
    brokerId: string,
    dto: ApproveBrokerDto,
    approver: { sub: string; role: string },
    tenantId: string,
  ) {
    const broker = await this.userRepository.findOne({
      where: approver.role === 'gerencia_level_2'
        ? { id: brokerId, manager_id: approver.sub, tenant_id: tenantId }
        : { id: brokerId, tenant_id: tenantId, role: 'corretor_level_3' },
    });

    if (!broker) {
      throw new NotFoundException(approver.role === 'gerencia_level_2'
        ? 'Corretor não encontrado ou não pertence à sua gerência.'
        : 'Corretor não encontrado neste tenant.');
    }

    if (broker.status !== 'inactive') {
      throw new BadRequestException('Este corretor já foi aprovado ou está ativo.');
    }

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

    await this.userRepository.save(broker);
    this.realtimeService.publish({ eventType: 'broker.approved', tenantId, aggregateId: broker.id, payload: { brokerId: broker.id, managerId: broker.manager_id, status: broker.status, brokerStage: broker.broker_stage, carenciaEndsAt: broker.carencia_ends_at } });
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
    if (!['diretoria_level_1', 'gerencia_level_2', 'platform_admin_level_0'].includes(actor.role)) {
      throw new BadRequestException('Perfil sem permissão para gerenciar Corretores.');
    }
    return broker;
  }

  async getBrokerManagementProfile(brokerId: string, actor: { sub: string; role: string }, tenantId: string) {
    const broker = await this.getBrokerForManagement(brokerId, actor, tenantId);
    const manager = broker.manager_id ? await this.userRepository.findOne({ where: { id: broker.manager_id, tenant_id: tenantId } }) : null;
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
    const broker = await this.getBrokerForManagement(brokerId, actor, tenantId);
    const before = { broker_stage: broker.broker_stage, creci: broker.creci };

    broker.broker_stage = dto.brokerStage;
    if (dto.creci !== undefined) {
      broker.creci = dto.creci ? dto.creci.trim().toUpperCase() : null;
    }
    const saved = await this.userRepository.save(broker);

    void this.auditService.record({ tenantId, actorUserId: actor.sub, actorRole: actor.role }, {
      action: 'BROKER_STAGE_UPDATED',
      entityType: 'USER',
      entityId: saved.id,
      beforeData: before,
      afterData: { broker_stage: saved.broker_stage, creci: saved.creci },
      reason: `Estágio de corretor atualizado para '${saved.broker_stage}'`,
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
    const [data, total] = await qb.orderBy('user.name', 'ASC').skip((page - 1) * pageSize).take(pageSize).getManyAndCount();
    return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  // 6. Motor Agendador Cron: Roda automaticamente todas as noites à meia-noite [10, 18]
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleCarenciaExpirationCron() {
    console.log('[CRON] Iniciando verificação de expiração de carências de corretores...');
    await this.processCarenciaExpirations();
  }

  // 7. Método Auxiliar para processar as carências vencidas (Usado pelo Cron e pela rota de testes) [10]
  async processCarenciaExpirations() {
    const now = new Date();

    // Busca todos os corretores com carência ativa (status: 'grace_period') e cuja data de expiração já venceu (menor ou igual a hoje) [10]
    const expiredBrokers = await this.userRepository.find({
      where: {
        status: 'grace_period',
        carencia_ends_at: LessThanOrEqual(now), // carencia_ends_at <= agora
      },
    });

    let activatedCount = 0;

    for (const broker of expiredBrokers) {
      // Altera o status para ativo [10]
      broker.status = 'active';
      
      await this.userRepository.save(broker);
      activatedCount++;

      console.log(`[CRON] Carência encerrada para o corretor '${broker.nome_guerra}'. Usuário ativado!`);
      // HOOK FUTURO: Disparar notificação Push ("Você está habilitado a receber leads!") [10]
      // HOOK FUTURO: Habilitar o corretor no CVCRM via API [10]
    }

    return {
      processedBrokers: expiredBrokers.length,
      activatedCount,
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

    for (const broker of brokers) {
      // B. Busca o gerente associado para exibir o nome de guerra
      let managerName = 'Sem Gerente';
      if (broker.manager_id) {
        const manager = await this.userRepository.findOne({ where: { id: broker.manager_id } });
        if (manager) {
          managerName = manager.nome_guerra;
        }
      }

      // C. Busca a presença ativa ("online") deste corretor
      const activePresence = await this.userRepository.manager.getRepository('presences').findOne({
        where: { broker_id: broker.id, tenant_id: tenantId, status: 'online' },
        relations: { booth: true },
      }) as any;

      const isPresent = !!activePresence;
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
        statusPresenca: isPresent ? `🟢 ONLINE (${activePresence.booth?.name || 'Plantão'})` : '🔴 OFFLINE',
        statusCarencia: broker.removed_at ? '⚫ REMOVIDO' : (broker.status === 'grace_period' ? '🟡 EM CARÊNCIA' : (isOutOfCarencia ? '🟢 ATIVO' : '🔴 INATIVO')),
        leadsPaused: broker.leads_paused,
        isHabilitado: isHabilitado ? '🟢 HABILITADO' : '🔴 BLOQUEADO',
        roletaName: activePresence?.roleta_name || null,
        roletaEntryType: activePresence?.roleta_entry_type || null,
        roletaPosition: activePresence?.roleta_position || null,
        minutesActive,
        minimumRequiredMinutes: activePresence?.minimum_period_minutes || 120,
        dataAtualizacao: new Date().toLocaleDateString('pt-BR'),
      });
    }

    // Ordenação da fila de leads: primeiro os habilitados por posição na roleta, depois pontualidade, depois nome
    queue.sort((a, b) => {
      if (a.isHabilitado === '🟢 HABILITADO' && b.isHabilitado !== '🟢 HABILITADO') return -1;
      if (a.isHabilitado !== '🟢 HABILITADO' && b.isHabilitado === '🟢 HABILITADO') return 1;
      if (a.roletaPosition && b.roletaPosition) return a.roletaPosition - b.roletaPosition;
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
}