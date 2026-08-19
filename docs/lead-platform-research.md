# Pesquisa preliminar de plataformas de leads

## CVCRM

Fonte: https://desenvolvedor.cvcrm.com.br/

O portal oficial informa que o CVCRM possui APIs para diferentes módulos e jornadas, incluindo lead, atendimento, cadastro, reserva e venda. A documentação afirma que as APIs comuns são utilizadas para automatizar processos específicos, como enviar leads de landing pages para o CVCRM ou criar integrações com ERPs. A URL depende do subdomínio da base da empresa, por exemplo `https://dev.cvcrm.com.br/api/cvio/lead`. O portal também informa que permissões do perfil e limites de requisição precisam ser considerados.

Fonte complementar: https://ajuda.cvcrm.com.br/support/solutions/articles/157000357280-documenta%C3%A7%C3%A3o-da-api-de-integra%C3%A7%C3%A3o-de-leads-do-cv-para-sites-integrac%C3%B5es-e-api

A página de suporte recomenda que a integração seja realizada por equipe com conhecimento de desenvolvimento e direciona para o portal oficial.

## C2S / Contact2Sale

Fonte: https://sites.google.com/view/guiadeajudac2s/menus/integra%C3%A7%C3%B5es/integra%C3%A7%C3%A3o-via-api-c2s/informa%C3%A7%C3%B5es-da-api-c2s?authuser=1

A documentação de ajuda informa que o C2S possui API aberta, com criação de leads como uso comum. A autenticação utiliza token gerado na conta da empresa, e o próprio material classifica esse token como sensível. A documentação também explica que webhook externo pode ser usado para receber parâmetros de outros sistemas, transformá-los e então chamar a API do C2S.

Fonte da documentação técnica indicada pelo C2S: https://api.contact2sale.com/docs/api

## Leadfy Imob

Fonte: https://leadfy-imob.com.br/ajuda/integracao-via-api

A Leadfy disponibiliza endpoint HTTP POST para recebimento de leads em JSON. O endpoint utiliza um identificador da empresa, grupo ou corretor na URL. A documentação descreve campos padronizados como nome, telefone, e-mail, origem, tag, código, descrição, negociação e mensagem. A plataforma também prevê direcionamento por empresa, grupo ou corretor e rodízio próprio conforme o identificador utilizado.

## Implicação arquitetural

As três plataformas não devem ser acopladas diretamente ao algoritmo interno de distribuição. O ABIATAR deve possuir uma camada de adaptadores por fornecedor, um modelo canônico interno de lead, idempotência por origem e identificador externo, fila de entrada, janela operacional por plantão, seleção de Corretores elegíveis por Check-in e um distribuidor próprio em rodízio. A integração de saída, quando necessária, deve ser separada da entrada para evitar que o rodízio da plataforma externa substitua a regra interna da Diretoria.
