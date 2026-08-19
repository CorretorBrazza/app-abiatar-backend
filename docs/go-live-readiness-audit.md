# Auditoria de Prontidão para Go-Live Controlado

## Decisão executiva

**Apto para iniciar um piloto real controlado, mas não apto para abertura ampliada ou go-live definitivo.**

## Itens aprovados

| Área | Resultado |
|---|---|
| Domínio público | `https://abiatar.bitimob.com.br` responde HTTP 200. |
| API | `https://api.abiatar.bitimob.com.br/health` responde HTTP 200 com status operacional. |
| Autenticação | Diretoria, Gerência, Recepção e Corretor de teste autenticam corretamente. |
| Plantões | Vista Plaza e Vista Plaza 2 estão publicados e visíveis aos quatro níveis. |
| Regras | Versão 2 ativa; mínimo de 120 minutos; raios de 100 m e 5.000 m; cobertura mínima de 2. |
| Convites | Convites por papel, vínculo de gerente e aceite público foram validados em produção. |
| Build | Backend e frontend compilados com sucesso. |
| Teste automatizado existente | Suíte backend disponível passou; há apenas um teste unitário básico. |

## Pendências antes do piloto real

A lista de usuários de teste ainda precisa ser substituída ou complementada pelos usuários reais autorizados. Os parâmetros dos plantões precisam ser confirmados pela Diretoria, principalmente horários, metas, tolerâncias, cobertura e regras de fim de semana.

O primeiro turno real ainda precisa ser observado de ponta a ponta, incluindo permissão de localização, Check-in, Check-out, cálculo de período, pausa pela Recepção, notificações operacionais, Inbox formal e atualização dos dashboards.

Não foi possível comprovar, apenas pela configuração versionada e pelos endpoints públicos, a existência de uma rotina operacional documentada de backup e restauração testada. Isso deve ser tratado como pendência de produção antes do go-live ampliado.

O frontend não possui suíte automatizada configurada e a suíte backend atual cobre somente o endpoint básico da aplicação. Para o piloto controlado, a validação manual orientada por checklist é possível; para abertura ampliada, é necessário aumentar a cobertura de testes.

A integração CVCRM e a distribuição de leads em tempo real continuam fora do critério de conclusão do piloto de presença, salvo se forem requisito obrigatório da primeira operação real.

## Decisão

O ambiente pode iniciar um **piloto real limitado**, com um plantão, uma Diretoria, um Gerente, uma Recepção e três a cinco Corretores. A abertura deve ocorrer somente após a confirmação dos dados reais, do grupo autorizado e do horário do primeiro turno.

A abertura ampliada deve aguardar a comprovação de backup/restauração, a validação de notificações no dispositivo real, a revisão da cobertura de testes e a decisão sobre a integração CVCRM.
