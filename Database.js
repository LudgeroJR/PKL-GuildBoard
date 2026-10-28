const DATABASE_SCHEMA_ = Object.freeze({
  Config: createDatabaseTableSchema_(
    "Config",
    ["key", "value", "type", "description"],
    "key",
  ),

  Members: createDatabaseTableSchema_(
    "Members",
    [
      "memberId",
      "name",
      "guildRole",
      "level",
      "joinedAt",
      "status",
      "leftAt",
      "targetRequired",
      "createdAt",
      "updatedAt",
    ],
    "memberId",
  ),

  Contributions: createDatabaseTableSchema_(
    "Contributions",
    [
      "contributionId",
      "memberId",
      "weekKey",
      "amount",
      "targetRequired",
      "targetAmount",
      "createdAt",
      "updatedAt",
    ],
    "contributionId",
  ),

  GuildState: createDatabaseTableSchema_(
    "GuildState",
    [
      "guildStateId",
      "level",
      "bankBalance",
      "xpTotal",
      "xpProximoNivel",
      "vagas",
      "rankingHoje",
      "rankingOntem",
      "currentObjectiveSkillId",
      "createdAt",
      "updatedAt",
    ],
    "guildStateId",
  ),

  Skills: createDatabaseTableSchema_(
    "Skills",
    ["skillId", "apiSkillId", "name", "totalLevels", "createdAt", "updatedAt"],
    "skillId",
  ),

  SkillBuffs: createDatabaseTableSchema_(
    "SkillBuffs",
    [
      "skillBuffId",
      "skillId",
      "level",
      "description",
      "createdAt",
      "updatedAt",
    ],
    "skillBuffId",
  ),

  SkillRequirements: createDatabaseTableSchema_(
    "SkillRequirements",
    [
      "skillRequirementId",
      "skillId",
      "requiredSkillId",
      "minimumLevel",
      "createdAt",
      "updatedAt",
    ],
    "skillRequirementId",
  ),

  SkillState: createDatabaseTableSchema_(
    "SkillState",
    [
      "skillStateId",
      "skillId",
      "currentLevel",
      "currentStep",
      "totalSteps",
      "status",
      "activatedAt",
      "updatedAt",
    ],
    "skillStateId",
  ),

  PodexCategories: createDatabaseTableSchema_(
    "PodexCategories",
    ["categoryId", "name", "sortOrder", "createdAt", "updatedAt"],
    "categoryId",
  ),

  PodexSubcategories: createDatabaseTableSchema_(
    "PodexSubcategories",
    [
      "subcategoryId",
      "categoryId",
      "name",
      "sortOrder",
      "createdAt",
      "updatedAt",
    ],
    "subcategoryId",
  ),

  PodexRarities: createDatabaseTableSchema_(
    "PodexRarities",
    [
      "rarityId",
      "subcategoryId",
      "name",
      "completionBuff",
      "sortOrder",
      "createdAt",
      "updatedAt",
    ],
    "rarityId",
  ),

  PodexLevels: createDatabaseTableSchema_(
    "PodexLevels",
    ["podexLevelId", "rarityId", "level", "createdAt", "updatedAt"],
    "podexLevelId",
  ),

  Items: createDatabaseTableSchema_(
    "Items",
    ["itemId", "name", "originType", "origin", "imageUrl", "createdAt", "updatedAt"],
    "itemId",
  ),

  PodexRequirements: createDatabaseTableSchema_(
    "PodexRequirements",
    [
      "podexRequirementId",
      "podexLevelId",
      "itemId",
      "quantity",
      "createdAt",
      "updatedAt",
    ],
    "podexRequirementId",
  ),

  WeeklyTasks: createDatabaseTableSchema_(
    "WeeklyTasks",
    ["weeklyTaskId", "weekKey", "memberId", "delivered", "createdAt", "updatedAt"],
    "weeklyTaskId",
  ),

  DailyTasks: createDatabaseTableSchema_(
    "DailyTasks",
    ["dailyTaskId", "weekKey", "memberId", "day", "delivered", "createdAt", "updatedAt"],
    "dailyTaskId",
  ),
});

const DATABASE_SETUP_LOCK_TIMEOUT_MS = 5000;
// Compras concorrentes podem aguardar várias operações multiaba na fila.
const DATABASE_WRITE_LOCK_TIMEOUT_MS = 30000;
// Cache de leitura: TTL curto limita staleness por edição manual da planilha.
const DATABASE_CACHE_TTL_SECONDS = 60;
// Limite do CacheService: 100KB/valor; 30k chars cobre até 3 bytes/char.
const DATABASE_CACHE_CHUNK_SIZE = 30000;

const DATABASE_INITIAL_CONFIG = Object.freeze({
  key: "DAILY_TARGET",
  value: "200000",
  type: "NUMBER",
  description: "Meta diária de contribuição por membro.",
});

function createDatabaseTableSchema_(sheetName, headers, primaryKey) {
  return Object.freeze({
    sheetName: sheetName,
    headers: Object.freeze(headers.slice()),
    primaryKey: primaryKey,
  });
}

function getDatabaseSchema_() {
  return DATABASE_SCHEMA_;
}

function getDatabaseTableSchema_(sheetName) {
  if (
    typeof sheetName !== "string" ||
    !Object.prototype.hasOwnProperty.call(DATABASE_SCHEMA_, sheetName)
  ) {
    throw new Error(`Tabela não reconhecida pelo schema: ${sheetName}.`);
  }

  return DATABASE_SCHEMA_[sheetName];
}

function openDatabaseSpreadsheetById_(spreadsheetId) {
  if (typeof spreadsheetId !== "string" || spreadsheetId.trim() === "") {
    throw new Error("Spreadsheet ID inválido.");
  }

  try {
    return SpreadsheetApp.openById(spreadsheetId.trim());
  } catch (error) {
    throw new Error(
      "Não foi possível acessar a planilha configurada em SPREADSHEET_ID.",
    );
  }
}

function getDatabaseSpreadsheet_() {
  return openDatabaseSpreadsheetById_(getSpreadsheetId_());
}

function getDatabaseSheetNames_() {
  return getDatabaseSpreadsheet_()
    .getSheets()
    .map(function (sheet) {
      return sheet.getName();
    });
}

/*
 * Cria uma planilha externa (fora da base de dados) com as abas fornecidas
 * e retorna { spreadsheetId, url }.
 *
 * sheetsData: Array<{ name: string, rows: Array<Array<any>> }>
 * A primeira aba padrão do Sheets é renomeada; as demais são inseridas na
 * ordem. Não acessa nem modifica a base principal.
 */
function createExternalSpreadsheetWithSheets_(title, sheetsData) {
  if (typeof title !== "string" || title.trim() === "") {
    throw new Error("Título de planilha externa inválido.");
  }

  if (!Array.isArray(sheetsData) || sheetsData.length === 0) {
    throw new Error("Lista de abas inválida para planilha externa.");
  }

  const ss = SpreadsheetApp.create(title.trim());

  sheetsData.forEach(function (sheetDef, index) {
    let sheet;

    if (index === 0) {
      sheet = ss.getSheets()[0];
      sheet.setName(sheetDef.name);
    } else {
      sheet = ss.insertSheet(sheetDef.name);
    }

    if (sheetDef.rows && sheetDef.rows.length > 0) {
      const colCount = sheetDef.rows.reduce(function (max, row) {
        return Math.max(max, Array.isArray(row) ? row.length : 0);
      }, 0);

      if (colCount > 0) {
        sheet
          .getRange(1, 1, sheetDef.rows.length, colCount)
          .setValues(sheetDef.rows);
      }
    }
  });

  SpreadsheetApp.flush();

  return {
    spreadsheetId: ss.getId(),
    url: ss.getUrl(),
  };
}

/*
 * Abre uma planilha externa por ID e lê as abas nomeadas.
 * sheetNames: string[]
 * Retorna { [sheetName]: Array<Array<any>> | null }
 *   null  → aba não encontrada.
 *   []    → aba encontrada, mas vazia.
 * Lança NOT_FOUND se a planilha for inacessível.
 */
function readExternalSpreadsheetSheets_(spreadsheetId, sheetNames) {
  if (typeof spreadsheetId !== "string" || spreadsheetId.trim() === "") {
    throw new Error("ID de planilha externa inválido.");
  }

  if (!Array.isArray(sheetNames) || sheetNames.length === 0) {
    throw new Error("Lista de abas inválida para leitura externa.");
  }

  let ss;

  try {
    ss = SpreadsheetApp.openById(spreadsheetId.trim());
  } catch (error) {
    throw createControlledError_(
      ERROR_CODES.NOT_FOUND,
      "Não foi possível acessar a planilha informada. " +
        "Verifique o URL ou ID e as permissões de compartilhamento.",
      null,
    );
  }

  const result = Object.create(null);

  sheetNames.forEach(function (sheetName) {
    const sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      result[sheetName] = null;
      return;
    }

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();

    if (lastRow === 0 || lastCol === 0) {
      result[sheetName] = [];
      return;
    }

    result[sheetName] = sheet
      .getRange(1, 1, lastRow, lastCol)
      .getValues();
  });

  return result;
}

function getDatabaseSheet_(sheetName) {
  const schema = getDatabaseTableSchema_(sheetName);
  const spreadsheet = getDatabaseSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(schema.sheetName);

  if (!sheet) {
    throw new Error(`Aba obrigatória não encontrada: ${schema.sheetName}.`);
  }

  return sheet;
}

function readDatabaseHeaders_(sheet) {
  if (sheet.getLastRow() < 1 || sheet.getLastColumn() < 1) {
    return [];
  }

  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function areDatabaseHeadersValid_(actualHeaders, expectedHeaders) {
  if (
    !Array.isArray(actualHeaders) ||
    !Array.isArray(expectedHeaders) ||
    actualHeaders.length !== expectedHeaders.length
  ) {
    return false;
  }

  return expectedHeaders.every(function (expectedHeader, index) {
    return actualHeaders[index] === expectedHeader;
  });
}

function databaseRowToObject_(sheetName, row) {
  const schema = getDatabaseTableSchema_(sheetName);

  if (!Array.isArray(row)) {
    throw new Error(`Linha inválida para a tabela ${sheetName}.`);
  }

  if (row.length !== schema.headers.length) {
    throw new Error(
      `Quantidade de colunas incompatível para a tabela ${sheetName}.`,
    );
  }

  return schema.headers.reduce(function (record, header, index) {
    const value = row[index];

    if (value === undefined) {
      throw new Error(`Valor undefined encontrado em ${sheetName}.${header}.`);
    }

    record[header] = value;

    return record;
  }, {});
}

function databaseRowsToObjects_(sheetName, rows) {
  if (!Array.isArray(rows)) {
    throw new Error(`Conjunto de linhas inválido para a tabela ${sheetName}.`);
  }

  return rows.map(function (row) {
    return databaseRowToObject_(sheetName, row);
  });
}

function databaseMatrixToObjects_(sheetName, matrix) {
  const schema = getDatabaseTableSchema_(sheetName);

  if (!Array.isArray(matrix) || matrix.length === 0) {
    throw new Error(`Tabela sem headers: ${sheetName}.`);
  }

  const actualHeaders = matrix[0];

  if (!areDatabaseHeadersValid_(actualHeaders, schema.headers)) {
    throw new Error(`Headers incompatíveis na tabela ${sheetName}.`);
  }

  if (matrix.length === 1) {
    return [];
  }

  return databaseRowsToObjects_(sheetName, matrix.slice(1));
}

/*
 * Cache de leitura por tabela (CacheService, TTL curto).
 *
 * Invariante: os dados em cache sob a versão V foram lidos da planilha
 * DEPOIS de V existir. O escritor invalida (remove a versão) somente
 * após flush(), ainda sob o lock. Um leitor atrasado só consegue gravar
 * dados sob uma versão já descartada, que ninguém mais lê.
 * Leituras autoritativas (sob lock, setup) usam readDatabaseTableUncached_.
 */
function databaseCacheVersionKey_(sheetName) {
  return `DB_VER_${sheetName}`;
}

function databaseCacheDataKey_(sheetName, version, suffix) {
  return `DB_TBL_${sheetName}_${version}_${suffix}`;
}

// Tabelas escritas nesta execução e ainda não commitadas (flush + invalidação).
let databaseDirtyTables_ = Object.create(null);

function markDatabaseTableDirty_(sheetName) {
  databaseDirtyTables_[sheetName] = true;
}

function invalidateDatabaseTableCache_(sheetName) {
  try {
    invalidateDatabaseTableCacheWithCache_(CacheService.getScriptCache(), sheetName);
  } catch (error) {
    console.warn(
      "[Database cache] falha ao invalidar %s: %s",
      sheetName,
      error && error.message,
    );
  }
}

function invalidateDatabaseTableCacheWithCache_(cache, sheetName) {
  cache.remove(databaseCacheVersionKey_(sheetName));
}

/*
 * Confirma as escritas pendentes: flush só se houve escrita, depois
 * invalida o cache das tabelas tocadas (mesmo se o flush falhar).
 */
function commitDatabaseWrites_() {
  const sheetNames = Object.keys(databaseDirtyTables_);

  if (sheetNames.length === 0) {
    return;
  }

  try {
    SpreadsheetApp.flush();
  } finally {
    databaseDirtyTables_ = Object.create(null);
    sheetNames.forEach(invalidateDatabaseTableCache_);
  }
}

function readDatabaseTableFromCache_(cache, sheetName, version) {
  const countValue = cache.get(databaseCacheDataKey_(sheetName, version, "n"));

  if (!countValue) {
    return null;
  }

  const count = Number(countValue);
  const keys = [];

  for (let i = 0; i < count; i += 1) {
    keys.push(databaseCacheDataKey_(sheetName, version, i));
  }

  const chunks = cache.getAll(keys);
  let json = "";

  for (let i = 0; i < count; i += 1) {
    const chunk = chunks[keys[i]];

    if (typeof chunk !== "string") {
      return null;
    }

    json += chunk;
  }

  return JSON.parse(json);
}

function writeDatabaseTableToCache_(cache, sheetName, version, records) {
  const hasDate = records.some(function (record) {
    return Object.keys(record).some(function (field) {
      return record[field] instanceof Date;
    });
  });

  // JSON não preserva Date; tabela com Date nunca é cacheada.
  if (hasDate) {
    return;
  }

  const json = JSON.stringify(records);
  const entries = {};
  let count = 0;

  for (let start = 0; start < json.length; start += DATABASE_CACHE_CHUNK_SIZE) {
    entries[databaseCacheDataKey_(sheetName, version, count)] = json.substr(
      start,
      DATABASE_CACHE_CHUNK_SIZE,
    );
    count += 1;
  }

  entries[databaseCacheDataKey_(sheetName, version, "n")] = String(count);

  cache.putAll(entries, DATABASE_CACHE_TTL_SECONDS);
}

function readDatabaseTable_(sheetName) {
  getDatabaseTableSchema_(sheetName);

  // Escrita pendente nesta execução: cache ainda não reflete a planilha.
  if (databaseDirtyTables_[sheetName]) {
    return readDatabaseTableUncached_(sheetName);
  }

  let cache;
  let version;

  try {
    cache = CacheService.getScriptCache();
    version = cache.get(databaseCacheVersionKey_(sheetName));

    if (version) {
      const cached = readDatabaseTableFromCache_(cache, sheetName, version);

      if (cached) {
        return cached;
      }
    } else {
      // A versão é gravada ANTES da leitura da planilha (ver invariante).
      version = Utilities.getUuid();
      cache.put(
        databaseCacheVersionKey_(sheetName),
        version,
        DATABASE_CACHE_TTL_SECONDS,
      );
    }
  } catch (error) {
    return readDatabaseTableUncached_(sheetName);
  }

  const records = readDatabaseTableUncached_(sheetName);

  try {
    writeDatabaseTableToCache_(cache, sheetName, version, records);
  } catch (error) {
    // Cache é otimização: falha não afeta a leitura.
  }

  return records;
}

function readDatabaseTableUncached_(sheetName) {
  const sheet = getDatabaseSheet_(sheetName);
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow < 1 || lastColumn < 1) {
    throw new Error(`Tabela sem headers: ${sheetName}.`);
  }

  const matrix = sheet.getRange(1, 1, lastRow, lastColumn).getValues();

  return databaseMatrixToObjects_(sheetName, matrix);
}

function buildDatabasePrimaryKeyIndex_(sheetName, records) {
  const schema = getDatabaseTableSchema_(sheetName);

  if (!Array.isArray(records)) {
    throw new Error(`Registros inválidos para indexação em ${sheetName}.`);
  }

  const index = Object.create(null);

  records.forEach(function (record) {
    if (!isObject_(record)) {
      throw new Error(`Registro inválido encontrado em ${sheetName}.`);
    }

    const primaryKeyValue = record[schema.primaryKey];

    if (
      primaryKeyValue === undefined ||
      primaryKeyValue === null ||
      primaryKeyValue === ""
    ) {
      throw new Error(
        `Chave primária ausente em ${sheetName}.${schema.primaryKey}.`,
      );
    }

    if (Object.prototype.hasOwnProperty.call(index, primaryKeyValue)) {
      throw new Error(
        `Chave primária duplicada em ${sheetName}: ${primaryKeyValue}.`,
      );
    }

    index[primaryKeyValue] = record;
  });

  return index;
}

function findDatabaseRecordByPrimaryKey_(sheetName, primaryKeyValue) {
  const schema = getDatabaseTableSchema_(sheetName);

  if (
    primaryKeyValue === undefined ||
    primaryKeyValue === null ||
    primaryKeyValue === ""
  ) {
    throw new Error(`Valor inválido para ${schema.primaryKey}.`);
  }

  const records = readDatabaseTable_(sheetName);

  const index = buildDatabasePrimaryKeyIndex_(sheetName, records);

  return Object.prototype.hasOwnProperty.call(index, primaryKeyValue)
    ? index[primaryKeyValue]
    : null;
}

function applyDatabaseUpdatesInMemory_(sheetName, currentRecords, updates) {
  const schema = getDatabaseTableSchema_(sheetName);

  if (!Array.isArray(currentRecords)) {
    throw new Error(`Registros atuais inválidos para ${sheetName}.`);
  }

  if (!Array.isArray(updates)) {
    throw new Error(`Atualizações inválidas para ${sheetName}.`);
  }

  const positionIndex = Object.create(null);

  currentRecords.forEach(function (record, index) {
    databaseObjectToRow_(sheetName, record);

    const primaryKeyValue = record[schema.primaryKey];

    if (
      primaryKeyValue === undefined ||
      primaryKeyValue === null ||
      primaryKeyValue === ""
    ) {
      throw new Error(
        `Chave primária ausente em ${sheetName}.${schema.primaryKey}.`,
      );
    }

    if (Object.prototype.hasOwnProperty.call(positionIndex, primaryKeyValue)) {
      throw new Error(
        `Chave primária duplicada em ${sheetName}: ${primaryKeyValue}.`,
      );
    }

    positionIndex[primaryKeyValue] = index;
  });

  const seenUpdates = Object.create(null);

  const result = currentRecords.slice();

  updates.forEach(function (update) {
    if (!isObject_(update)) {
      throw new Error(`Atualização inválida para ${sheetName}.`);
    }

    const primaryKeyValue = update.primaryKeyValue;

    if (
      primaryKeyValue === undefined ||
      primaryKeyValue === null ||
      primaryKeyValue === ""
    ) {
      throw new Error(
        `Chave primária da atualização é inválida para ${sheetName}.`,
      );
    }

    if (Object.prototype.hasOwnProperty.call(seenUpdates, primaryKeyValue)) {
      throw new Error(
        `Atualização duplicada para ${sheetName}: ${primaryKeyValue}.`,
      );
    }

    seenUpdates[primaryKeyValue] = true;

    if (!isObject_(update.record)) {
      throw new Error(`Registro de atualização inválido para ${sheetName}.`);
    }

    databaseObjectToRow_(sheetName, update.record);

    if (update.record[schema.primaryKey] !== primaryKeyValue) {
      throw new Error(`A chave primária de ${sheetName} é imutável.`);
    }

    if (!Object.prototype.hasOwnProperty.call(positionIndex, primaryKeyValue)) {
      throw createControlledError_(
        ERROR_CODES.NOT_FOUND,
        "O registro solicitado não foi encontrado.",
        null,
      );
    }

    result[positionIndex[primaryKeyValue]] = update.record;
  });

  return result;
}

function runWithDatabaseWriteLock_(callback) {
  if (typeof callback !== "function") {
    throw new Error("Operação protegida por lock inválida.");
  }

  const lock = LockService.getScriptLock();

  /*
   * Permite que uma operação de domínio mantenha
   * um único ScriptLock enquanto chama mais de
   * uma primitiva do Database.
   */
  const alreadyHeld = lock.hasLock();

  if (!alreadyHeld && !lock.tryLock(DATABASE_WRITE_LOCK_TIMEOUT_MS)) {
    throw createControlledError_(
      ERROR_CODES.CONFLICT,
      "Não foi possível concluir a gravação porque a base está em uso.",
      null,
    );
  }

  try {
    return callback();
  } finally {
    if (!alreadyHeld) {
      try {
        commitDatabaseWrites_();
      } finally {
        lock.releaseLock();
      }
    }
  }
}

function updateDatabaseRecordsByPrimaryKey_(sheetName, updates, options) {
  if (!Array.isArray(updates)) {
    throw new Error(`Atualizações inválidas para ${sheetName}.`);
  }

  if (updates.length === 0) {
    return 0;
  }

  const settings = options === undefined ? {} : options;

  if (!isObject_(settings)) {
    throw new Error(`Opções de atualização inválidas para ${sheetName}.`);
  }

  Object.keys(settings).forEach(function (optionName) {
    if (optionName !== "uniqueKeyFields") {
      throw new Error(`Opção de atualização não reconhecida: ${optionName}.`);
    }
  });

  const uniqueKeyFields = normalizeDatabaseUniqueKeyFields_(
    sheetName,
    settings.uniqueKeyFields,
  );

  /*
   * Validação estrutural antes do lock.
   */
  const schema = getDatabaseTableSchema_(sheetName);

  const seenPrimaryKeys = Object.create(null);

  updates.forEach(function (update) {
    if (!isObject_(update) || !isObject_(update.record)) {
      throw new Error(`Atualização inválida para ${sheetName}.`);
    }

    const primaryKeyValue = update.primaryKeyValue;

    if (
      primaryKeyValue === undefined ||
      primaryKeyValue === null ||
      primaryKeyValue === ""
    ) {
      throw new Error(
        `Chave primária da atualização é inválida para ${sheetName}.`,
      );
    }

    databaseObjectToRow_(sheetName, update.record);

    if (update.record[schema.primaryKey] !== primaryKeyValue) {
      throw new Error(`A chave primária de ${sheetName} é imutável.`);
    }

    if (
      Object.prototype.hasOwnProperty.call(seenPrimaryKeys, primaryKeyValue)
    ) {
      throw new Error(
        `Atualização duplicada para ${sheetName}: ${primaryKeyValue}.`,
      );
    }

    seenPrimaryKeys[primaryKeyValue] = true;
  });

  return runWithDatabaseWriteLock_(function () {
    /*
     * Estado autoritativo relido somente
     * depois da aquisição do lock.
     */
    const currentRecords = readDatabaseTableUncached_(sheetName);

    const updatedRecords = applyDatabaseUpdatesInMemory_(
      sheetName,
      currentRecords,
      updates,
    );

    /*
     * Valida a tabela FINAL, não apenas
     * os registros recebidos no payload.
     */
    if (uniqueKeyFields.length > 0) {
      buildDatabaseLogicalUniqueIndex_(
        sheetName,
        updatedRecords,
        uniqueKeyFields,
      );
    }

    const rows = databaseObjectsToRows_(sheetName, updatedRecords);

    if (rows.length === 0) {
      return 0;
    }

    const sheet = getDatabaseSheet_(sheetName);

    assertDatabaseSheetHeaders_(sheetName, sheet);

    const targetRange = sheet.getRange(
      2,
      1,
      rows.length,
      schema.headers.length,
    );

    markDatabaseTableDirty_(sheetName);

    applyDatabaseWriteFormats_(sheetName, targetRange);

    targetRange.setValues(rows);

    return updates.length;
  });
}

function updateDatabaseRecordByPrimaryKey_(sheetName, primaryKeyValue, record) {
  return updateDatabaseRecordsByPrimaryKey_(sheetName, [
    {
      primaryKeyValue: primaryKeyValue,
      record: record,
    },
  ]);
}

function validateDatabaseInsertBatch_(sheetName, records) {
  const schema = getDatabaseTableSchema_(sheetName);

  if (!Array.isArray(records)) {
    throw new Error(`Conjunto de registros inválido para ${sheetName}.`);
  }

  const seenPrimaryKeys = Object.create(null);

  records.forEach(function (record) {
    /*
     * Valida:
     * - objeto;
     * - propriedades oficiais;
     * - nenhuma propriedade ausente;
     * - nenhum undefined.
     */
    databaseObjectToRow_(sheetName, record);

    const primaryKeyValue = record[schema.primaryKey];

    if (
      primaryKeyValue === undefined ||
      primaryKeyValue === null ||
      primaryKeyValue === ""
    ) {
      throw new Error(
        `Chave primária ausente em ${sheetName}.${schema.primaryKey}.`,
      );
    }

    if (
      Object.prototype.hasOwnProperty.call(seenPrimaryKeys, primaryKeyValue)
    ) {
      throw createControlledError_(
        ERROR_CODES.CONFLICT,
        "Existem registros duplicados no lote de gravação.",
        null,
      );
    }

    seenPrimaryKeys[primaryKeyValue] = true;
  });

  return true;
}

function normalizeDatabaseUniqueKeyFields_(sheetName, uniqueKeyFields) {
  if (uniqueKeyFields === undefined || uniqueKeyFields === null) {
    return [];
  }

  if (!Array.isArray(uniqueKeyFields)) {
    throw new Error(`Campos de chave lógica inválidos para ${sheetName}.`);
  }

  if (uniqueKeyFields.length === 0) {
    return [];
  }

  const schema = getDatabaseTableSchema_(sheetName);

  const seenFields = Object.create(null);

  return uniqueKeyFields.map(function (fieldName) {
    const normalizedFieldName = validateRequiredString_(
      fieldName,
      "uniqueKeyField",
      1,
      100,
    );

    if (!schema.headers.includes(normalizedFieldName)) {
      throw new Error(
        `Campo de chave lógica não pertence a ${sheetName}: ` +
          `${normalizedFieldName}.`,
      );
    }

    if (Object.prototype.hasOwnProperty.call(seenFields, normalizedFieldName)) {
      throw new Error(
        `Campo repetido na chave lógica de ${sheetName}: ` +
          `${normalizedFieldName}.`,
      );
    }

    seenFields[normalizedFieldName] = true;

    return normalizedFieldName;
  });
}

function buildDatabaseLogicalUniqueIndex_(sheetName, records, uniqueKeyFields) {
  if (!Array.isArray(records)) {
    throw new Error(`Registros inválidos para chave lógica em ${sheetName}.`);
  }

  if (!Array.isArray(uniqueKeyFields)) {
    throw new Error(`Campos de chave lógica inválidos para ${sheetName}.`);
  }

  const index = Object.create(null);

  if (uniqueKeyFields.length === 0) {
    return index;
  }

  records.forEach(function (record) {
    if (!isObject_(record)) {
      throw new Error(`Registro inválido encontrado em ${sheetName}.`);
    }

    const keyParts = uniqueKeyFields.map(function (fieldName) {
      if (!Object.prototype.hasOwnProperty.call(record, fieldName)) {
        throw new Error(
          `Campo ausente na chave lógica: ` + `${sheetName}.${fieldName}.`,
        );
      }

      const value = record[fieldName];

      if (value === undefined || value === null || value === "") {
        throw new Error(
          `Valor inválido na chave lógica: ` + `${sheetName}.${fieldName}.`,
        );
      }

      return value;
    });

    const logicalKey = JSON.stringify(keyParts);

    if (Object.prototype.hasOwnProperty.call(index, logicalKey)) {
      throw createControlledError_(
        ERROR_CODES.CONFLICT,
        "Existem registros duplicados para a mesma chave lógica.",
        null,
      );
    }

    index[logicalKey] = record;
  });

  return index;
}

function insertDatabaseRecords_(sheetName, records, options) {
  if (!Array.isArray(records)) {
    throw new Error(`Conjunto de registros inválido para ${sheetName}.`);
  }

  if (records.length === 0) {
    return 0;
  }

  const settings = options === undefined ? {} : options;

  if (!isObject_(settings)) {
    throw new Error(`Opções de inserção inválidas para ${sheetName}.`);
  }

  const optionNames = Object.keys(settings);

  optionNames.forEach(function (optionName) {
    if (optionName !== "uniqueKeyFields") {
      throw new Error(`Opção de inserção não reconhecida: ${optionName}.`);
    }
  });

  /*
   * Tudo que pode ser validado sem depender
   * do estado atual acontece antes do lock.
   */
  validateDatabaseInsertBatch_(sheetName, records);

  const uniqueKeyFields = normalizeDatabaseUniqueKeyFields_(
    sheetName,
    settings.uniqueKeyFields,
  );

  const incomingUniqueIndex = buildDatabaseLogicalUniqueIndex_(
    sheetName,
    records,
    uniqueKeyFields,
  );

  const schema = getDatabaseTableSchema_(sheetName);

  return runWithDatabaseWriteLock_(function () {
    /*
     * Estado autoritativo relido depois
     * da aquisição do lock.
     */
    const currentRecords = readDatabaseTableUncached_(sheetName);

    const currentIndex = buildDatabasePrimaryKeyIndex_(
      sheetName,
      currentRecords,
    );

    records.forEach(function (record) {
      const primaryKeyValue = record[schema.primaryKey];

      if (Object.prototype.hasOwnProperty.call(currentIndex, primaryKeyValue)) {
        throw createControlledError_(
          ERROR_CODES.CONFLICT,
          "Já existe um registro com o identificador informado.",
          null,
        );
      }
    });

    if (uniqueKeyFields.length > 0) {
      const currentUniqueIndex = buildDatabaseLogicalUniqueIndex_(
        sheetName,
        currentRecords,
        uniqueKeyFields,
      );

      Object.keys(incomingUniqueIndex).forEach(function (logicalKey) {
        if (
          Object.prototype.hasOwnProperty.call(currentUniqueIndex, logicalKey)
        ) {
          throw createControlledError_(
            ERROR_CODES.CONFLICT,
            "Já existe um registro para a mesma chave lógica.",
            null,
          );
        }
      });
    }

    return appendDatabaseRecords_(sheetName, records);
  });
}

function insertDatabaseRecord_(sheetName, record) {
  return insertDatabaseRecords_(sheetName, [record]);
}

function replaceDatabaseTables_(replacements) {
  if (!Array.isArray(replacements) || replacements.length === 0) {
    throw new Error("Substituições de tabelas inválidas.");
  }

  const seenSheetNames = Object.create(null);

  /*
   * Toda validação independente do estado físico acontece
   * antes da primeira escrita. A operação continua sem garantia
   * ACID entre abas, conforme a limitação do Google Sheets.
   */
  const plans = replacements.map(function (replacement) {
    if (!isObject_(replacement)) {
      throw new Error("Substituição de tabela inválida.");
    }

    const allowedProperties = ["sheetName", "records", "uniqueKeyFields"];
    const unexpectedProperties = Object.keys(replacement).filter(
      function (propertyName) {
        return !allowedProperties.includes(propertyName);
      },
    );

    if (unexpectedProperties.length > 0) {
      throw new Error(
        `Propriedades não reconhecidas na substituição: ` +
          `${unexpectedProperties.join(", ")}.`,
      );
    }

    const schema = getDatabaseTableSchema_(replacement.sheetName);

    if (Object.prototype.hasOwnProperty.call(seenSheetNames, schema.sheetName)) {
      throw new Error(`Substituição duplicada para ${schema.sheetName}.`);
    }

    seenSheetNames[schema.sheetName] = true;

    if (!Array.isArray(replacement.records)) {
      throw new Error(`Registros inválidos para ${schema.sheetName}.`);
    }

    validateDatabaseInsertBatch_(schema.sheetName, replacement.records);

    const uniqueKeyFields = normalizeDatabaseUniqueKeyFields_(
      schema.sheetName,
      replacement.uniqueKeyFields,
    );

    buildDatabaseLogicalUniqueIndex_(
      schema.sheetName,
      replacement.records,
      uniqueKeyFields,
    );

    return {
      schema: schema,
      records: replacement.records.slice(),
      rows: databaseObjectsToRows_(schema.sheetName, replacement.records),
    };
  });

  return runWithDatabaseWriteLock_(function () {
    /*
     * Resolve e valida todas as abas antes da primeira escrita.
     */
    const physicalPlans = plans.map(function (plan) {
      const sheet = getDatabaseSheet_(plan.schema.sheetName);

      assertDatabaseSheetHeaders_(plan.schema.sheetName, sheet);

      return {
        schema: plan.schema,
        rows: plan.rows,
        sheet: sheet,
        currentDataRowCount: Math.max(sheet.getLastRow() - 1, 0),
      };
    });

    physicalPlans.forEach(function (plan) {
      const rowCount = plan.rows.length;
      const columnCount = plan.schema.headers.length;

      markDatabaseTableDirty_(plan.schema.sheetName);

      if (rowCount > 0) {
        const targetRange = plan.sheet.getRange(2, 1, rowCount, columnCount);

        applyDatabaseWriteFormats_(plan.schema.sheetName, targetRange);
        targetRange.setValues(plan.rows);
      }

      if (plan.currentDataRowCount > rowCount) {
        plan.sheet
          .getRange(
            rowCount + 2,
            1,
            plan.currentDataRowCount - rowCount,
            columnCount,
          )
          .clearContent();
      }
    });

    return physicalPlans.reduce(function (result, plan) {
      result[plan.schema.sheetName] = plan.rows.length;
      return result;
    }, {});
  });
}

function getDatabaseConfigValue_(key) {
  const normalizedKey = validateRequiredString_(key, "configKey", 1, 100);

  const records = readDatabaseTable_("Config");

  const matchingRecords = records.filter(function (record) {
    return record.key === normalizedKey;
  });

  if (matchingRecords.length === 0) {
    throw new Error(`Configuração não encontrada: ${normalizedKey}.`);
  }

  if (matchingRecords.length > 1) {
    throw new Error(`Configuração duplicada: ${normalizedKey}.`);
  }

  return parseDatabaseConfigValue_(matchingRecords[0]);
}

function setDatabaseConfigNumber_(key, value) {
  const normalizedKey = validateRequiredString_(key, "configKey", 1, 100);
  const normalizedValue = validateNonNegativeInteger_(value, normalizedKey);

  const record = readDatabaseTable_("Config").find(function (item) {
    return item.key === normalizedKey;
  });

  if (!record) {
    throw new Error(`Configuração não encontrada: ${normalizedKey}.`);
  }

  updateDatabaseRecordByPrimaryKey_("Config", normalizedKey, Object.assign({}, record, {
    type: "NUMBER",
    value: String(normalizedValue),
  }));

  return normalizedValue;
}

function parseDatabaseConfigValue_(record) {
  if (!isObject_(record)) {
    throw new Error("Registro de configuração inválido.");
  }

  const key = validateRequiredString_(record.key, "key", 1, 100);

  const type = validateEnum_(record.type, "type", [
    "STRING",
    "NUMBER",
    "BOOLEAN",
  ]);

  if (typeof record.value !== "string") {
    throw new Error(
      `Configuração ${key} possui value que não está armazenado como string.`,
    );
  }

  const value = record.value.trim();

  if (type === "STRING") {
    return value;
  }

  if (type === "NUMBER") {
    if (value === "" || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) {
      throw new Error(`Configuração ${key} possui NUMBER inválido.`);
    }

    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      throw new Error(`Configuração ${key} possui NUMBER inválido.`);
    }

    return numericValue;
  }

  if (type === "BOOLEAN") {
    if (value === "true") {
      return true;
    }

    if (value === "false") {
      return false;
    }

    throw new Error(`Configuração ${key} possui BOOLEAN inválido.`);
  }

  throw new Error(`Tipo de configuração não suportado: ${type}.`);
}

function assertDatabaseSheetHeaders_(sheetName, sheet) {
  const schema = getDatabaseTableSchema_(sheetName);
  const actualHeaders = readDatabaseHeaders_(sheet);

  if (!areDatabaseHeadersValid_(actualHeaders, schema.headers)) {
    throw new Error(
      `Headers incompatíveis ou ausentes na tabela ${sheetName}.`,
    );
  }

  return true;
}

function applyDatabaseWriteFormats_(sheetName, targetRange) {
  if (!targetRange || typeof targetRange.offset !== "function") {
    throw new Error("Range de gravação inválido.");
  }

  if (sheetName === "Config") {
    targetRange.setNumberFormat("@");
    return;
  }

  const TEXT_DATE_COLUMNS = ["weekKey", "day"];
  const schema = getDatabaseTableSchema_(sheetName);

  TEXT_DATE_COLUMNS.forEach(function (colName) {
    const colIndex = schema.headers.indexOf(colName);

    if (colIndex >= 0) {
      targetRange
        .offset(0, colIndex, targetRange.getNumRows(), 1)
        .setNumberFormat("@");
    }
  });
}

function appendDatabaseRecords_(sheetName, records) {
  if (!Array.isArray(records)) {
    throw new Error(
      `Conjunto de registros inválido para a tabela ${sheetName}.`,
    );
  }

  if (records.length === 0) {
    return 0;
  }

  const sheet = getDatabaseSheet_(sheetName);

  assertDatabaseSheetHeaders_(sheetName, sheet);

  const rows = databaseObjectsToRows_(sheetName, records);

  const startRow = sheet.getLastRow() + 1;
  const columnCount = getDatabaseTableSchema_(sheetName).headers.length;

  const targetRange = sheet.getRange(startRow, 1, rows.length, columnCount);

  markDatabaseTableDirty_(sheetName);

  applyDatabaseWriteFormats_(sheetName, targetRange);

  targetRange.setValues(rows);

  return rows.length;
}

function databaseObjectToRow_(sheetName, record) {
  const schema = getDatabaseTableSchema_(sheetName);

  if (!isObject_(record)) {
    throw new Error(`Registro inválido para a tabela ${sheetName}.`);
  }

  const recordProperties = Object.keys(record);

  const unexpectedProperties = recordProperties.filter(function (propertyName) {
    return !schema.headers.includes(propertyName);
  });

  if (unexpectedProperties.length > 0) {
    throw new Error(
      `Propriedades não reconhecidas em ${sheetName}: ` +
        `${unexpectedProperties.join(", ")}.`,
    );
  }

  return schema.headers.map(function (header) {
    if (!Object.prototype.hasOwnProperty.call(record, header)) {
      throw new Error(
        `Propriedade obrigatória ausente no registro técnico: ` +
          `${sheetName}.${header}.`,
      );
    }

    const value = record[header];

    if (value === undefined) {
      throw new Error(
        `Valor undefined não pode ser persistido: ` + `${sheetName}.${header}.`,
      );
    }

    return value === null ? "" : value;
  });
}

function databaseObjectsToRows_(sheetName, records) {
  if (!Array.isArray(records)) {
    throw new Error(
      `Conjunto de registros inválido para a tabela ${sheetName}.`,
    );
  }

  return records.map(function (record) {
    return databaseObjectToRow_(sheetName, record);
  });
}

function inspectDatabaseStructure_() {
  const spreadsheet = getDatabaseSpreadsheet_();
  const schemas = getDatabaseSchema_();
  const schemaNames = Object.keys(schemas);

  const sheets = spreadsheet.getSheets();
  const physicalSheetNames = sheets.map(function (sheet) {
    return sheet.getName();
  });
  const sheetRowCounts = sheets.map(function (sheet) {
    return { sheetName: sheet.getName(), rows: Math.max(0, sheet.getLastRow() - 1) };
  });

  const expectedSheetNames = schemaNames.map(function (schemaName) {
    return schemas[schemaName].sheetName;
  });

  const missingSheets = [];
  const headerIssues = [];

  schemaNames.forEach(function (schemaName) {
    const schema = schemas[schemaName];
    const sheet = spreadsheet.getSheetByName(schema.sheetName);

    if (!sheet) {
      missingSheets.push(schema.sheetName);
      return;
    }

    const actualHeaders = readDatabaseHeaders_(sheet);

    if (actualHeaders.length === 0) {
      headerIssues.push({
        sheetName: schema.sheetName,
        type: "MISSING_HEADERS",
        expectedHeaders: schema.headers.slice(),
        actualHeaders: [],
      });

      return;
    }

    if (!areDatabaseHeadersValid_(actualHeaders, schema.headers)) {
      headerIssues.push({
        sheetName: schema.sheetName,
        type: "INCOMPATIBLE_HEADERS",
        expectedHeaders: schema.headers.slice(),
        actualHeaders: actualHeaders.slice(),
      });
    }
  });

  const unexpectedSheets = physicalSheetNames.filter(function (sheetName) {
    return !expectedSheetNames.includes(sheetName) && sheetName !== "SkillHistory";
  });

  return {
    spreadsheetName: spreadsheet.getName(),
    timezone: spreadsheet.getSpreadsheetTimeZone(),
    timezoneValid: spreadsheet.getSpreadsheetTimeZone() === DEFAULT_TIMEZONE,

    expectedSheetCount: expectedSheetNames.length,
    physicalSheetCount: physicalSheetNames.length,

    expectedSheetNames: expectedSheetNames,
    physicalSheetNames: physicalSheetNames,
    sheetRowCounts: sheetRowCounts,

    missingSheets: missingSheets,
    unexpectedSheets: unexpectedSheets,
    headerIssues: headerIssues,

    isValid:
      missingSheets.length === 0 &&
      unexpectedSheets.length === 0 &&
      headerIssues.length === 0 &&
      spreadsheet.getSpreadsheetTimeZone() === DEFAULT_TIMEZONE,
  };
}

/* Compara as seis abas canônicas com a cópia integral conferida no Bloco 9. */
function auditPhase16PodexAgainstBackup_() {
  const backupId = PropertiesService.getScriptProperties()
    .getProperty('PHASE16_B9_BACKUP_SPREADSHEET_ID');
  if (!backupId || backupId === getSpreadsheetId_()) {
    throw new Error('Cópia independente do Bloco 9 não configurada.');
  }
  const names = ['PodexCategories', 'PodexSubcategories', 'PodexRarities',
    'PodexLevels', 'Items', 'PodexRequirements'];
  const backup = readExternalSpreadsheetSheets_(backupId, names);
  const spreadsheet = getDatabaseSpreadsheet_();
  const rowCounts = {};

  names.forEach(function (name) {
    const sheet = spreadsheet.getSheetByName(name);
    if (!sheet || sheet.getLastRow() < 1 || sheet.getLastColumn() < 1 || !backup[name]) {
      throw new Error('Aba Podex ausente no banco ou na cópia: ' + name);
    }
    const current = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
    if (JSON.stringify(current) !== JSON.stringify(backup[name])) {
      throw new Error('Podex divergiu da cópia do Bloco 9: ' + name);
    }
    rowCounts[name] = current.length - 1;
  });

  return { status: 'IDENTICAL', rowCounts: rowCounts };
}

function assertDatabaseStructure_() {
  const inspection = inspectDatabaseStructure_();

  if (!inspection.timezoneValid) {
    throw new Error(`Timezone incompatível. Esperado: ${DEFAULT_TIMEZONE}.`);
  }

  if (inspection.missingSheets.length > 0) {
    throw new Error(
      `Abas obrigatórias ausentes: ${inspection.missingSheets.join(", ")}.`,
    );
  }

  if (inspection.unexpectedSheets.length > 0) {
    throw new Error(
      `Abas não reconhecidas encontradas: ${inspection.unexpectedSheets.join(", ")}.`,
    );
  }

  if (inspection.headerIssues.length > 0) {
    const sheetNames = inspection.headerIssues.map(function (issue) {
      return issue.sheetName;
    });

    throw new Error(
      `Headers incompatíveis ou ausentes: ${sheetNames.join(", ")}.`,
    );
  }

  return inspection;
}

/*
 * Migração one-time: insere coluna imageUrl na aba Items após a coluna origin.
 * Idempotente — no-op se imageUrl já existir ou sheet não existir.
 */
function migrateDatabaseItemsAddImageUrl_() {
  const spreadsheet = getDatabaseSpreadsheet_();
  const sheet = spreadsheet.getSheetByName('Items');
  if (!sheet) return;

  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) return;

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (headers.indexOf('imageUrl') !== -1) return;

  const originIdx = headers.indexOf('origin');
  if (originIdx === -1) {
    throw new Error('Coluna "origin" não encontrada em Items. Estado inesperado da planilha.');
  }

  const insertAfterCol = originIdx + 1;
  markDatabaseTableDirty_('Items');
  sheet.insertColumnAfter(insertAfterCol);
  sheet.getRange(1, insertAfterCol + 1).setValue('imageUrl');
  commitDatabaseWrites_();
}

/*
 * Migração one-time: insere colunas xpTotal, xpProximoNivel, vagas,
 * rankingHoje e rankingOntem na aba GuildState após bankBalance.
 * Idempotente — no-op se as colunas já existirem ou sheet não existir.
 * Linhas de dados existentes recebem 0 nas novas colunas.
 */
function migrateDatabaseGuildStateAddApiFields_() {
  const spreadsheet = getDatabaseSpreadsheet_();
  const sheet = spreadsheet.getSheetByName('GuildState');
  if (!sheet) return;

  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) return;

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const newColumns = ['xpTotal', 'xpProximoNivel', 'vagas', 'rankingHoje', 'rankingOntem'];
  if (newColumns.every(function (name) { return headers.indexOf(name) !== -1; })) return;

  const bankBalanceIdx = headers.indexOf('bankBalance');
  if (bankBalanceIdx === -1) {
    throw new Error('Coluna "bankBalance" não encontrada em GuildState. Estado inesperado da planilha.');
  }

  const dataRowCount = Math.max(sheet.getLastRow() - 1, 0);
  let insertAfterCol = bankBalanceIdx + 1;

  markDatabaseTableDirty_('GuildState');

  newColumns.forEach(function (name) {
    sheet.insertColumnAfter(insertAfterCol);
    insertAfterCol += 1;
    sheet.getRange(1, insertAfterCol).setValue(name);

    if (dataRowCount > 0) {
      sheet.getRange(2, insertAfterCol, dataRowCount, 1).setValue(0);
    }
  });

  commitDatabaseWrites_();
}

/* Confere uma cópia integral já fornecida e retira apenas as três colunas
 * rejeitadas. Executar manualmente antes de usar o schema novo. */
function migratePhase16Block9Schema_() {
  const result = runWithDatabaseWriteLock_(function () {
  const spreadsheet = getDatabaseSpreadsheet_();
  const sheet = spreadsheet.getSheetByName('Contributions');
  if (!sheet) throw new Error('Aba Contributions ausente.');

  const currentHeaders = DATABASE_SCHEMA_.Contributions.headers.slice();
  const oldHeaders = currentHeaders.slice(0, 4).concat(
    ['lcGasto', 'tasksEntregues', 'xpTrazida'], currentHeaders.slice(4),
  );
  const headers = readDatabaseHeaders_(sheet);
  const history = spreadsheet.getSheetByName('SkillHistory');
  if (areDatabaseHeadersValid_(headers, currentHeaders)) {
    return { status: 'ALREADY_APPLIED', contributionRows: sheet.getLastRow() - 1,
      skillHistoryRows: history ? history.getLastRow() - 1 : null,
      structure: inspectDatabaseStructure_() };
  }
  if (!areDatabaseHeadersValid_(headers, oldHeaders)) {
    throw new Error('Headers legados de Contributions incompatíveis; migração cancelada.');
  }

  const rows = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  const sheetsData = [{ name: 'Contributions', rows: rows }];
  if (history) {
    if (history.getLastRow() < 1 || history.getLastColumn() < 1) {
      throw new Error('SkillHistory sem headers; backup cancelado.');
    }
    sheetsData.push({ name: 'SkillHistory',
      rows: history.getRange(1, 1, history.getLastRow(), history.getLastColumn()).getValues() });
  }
  const backupSpreadsheetId = PropertiesService.getScriptProperties()
    .getProperty('PHASE16_B9_BACKUP_SPREADSHEET_ID');
  if (!backupSpreadsheetId || backupSpreadsheetId === getSpreadsheetId_()) {
    throw new Error('Configure PHASE16_B9_BACKUP_SPREADSHEET_ID com a cópia integral da base antes da migração.');
  }
  const exported = readExternalSpreadsheetSheets_(
    backupSpreadsheetId, sheetsData.map(function (entry) { return entry.name; }),
  );
  sheetsData.forEach(function (entry) {
    if (!exported[entry.name] ||
        JSON.stringify(exported[entry.name]) !== JSON.stringify(entry.rows)) {
      throw new Error('Backup não conferiu: ' + entry.name);
    }
  });

  markDatabaseTableDirty_('Contributions');
  sheet.deleteColumns(5, 3);
  commitDatabaseWrites_();
  assertDatabaseSheetHeaders_('Contributions', sheet);
  const migrated = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
  const preserved = rows.map(function (row) { return row.slice(0, 4).concat(row.slice(7)); });
  if (JSON.stringify(migrated) !== JSON.stringify(preserved)) {
    throw new Error('Contributions divergiu após migração; restaurar da cópia ' + backupSpreadsheetId);
  }
  return { status: 'APPLIED', backupSpreadsheetId: backupSpreadsheetId, contributionRows: rows.length - 1,
    skillHistoryRows: history ? history.getLastRow() - 1 : null,
    structure: inspectDatabaseStructure_() };
  });
  console.log('[Phase16 B9 migration] %s', JSON.stringify({
    status: result.status,
    contributionRows: result.contributionRows,
    skillHistoryRows: result.skillHistoryRows,
    expectedSheetNames: result.structure.expectedSheetNames,
    physicalSheetNames: result.structure.physicalSheetNames,
    sheetRowCounts: result.structure.sheetRowCounts,
    structureValid: result.structure.isValid,
  }));
  return result;
}

/*
 * Migração one-time: cria as abas WeeklyTasks e DailyTasks se não existirem.
 * Idempotente — no-op se as abas já existirem com headers corretos.
 */
function migrateDatabaseAddTasksTables_() {
  const spreadsheet = getDatabaseSpreadsheet_();
  const schemas = [DATABASE_SCHEMA_.WeeklyTasks, DATABASE_SCHEMA_.DailyTasks];

  let changed = false;

  schemas.forEach(function (schema) {
    const existing = spreadsheet.getSheetByName(schema.sheetName);
    if (existing) {
      assertDatabaseSheetHeaders_(schema.sheetName, existing);
      return;
    }

    const sheet = spreadsheet.insertSheet(schema.sheetName);
    sheet
      .getRange(1, 1, 1, schema.headers.length)
      .setValues([schema.headers.slice()]);
    markDatabaseTableDirty_(schema.sheetName);
    changed = true;
  });

  if (changed) {
    commitDatabaseWrites_();
  }
}

function setupDatabase_() {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(DATABASE_SETUP_LOCK_TIMEOUT_MS)) {
    throw createControlledError_(
      ERROR_CODES.CONFLICT,
      "Não foi possível obter acesso exclusivo para inicializar a base.",
      null,
    );
  }

  try {
    const spreadsheet = getDatabaseSpreadsheet_();

    validateDatabaseSetupPreconditions_(spreadsheet);

    // Setup pode criar abas/headers: toda tabela é autoritativa e invalidada.
    Object.keys(getDatabaseSchema_()).forEach(markDatabaseTableDirty_);

    ensureDatabaseTimezone_(spreadsheet);
    ensureDatabaseSheetsAndHeaders_(spreadsheet);
    ensureInitialDatabaseConfig_();

    const verification = verifyDatabase_();

    console.log("[F02 database setup] PASSOU %s", JSON.stringify(verification));

    return verification;
  } finally {
    try {
      commitDatabaseWrites_();
    } finally {
      lock.releaseLock();
    }
  }
}

function validateDatabaseSetupPreconditions_(spreadsheet) {
  const inspection = inspectDatabaseStructure_();

  if (inspection.unexpectedSheets.length > 0) {
    throw new Error(
      "A planilha contém abas não reconhecidas: " +
        `${inspection.unexpectedSheets.join(", ")}.`,
    );
  }

  const incompatibleSheets = inspection.headerIssues.filter(function (issue) {
    return issue.type === "INCOMPATIBLE_HEADERS";
  });

  if (incompatibleSheets.length > 0) {
    throw new Error(
      "O setup foi interrompido porque existem abas com " +
        "headers incompatíveis: " +
        incompatibleSheets
          .map(function (issue) {
            return issue.sheetName;
          })
          .join(", ") +
        ".",
    );
  }

  return true;
}

function ensureDatabaseTimezone_(spreadsheet) {
  const currentTimezone = spreadsheet.getSpreadsheetTimeZone();

  if (currentTimezone !== DEFAULT_TIMEZONE) {
    spreadsheet.setSpreadsheetTimeZone(DEFAULT_TIMEZONE);
  }
}

function ensureDatabaseSheetsAndHeaders_(spreadsheet) {
  const schemas = getDatabaseSchema_();

  Object.keys(schemas).forEach(function (schemaName) {
    const schema = schemas[schemaName];

    let sheet = spreadsheet.getSheetByName(schema.sheetName);

    if (!sheet) {
      sheet = spreadsheet.insertSheet(schema.sheetName);
    }

    if (sheet.getLastRow() === 0 && sheet.getLastColumn() === 0) {
      sheet
        .getRange(1, 1, 1, schema.headers.length)
        .setValues([schema.headers.slice()]);

      return;
    }

    assertDatabaseSheetHeaders_(schema.sheetName, sheet);
  });
}

function ensureInitialDatabaseConfig_() {
  const records = readDatabaseTable_("Config");

  const matchingRecords = records.filter(function (record) {
    return record.key === DATABASE_INITIAL_CONFIG.key;
  });

  if (matchingRecords.length > 1) {
    throw new Error("Configuração DAILY_TARGET duplicada.");
  }

  if (matchingRecords.length === 1) {
    validateDailyTargetConfig_(matchingRecords[0]);

    return false;
  }

  appendDatabaseRecords_("Config", [
    {
      key: DATABASE_INITIAL_CONFIG.key,
      value: DATABASE_INITIAL_CONFIG.value,
      type: DATABASE_INITIAL_CONFIG.type,
      description: DATABASE_INITIAL_CONFIG.description,
    },
  ]);

  const createdRecord = readDatabaseTable_("Config").find(function (record) {
    return record.key === DATABASE_INITIAL_CONFIG.key;
  });

  validateDailyTargetConfig_(createdRecord);

  return true;
}

function validateDailyTargetConfig_(record) {
  if (!record) {
    throw new Error("Configuração DAILY_TARGET não encontrada.");
  }

  if (
    record.key !== "DAILY_TARGET" ||
    record.type !== "NUMBER" ||
    typeof record.value !== "string"
  ) {
    throw new Error("Configuração DAILY_TARGET incompatível.");
  }

  const dailyTarget = parseDatabaseConfigValue_(record);

  validateNonNegativeInteger_(dailyTarget, "DAILY_TARGET");

  return true;
}

function verifyDatabase_() {
  const inspection = assertDatabaseStructure_();

  const configRecords = readDatabaseTable_("Config");

  const dailyTargetRecords = configRecords.filter(function (record) {
    return record.key === "DAILY_TARGET";
  });

  if (dailyTargetRecords.length !== 1) {
    throw new Error(
      "A base deve possuir exatamente uma configuração DAILY_TARGET.",
    );
  }

  validateDailyTargetConfig_(dailyTargetRecords[0]);

  return {
    isValid: true,
    sheetCount: inspection.physicalSheetCount,
    timezone: inspection.timezone,
    dailyTarget: {
      value: dailyTargetRecords[0].value,
      type: dailyTargetRecords[0].type,
      storedAsString: typeof dailyTargetRecords[0].value === "string",
    },
  };
}
