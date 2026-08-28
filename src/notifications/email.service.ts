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
                ? `Foram anexados ${docCount} arquivo(s) a este e-mail para verificação (RG/CNH, CRECI e Comprovante de Residência).`
                : 'Nenhum arquivo anexado pelo corretor.'}
            </p>
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
}
