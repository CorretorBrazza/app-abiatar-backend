// src/users/users.service.ts
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, LessThanOrEqual } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { Cron, CronExpression } from '@nestjs/schedule';

import { User } from './user.entity';
import { OnboardingLink } from './entities/onboarding-link.entity';
import { RegisterBrokerDto } from './dto/register-broker.dto';
import { ApproveBrokerDto } from './dto/approve-broker.dto';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,

    @InjectRepository(OnboardingLink)
    private linkRepository: Repository<OnboardingLink>,
    private notificationsService: NotificationsService,
  ) {}

  // 1. Gerente gera um novo link de onboarding com validade de 7 dias
  async createOnboardingLink(managerId: string, tenantId: string) {
    const token = crypto.randomBytes(16).toString('hex'); // Gera um token aleatório seguro
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 7); // Válido por 7 dias (conforme escopo)

    const link = this.linkRepository.create({
      tenant_id: tenantId,
      manager_id: managerId,
      token: token,
      valid_until: validUntil,
    });

    const savedLink = await this.linkRepository.save(link);

    // Retorna a URL personalizada do Gerente com o token único
    return {
      token: savedLink.token,
      valid_until: savedLink.valid_until,
      onboarding_url: `app.abiatar.com.br/cadastro/${savedLink.token}`,
    };
  }

  // 2. Corretor se cadastra sozinho através do link (Rota Pública - Sem Token JWT)
  async registerBroker(dto: RegisterBrokerDto) {
    // Valida se o link de onboarding existe e ainda está dentro do prazo
    const link = await this.linkRepository.findOne({
      where: { 
        token: dto.token, 
        valid_until: MoreThan(new Date()),
        is_used: false 
      },
    });

    if (!link) {
      throw new BadRequestException('O link de cadastro é inválido, expirou ou já foi utilizado.');
    }

// Validação de unicidade do Nome de Guerra RESTRITA a esta construtora
    const existingNomeGuerra = await this.userRepository.findOne({
      where: { 
        nome_guerra: dto.nomeGuerra, 
        tenant_id: link.tenant_id // <-- Filtro adicionado para garantir unicidade apenas nesta empresa!
      },
    });
    if (existingNomeGuerra) {
      throw new BadRequestException(`O nome de guerra '${dto.nomeGuerra}' já está em uso por outro corretor.`);
    }

    // Validação de e-mail único
    const existingEmail = await this.userRepository.findOne({ where: { email: dto.email } });
    if (existingEmail) {
      throw new BadRequestException('Este e-mail de usuário já está cadastrado.');
    }

    // Criptografa a senha do corretor
    const salt = await bcrypt.genSalt(10);
    const passwordHashed = await bcrypt.hash(dto.passwordHash, salt);

    // Cria o registro do Corretor (Status: Inativo, aguardando aprovação do Gerente)
    const broker = this.userRepository.create({
      tenant_id: link.tenant_id,
      manager_id: link.manager_id,
      name: dto.name,
      nome_guerra: dto.nomeGuerra,
      email: dto.email,
      password_hash: passwordHashed,
      creci: dto.creci,
      role: 'corretor_level_3',
      status: 'inactive', // Fica inativo até que o gerente aprove
    });

    await this.userRepository.save(broker);

    return {
      message: 'Seu cadastro foi enviado! Aguarde a aprovação do seu gerente para acessar o sistema.',
    };
  }

  // 3. Gerente lista os corretores pendentes de aprovação da sua equipe
  async findPendingApprovals(managerId: string, tenantId: string): Promise<User[]> {
    return this.userRepository.find({
      where: { 
        manager_id: managerId, 
        tenant_id: tenantId, 
        status: 'inactive' 
      },
      order: { name: 'ASC' },
    });
  }

  // 4. Gerente aprova o corretor e define a faixa de carência (7, 15 ou 30 dias)
  async approveBroker(brokerId: string, dto: ApproveBrokerDto, managerId: string, tenantId: string) {
    const broker = await this.userRepository.findOne({
      where: { id: brokerId, manager_id: managerId, tenant_id: tenantId },
    });

    if (!broker) {
      throw new NotFoundException('Corretor não encontrado ou não pertence à sua gerência.');
    }

    if (broker.status !== 'inactive') {
      throw new BadRequestException('Este corretor já foi aprovado ou está ativo.');
    }

    // Calcula a data exata em que a carência de leads vai expirar
    const carenciaExpiration = new Date();
    carenciaExpiration.setDate(carenciaExpiration.getDate() + dto.carenciaDays);

    // Atualiza o status do corretor para 'grace_period' (Carência ativa)
    broker.status = 'grace_period';
    broker.carencia_ends_at = carenciaExpiration;

    await this.userRepository.save(broker);
    void this.notificationsService.sendToUser(
      broker.id,
      tenantId,
      'Cadastro aprovado',
      `Seu cadastro foi aprovado. Sua carência termina em ${carenciaExpiration.toLocaleDateString('pt-BR')}.`,
      { type: 'broker_approved', brokerId: broker.id, carenciaDays: dto.carenciaDays },
    );

    return {
      message: `Corretor '${broker.nome_guerra}' aprovado com sucesso! Carência definida por ${dto.carenciaDays} dias.`,
      carencia_ends_at: broker.carencia_ends_at,
    };
  }

  // 5. Gerente lista os corretores ativos e em carência do seu time
  async findTeam(managerId: string, tenantId: string): Promise<User[]> {
    return this.userRepository.createQueryBuilder('user')
      .where('user.manager_id = :managerId', { managerId })
      .andWhere('user.tenant_id = :tenantId', { tenantId })
      .andWhere('user.status IN (:...statuses)', { statuses: ['active', 'grace_period'] })
      .orderBy('user.name', 'ASC')
      .getMany();
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

   // 8. Retorna a Fila de Leads ativa em tempo real de todos os corretores do tenant [6, 10]
  async getRealTimeLeadsQueue(tenantId: string) {
    // A. Busca todos os corretores (Nível 3) cadastrados e inativados da construtora [10]
    const brokers = await this.userRepository.find({
      where: { tenant_id: tenantId, role: 'corretor_level_3' },
      order: { name: 'ASC' },
    });

    const queue: any[] = []; // <-- ADICIONADO "any[]" para aceitar inserções em modo estrito

    for (const broker of brokers) {
      // B. Busca se o corretor possui um gerente associado para exibir o nome de guerra dele [10]
      let managerName = 'Sem Gerente';
      if (broker.manager_id) {
        const manager = await this.userRepository.findOne({ where: { id: broker.manager_id } });
        if (manager) {
          managerName = manager.nome_guerra;
        }
      }

      // C. Busca se o corretor está fisicamente presente em algum plantão online neste segundo [8]
      const activePresence = await this.userRepository.manager.getRepository('presences').findOne({
        where: { broker_id: broker.id, tenant_id: tenantId, status: 'online' },
        relations: { booth: true }, // <-- AJUSTADO PARA FORMATO OBJETO DO TYPEORM 0.3+
      }) as any;

      const isPresent = !!activePresence;
      const isOutOfCarencia = broker.status === 'active'; // Ativo = fora da carência [10]

      // D. A REGRA DE OURO: Só está habilitado se estiver presente E fora da carência [8, 10]
      const isHabilitado = isPresent && isOutOfCarencia;

      queue.push({
        brokerId: broker.id,
        nomeGuerra: broker.nome_guerra,
        managerName: managerName,
        statusPresenca: isPresent ? `🟢 ONLINE (${activePresence.booth.name})` : '🔴 OFFLINE',
        statusCarencia: broker.status === 'grace_period' ? '🟡 EM CARÊNCIA' : (isOutOfCarencia ? '🟢 ATIVO' : '🔴 INATIVO'),
        isHabilitado: isHabilitado ? '🟢 HABILITADO' : '🔴 BLOQUEADO',
        dataAtualizacao: new Date().toLocaleDateString('pt-BR'),
      });
    }

    return {
      message: 'Fila de distribuição de leads em tempo real carregada.',
      queue,
    };
  }
}