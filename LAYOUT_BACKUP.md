# Layout de tarefas — setembro de 2026

Interface reorganizada com listas pessoais, busca, ordenação, agrupamento por prazo e navegação administrativa. Mantém as APIs, permissões e o esquema de banco existentes.

## Voltar à versão anterior

O código anterior está preservado na branch `backup/layout-original-20260913`, commit `cd82cf3f684658f5494840fa0e60f422473ed50e`.

Para restaurar somente a interface em uma branch de trabalho, sem apagar alterações posteriores do servidor:

```sh
git restore --source=backup/layout-original-20260913 -- public/index.html public/app.js public/styles.css
git add public/index.html public/app.js public/styles.css
git commit -m "Restore original task layout"
```

Publique esse commit na branch conectada ao Railway. Os arquivos `workspace.css` e `workspace.js` deixam de ser carregados pelo HTML antigo. Não é necessário restaurar o banco.

Também foram guardados um ZIP e um Git bundle completos da versão original na pasta local `../backups/`, fora do diretório público. São backups do código, não dos dados do PostgreSQL.

## Verificação

```sh
npm run check
node --test tests/workspace.test.js
```

A validação visual local usa dados fictícios e não substitui uma verificação autenticada em produção.
