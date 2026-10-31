function findAllGuildHistory_() {
  // A base legada pode ainda não ter recebido a nova aba. Leituras públicas
  // devem representar isso como histórico vazio; a criação da aba continua
  // responsabilidade do setup/migração antes de qualquer escrita.
  const spreadsheet = getDatabaseSpreadsheet_();
  if (!spreadsheet.getSheetByName("GuildHistory")) {
    return [];
  }
  return readDatabaseTable_("GuildHistory").map(normalizeGuildHistoryFromStorage_);
}

function findGuildHistoryByGameDayKey_(gameDayKey) {
  const normalized = validateGameDayKey_(gameDayKey, "gameDayKey");
  const matches = findAllGuildHistory_().filter(function (record) {
    return record.gameDayKey === normalized;
  });
  if (matches.length > 1) {
    throw createControlledError_(ERROR_CODES.CONFLICT,
      "Existem snapshots duplicados para o mesmo dia do jogo.", null);
  }
  return matches.length === 0 ? null : matches[0];
}

function insertGuildHistory_(record) {
  validateGuildHistoryRepositoryRecord_(record);
  return insertDatabaseRecords_("GuildHistory", [record], {
    uniqueKeyFields: ["gameDayKey"],
  });
}

function updateGuildHistory_(record) {
  validateGuildHistoryRepositoryRecord_(record);
  return updateDatabaseRecordsByPrimaryKey_("GuildHistory", [{
    primaryKeyValue: record.historyId,
    record: record,
  }], {uniqueKeyFields: ["gameDayKey"]});
}

function validateGameDayKey_(value, fieldName) {
  const normalized = validateString_(value, fieldName || "gameDayKey", {
    required: true, minLength: 10, maxLength: 10,
  });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throwValidationError_(fieldName || "gameDayKey", "Dia do jogo inválido.");
  }
  const parts = normalized.split("-").map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (date.getUTCFullYear() !== parts[0] || date.getUTCMonth() !== parts[1] - 1 || date.getUTCDate() !== parts[2]) {
    throwValidationError_(fieldName || "gameDayKey", "Dia do jogo inexistente.");
  }
  return normalized;
}

function validateGuildHistoryRepositoryRecord_(record) {
  validateObject_(record, "guildHistory");
  validateUuid_(record.historyId, "historyId");
  validateGameDayKey_(record.gameDayKey, "gameDayKey");
  validateNonNegativeInteger_(record.xpTotal, "xpTotal");
  validateNonNegativeInteger_(record.totalContributed, "totalContributed");
  ["xpDelta", "goldDelta"].forEach(function (field) {
    if (record[field] !== null) validateNonNegativeInteger_(record[field], field);
  });
  assertValidDate_(record.createdAt);
  assertValidDate_(record.updatedAt);
  databaseObjectToRow_("GuildHistory", record);
  return record;
}

function normalizeGuildHistoryFromStorage_(record) {
  if (!isObject_(record)) throw new Error("Registro de histórico inválido.");
  const normalized = Object.assign({}, record);
  if (normalized.gameDayKey instanceof Date) {
    if (isNaN(normalized.gameDayKey.getTime())) {
      throw new Error("Dia do jogo inválido no histórico.");
    }
    // Sheets pode devolver a chave civil como Date quando a célula foi
    // interpretada como data. A chave não é um instante do reset das 07:00;
    // é a data civil já iniciada pelo dia do jogo.
    normalized.gameDayKey = Utilities.formatDate(
      normalized.gameDayKey,
      DEFAULT_TIMEZONE,
      "yyyy-MM-dd",
    );
  }
  ["xpDelta", "goldDelta"].forEach(function (field) {
    if (normalized[field] === "") normalized[field] = null;
  });
  return normalized;
}
