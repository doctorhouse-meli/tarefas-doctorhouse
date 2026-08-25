# Migracao do Google Sheets para PostgreSQL

Este processo nao apaga nada do Google Sheets.

## 1. Exportar dados do Apps Script antigo

1. Abra o projeto Apps Script antigo.
2. Crie um novo arquivo chamado `ExportarDados.gs`.
3. Cole o conteudo de:

```text
railway-task-dashboard/migration/ExportarDados.gs
```

4. Execute a funcao:

```text
exportDashboardDataToDrive
```

5. Autorize o Apps Script.
6. Abra `Executions` ou `Registros` e copie o link do arquivo criado no Google Drive.
7. Baixe o arquivo `dashboard-tarefas-export.json`.

## 2. Colocar o arquivo no projeto novo

Coloque o JSON baixado neste caminho:

```text
railway-task-dashboard/data/sheets-export.json
```

## 3. Importar para o PostgreSQL

No Railway, crie um servico temporario ou rode localmente com `DATABASE_URL` apontando para o Postgres do Railway.

Comando:

```text
npm run import:sheets
```

O importador faz upsert:

- Se ja existir, atualiza.
- Se nao existir, cria.
- Pode rodar novamente se precisar.

## 4. Conferencia

Depois de importar:

1. Abra o dashboard novo no Railway.
2. Entre como admin.
3. Confira usuarios, tarefas, modelos diarios, comentarios, checklist e historico.
4. Quando estiver tudo certo, passe o link novo para os colaboradores.

## Importante

Nao use os dois sistemas ao mesmo tempo por muito tempo. Depois da migracao, se uma pessoa continuar criando tarefa no Apps Script antigo, essa nova tarefa nao vai aparecer automaticamente no Railway.
