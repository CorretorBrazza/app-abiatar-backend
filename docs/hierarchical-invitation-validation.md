# Validação de Convites Hierárquicos

## Regra aprovada

A Diretoria pode convidar Gerente ou Corretor. Quando o papel escolhido é Corretor, a seleção de um Gerente ativo do mesmo tenant é obrigatória. A Gerência pode convidar apenas Corretor e o gerente responsável é automaticamente o próprio usuário autenticado.

## Resultados em produção

| Cenário | Resultado |
|---|---|
| Lista de gerentes ativos para a Diretoria | Aprovado; carregada em tempo real pela rota protegida. |
| Convite de Gerente pela Diretoria | Aprovado; `invited_role=gerencia_level_2` e `manager_id=null`. |
| Convite de Corretor pela Diretoria | Aprovado; `invited_role=corretor_level_3` e `manager_id` do gerente selecionado. |
| Convite de Corretor pela Gerência | Aprovado; `manager_id` é automaticamente o ID da própria Gerência. |
| Diretoria convidando Corretor sem Gerente | Bloqueado com HTTP 400. |
| Gerência tentando convidar Gerente | Bloqueado com HTTP 400. |
| Aceite de Corretor | Aprovado; o usuário foi criado no tenant como `corretor_level_3`, com `manager_id` do gerente escolhido e status inicial inativo para aprovação. |
| Aceite de Gerente | Aprovado; o usuário foi criado no tenant como `gerencia_level_2`, ativo e disponível na base de gerentes. |
| Auditoria | O convite e o aceite registram autor, tenant, papel convidado e vínculo hierárquico. |

## Implementação

A entidade de convite agora possui papel convidado, gerente responsável opcional e autor do convite. A migration preserva links antigos, que continuam sendo tratados como convites de Corretor vinculados ao gerente legado.

## Pendência de aceite público

O backend já suporta aceite de Gerente e Corretor. A interface pública existente ainda é orientada ao formulário antigo de Corretor. Para declarar o módulo totalmente concluído, a tela pública deve consultar o token, identificar o papel convidado e renderizar o formulário correspondente, sem exigir que o usuário escolha manualmente um papel diferente do convite.
