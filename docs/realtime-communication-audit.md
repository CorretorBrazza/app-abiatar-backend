# Auditoria de Presença e Comunicação

## Conclusão executiva

O sistema possui presença e comunicação persistentes e funcionais, mas **não é totalmente realtime no sentido técnico de atualização instantânea por evento**. A operação atual combina endpoints HTTP, polling periódico e push. Além disso, foi identificado um bloqueio de segurança: o serviço de mensagens não valida no backend o papel do remetente antes de criar um comunicado.

## Presença

| Requisito | Situação |
|---|---|
| Check-in e Check-out | Implementados por endpoints protegidos. |
| Registro persistente | Implementado na tabela de presenças. |
| Verificação de GPS e regras | Implementada pelo backend. |
| Atualização da Recepção | O frontend consulta a lista a cada 5 segundos. |
| Atualização de Inbox | O frontend consulta a caixa a cada 15 segundos em alguns dashboards. |
| WebSocket/SSE/evento de presença | Não identificado. |
| Atualização instantânea garantida | Não; há atraso de polling de até o intervalo configurado. |

Portanto, quando um Corretor faz Check-in, os demais perfis podem visualizar a alteração automaticamente, mas a implementação atual é **quase realtime por polling**, não realtime por transmissão de evento.

## Mensagens formais

| Requisito | Situação |
|---|---|
| Envio para todos os Corretores | Implementado por escopo. |
| Envio para todos os Gerentes | Implementado por escopo. |
| Envio para equipe de um Gerente | Implementado; inclui o Gerente e seus Corretores. |
| Seleção individual de Corretores | Implementada por lista de IDs. |
| Usuário offline | O registro é persistido no Inbox mesmo sem presença online. |
| Push para dispositivo offline | Tentado quando há token de dispositivo registrado; depende de permissão e token válido. |
| Contador de não lidas | Implementado no frontend. |
| Mensagem urgente | Impede exclusão antes da leitura. |
| Leitura obrigatória | Parcialmente implementada; existe confirmação e bloqueio de exclusão, mas não há estado separado de aceite obrigatório nem bloqueio global de navegação. |

## Bloqueio crítico identificado

O controller de mensagens exige apenas autenticação JWT. O serviço recebe `senderId`, mas não consulta o papel do usuário antes de criar e distribuir o comunicado. A interface pode limitar o acesso visualmente, porém um usuário autenticado poderia tentar chamar diretamente o endpoint de mensagens.

A regra correta precisa ser aplicada no backend: somente Diretoria e Gerência podem enviar mensagens formais; a Diretoria pode usar todos os escopos autorizados; a Gerência deve ficar limitada à própria equipe e aos destinatários permitidos.

## Decisão

O sistema está apto para testes controlados de comunicação, mas ainda não deve ser declarado completamente validado para go-live. Antes do backup e do piloto real, é necessário corrigir a autorização de remetentes e definir se o requisito “realtime” aceita o polling atual ou exige WebSocket/SSE. Também é recomendável reforçar a leitura obrigatória com um estado explícito de confirmação.
