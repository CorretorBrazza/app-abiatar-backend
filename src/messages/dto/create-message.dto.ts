// src/messages/dto/create-message.dto.ts
export class CreateMessageDto {
  title: string;
  content: string;
  isUrgent?: boolean; // Padrão é falso
  
  // Estrutura dinâmica para os destinatários (conforme item 7.1 do escopo) [12]
  // Pode ser: 'all_brokers', 'all_managers', 'specific_team' (enviar para um gerente e seu time) ou um array de IDs específicos
  scope: 'all_brokers' | 'all_managers' | 'specific_team' | 'individual'; 
  targetManagerId?: string; // Usado se escopo for 'specific_team'
  individualRecipientIds?: string[]; // Usado se escopo for 'individual'
}