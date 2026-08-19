# Comparação do Projeto Inicial com o Estado Atual do ABIATAR

## Conclusão executiva

O estado atual representa uma **implementação substancial do núcleo operacional** inicialmente planejado, mas não representa a totalidade do projeto inicial nem todas as premissas de um SaaS white label pronto para escala.

A plataforma já possui uma base operacional funcional para tenants, plantões, presença, hierarquia, mensagens, notificações, regras versionadas, dashboards e auditoria. Entretanto, permanecem lacunas importantes em administração global, integração externa, jurídico público, backup real comprovado, autorização de mensagens no backend, realtime por eventos e endurecimento para produção ampliada.

## Matriz de cobertura

| Premissa inicial | Estado atual | Classificação |
|---|---|---|
| ABIATAR como tenant white label | Tenant, cores e marca parametrizada em partes do sistema; ainda há referências e textos específicos que exigem revisão | Parcial |
| Domínio próprio e infraestrutura online | Domínio, frontend e API publicados; banco operacional disponível | Atendido para piloto |
| Cinco níveis hierárquicos incluindo Nível 0 | Papéis existem no modelo; Diretoria, Gerência, Recepção e Corretor possuem fluxos; painel global Nível 0 não foi implementado | Parcial crítico |
| Diretoria configura plantões | Cadastro, edição, lifecycle, regras e publicação implementados | Atendido |
| Regras por plantão | Versionamento, raio, duração, peso, metas, tolerâncias e cobertura implementados | Atendido |
| Plantão como rascunho/publicado/pausado/arquivado | Implementado e testado | Atendido |
| Check-in por GPS/Wi-Fi | GPS e regras implementados; Wi-Fi existe como estrutura, mas a experiência PWA depende das limitações do navegador | Parcial |
| Presença compartilhada entre perfis | Dados persistidos e propagados por polling | Parcial; não é realtime por evento |
| Recepção acompanha e pausa Corretores | Visualização e pausa implementadas; fluxo operacional testado | Atendido para piloto |
| Push operacional imediato | Implementado para Corretor online com dispositivo/token válido | Parcial; depende de permissão e infraestrutura de push |
| Inbox formal persistente | Persistência, não lida, leitura e exclusão lógica implementadas | Atendido |
| Mensagem obrigatória | Urgente impede exclusão antes da leitura | Parcial; não há confirmação obrigatória independente nem bloqueio global |
| Diretoria envia por público | Escopos para todos, equipes e indivíduos implementados | Parcial crítico; autorização do remetente precisa ser reforçada no backend |
| Mensagem para usuário offline | Registro persistente no Inbox; push depende de token de dispositivo | Atendido com dependência operacional |
| Convites hierárquicos | Gerente/Corretor, seleção de gerente, aceite e vínculo automático implementados | Atendido |
| BI da Diretoria | Estatísticas mensais, demanda, períodos, metas e cobertura disponíveis | Parcial; falta visão global consolidada e validação histórica abrangente |
| Auditoria completa | Logs de negócio com ator, tenant, antes/depois e motivo | Atendido no núcleo |
| Logs técnicos e recuperação | Logging de desenvolvimento e scripts de backup/restauração criados | Parcial; backup real e restauração ainda não comprovados |
| Jurídico público | Páginas públicas de privacidade/confidencialidade não identificadas | Pendente crítico |
| Integração CVCRM | Não identificada na superfície atual de código | Pendente crítico |
| Administração global Nível 0 | Não há dashboard global implementado | Pendente estratégico |
| White Label replicável | Arquitetura tenant-aware existe; onboarding e configuração ainda precisam de abstração completa | Parcial |
| Backup versionado de desenvolvimento | Scripts prontos; repositório privado separado ainda não criado | Pendente operacional |

## Premissas que foram preservadas

A essência original foi preservada em pontos centrais. O sistema continua organizado em torno de plantões, presença, regras por operação, hierarquia de usuários e comunicação separada entre alerta operacional e mensagem formal. A Diretoria é a origem das configurações e o Corretor só deve consumir plantões publicados.

Também foi preservada a decisão de utilizar o domínio próprio, manter o PWA como canal final, utilizar o banco relacional como fonte operacional e tratar a marca como variável de tenant, ainda que a remoção completa de referências específicas à ABIATAR precise continuar.

## Desvios conceituais identificados

O maior desvio é a interpretação de “realtime”. O sistema atual atualiza dados por consultas periódicas: aproximadamente 5 segundos na Recepção e intervalos maiores em outras telas. Isso pode ser suficiente para o piloto, mas não equivale a uma arquitetura realtime por eventos, WebSocket ou SSE.

O segundo desvio é a comunicação formal. A interface restringe visualmente o envio, mas o backend precisa validar explicitamente o papel do remetente. A regra não pode depender somente do dashboard exibido.

O terceiro desvio é o percentual institucional de status. A página pública usa uma régua institucional conservadora, enquanto o controle técnico interno acompanha o progresso real. Isso é aceitável quando os critérios de cada indicador estão documentados; não deve ser usado para afirmar conclusão de módulos que ainda não foram aceitos.

## Lacunas que impedem declarar o projeto completo

As lacunas mais relevantes são a ausência do painel de Nível 0, a integração CVCRM, a camada jurídica pública, o backup real com restauração comprovada, a autorização backend de mensagens, a cobertura automatizada limitada e a ausência de realtime por eventos.

Essas lacunas não anulam o núcleo já implementado, mas impedem afirmar que o projeto inicial foi executado em sua totalidade. O status correto é **núcleo operacional avançado, pronto para piloto controlado, ainda não plataforma SaaS white label completa para escala**.

## Recomendação de continuidade

Antes do repositório de backup, deve ser corrigida a autorização backend de mensagens e definido formalmente se polling de 5 segundos é suficiente para o primeiro piloto. Em seguida, deve-se criar o backup real de desenvolvimento, executar restauração em ambiente isolado, fechar o primeiro plantão e realizar um turno real controlado.

Depois do piloto, a ordem recomendada é jurídico público, CVCRM, reforço de testes, realtime por eventos, painel Nível 0 e consolidação do white label para replicação comercial.
