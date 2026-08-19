# Validação do Aceite Público por Token

## Fluxo implementado

A URL pública agora segue o formato `/cadastro/{token}`. O PWA extrai o token da rota, consulta a API e recebe somente os metadados necessários para montar o formulário: papel convidado, validade e gerente responsável quando o convite é de Corretor.

O convidado não escolhe o próprio nível. O backend também valida novamente o papel no aceite, impedindo que um token de Gerente seja enviado ao endpoint de Corretor ou que um token de Corretor seja usado no cadastro de Gerente.

## Resultado em produção

| Cenário | Resultado |
|---|---|
| URL de convite de Gerente | Acessível; metadado retornou `gerencia_level_2` e nenhum gerente responsável. |
| URL de convite de Corretor | Acessível; metadado retornou `corretor_level_3` e o gerente selecionado. |
| Formulário de Gerente | Renderiza cadastro sem campo CRECI e envia para `/users/register-manager`. |
| Formulário de Corretor | Renderiza campo CRECI e envia para `/users/register-broker`. |
| Token inválido/expirado/usado | API rejeita e a tela apresenta mensagem de convite inválido. |
| URL sem token | Não recebe papel; não permite concluir cadastro por papel indefinido. |
| Rota pública no domínio | As duas URLs testadas retornaram HTTP 200 e carregaram o bundle do PWA. |

## Publicação

Backend: commit `339f13a`.

Frontend: commit `b08971d`.

## Critério de conclusão

O aceite público por papel está concluído para o fluxo via link. O convite determina o nível; a API e a tela respeitam essa determinação; o gerente responsável é informativo para o convidado e vinculante no backend; e o link continua sendo de uso único e sujeito à validade definida.
