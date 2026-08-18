# Segurança Operacional — Ambiente de Desenvolvimento

## Escopo

Esta camada é exclusivamente de desenvolvimento e testes. Ela não deve ser habilitada para registrar dados sensíveis em produção nem deve ser usada como substituta dos mecanismos nativos de backup do provedor de produção.

## Logs estruturados

Quando `NODE_ENV` não é `production` e `DEV_SECURITY_ENABLED` não é `false`, cada requisição gera um evento JSON com horário UTC, request ID, método, rota, status, duração, IP, agente, tenant e identidade sanitizada. Segredos, tokens, cookies, autorizações, credenciais e chaves privadas são substituídos por `[REDACTED]`.

Para persistir localmente, defina `DEV_SECURITY_LOG_FILE=./var/dev-security/events.ndjson`. O diretório deve possuir permissão 700 e os arquivos 600. Em produção, o middleware não grava esses arquivos.

A auditoria de negócio continua persistida na tabela `audit_logs`, com ator, tenant, sessão, request ID, mudança anterior, mudança posterior, motivo, sucesso e metadados. A auditoria também aplica redaction recursivo.

## Backup

Defina `DATABASE_URL` apontando exclusivamente para o banco de desenvolvimento, `DEV_BACKUP_DIR=./var/dev-backups` e, preferencialmente, `DEV_BACKUP_PASSPHRASE` em um gerenciador de segredos local. Execute:

```bash
npm run security:dev:backup
```

O processo cria dump PostgreSQL em formato customizado, compressão, checksum SHA-256, manifesto JSON, permissão 600 e limpeza por retenção. Quando a passphrase existe, o arquivo é cifrado com AES-256-CBC usando PBKDF2.

Sem `DEV_BACKUP_PASSPHRASE`, o script continua funcionando para desenvolvimento local, mas emite aviso e protege a cópia apenas por permissões de filesystem. Para dados minimamente sensíveis, a passphrase deve ser obrigatória na rotina operacional da equipe.

## Verificação e restauração

Valide uma cópia sem alterar o banco:

```bash
npm run security:dev:verify -- ./var/dev-backups/arquivo.dump.enc
```

Restaure somente em um banco de desenvolvimento isolado e com confirmação explícita:

```bash
DEV_RESTORE_CONFIRM=YES npm run security:dev:restore -- ./var/dev-backups/arquivo.dump.enc
```

A restauração recusa `NODE_ENV=production`, exige confirmação e valida o checksum antes de executar `pg_restore`.

## Retenção e recuperação

A retenção padrão é de 30 dias e pode ser alterada com `DEV_BACKUP_RETENTION_DAYS`. O backup deve ser executado antes de migrations destrutivas, testes de migração, importações de dados e alterações estruturais importantes.

O objetivo de desenvolvimento é recuperar o banco em poucas horas após falha ou experimento destrutivo. O processo de recuperação deve ser testado periodicamente em um banco separado, confirmando existência de tenants, usuários, plantões, regras, presenças, mensagens e logs de auditoria.

## Checklist de segurança

| Controle | Estado |
|---|---|
| Logs JSON com correlação | Implementado e desativado automaticamente em produção. |
| Redaction de segredos | Implementado nos logs técnicos e na auditoria. |
| Auditoria de mudanças | Implementada em banco com tenant e ator. |
| Backup customizado | Implementado para desenvolvimento. |
| Checksum e manifesto | Implementados. |
| Criptografia opcional | Implementada; recomendada para toda cópia sensível. |
| Retenção | Implementada por idade dos arquivos. |
| Restauração protegida | Implementada com confirmação e bloqueio de produção. |
| Teste real de restauração | Deve ser executado com `DATABASE_URL` de desenvolvimento disponível. |

## Limites

Nenhum arquivo de backup deve ser versionado no GitHub. A passphrase nunca deve ser salva no repositório, em logs, em mensagens de commit ou em variáveis públicas do frontend. Esta camada não comprova backup de produção, disponibilidade do provedor ou recuperação perante desastre de infraestrutura; esses controles devem ser configurados separadamente no ambiente de produção.
