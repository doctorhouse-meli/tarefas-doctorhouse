/**
 * Cole este arquivo no projeto Apps Script antigo, junto do Code.gs.
 * Execute exportDashboardDataToDrive() uma vez.
 *
 * Ele cria no Google Drive um arquivo:
 * dashboard-tarefas-export.json
 *
 * Baixe esse JSON e coloque em:
 * railway-task-dashboard/data/sheets-export.json
 */

function exportDashboardDataToDrive() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetNames = [
    'Usuarios',
    'Tarefas',
    'TemplatesDiarios',
    'Comentarios',
    'Workspaces',
    'Checklist',
    'Historico',
  ];

  const exportData = {
    exportedAt: new Date().toISOString(),
    spreadsheetId: ss.getId(),
    sheets: {},
  };

  sheetNames.forEach((sheetName) => {
    const sheet = ss.getSheetByName(sheetName);
    exportData.sheets[sheetName] = sheet ? readSheetAsObjects_(sheet) : [];
  });

  const json = JSON.stringify(exportData, null, 2);
  const file = DriveApp.createFile(
    Utilities.newBlob(json, 'application/json', 'dashboard-tarefas-export.json')
  );

  Logger.log('Arquivo criado: ' + file.getUrl());
  return file.getUrl();
}

function readSheetAsObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map((header) => String(header || '').trim());
  return values.slice(1)
    .filter((row) => row.some((cell) => cell !== '' && cell !== null))
    .map((row) => {
      const item = {};
      headers.forEach((header, index) => {
        item[header] = normalizeExportValue_(row[index]);
      });
      return item;
    });
}

function normalizeExportValue_(value) {
  if (value instanceof Date) return value.toISOString();
  return value;
}
