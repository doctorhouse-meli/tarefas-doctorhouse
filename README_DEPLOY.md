# Dashboard de Tarefas - Railway + GitHub

Esta pasta e uma versao independente do dashboard, sem Google Sheets e sem Apps Script.

## Como deixar certo com dois projetos no Railway

Voce pode ter varios sistemas na mesma conta Railway e na mesma conta GitHub. O importante e separar:

- Um projeto Railway para cada sistema, ou pelo menos um servico separado.
- Um banco PostgreSQL separado para este dashboard.
- Variaveis separadas por servico.
- Dominio separado para cada sistema.

Recomendado para sua empresa:

- Projeto atual no Railway: deixar como esta.
- Novo projeto Railway: `dashboard-tarefas`.
- Dentro dele:
  - Servico web: este app Node.js.
  - Banco: PostgreSQL exclusivo deste dashboard.
  - Servico cron: roda `npm run cron:daily` todo dia.

## Deploy

1. Crie um repositorio no GitHub para esta pasta, ou coloque esta pasta dentro de um monorepo.
2. No Railway, clique em `New Project`.
3. Escolha `Deploy from GitHub repo`.
4. Se estiver em monorepo, configure `Root Directory` como:

```text
/railway-task-dashboard
```

5. Adicione um PostgreSQL no mesmo projeto Railway.
6. No servico web, configure a variavel:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
SESSION_SECRET=uma_frase_grande_secreta_para_assinar_login
```

7. O start command ja esta no `railway.json`:

```text
npm start
```

## Cron das tarefas diarias

No Railway, crie outro servico usando o mesmo GitHub e a mesma pasta.

Configure:

```text
Start Command: npm run cron:daily
Cron Schedule: 0 9 * * *
```

Observacao: o cron do Railway usa UTC. `0 9 * * *` roda 06:00 no horario de Brasilia. Ajuste conforme o horario desejado.

## Login inicial

Ao abrir pela primeira vez, o banco cria automaticamente:

```text
Email: admin@empresa.com
Senha: 123456
```

Depois entre no painel e cadastre seus colaboradores.

## Arquivos principais

- `public/index.html`: tela.
- `public/styles.css`: estilos.
- `public/app.js`: interacoes do painel.
- `src/server.js`: API e regras de negocio.
- `src/db.js`: banco PostgreSQL e criacao das tabelas.
- `src/cron.js`: geracao diaria de tarefas.
- `src/importSheets.js`: importacao dos dados antigos exportados do Google Sheets.
- `migration/ExportarDados.gs`: exportador para colar no Apps Script antigo.

## Usuarios

No painel Admin existe uma tabela `Usuarios`.

O admin pode:

- Ver usuarios cadastrados.
- Criar novo usuario.
- Alterar nome.
- Alterar e-mail/login.
- Alterar senha.
- Alterar perfil `Admin` ou `Colaborador`.
- Alterar workspace.

Ao alterar o e-mail/login, o sistema tambem atualiza as tarefas, modelos diarios, comentarios e historico vinculados ao e-mail antigo.

## Migracao dos dados antigos

Veja o passo a passo em:

```text
MIGRACAO_SHEETS.md
```
