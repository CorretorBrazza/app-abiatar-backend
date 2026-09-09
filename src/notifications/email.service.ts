import { Injectable, Logger } from '@nestjs/common';

export interface EmailAttachment {
  filename: string;
  content: string; // base64 string
  contentType?: string;
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  async sendEmail(options: SendEmailOptions): Promise<boolean> {
    const apiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.MAIL_FROM || 'Abiatar Onboarding <onboarding@abiatar.com.br>';

    const targetEmails = Array.isArray(options.to) ? options.to : [options.to];

    if (!apiKey) {
      this.logger.warn(`[EmailService] RESEND_API_KEY não definida no ambiente. Notificação simulada para: ${targetEmails.join(', ')} | Assunto: "${options.subject}" (Anexos: ${options.attachments?.length || 0})`);
      return false;
    }

    try {
      const payload: any = {
        from: fromEmail,
        to: targetEmails,
        subject: options.subject,
        html: options.html,
      };

      if (options.attachments && options.attachments.length > 0) {
        payload.attachments = options.attachments.map((att) => ({
          filename: att.filename,
          content: att.content,
        }));
      }

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(`[EmailService] Resend API retornou erro HTTP ${response.status}: ${errorBody}`);
        return false;
      }

      const result = await response.json();
      this.logger.log(`[EmailService] E-mail de cadastro enviado com sucesso via Resend (ID: ${result.id}) para ${targetEmails.join(', ')}`);
      return true;
    } catch (err: any) {
      this.logger.error(`[EmailService] Exceção ao enviar e-mail via Resend: ${err.message}`, err.stack);
      return false;
    }
  }

  async sendBrokerRegistrationToHr(params: {
    brokerName: string;
    brokerNomeGuerra: string;
    brokerEmail: string;
    brokerStage: string;
    creci?: string | null;
    managerName: string;
    managerNomeGuerra: string;
    tenantName?: string;
    documents?: Array<{ filename: string; base64: string; contentType?: string }>;
  }): Promise<boolean> {
    const hrDestination = process.env.HR_DOCUMENTS_NOTIFICATION_EMAIL || process.env.HR_EMAIL || 'rh@abiatar.com.br';
    
    const stageLabels: Record<string, string> = {
      treinamento: '🔵 Corretor em Treinamento (Sem CRECI)',
      estagiario: '🟡 Corretor Estagiário (CRECI Estágio)',
      corretor_creci: '🟢 Corretor CRECI (Definitivo)',
    };
    const stageLabel = stageLabels[params.brokerStage] || params.brokerStage;

    const docCount = params.documents?.length || 0;
    const nowBr = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f4f5; margin: 0; padding: 24px; color: #18181b; }
        .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e4e4e7; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
        .header { background: #18181b; color: #ffffff; padding: 24px; text-align: center; }
        .header h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px; }
        .header p { margin: 6px 0 0 0; font-size: 13px; color: #a1a1aa; }
        .content { padding: 28px; }
        .badge { display: inline-block; padding: 6px 12px; background: #eff6ff; color: #1d4ed8; font-weight: 700; border-radius: 6px; font-size: 13px; margin-bottom: 20px; border: 1px solid #bfdbfe; }
        .info-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
        .info-table td { padding: 10px 12px; border-bottom: 1px solid #f4f4f5; font-size: 14px; }
        .info-table td.label { font-weight: 600; color: #71717a; width: 40%; }
        .info-table td.value { font-weight: 700; color: #09090b; }
        .docs-box { background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 16px; margin-bottom: 24px; }
        .docs-box h3 { margin: 0 0 8px 0; font-size: 14px; color: #334155; }
        .docs-box p { margin: 0; font-size: 13px; color: #64748b; }
        .footer { background: #fafafa; padding: 16px 28px; font-size: 12px; color: #a1a1aa; text-align: center; border-top: 1px solid #f4f4f5; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>ABIATAR · NOVO CADASTRO DE CORRETOR</h1>
          <p>Triagem de Recursos Humanos e Validação Documental</p>
        </div>
        <div class="content">
          <div class="badge">Aguardando Validação do RH</div>
          <p style="font-size: 14px; line-height: 20px; margin-bottom: 20px;">
            Um novo corretor completou o formulário de cadastro público e enviou seus dados e comprovantes.
          </p>

          <table class="info-table">
            <tr>
              <td class="label">Nome Completo:</td>
              <td class="value">${params.brokerName}</td>
            </tr>
            <tr>
              <td class="label">Nome de Guerra:</td>
              <td class="value">${params.brokerNomeGuerra}</td>
            </tr>
            <tr>
              <td class="label">E-mail:</td>
              <td class="value">${params.brokerEmail}</td>
            </tr>
            <tr>
              <td class="label">Estágio Solicitado:</td>
              <td class="value">${stageLabel}</td>
            </tr>
            <tr>
              <td class="label">CRECI:</td>
              <td class="value">${params.creci || 'Não informado / Em formação'}</td>
            </tr>
            <tr>
              <td class="label">Gerente Responsável:</td>
              <td class="value">Gerente ${params.managerNomeGuerra} (${params.managerName})</td>
            </tr>
            <tr>
              <td class="label">Data de Envio:</td>
              <td class="value">${nowBr}</td>
            </tr>
          </table>

          <div class="docs-box">
            <h3>📎 Documentos Anexados (${docCount})</h3>
            <p>
              ${docCount > 0 
                ? `Foram anexados ${docCount} arquivo(s) a este e-mail para verificação:`
                : 'Nenhum arquivo anexado pelo corretor.'}
            </p>
            ${docCount > 0 ? `
              <ul style="margin: 10px 0 0 0; padding-left: 18px; font-size: 13px; color: #1e293b; line-height: 20px;">
                ${(params.documents || []).map((d) => `<li><strong>${d.filename}</strong></li>`).join('')}
              </ul>
            ` : ''}
          </div>

          <p style="font-size: 13px; color: #52525b; line-height: 18px;">
            👉 <strong>Próximo Passo:</strong> Acesse o painel ABIATAR com seu login de RH ou Diretoria para <strong>Aprovar</strong> (enviando para o Gerente), <strong>Ajustar Estágio</strong> ou <strong>Excluir</strong> em caso de duplicidade/fraude.
          </p>
        </div>
        <div class="footer">
          ABIATAR Sistema Imobiliário · Notificação Automática de Triagem
        </div>
      </div>
    </body>
    </html>
    `;

    const attachments: EmailAttachment[] = (params.documents || []).map((doc) => ({
      filename: doc.filename,
      content: doc.base64,
      contentType: doc.contentType,
    }));

    return this.sendEmail({
      to: hrDestination,
      subject: `[Novo Cadastro] ${params.brokerNomeGuerra} · ${stageLabel} · Gerente ${params.managerNomeGuerra}`,
      html,
      attachments,
    });
  }

  async sendBrokerDocumentCorrectionRequest(params: {
    brokerName: string;
    brokerNomeGuerra: string;
    brokerEmail: string;
    brokerStage: string;
    managerNomeGuerra: string;
    tenantName?: string;
    message: string;
  }): Promise<boolean> {
    const stageLabels: Record<string, string> = {
      treinamento: '🔵 Corretor em Treinamento (Sem CRECI)',
      estagiario: '🟡 Corretor Estagiário (CRECI Estágio)',
      corretor_creci: '🟢 Corretor CRECI (Definitivo)',
    };
    const stageLabel = stageLabels[params.brokerStage] || params.brokerStage;

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f4f5; margin: 0; padding: 24px; color: #18181b; }
        .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e4e4e7; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
        .header { background: #b45309; color: #ffffff; padding: 24px; text-align: center; }
        .header h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px; }
        .header p { margin: 6px 0 0 0; font-size: 13px; color: #fde68a; }
        .content { padding: 28px; }
        .badge { display: inline-block; padding: 6px 12px; background: #fffbeb; color: #b45309; font-weight: 700; border-radius: 6px; font-size: 13px; margin-bottom: 20px; border: 1px solid #fcd34d; }
        .message-box { background: #fffbeb; border-left: 4px solid #f59e0b; border-radius: 8px; padding: 16px; margin-bottom: 24px; font-size: 14px; line-height: 22px; color: #1e293b; }
        .notice { background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 16px; margin-bottom: 24px; font-size: 14px; line-height: 20px; color: #0f172a; }
        .notice strong { color: #b45309; }
        .footer { background: #fafafa; padding: 16px 28px; font-size: 12px; color: #a1a1aa; text-align: center; border-top: 1px solid #f4f4f5; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>ABIATAR · CORREÇÃO DE DOCUMENTAÇÃO</h1>
          <p>Triagem de Recursos Humanos</p>
        </div>
        <div class="content">
          <div class="badge">Ação necessária no seu cadastro</div>
          <p style="font-size: 14px; line-height: 20px; margin-bottom: 20px;">
            Olá, <strong>${params.brokerNomeGuerra}</strong>! Recebemos o seu cadastro (<strong>${stageLabel}</strong>)
            e, na conferência dos documentos, o RH identificou um ajuste necessário:
          </p>

          <div class="message-box">
            ${params.message}
          </div>

          <div class="notice">
            ⚠️ <strong>Não responda este e-mail.</strong> Envie a documentação que está faltando para
            <strong>gestaoautonomos@abiatar.com</strong>, informando seu nome completo e nome de guerra
            (<strong>${params.brokerNomeGuerra}</strong>) para agilizar a validação.
          </div>

          <p style="font-size: 13px; color: #52525b; line-height: 18px;">
            Dúvidas? Fale com o Gerente <strong>${params.managerNomeGuerra}</strong> ou com o RH da ${params.tenantName || 'empresa'}.
          </p>
        </div>
        <div class="footer">
          ABIATAR Sistema Imobiliário · Notificação de Triagem Documental
        </div>
      </div>
    </body>
    </html>
    `;

    return this.sendEmail({
      to: params.brokerEmail,
      subject: `[ABIATAR] Correção de documentação no seu cadastro · ${params.brokerNomeGuerra}`,
      html,
    });
  }

  async sendPasswordResetToEmail(params: {
    name: string;
    email: string;
    temporaryPassword: string;
    tenantName?: string;
    expiresAt: Date;
  }): Promise<boolean> {
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f4f5; margin: 0; padding: 24px; color: #18181b; }
        .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e4e4e7; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
        .header { background: #b91c1c; color: #ffffff; padding: 24px; text-align: center; }
        .header h1 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px; }
        .header p { margin: 6px 0 0 0; font-size: 13px; color: #fecaca; }
        .content { padding: 28px; }
        .password-box { background: #fef2f2; border: 2px dashed #dc2626; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0; }
        .password-box .label { font-size: 12px; font-weight: 700; color: #991b1b; text-transform: uppercase; letter-spacing: 0.5px; }
        .password-box .value { font-size: 28px; font-weight: 800; color: #991b1b; letter-spacing: 2px; margin-top: 8px; font-family: monospace; }
        .notice { background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 16px; margin-bottom: 24px; font-size: 14px; line-height: 20px; color: #0f172a; }
        .notice strong { color: #b91c1c; }
        .footer { background: #fafafa; padding: 16px 28px; font-size: 12px; color: #a1a1aa; text-align: center; border-top: 1px solid #f4f4f5; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>ABIATAR · RECUPERAÇÃO DE SENHA</h1>
          <p>${params.tenantName || 'Sistema Imobiliário'}</p>
        </div>
        <div class="content">
          <p style="font-size: 14px; line-height: 20px; margin-bottom: 12px;">
            Olá, <strong>${params.name}</strong>! Recebemos a solicitação de redefinição da sua senha de acesso.
          </p>
          <p style="font-size: 14px; line-height: 20px;">Utilize a senha temporária abaixo para entrar no aplicativo:</p>

          <div class="password-box">
            <div class="label">Senha temporária</div>
            <div class="value">${params.temporaryPassword}</div>
          </div>

          <div class="notice">
            ⚠️ <strong>Importante:</strong> esta senha expira em <strong>30 minutos</strong> após esta solicitação
            e você deverá definir uma nova senha no primeiro acesso. Se a solicitação não foi feita por você,
            ignore este e-mail e a senha temporária será ignorada.
          </div>

          <p style="font-size: 13px; color: #52525b; line-height: 18px;">
            Expiração: ${params.expiresAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
          </p>
        </div>
        <div class="footer">
          ABIATAR Sistema Imobiliário · Recuperação de Senha
        </div>
      </div>
    </body>
    </html>
    `;

    return this.sendEmail({
      to: params.email,
      subject: `[ABIATAR] Sua senha temporária de acesso`,
      html,
    });
  }
}
