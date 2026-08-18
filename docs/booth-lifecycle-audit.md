# Auditoria do ciclo de vida dos plantões

## Diagnóstico

O fluxo atual permite que um plantão seja criado e imediatamente apareça para os demais níveis. A Diretoria consegue editar somente o conjunto de regras operacionais por meio de novas versões, mas não consegue editar integralmente o cadastro-base do plantão nem controlar seu estado de publicação.

## Campos atualmente existentes

| Grupo | Campos | Situação atual |
|---|---|---|
| Identidade | Nome e endereço | Cadastráveis na criação; não há edição posterior pela Diretoria. |
| Localização | Latitude e longitude | Cadastráveis na criação; não há edição posterior. |
| Presença | Raio GPS e redes Wi-Fi | Raio pode ser versionado nas regras; Wi-Fi é cadastrado na criação e não possui edição completa. |
| Cobertura | Mínimo de corretores | Pode ser versionado nas regras; também existe campo legado no plantão. |
| Gestão | Gerente responsável | Cadastrável na criação; não há edição completa dedicada. |
| Operação | Duração mínima, peso, horários, tolerâncias, ping, metas e fim de semana | Editáveis pela Diretoria na tela `[DR-02]`, com versionamento e auditoria. |
| Ciclo de vida | Rascunho, publicado, arquivado, vigência | Não existe atualmente. |

## Problema de governança

Sem um estado de publicação, a existência do registro é confundida com disponibilidade operacional. Isso permite que um plantão incompleto ou ainda não revisado seja retornado à lista do Corretor.

## Fluxo-alvo white label

A Diretoria deverá criar ou editar o cadastro completo em estado de rascunho. O sistema deverá exigir configuração operacional válida antes da publicação. Somente após a publicação o plantão poderá ser retornado às telas da Gerência, Recepção e Corretor, respeitando o tenant e as permissões de cada usuário.

Toda publicação deverá congelar uma versão operacional, registrar o usuário responsável, data, motivo e resumo das alterações. Uma nova edição deverá criar nova versão em rascunho ou substituir a próxima versão planejada, sem alterar presenças já iniciadas.

## Fallbacks

Os valores padrão atualmente usados para evitar indisponibilidade técnica — como duração mínima de 120 minutos, peso 1, metas padrão e raio legado — não devem liberar silenciosamente um plantão em produção. Eles podem continuar como recuperação controlada, mas o sistema deve bloquear o uso operacional quando não houver configuração publicada e ativa.

## Recomendação de estados

| Estado | Visibilidade | Permissões |
|---|---|---|
| Rascunho | Somente Diretoria | Criar e editar todos os campos. |
| Pronto para publicação | Somente Diretoria | Revisar pendências e publicar. |
| Publicado/ativo | Gerência, Recepção e Corretor, conforme escopo | Uso operacional; edição exige nova versão. |
| Pausado | Diretoria e Gerência | Não permite novos Check-ins; presenças existentes seguem regra definida. |
| Arquivado | Diretoria | Histórico e auditoria; não aparece para operação. |
