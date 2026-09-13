# Doctor House — Tarefas

Painel de tarefas em Node.js, Express e PostgreSQL, com instalação como PWA.

## Instalar

No iPhone/iPad, abra o endereço do painel no Safari, toque em Compartilhar e em **Adicionar à Tela de Início**. Se aparecer a opção **Abrir como App**, mantenha-a ativada. Abra pelo ícone criado, faça login e toque em **Ativar notificações**. Web Push exige iOS/iPadOS 16.4 ou posterior. Use **Testar notificação** para conferir o recebimento, inclusive depois de sair do app.

No Android e nos navegadores compatíveis de computador, use **Instalar app** ou a opção de instalação do navegador. A permissão de notificações é individual por aparelho. **Desativar notificações** cancela a inscrição naquele aparelho; sair da conta também a cancela.

Os sons escolhidos no painel são reproduzidos com o painel aberto. O som das notificações do sistema, incluindo iPhone com app fechado, depende do sistema operacional, das permissões, do modo silencioso e do Foco. O PWA não escolhe um áudio personalizado para esse aviso.

## Conexão e sessão

O app instalado mantém um token de sessão por até 12 horas, sem persistir a senha. Ao expirar, é necessário entrar novamente. Com uma atualização disponível, o painel oferece um botão e pede para salvar os formulários antes de recarregar.

Sem conexão, o app mostra uma tela de recuperação. Consultar e alterar tarefas exige internet; não há edição offline nem fila de alterações locais. O service worker guarda apenas a tela offline e os ícones, nunca respostas autenticadas ou dados de tarefas.

## Servidor e notificações

Configure `DATABASE_URL` e as variáveis de autenticação já usadas pelo projeto. Execute `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm test` e `pnpm start`. Produção exige HTTPS.

Na inicialização, o servidor cria de forma idempotente `push_config`, `push_subscriptions`, `push_outbox` e o gatilho de eventos de tarefas. As chaves VAPID são geradas uma única vez e persistidas no banco. Preserve `push_config` nos backups para manter as inscrições entre deploys. Não exponha a chave privada nem as inscrições em logs.

Criação e atribuição de tarefas notificam o responsável; mudanças de status notificam o solicitante; observações de conclusão notificam os administradores inscritos. Os avisos mostram texto genérico, sem o conteúdo da tarefa. Ao tocar, o app abre a tarefa acessível à conta autenticada.

O servidor verifica a fila a cada 15 segundos e as repetições a cada minuto. Mantenha ao menos uma instância web ativa: um serviço suspenso não processa a fila até voltar a executar. Bloqueios do PostgreSQL coordenam múltiplas instâncias; endpoints expirados são removidos e falhas temporárias recebem até cinco tentativas. A entrega final depende do provedor push e do aparelho.

## Edição de tarefas próprias

O menu da tarefa oferece **Editar tarefa** quando a conta autenticada é tanto a criadora quanto a responsável atual. O formulário permite alterar título, descrição, prioridade, data, horário, status e observação de conclusão. Responsável, espaço e autoria são preservados pelo servidor. As permissões administrativas existentes continuam disponíveis na gestão da equipe.

A autoria de tarefas e de novas programações fica em `criado_por`, preenchida a partir da sessão autenticada. Nas tarefas antigas, a migração aproveita o primeiro registro “Criou tarefa” do histórico. Quando não existe evidência da autoria (incluindo programações antigas), a edição pessoal permanece bloqueada; não se presume que o responsável seja o criador. Nas tarefas diárias com autoria identificada, editar uma ocorrência não altera a programação futura.

## Validação

`pnpm test` inclui as regressões do painel, testes de gatilhos e fila em PostgreSQL via PGlite, autorização por proprietário da inscrição e testes do service worker. O recebimento real no iPhone deve ser conferido no próprio aparelho após instalar e permitir os avisos.
