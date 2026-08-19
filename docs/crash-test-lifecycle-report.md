# Relatório de Crash Test — Ciclo de Vida dos Plantões

## Ambiente

O teste foi executado contra o ambiente de produção da API, usando os usuários de teste de Diretoria, Gerência, Recepção e Corretor. Os plantões `Vista Plaza` e `Vista Plaza 2` não foram alterados. Foi criado um plantão temporário, utilizado durante todo o teste e excluído ao final.

## Cenários executados

| Grupo | Resultado |
|---|---|
| Login dos quatro níveis | Aprovado. |
| Criação de plantão | Aprovado; o registro nasceu como `draft`. |
| Visibilidade do rascunho | Aprovado; Diretoria visualizou, Gerência, Recepção e Corretor não visualizaram. |
| Edição de nome, endereço, gerente e Wi-Fi | Aprovado e registrado em auditoria. |
| Edição de raio e cobertura | Persistida, porém a resposta imediata da API exibiu o valor efetivo da regra ativa, e não separou explicitamente o valor legado do plantão. Esse contrato precisa ser refinado. |
| Criação e versionamento das regras | Aprovado; a regra foi salva como versão 2 com os parâmetros alterados. |
| Publicação | Aprovado. O plantão apareceu para os quatro níveis. |
| Pausa | Aprovado; a API retorna HTTP 201 por ser uma transição acionada por POST. |
| Visibilidade após pausa | Aprovado; Gerência, Recepção e Corretor deixaram de visualizar o plantão. |
| Check-in direto em plantão pausado | Falhou na primeira execução: o sistema permitiu o Check-in mesmo com o plantão pausado. Correção aplicada. |
| Reteste do Check-in pausado | Aprovado após publicação da correção; retorno HTTP 400 com a mensagem de bloqueio operacional. |
| Retomada por nova publicação | Aprovado; o fluxo utiliza novamente a transição `publish`. |
| Arquivamento | Aprovado; o plantão deixou de aparecer para os níveis operacionais. |
| Exclusão | Aprovado; o plantão temporário foi removido e não apareceu mais na listagem da Diretoria. |
| Auditoria | Aprovado; criação, edição, alteração de regras, publicação, pausa e arquivamento deixaram registros com ator, tenant, entidade, estado e motivo. |

## Defeito crítico corrigido

O teste identificou que esconder um plantão pausado da rota `GET /booths` não era suficiente. O endpoint de Check-in ainda aceitava uma requisição direta usando o identificador do plantão pausado. A validação foi adicionada ao serviço de presenças:

> Um plantão só pode aceitar novos Check-ins quando seu estado for `published`.

Depois do deploy, o mesmo cenário retornou `400 Bad Request` e a mensagem `Este plantão não está publicado para novos Check-ins.`

## Defeito de contrato identificado

O cadastro-base e a regra operacional possuem campos relacionados de raio GPS e cobertura mínima. Quando uma regra ativa existe, o serviço aplica os valores efetivos da regra sobre o objeto do plantão antes de retorná-lo. Isso é correto para a operação, mas pode confundir a tela da Diretoria porque a resposta não distingue claramente:

| Campo | Significado |
|---|---|
| Valor cadastral legado | Valor armazenado no registro-base do plantão. |
| Valor operacional efetivo | Valor vigente na regra versionada publicada. |

A próxima melhoria recomendada é retornar esses valores com nomes distintos, como `baseGpsRadius`, `effectiveGpsRadius`, `baseMinimumBrokersRequired` e `effectiveMinimumBrokersRequired`. Assim, a Diretoria verá o cadastro completo e o Corretor verá somente a regra efetiva.

## Correção adicional no frontend

O crash test também identificou que o formulário de criação enviava `gpsRadius` e `minimumBrokersRequired`, enquanto o DTO de criação utiliza os campos legados `gps_radius` e `min_brokers_required`. A tela `[DR-02]` foi corrigida para usar o contrato correto na criação. O reteste comprovou que um novo plantão foi criado com raio `777`, cobertura mínima `7` e estado `draft`.

## Commits publicados

| Repositório | Commit |
|---|---|
| Backend | `8f9c8b5` — bloqueio de Check-in em plantão não publicado. |
| Frontend | `c4b4865` — persistência correta de raio e cobertura na criação. |

## Conclusão

O ciclo principal de criação, edição, configuração, versionamento, publicação, pausa, bloqueio, retomada, arquivamento, exclusão, visibilidade hierárquica e auditoria foi validado. O único defeito funcional crítico encontrado foi corrigido e retestado com sucesso. Permanece uma melhoria de clareza no contrato de resposta, para separar explicitamente valores cadastrais e valores operacionais efetivos na tela da Diretoria.
