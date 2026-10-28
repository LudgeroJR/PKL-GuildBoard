// ============================================================
// PodexImportService.js
// Importação em lote do Podex via Google Spreadsheet.
// Responsabilidades: template, parsing, validação, diff,
// fingerprints, preview e apply.
// Sem SpreadsheetApp (acesso exclusivamente via Database.js).
// ============================================================

const PODEX_IMPORT_TEMPLATE_VERSION_ = 1;
const PODEX_IMPORT_TEMPLATE_TYPE_    = 'PKL_PODEX_IMPORT';
const PODEX_IMPORT_TEMPLATE_MODES_   = Object.freeze(['EMPTY', 'CURRENT']);

const PODEX_IMPORT_TEMPLATE_SHEETS_ = Object.freeze([
  '_Instructions',
  '_Meta',
  'Categories',
  'Subcategories',
  'Rarities',
  'Items',
  'Requirements',
]);

const PODEX_IMPORT_DATA_SHEET_NAMES_ = Object.freeze([
  'Categories',
  'Subcategories',
  'Rarities',
  'Items',
  'Requirements',
]);

const PODEX_IMPORT_HEADERS_ = Object.freeze({
  Categories:    Object.freeze(['categoryRef', 'categoryId', 'name', 'sortOrder']),
  Subcategories: Object.freeze(['subcategoryRef', 'subcategoryId', 'categoryRef', 'name', 'sortOrder']),
  Rarities:      Object.freeze(['rarityRef', 'rarityId', 'subcategoryRef', 'name', 'completionBuff', 'sortOrder']),
  Items:         Object.freeze(['itemRef', 'itemId', 'name', 'originType', 'origin', 'imageUrl']),
  Requirements:  Object.freeze(['rarityRef', 'level', 'itemRef', 'quantity']),
});

// ------------------------------------------------------------
// Criação de template
// ------------------------------------------------------------

function createPodexImportTemplate_(payload) {
  validateAllowedProperties_(payload, 'payload', ['mode']);

  const mode = validateEnum_(
    payload.mode, 'mode', PODEX_IMPORT_TEMPLATE_MODES_
  );

  const catalog = mode === 'CURRENT'
    ? getAdminPodexCatalog_()
    : null;

  const now     = new Date();
  const dateStr = Utilities.formatDate(now, DEFAULT_TIMEZONE, 'yyyy-MM-dd');

  const title = APP_FULL_NAME
    + ' - Podex Import v' + PODEX_IMPORT_TEMPLATE_VERSION_
    + ' - ' + mode
    + ' - ' + dateStr;

  const sheetsData = buildPodexImportTemplateSheetsData_(mode, now, catalog);

  const external = createExternalSpreadsheetWithSheets_(title, sheetsData);

  return {
    spreadsheetId:   external.spreadsheetId,
    url:             external.url,
    mode:            mode,
    templateVersion: PODEX_IMPORT_TEMPLATE_VERSION_,
  };
}

// ------------------------------------------------------------
// Construção dos dados do template em memória
// (funções puras: não acessam Sheets nem produzem efeitos)
// ------------------------------------------------------------

function buildPodexImportTemplateSheetsData_(mode, generatedAt, catalog) {
  var instructionsRows = buildPodexImportInstructionsRows_();
  var metaRows         = buildPodexImportMetaRows_(mode, generatedAt);
  var dataSheets       = buildPodexImportDataSheets_(mode, catalog);

  return [
    { name: '_Instructions', rows: instructionsRows },
    { name: '_Meta',         rows: metaRows         },
  ].concat(dataSheets);
}

function buildPodexImportMetaRows_(mode, generatedAt) {
  return [
    ['key',             'value'                          ],
    ['templateType',    PODEX_IMPORT_TEMPLATE_TYPE_      ],
    ['templateVersion', PODEX_IMPORT_TEMPLATE_VERSION_   ],
    ['generatedMode',   mode                             ],
    ['generatedAt',     generatedAt.toISOString()        ],
    ['appVersion',      APP_VERSION                      ],
  ];
}

function buildPodexImportInstructionsRows_() {
  return [
    ['PKL Tools - Podex Import - Instruções de Uso'],
    [''],
    ['FINALIDADE'],
    ['Esta planilha é o template oficial para importação em lote do Podex (PKL Tools).'],
    ['Use-a para a carga inicial ou para grandes atualizações do catálogo de raridades, itens e requisitos.'],
    [''],
    ['ATENÇÃO: A IMPORTAÇÃO SUBSTITUI O ESTADO COMPLETO'],
    ['A importação descreve o estado final completo do Podex.'],
    ['Registros atuais ausentes nesta planilha serão REMOVIDOS permanentemente na aplicação.'],
    ['Para alterar poucos registros, utilize o CRUD manual na seção Estrutura ou Itens do Podex.'],
    [''],
    ['MODOS DO TEMPLATE'],
    ['EMPTY: template vazio — para a primeira carga (somente quando a base não possui dados).'],
    ['CURRENT: template com os dados atuais — para grandes atualizações de uma base existente.'],
    ['Usar EMPTY em uma base com dados gera erro. Use sempre CURRENT para atualizar dados existentes.'],
    [''],
    ['REFS (categoryRef, subcategoryRef, rarityRef, itemRef)'],
    ['Refs são identificadores internos desta planilha para relacionar registros entre abas.'],
    ['Exemplos: cat-kanto, sub-pokemon, rar-comum, item-fire-stone.'],
    ['As refs NÃO são salvas na base de dados. Elas existem apenas nesta planilha.'],
    ['No template CURRENT, o ID UUID existente é usado como ref por conveniência.'],
    [''],
    ['IDs (categoryId, subcategoryId, rarityId, itemId)'],
    ['Registros já existentes têm seu ID preenchido nesta planilha.'],
    ['NÃO altere IDs existentes — eles preservam a identidade dos registros na base.'],
    ['Para adicionar novos registros, deixe o campo ID vazio. O sistema gerará os IDs automaticamente.'],
    ['IDs informados que não existem na base causam erro de validação.'],
    ['IDs duplicados nesta planilha causam erro de validação.'],
    [''],
    ['originType'],
    ['Valores permitidos: POKEMON | TYPE | OTHER'],
    ['OTHER: usar somente quando a origem não for um Pokémon específico nem uma tipagem.'],
    [''],
    ['NÍVEIS 1-4'],
    ['Os níveis de cada raridade (1, 2, 3 e 4) são gerenciados automaticamente pelo sistema.'],
    ['Não existe aba de Levels editável neste template — os níveis derivam das Raridades.'],
    ['Para definir os requisitos de um nível, use a aba Requirements com rarityRef e level (1, 2, 3 ou 4).'],
    [''],
    ['REQUIREMENTS'],
    ['Cada linha define: rarityRef + level (1–4) + itemRef + quantidade.'],
    ['A combinação rarityRef + level + itemRef deve ser única nesta aba.'],
    ['Remover uma linha de requirement remove o requisito correspondente na base.'],
    [''],
    ['PRÉVIA OBRIGATÓRIA'],
    ['Sempre gere uma prévia antes de aplicar a importação.'],
    ['A prévia mostra exatamente o que será criado (NEW), alterado (CHANGED),'],
    ['mantido (UNCHANGED) e removido (REMOVED). Confirme a prévia antes de aplicar.'],
    [''],
    ['REGISTROS OMITIDOS SERÃO REMOVIDOS'],
    ['Qualquer registro atual não presente nesta planilha será marcado como REMOVED'],
    ['e permanentemente excluído na aplicação. Isso vale para categorias, subcategorias,'],
    ['raridades, itens e requisitos.'],
    [''],
    ['APÓS IMPORTAÇÃO COM NOVOS REGISTROS'],
    ['Se você adicionou novos registros (campos ID vazios), eles receberão IDs da base.'],
    ['Esta planilha não é atualizada automaticamente com os novos IDs gerados.'],
    ['Gere um novo template CURRENT antes da próxima grande atualização.'],
  ];
}

function buildPodexImportDataSheets_(mode, catalog) {
  var categoryRows    = [PODEX_IMPORT_HEADERS_.Categories.slice()];
  var subcategoryRows = [PODEX_IMPORT_HEADERS_.Subcategories.slice()];
  var rarityRows      = [PODEX_IMPORT_HEADERS_.Rarities.slice()];
  var itemRows        = [PODEX_IMPORT_HEADERS_.Items.slice()];
  var requirementRows = [PODEX_IMPORT_HEADERS_.Requirements.slice()];

  if (mode === 'CURRENT' && catalog !== null) {
    var data = buildPodexImportCurrentDataRows_(catalog);
    categoryRows    = categoryRows.concat(data.categories);
    subcategoryRows = subcategoryRows.concat(data.subcategories);
    rarityRows      = rarityRows.concat(data.rarities);
    itemRows        = itemRows.concat(data.items);
    requirementRows = requirementRows.concat(data.requirements);
  }

  return [
    { name: 'Categories',    rows: categoryRows    },
    { name: 'Subcategories', rows: subcategoryRows },
    { name: 'Rarities',      rows: rarityRows      },
    { name: 'Items',         rows: itemRows        },
    { name: 'Requirements',  rows: requirementRows },
  ];
}

/*
 * Constrói linhas de dados para template CURRENT.
 * Para cada tipo, usa o UUID existente como ref (estável e único).
 * Recebe o catálogo agregado retornado por getAdminPodexCatalog_().
 */
function buildPodexImportCurrentDataRows_(catalog) {
  var categoryRows = catalog.categories.map(function (cat) {
    return [
      cat.categoryId,  // categoryRef = categoryId
      cat.categoryId,  // categoryId
      cat.name,
      cat.sortOrder,
    ];
  });

  var subcategoryRows = catalog.subcategories.map(function (sub) {
    return [
      sub.subcategoryId,  // subcategoryRef = subcategoryId
      sub.subcategoryId,  // subcategoryId
      sub.categoryId,     // categoryRef = categoryId do parent
      sub.name,
      sub.sortOrder,
    ];
  });

  var rarityRows = catalog.rarities.map(function (rar) {
    return [
      rar.rarityId,       // rarityRef = rarityId
      rar.rarityId,       // rarityId
      rar.subcategoryId,  // subcategoryRef = subcategoryId do parent
      rar.name,
      rar.completionBuff !== null ? rar.completionBuff : '',
      rar.sortOrder,
    ];
  });

  var itemRows = catalog.items.map(function (item) {
    return [
      item.itemId,     // itemRef = itemId
      item.itemId,     // itemId
      item.name,
      item.originType,
      item.origin,
      item.imageUrl !== null ? item.imageUrl : '',
    ];
  });

  // Requirements: resolve podexLevelId → rarityId + level
  var levelByLevelId = Object.create(null);
  catalog.levels.forEach(function (l) {
    levelByLevelId[l.podexLevelId] = l;
  });

  var requirementRows = catalog.requirements.map(function (req) {
    var level = levelByLevelId[req.podexLevelId];

    if (!level) {
      throw new Error(
        'Integridade: podexLevelId ' + req.podexLevelId +
        ' não encontrado em PodexLevels ao gerar template CURRENT.'
      );
    }

    return [
      level.rarityId,  // rarityRef = rarityId
      level.level,     // level (1–4)
      req.itemId,      // itemRef = itemId
      req.quantity,
    ];
  });

  return {
    categories:    categoryRows,
    subcategories: subcategoryRows,
    rarities:      rarityRows,
    items:         itemRows,
    requirements:  requirementRows,
  };
}

// ------------------------------------------------------------
// Parsing de template de importação
// ------------------------------------------------------------

function extractPodexImportSpreadsheetId_(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    throw createControlledError_(ERROR_CODES.INVALID_REQUEST, 'spreadsheetIdOrUrl é obrigatório.');
  }
  var s = input.trim();
  var match = s.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (match) return match[1];
  if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return s;
  throw createControlledError_(ERROR_CODES.INVALID_REQUEST, 'spreadsheetIdOrUrl inválido. Informe o URL completo ou o ID da planilha.');
}

function validatePodexImportNotDatabaseSpreadsheet_(spreadsheetId) {
  var dbId = getSpreadsheetId_();
  if (spreadsheetId === dbId) {
    throw createControlledError_(
      ERROR_CODES.INVALID_REQUEST,
      'O ID informado corresponde à planilha principal do sistema. Use um template de importação externo.'
    );
  }
}

function safeReadPodexImportRawSheets_(spreadsheetId) {
  var sheetsToRead = ['_Meta'].concat(PODEX_IMPORT_DATA_SHEET_NAMES_);
  return readExternalSpreadsheetSheets_(spreadsheetId, sheetsToRead);
}

function createPodexImportValidationCtx_() {
  return { errors: [] };
}

function podexImportAddError_(ctx, section, recordRef, field, message) {
  ctx.errors.push({ section: section, recordRef: recordRef, field: field, message: message });
}

function podexImportThrowIfErrors_(ctx) {
  if (ctx.errors.length === 0) return;
  throw createControlledError_(
    ERROR_CODES.VALIDATION_ERROR,
    'Erros de validação no template de importação.',
    { validationErrors: ctx.errors }
  );
}

function isPodexImportRowEmpty_(row) {
  if (!Array.isArray(row)) return true;
  return row.every(function (cell) {
    return cell === '' || cell === null || cell === undefined;
  });
}

function podexImportRowToObject_(row, headers) {
  var obj = Object.create(null);
  headers.forEach(function (h, i) {
    var raw = (i < row.length) ? row[i] : '';
    obj[h] = (raw === null || raw === undefined) ? '' : String(raw).trim();
  });
  return obj;
}

// ------------------------------------------------------------
// Validação de _Meta
// ------------------------------------------------------------

function validatePodexImportMetaStrict_(rawSheets) {
  var metaRows = rawSheets['_Meta'];
  if (!Array.isArray(metaRows) || metaRows.length < 2) {
    throw createControlledError_(ERROR_CODES.INVALID_REQUEST, 'Aba _Meta ausente ou vazia no template.');
  }

  var metaMap = Object.create(null);
  for (var i = 1; i < metaRows.length; i++) {
    var row = metaRows[i];
    if (!isPodexImportRowEmpty_(row)) {
      var k = String(row[0] || '').trim();
      var v = String(row[1] !== undefined ? row[1] : '').trim();
      if (k) metaMap[k] = v;
    }
  }

  if (metaMap['templateType'] !== PODEX_IMPORT_TEMPLATE_TYPE_) {
    throw createControlledError_(
      ERROR_CODES.INVALID_REQUEST,
      'Template inválido: templateType incorreto. Esperado: ' + PODEX_IMPORT_TEMPLATE_TYPE_ + '.'
    );
  }

  var ver = Number(metaMap['templateVersion']);
  if (!Number.isFinite(ver) || ver !== PODEX_IMPORT_TEMPLATE_VERSION_) {
    throw createControlledError_(
      ERROR_CODES.INVALID_REQUEST,
      'Versão do template incompatível. Esperado: ' + PODEX_IMPORT_TEMPLATE_VERSION_ +
        '. Encontrado: ' + metaMap['templateVersion'] + '.'
    );
  }

  var mode = metaMap['generatedMode'];
  if (PODEX_IMPORT_TEMPLATE_MODES_.indexOf(mode) === -1) {
    throw createControlledError_(
      ERROR_CODES.INVALID_REQUEST,
      'generatedMode inválido no template: ' + mode
    );
  }

  return { mode: mode, metaMap: metaMap };
}

// ------------------------------------------------------------
// Validação de presença das abas de dados
// ------------------------------------------------------------

function validatePodexImportDataSheetPresence_(rawSheets) {
  var missing = PODEX_IMPORT_DATA_SHEET_NAMES_.filter(function (name) {
    return rawSheets[name] === null || rawSheets[name] === undefined;
  });
  if (missing.length > 0) {
    throw createControlledError_(
      ERROR_CODES.INVALID_REQUEST,
      'Abas ausentes no template: ' + missing.join(', ') + '.'
    );
  }
}

// ------------------------------------------------------------
// Parsers por aba
// ------------------------------------------------------------

function validatePodexImportSheetHeaders_(sheetName, actualRow, expectedHeaders) {
  var actual = (Array.isArray(actualRow) ? actualRow : []).map(function (c) {
    return String(c || '').trim();
  });
  for (var i = 0; i < expectedHeaders.length; i++) {
    if (actual[i] !== expectedHeaders[i]) {
      throw createControlledError_(
        ERROR_CODES.INVALID_REQUEST,
        'Cabeçalho inválido na aba ' + sheetName + '. Esperado: ' + expectedHeaders.join(', ') + '.'
      );
    }
  }
}

function podexImportParsePositiveInt_(value, section, ref, field, ctx) {
  var n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    podexImportAddError_(ctx, section, ref, field, 'Deve ser número inteiro positivo.');
    return null;
  }
  return n;
}

function podexImportParseInteger_(value, section, ref, field, ctx) {
  var n = value === '' ? NaN : Number(value);
  if (!Number.isInteger(n)) {
    podexImportAddError_(ctx, section, ref, field, 'Deve ser número inteiro.');
    return null;
  }
  return n;
}

function podexImportIsValidUuid_(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function parsePodexImportCategoriesSheet_(rawSheets, ctx) {
  var rows = rawSheets['Categories'];
  if (!Array.isArray(rows) || rows.length === 0) return [];
  var hdrs = PODEX_IMPORT_HEADERS_.Categories;
  validatePodexImportSheetHeaders_('Categories', rows[0], hdrs);

  var result = [];
  for (var i = 1; i < rows.length; i++) {
    if (isPodexImportRowEmpty_(rows[i])) continue;
    var o = podexImportRowToObject_(rows[i], hdrs);
    var ref = o.categoryRef || ('row' + (i + 1));
    var ok = true;

    if (!o.categoryRef) {
      podexImportAddError_(ctx, 'Categories', ref, 'categoryRef', 'Obrigatório.');
      ok = false;
    }
    if (o.categoryId !== '' && !podexImportIsValidUuid_(o.categoryId)) {
      podexImportAddError_(ctx, 'Categories', ref, 'categoryId', 'Deve ser UUID válido ou vazio (novo registro).');
      ok = false;
    }
    if (!o.name) {
      podexImportAddError_(ctx, 'Categories', ref, 'name', 'Obrigatório.');
      ok = false;
    } else if (o.name.length > 200) {
      podexImportAddError_(ctx, 'Categories', ref, 'name', 'Máximo 200 caracteres.');
      ok = false;
    }
    var sortOrder = podexImportParseInteger_(o.sortOrder, 'Categories', ref, 'sortOrder', ctx);
    if (sortOrder === null) ok = false;

    if (ok) {
      result.push({
        categoryRef: o.categoryRef,
        categoryId:  o.categoryId !== '' ? o.categoryId : null,
        name:        o.name,
        sortOrder:   sortOrder,
      });
    }
  }
  return result;
}

function parsePodexImportSubcategoriesSheet_(rawSheets, ctx) {
  var rows = rawSheets['Subcategories'];
  if (!Array.isArray(rows) || rows.length === 0) return [];
  var hdrs = PODEX_IMPORT_HEADERS_.Subcategories;
  validatePodexImportSheetHeaders_('Subcategories', rows[0], hdrs);

  var result = [];
  for (var i = 1; i < rows.length; i++) {
    if (isPodexImportRowEmpty_(rows[i])) continue;
    var o = podexImportRowToObject_(rows[i], hdrs);
    var ref = o.subcategoryRef || ('row' + (i + 1));
    var ok = true;

    if (!o.subcategoryRef) {
      podexImportAddError_(ctx, 'Subcategories', ref, 'subcategoryRef', 'Obrigatório.');
      ok = false;
    }
    if (o.subcategoryId !== '' && !podexImportIsValidUuid_(o.subcategoryId)) {
      podexImportAddError_(ctx, 'Subcategories', ref, 'subcategoryId', 'Deve ser UUID válido ou vazio.');
      ok = false;
    }
    if (!o.categoryRef) {
      podexImportAddError_(ctx, 'Subcategories', ref, 'categoryRef', 'Obrigatório.');
      ok = false;
    }
    if (!o.name) {
      podexImportAddError_(ctx, 'Subcategories', ref, 'name', 'Obrigatório.');
      ok = false;
    } else if (o.name.length > 200) {
      podexImportAddError_(ctx, 'Subcategories', ref, 'name', 'Máximo 200 caracteres.');
      ok = false;
    }
    var sortOrder = podexImportParseInteger_(o.sortOrder, 'Subcategories', ref, 'sortOrder', ctx);
    if (sortOrder === null) ok = false;

    if (ok) {
      result.push({
        subcategoryRef: o.subcategoryRef,
        subcategoryId:  o.subcategoryId !== '' ? o.subcategoryId : null,
        categoryRef:    o.categoryRef,
        name:           o.name,
        sortOrder:      sortOrder,
      });
    }
  }
  return result;
}

function parsePodexImportRaritiesSheet_(rawSheets, ctx) {
  var rows = rawSheets['Rarities'];
  if (!Array.isArray(rows) || rows.length === 0) return [];
  var hdrs = PODEX_IMPORT_HEADERS_.Rarities;
  validatePodexImportSheetHeaders_('Rarities', rows[0], hdrs);

  var result = [];
  for (var i = 1; i < rows.length; i++) {
    if (isPodexImportRowEmpty_(rows[i])) continue;
    var o = podexImportRowToObject_(rows[i], hdrs);
    var ref = o.rarityRef || ('row' + (i + 1));
    var ok = true;

    if (!o.rarityRef) {
      podexImportAddError_(ctx, 'Rarities', ref, 'rarityRef', 'Obrigatório.');
      ok = false;
    }
    if (o.rarityId !== '' && !podexImportIsValidUuid_(o.rarityId)) {
      podexImportAddError_(ctx, 'Rarities', ref, 'rarityId', 'Deve ser UUID válido ou vazio.');
      ok = false;
    }
    if (!o.subcategoryRef) {
      podexImportAddError_(ctx, 'Rarities', ref, 'subcategoryRef', 'Obrigatório.');
      ok = false;
    }
    if (!o.name) {
      podexImportAddError_(ctx, 'Rarities', ref, 'name', 'Obrigatório.');
      ok = false;
    } else if (o.name.length > 200) {
      podexImportAddError_(ctx, 'Rarities', ref, 'name', 'Máximo 200 caracteres.');
      ok = false;
    }

    var completionBuff = o.completionBuff !== '' ? o.completionBuff : null;

    var sortOrder = podexImportParseInteger_(o.sortOrder, 'Rarities', ref, 'sortOrder', ctx);
    if (sortOrder === null) ok = false;

    if (ok) {
      result.push({
        rarityRef:      o.rarityRef,
        rarityId:       o.rarityId !== '' ? o.rarityId : null,
        subcategoryRef: o.subcategoryRef,
        name:           o.name,
        completionBuff: completionBuff,
        sortOrder:      sortOrder,
      });
    }
  }
  return result;
}

function parsePodexImportItemsSheet_(rawSheets, ctx) {
  var rows = rawSheets['Items'];
  if (!Array.isArray(rows) || rows.length === 0) return [];
  var hdrs = PODEX_IMPORT_HEADERS_.Items;
  validatePodexImportSheetHeaders_('Items', rows[0], hdrs);

  var result = [];
  for (var i = 1; i < rows.length; i++) {
    if (isPodexImportRowEmpty_(rows[i])) continue;
    var o = podexImportRowToObject_(rows[i], hdrs);
    var ref = o.itemRef || ('row' + (i + 1));
    var ok = true;

    if (!o.itemRef) {
      podexImportAddError_(ctx, 'Items', ref, 'itemRef', 'Obrigatório.');
      ok = false;
    }
    if (o.itemId !== '' && !podexImportIsValidUuid_(o.itemId)) {
      podexImportAddError_(ctx, 'Items', ref, 'itemId', 'Deve ser UUID válido ou vazio.');
      ok = false;
    }
    if (!o.name) {
      podexImportAddError_(ctx, 'Items', ref, 'name', 'Obrigatório.');
      ok = false;
    } else if (o.name.length > 200) {
      podexImportAddError_(ctx, 'Items', ref, 'name', 'Máximo 200 caracteres.');
      ok = false;
    }
    if (PODEX_ITEM_ORIGIN_TYPES_.indexOf(o.originType) === -1) {
      podexImportAddError_(ctx, 'Items', ref, 'originType', 'Deve ser ' + PODEX_ITEM_ORIGIN_TYPES_.join(' ou ') + '.');
      ok = false;
    }
    if (!o.origin) {
      podexImportAddError_(ctx, 'Items', ref, 'origin', 'Obrigatório.');
      ok = false;
    } else if (o.origin.length > 200) {
      podexImportAddError_(ctx, 'Items', ref, 'origin', 'Máximo 200 caracteres.');
      ok = false;
    }
    if (o.imageUrl !== '' && o.imageUrl.length > 500) {
      podexImportAddError_(ctx, 'Items', ref, 'imageUrl', 'Máximo 500 caracteres.');
      ok = false;
    }

    if (ok) {
      result.push({
        itemRef:    o.itemRef,
        itemId:     o.itemId !== '' ? o.itemId : null,
        name:       o.name,
        originType: o.originType,
        origin:     o.origin,
        imageUrl:   o.imageUrl !== '' ? o.imageUrl : null,
      });
    }
  }
  return result;
}

function parsePodexImportRequirementsSheet_(rawSheets, ctx) {
  var rows = rawSheets['Requirements'];
  if (!Array.isArray(rows) || rows.length === 0) return [];
  var hdrs = PODEX_IMPORT_HEADERS_.Requirements;
  validatePodexImportSheetHeaders_('Requirements', rows[0], hdrs);

  var result = [];
  for (var i = 1; i < rows.length; i++) {
    if (isPodexImportRowEmpty_(rows[i])) continue;
    var o = podexImportRowToObject_(rows[i], hdrs);
    var ref = (o.rarityRef && o.itemRef)
      ? (o.rarityRef + ':' + o.level + ':' + o.itemRef)
      : ('row' + (i + 1));
    var ok = true;

    if (!o.rarityRef) {
      podexImportAddError_(ctx, 'Requirements', ref, 'rarityRef', 'Obrigatório.');
      ok = false;
    }
    var level = Number(o.level);
    if (!Number.isFinite(level) || !Number.isInteger(level) || level < 1 || level > 4) {
      podexImportAddError_(ctx, 'Requirements', ref, 'level', 'Deve ser inteiro entre 1 e 4.');
      ok = false;
      level = null;
    }
    if (!o.itemRef) {
      podexImportAddError_(ctx, 'Requirements', ref, 'itemRef', 'Obrigatório.');
      ok = false;
    }
    var quantity = podexImportParsePositiveInt_(o.quantity, 'Requirements', ref, 'quantity', ctx);
    if (quantity === null) ok = false;

    if (ok) {
      result.push({
        rarityRef: o.rarityRef,
        level:     level,
        itemRef:   o.itemRef,
        quantity:  quantity,
      });
    }
  }
  return result;
}

// ------------------------------------------------------------
// Validações pós-parse
// ------------------------------------------------------------

function validatePodexImportCrossRefs_(cats, subs, rars, items, reqs, ctx) {
  var catRefSet = Object.create(null);
  cats.forEach(function (c) { catRefSet[c.categoryRef] = true; });

  var subRefSet = Object.create(null);
  subs.forEach(function (s) { subRefSet[s.subcategoryRef] = true; });

  var rarRefSet = Object.create(null);
  rars.forEach(function (r) { rarRefSet[r.rarityRef] = true; });

  var itemRefSet = Object.create(null);
  items.forEach(function (it) { itemRefSet[it.itemRef] = true; });

  subs.forEach(function (s) {
    if (!catRefSet[s.categoryRef]) {
      podexImportAddError_(ctx, 'Subcategories', s.subcategoryRef, 'categoryRef',
        'categoryRef "' + s.categoryRef + '" não encontrado na aba Categories.');
    }
  });

  rars.forEach(function (r) {
    if (!subRefSet[r.subcategoryRef]) {
      podexImportAddError_(ctx, 'Rarities', r.rarityRef, 'subcategoryRef',
        'subcategoryRef "' + r.subcategoryRef + '" não encontrado na aba Subcategories.');
    }
  });

  reqs.forEach(function (q) {
    var reqRef = q.rarityRef + ':' + q.level + ':' + q.itemRef;
    if (!rarRefSet[q.rarityRef]) {
      podexImportAddError_(ctx, 'Requirements', reqRef, 'rarityRef',
        'rarityRef "' + q.rarityRef + '" não encontrado na aba Rarities.');
    }
    if (!itemRefSet[q.itemRef]) {
      podexImportAddError_(ctx, 'Requirements', reqRef, 'itemRef',
        'itemRef "' + q.itemRef + '" não encontrado na aba Items.');
    }
  });
}

function validatePodexImportIds_(cats, subs, rars, items, catalog, ctx) {
  var existingCatIds = Object.create(null);
  catalog.categories.forEach(function (c) { existingCatIds[c.categoryId] = true; });

  var existingSubIds = Object.create(null);
  catalog.subcategories.forEach(function (s) { existingSubIds[s.subcategoryId] = true; });

  var existingRarIds = Object.create(null);
  catalog.rarities.forEach(function (r) { existingRarIds[r.rarityId] = true; });

  var existingItemIds = Object.create(null);
  catalog.items.forEach(function (it) { existingItemIds[it.itemId] = true; });

  cats.forEach(function (c) {
    if (c.categoryId !== null && !existingCatIds[c.categoryId]) {
      podexImportAddError_(ctx, 'Categories', c.categoryRef, 'categoryId',
        'ID "' + c.categoryId + '" não existe na base. Deixe vazio para criar novo.');
    }
  });

  subs.forEach(function (s) {
    if (s.subcategoryId !== null && !existingSubIds[s.subcategoryId]) {
      podexImportAddError_(ctx, 'Subcategories', s.subcategoryRef, 'subcategoryId',
        'ID "' + s.subcategoryId + '" não existe na base. Deixe vazio para criar novo.');
    }
  });

  rars.forEach(function (r) {
    if (r.rarityId !== null && !existingRarIds[r.rarityId]) {
      podexImportAddError_(ctx, 'Rarities', r.rarityRef, 'rarityId',
        'ID "' + r.rarityId + '" não existe na base. Deixe vazio para criar novo.');
    }
  });

  items.forEach(function (it) {
    if (it.itemId !== null && !existingItemIds[it.itemId]) {
      podexImportAddError_(ctx, 'Items', it.itemRef, 'itemId',
        'ID "' + it.itemId + '" não existe na base. Deixe vazio para criar novo.');
    }
  });
}

function validatePodexImportUniqueness_(cats, subs, rars, items, reqs, ctx) {
  function checkDuplicateRefs_(section, records, refField) {
    var seen = Object.create(null);
    records.forEach(function (r) {
      var k = r[refField];
      if (seen[k]) {
        podexImportAddError_(ctx, section, k, refField, 'Ref duplicada: "' + k + '".');
      }
      seen[k] = true;
    });
  }

  function checkDuplicateIds_(section, records, idField, refField) {
    var seen = Object.create(null);
    records.forEach(function (r) {
      var id = r[idField];
      if (id === null) return;
      if (seen[id]) {
        podexImportAddError_(ctx, section, r[refField], idField, 'ID duplicado: "' + id + '".');
      }
      seen[id] = true;
    });
  }

  checkDuplicateRefs_('Categories',    cats,  'categoryRef');
  checkDuplicateRefs_('Subcategories', subs,  'subcategoryRef');
  checkDuplicateRefs_('Rarities',      rars,  'rarityRef');
  checkDuplicateRefs_('Items',         items, 'itemRef');

  checkDuplicateIds_('Categories',    cats,  'categoryId',    'categoryRef');
  checkDuplicateIds_('Subcategories', subs,  'subcategoryId', 'subcategoryRef');
  checkDuplicateIds_('Rarities',      rars,  'rarityId',      'rarityRef');
  checkDuplicateIds_('Items',         items, 'itemId',        'itemRef');

  var reqKeys = Object.create(null);
  reqs.forEach(function (q) {
    var k = q.rarityRef + '|' + q.level + '|' + q.itemRef;
    if (reqKeys[k]) {
      podexImportAddError_(ctx, 'Requirements',
        q.rarityRef + ':' + q.level + ':' + q.itemRef,
        'rarityRef+level+itemRef',
        'Combinação duplicada: rarityRef="' + q.rarityRef + '", level=' + q.level + ', itemRef="' + q.itemRef + '".'
      );
    }
    reqKeys[k] = true;
  });
}

// ------------------------------------------------------------
// Ponto de entrada puro (testável sem planilha real)
// ------------------------------------------------------------

/*
 * Retorna { spreadsheetId, mode, categories, subcategories, rarities, items, requirements }.
 * Lança VALIDATION_ERROR se houver erros de validação.
 * Lança INVALID_REQUEST se meta/estrutura inválida.
 */
function parsePodexImportFromRawSheets_(rawSheets, spreadsheetId, currentCatalog) {
  var meta = validatePodexImportMetaStrict_(rawSheets);
  validatePodexImportDataSheetPresence_(rawSheets);

  var ctx = createPodexImportValidationCtx_();

  var cats  = parsePodexImportCategoriesSheet_(rawSheets, ctx);
  var subs  = parsePodexImportSubcategoriesSheet_(rawSheets, ctx);
  var rars  = parsePodexImportRaritiesSheet_(rawSheets, ctx);
  var items = parsePodexImportItemsSheet_(rawSheets, ctx);
  var reqs  = parsePodexImportRequirementsSheet_(rawSheets, ctx);

  podexImportThrowIfErrors_(ctx);

  validatePodexImportUniqueness_(cats, subs, rars, items, reqs, ctx);
  podexImportThrowIfErrors_(ctx);

  validatePodexImportCrossRefs_(cats, subs, rars, items, reqs, ctx);
  podexImportThrowIfErrors_(ctx);

  validatePodexImportIds_(cats, subs, rars, items, currentCatalog, ctx);
  podexImportThrowIfErrors_(ctx);

  return {
    spreadsheetId:  spreadsheetId,
    mode:           meta.mode,
    categories:     cats,
    subcategories:  subs,
    rarities:       rars,
    items:          items,
    requirements:   reqs,
  };
}

// ------------------------------------------------------------
// Orquestrador (lê da planilha externa)
// ------------------------------------------------------------

function parsePodexImportTemplate_(spreadsheetIdOrUrl, currentCatalog) {
  var spreadsheetId = extractPodexImportSpreadsheetId_(spreadsheetIdOrUrl);
  validatePodexImportNotDatabaseSpreadsheet_(spreadsheetId);
  var rawSheets = safeReadPodexImportRawSheets_(spreadsheetId);
  return parsePodexImportFromRawSheets_(rawSheets, spreadsheetId, currentCatalog);
}

// ------------------------------------------------------------
// Fingerprints e previewToken
// ------------------------------------------------------------

function computePodexImportDigestHex_(input) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    input,
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (b) {
    return ('0' + (b & 0xff).toString(16)).slice(-2);
  }).join('');
}

function computePodexImportSourceFingerprint_(parsed) {
  var cats  = parsed.categories.slice().sort(function (a, b) { return a.categoryRef  < b.categoryRef  ? -1 : 1; });
  var subs  = parsed.subcategories.slice().sort(function (a, b) { return a.subcategoryRef < b.subcategoryRef ? -1 : 1; });
  var rars  = parsed.rarities.slice().sort(function (a, b) { return a.rarityRef  < b.rarityRef  ? -1 : 1; });
  var items = parsed.items.slice().sort(function (a, b) { return a.itemRef  < b.itemRef  ? -1 : 1; });
  var reqs  = parsed.requirements.slice().sort(function (a, b) {
    var ka = a.rarityRef + '|' + a.level + '|' + a.itemRef;
    var kb = b.rarityRef + '|' + b.level + '|' + b.itemRef;
    return ka < kb ? -1 : 1;
  });

  var parts = [
    'v'    + PODEX_IMPORT_TEMPLATE_VERSION_,
    'mode:' + parsed.mode,
    'cats:' + JSON.stringify(cats.map(function (c) { return { ref: c.categoryRef, id: c.categoryId, name: c.name, so: c.sortOrder }; })),
    'subs:' + JSON.stringify(subs.map(function (s) { return { ref: s.subcategoryRef, id: s.subcategoryId, cref: s.categoryRef, name: s.name, so: s.sortOrder }; })),
    'rars:' + JSON.stringify(rars.map(function (r) { return { ref: r.rarityRef, id: r.rarityId, sref: r.subcategoryRef, name: r.name, buff: r.completionBuff, so: r.sortOrder }; })),
    'items:' + JSON.stringify(items.map(function (it) { return { ref: it.itemRef, id: it.itemId, name: it.name, ot: it.originType, origin: it.origin, img: it.imageUrl }; })),
    'reqs:' + JSON.stringify(reqs.map(function (q) { return { rref: q.rarityRef, lvl: q.level, iref: q.itemRef, qty: q.quantity }; })),
  ];

  return computePodexImportDigestHex_(parts.join('\n'));
}

function computePodexImportCurrentFingerprint_(catalog) {
  var cats  = catalog.categories.slice().sort(function (a, b) { return a.categoryId  < b.categoryId  ? -1 : 1; });
  var subs  = catalog.subcategories.slice().sort(function (a, b) { return a.subcategoryId < b.subcategoryId ? -1 : 1; });
  var rars  = catalog.rarities.slice().sort(function (a, b) { return a.rarityId  < b.rarityId  ? -1 : 1; });
  var items = catalog.items.slice().sort(function (a, b) { return a.itemId  < b.itemId  ? -1 : 1; });
  var reqs  = catalog.requirements.slice().sort(function (a, b) {
    var ka = a.podexLevelId + '|' + a.itemId;
    var kb = b.podexLevelId + '|' + b.itemId;
    return ka < kb ? -1 : 1;
  });

  var parts = [
    'cats:' + JSON.stringify(cats.map(function (c) { return { id: c.categoryId, name: c.name, so: c.sortOrder }; })),
    'subs:' + JSON.stringify(subs.map(function (s) { return { id: s.subcategoryId, cid: s.categoryId, name: s.name, so: s.sortOrder }; })),
    'rars:' + JSON.stringify(rars.map(function (r) { return { id: r.rarityId, sid: r.subcategoryId, name: r.name, buff: r.completionBuff, so: r.sortOrder }; })),
    'items:' + JSON.stringify(items.map(function (it) { return { id: it.itemId, name: it.name, ot: it.originType, origin: it.origin, img: it.imageUrl }; })),
    'reqs:' + JSON.stringify(reqs.map(function (r) { return { lid: r.podexLevelId, iid: r.itemId, qty: r.quantity }; })),
  ];

  return computePodexImportDigestHex_(parts.join('\n'));
}

function computePodexImportPreviewToken_(sourceFingerprint, currentFingerprint) {
  return computePodexImportDigestHex_(
    PODEX_IMPORT_TEMPLATE_VERSION_ + '|' + sourceFingerprint + '|' + currentFingerprint
  );
}

// ------------------------------------------------------------
// Diff engine
// ------------------------------------------------------------

function podexImportBuildIdMap_(records, idField) {
  var map = Object.create(null);
  records.forEach(function (r) { map[r[idField]] = r; });
  return map;
}

/*
 * Pure function — classifica cada entidade como NEW/CHANGED/UNCHANGED/REMOVED.
 * Não acessa Sheets nem produz efeitos colaterais.
 */
function computePodexImportDiff_(parsed, currentCatalog) {
  var currentCatById  = podexImportBuildIdMap_(currentCatalog.categories,    'categoryId');
  var currentSubById  = podexImportBuildIdMap_(currentCatalog.subcategories,  'subcategoryId');
  var currentRarById  = podexImportBuildIdMap_(currentCatalog.rarities,       'rarityId');
  var currentItemById = podexImportBuildIdMap_(currentCatalog.items,          'itemId');

  var currentLevelByKey = Object.create(null);
  currentCatalog.levels.forEach(function (l) {
    currentLevelByKey[l.rarityId + '|' + l.level] = l;
  });

  var currentReqByKey = Object.create(null);
  currentCatalog.requirements.forEach(function (r) {
    currentReqByKey[r.podexLevelId + '|' + r.itemId] = r;
  });

  var catRefToId  = Object.create(null);
  parsed.categories.forEach(function (c) { catRefToId[c.categoryRef] = c.categoryId; });

  var subRefToId  = Object.create(null);
  parsed.subcategories.forEach(function (s) { subRefToId[s.subcategoryRef] = s.subcategoryId; });

  var rarRefToId  = Object.create(null);
  parsed.rarities.forEach(function (r) { rarRefToId[r.rarityRef] = r.rarityId; });

  var itemRefToId = Object.create(null);
  parsed.items.forEach(function (it) { itemRefToId[it.itemRef] = it.itemId; });

  // --- Categories ---
  var catDiff = { new: [], changed: [], unchanged: [], removed: [] };
  var importCatIds = Object.create(null);
  parsed.categories.forEach(function (cat) {
    if (cat.categoryId === null) {
      catDiff.new.push({ categoryRef: cat.categoryRef, name: cat.name, sortOrder: cat.sortOrder });
    } else {
      importCatIds[cat.categoryId] = true;
      var cur = currentCatById[cat.categoryId];
      if (cur.name === cat.name && cur.sortOrder === cat.sortOrder) {
        catDiff.unchanged.push({ categoryId: cat.categoryId, name: cat.name, sortOrder: cat.sortOrder });
      } else {
        catDiff.changed.push({
          categoryId: cat.categoryId,
          before: { name: cur.name, sortOrder: cur.sortOrder },
          after:  { name: cat.name, sortOrder: cat.sortOrder },
        });
      }
    }
  });
  currentCatalog.categories.forEach(function (c) {
    if (!importCatIds[c.categoryId]) {
      catDiff.removed.push({ categoryId: c.categoryId, name: c.name });
    }
  });

  // --- Subcategories ---
  var subDiff = { new: [], changed: [], unchanged: [], removed: [] };
  var importSubIds = Object.create(null);
  parsed.subcategories.forEach(function (sub) {
    var resolvedCatId = catRefToId[sub.categoryRef];
    if (sub.subcategoryId === null) {
      subDiff.new.push({ subcategoryRef: sub.subcategoryRef, categoryRef: sub.categoryRef, name: sub.name, sortOrder: sub.sortOrder });
    } else {
      importSubIds[sub.subcategoryId] = true;
      var cur = currentSubById[sub.subcategoryId];
      if (cur.name === sub.name && cur.sortOrder === sub.sortOrder && cur.categoryId === resolvedCatId) {
        subDiff.unchanged.push({ subcategoryId: sub.subcategoryId, name: sub.name, sortOrder: sub.sortOrder, categoryId: resolvedCatId });
      } else {
        subDiff.changed.push({
          subcategoryId: sub.subcategoryId,
          before: { name: cur.name, sortOrder: cur.sortOrder, categoryId: cur.categoryId },
          after:  { name: sub.name, sortOrder: sub.sortOrder, categoryId: resolvedCatId },
        });
      }
    }
  });
  currentCatalog.subcategories.forEach(function (s) {
    if (!importSubIds[s.subcategoryId]) {
      subDiff.removed.push({ subcategoryId: s.subcategoryId, name: s.name });
    }
  });

  // --- Rarities ---
  var rarDiff = { new: [], changed: [], unchanged: [], removed: [] };
  var importRarIds = Object.create(null);
  parsed.rarities.forEach(function (rar) {
    var resolvedSubId = subRefToId[rar.subcategoryRef];
    if (rar.rarityId === null) {
      rarDiff.new.push({ rarityRef: rar.rarityRef, subcategoryRef: rar.subcategoryRef, name: rar.name, completionBuff: rar.completionBuff, sortOrder: rar.sortOrder });
    } else {
      importRarIds[rar.rarityId] = true;
      var cur = currentRarById[rar.rarityId];
      if (cur.name === rar.name && cur.sortOrder === rar.sortOrder &&
          cur.subcategoryId === resolvedSubId && cur.completionBuff === rar.completionBuff) {
        rarDiff.unchanged.push({ rarityId: rar.rarityId, name: rar.name, sortOrder: rar.sortOrder, subcategoryId: resolvedSubId, completionBuff: rar.completionBuff });
      } else {
        rarDiff.changed.push({
          rarityId: rar.rarityId,
          before: { name: cur.name, sortOrder: cur.sortOrder, subcategoryId: cur.subcategoryId, completionBuff: cur.completionBuff },
          after:  { name: rar.name, sortOrder: rar.sortOrder, subcategoryId: resolvedSubId,      completionBuff: rar.completionBuff },
        });
      }
    }
  });
  currentCatalog.rarities.forEach(function (r) {
    if (!importRarIds[r.rarityId]) {
      rarDiff.removed.push({ rarityId: r.rarityId, name: r.name });
    }
  });

  // --- Items ---
  var itemDiff = { new: [], changed: [], unchanged: [], removed: [] };
  var importItemIds = Object.create(null);
  parsed.items.forEach(function (item) {
    if (item.itemId === null) {
      itemDiff.new.push({ itemRef: item.itemRef, name: item.name, originType: item.originType, origin: item.origin, imageUrl: item.imageUrl });
    } else {
      importItemIds[item.itemId] = true;
      var cur = currentItemById[item.itemId];
      if (cur.name === item.name && cur.originType === item.originType &&
          cur.origin === item.origin && cur.imageUrl === item.imageUrl) {
        itemDiff.unchanged.push({ itemId: item.itemId, name: item.name, originType: item.originType, origin: item.origin, imageUrl: item.imageUrl });
      } else {
        itemDiff.changed.push({
          itemId: item.itemId,
          before: { name: cur.name, originType: cur.originType, origin: cur.origin, imageUrl: cur.imageUrl },
          after:  { name: item.name, originType: item.originType, origin: item.origin, imageUrl: item.imageUrl },
        });
      }
    }
  });
  currentCatalog.items.forEach(function (it) {
    if (!importItemIds[it.itemId]) {
      itemDiff.removed.push({ itemId: it.itemId, name: it.name, originType: it.originType, origin: it.origin });
    }
  });

  // --- Requirements ---
  var reqDiff = { new: [], changed: [], unchanged: [], removed: [] };
  var matchedReqKeys = Object.create(null);
  parsed.requirements.forEach(function (req) {
    var rarityId = rarRefToId[req.rarityRef];
    var itemId   = itemRefToId[req.itemRef];

    var podexLevelId = null;
    if (rarityId !== null && rarityId !== undefined) {
      var lvl = currentLevelByKey[rarityId + '|' + req.level];
      podexLevelId = lvl ? lvl.podexLevelId : null;
    }

    if (podexLevelId === null || itemId === null || itemId === undefined) {
      reqDiff.new.push({ rarityRef: req.rarityRef, level: req.level, itemRef: req.itemRef, quantity: req.quantity });
    } else {
      var key = podexLevelId + '|' + itemId;
      var curReq = currentReqByKey[key];
      if (!curReq) {
        reqDiff.new.push({ rarityRef: req.rarityRef, level: req.level, itemRef: req.itemRef, quantity: req.quantity, podexLevelId: podexLevelId, itemId: itemId });
      } else {
        matchedReqKeys[key] = true;
        if (curReq.quantity === req.quantity) {
          reqDiff.unchanged.push({ podexRequirementId: curReq.podexRequirementId, podexLevelId: podexLevelId, itemId: itemId, quantity: req.quantity });
        } else {
          reqDiff.changed.push({
            podexRequirementId: curReq.podexRequirementId,
            podexLevelId: podexLevelId,
            itemId: itemId,
            before: { quantity: curReq.quantity },
            after:  { quantity: req.quantity },
          });
        }
      }
    }
  });
  currentCatalog.requirements.forEach(function (r) {
    var key = r.podexLevelId + '|' + r.itemId;
    if (!matchedReqKeys[key]) {
      reqDiff.removed.push({ podexRequirementId: r.podexRequirementId, podexLevelId: r.podexLevelId, itemId: r.itemId, quantity: r.quantity });
    }
  });

  // --- Levels (derivados das raridades) ---
  var levelsAdded    = rarDiff.new.length * 4;
  var levelsRemoved  = rarDiff.removed.length * 4;
  var levelsPreserved = (rarDiff.unchanged.length + rarDiff.changed.length) * 4;

  return {
    categories:    catDiff,
    subcategories: subDiff,
    rarities:      rarDiff,
    items:         itemDiff,
    requirements:  reqDiff,
    levels: { added: levelsAdded, removed: levelsRemoved, preserved: levelsPreserved },
  };
}

// ------------------------------------------------------------
// Validação de modo EMPTY
// ------------------------------------------------------------

function validatePodexImportEmptyMode_(catalog) {
  var hasData = catalog.categories.length > 0 || catalog.subcategories.length > 0 ||
                catalog.rarities.length > 0    || catalog.items.length > 0;
  if (hasData) {
    throw createControlledError_(
      ERROR_CODES.CONFLICT,
      'Template EMPTY não pode ser aplicado a uma base com dados existentes. Gere um template CURRENT para atualizar uma base existente.'
    );
  }
}

// ------------------------------------------------------------
// previewPodexImport_ — entry point da action podex.previewImport
// ------------------------------------------------------------

function previewPodexImport_(payload) {
  validateAllowedProperties_(payload, 'payload', ['spreadsheet']);

  if (!payload.spreadsheet || typeof payload.spreadsheet !== 'string') {
    throw createControlledError_(ERROR_CODES.INVALID_REQUEST, 'spreadsheet é obrigatório.');
  }

  var catalog = getAdminPodexCatalog_();
  var parsed  = parsePodexImportTemplate_(payload.spreadsheet, catalog);

  if (parsed.mode === 'EMPTY') {
    validatePodexImportEmptyMode_(catalog);
  }

  var diff              = computePodexImportDiff_(parsed, catalog);

  // Mesmas invariantes do apply, para o erro aparecer já na prévia.
  var fakeSeq = 0;
  validatePodexImportFinalState_(buildPodexImportFinalState_(parsed, catalog, new Date(), function () {
    fakeSeq += 1;
    return 'preview-' + fakeSeq;
  }));

  var sourceFingerprint  = computePodexImportSourceFingerprint_(parsed);
  var currentFingerprint = computePodexImportCurrentFingerprint_(catalog);
  var previewToken       = computePodexImportPreviewToken_(sourceFingerprint, currentFingerprint);

  return {
    templateVersion: PODEX_IMPORT_TEMPLATE_VERSION_,
    mode:            parsed.mode,
    source:          { spreadsheetId: parsed.spreadsheetId },
    summary:         buildPodexImportSummary_(diff),
    changes:         diff,
    previewToken:    previewToken,
  };
}

function buildPodexImportSummary_(diff) {
  function counts_(d) {
    return { new: d.new.length, changed: d.changed.length, unchanged: d.unchanged.length, removed: d.removed.length };
  }

  return {
    categories:    counts_(diff.categories),
    subcategories: counts_(diff.subcategories),
    rarities:      counts_(diff.rarities),
    items:         counts_(diff.items),
    requirements:  counts_(diff.requirements),
    levels:        diff.levels,
  };
}

// ------------------------------------------------------------
// Estado final (puro) e validação
// ------------------------------------------------------------

/*
 * Pure function — monta as 6 tabelas finais a partir do import e do
 * catálogo atual. `now` e `newUuid` são injetados para testabilidade.
 * Novos: UUID + createdAt/updatedAt = now. Alterados: preserva ID e
 * createdAt, updatedAt = now. Mantidos: preserva tudo.
 */
function buildPodexImportFinalState_(parsed, catalog, now, newUuid) {
  var curCat  = podexImportBuildIdMap_(catalog.categories,    'categoryId');
  var curSub  = podexImportBuildIdMap_(catalog.subcategories, 'subcategoryId');
  var curRar  = podexImportBuildIdMap_(catalog.rarities,      'rarityId');
  var curItem = podexImportBuildIdMap_(catalog.items,         'itemId');

  var curLevelByKey = Object.create(null);
  catalog.levels.forEach(function (l) { curLevelByKey[l.rarityId + '|' + l.level] = l; });

  var curReqByKey = Object.create(null);
  catalog.requirements.forEach(function (r) { curReqByKey[r.podexLevelId + '|' + r.itemId] = r; });

  var catRefToId  = Object.create(null);
  var subRefToId  = Object.create(null);
  var rarRefToId  = Object.create(null);
  var itemRefToId = Object.create(null);

  var categories = parsed.categories.map(function (c) {
    var cur = c.categoryId === null ? null : curCat[c.categoryId];
    var id  = cur ? cur.categoryId : newUuid();
    catRefToId[c.categoryRef] = id;
    var same = cur && cur.name === c.name && cur.sortOrder === c.sortOrder;
    return {
      categoryId: id,
      name:       c.name,
      sortOrder:  c.sortOrder,
      createdAt:  cur ? cur.createdAt : now,
      updatedAt:  same ? cur.updatedAt : now,
    };
  });

  var subcategories = parsed.subcategories.map(function (s) {
    var cur = s.subcategoryId === null ? null : curSub[s.subcategoryId];
    var id  = cur ? cur.subcategoryId : newUuid();
    subRefToId[s.subcategoryRef] = id;
    var categoryId = catRefToId[s.categoryRef];
    var same = cur && cur.name === s.name && cur.sortOrder === s.sortOrder && cur.categoryId === categoryId;
    return {
      subcategoryId: id,
      categoryId:    categoryId,
      name:          s.name,
      sortOrder:     s.sortOrder,
      createdAt:     cur ? cur.createdAt : now,
      updatedAt:     same ? cur.updatedAt : now,
    };
  });

  var rarities = parsed.rarities.map(function (r) {
    var cur = r.rarityId === null ? null : curRar[r.rarityId];
    var id  = cur ? cur.rarityId : newUuid();
    rarRefToId[r.rarityRef] = id;
    var subcategoryId = subRefToId[r.subcategoryRef];
    var same = cur && cur.name === r.name && cur.sortOrder === r.sortOrder &&
               cur.subcategoryId === subcategoryId && cur.completionBuff === r.completionBuff;
    return {
      rarityId:       id,
      subcategoryId:  subcategoryId,
      name:           r.name,
      completionBuff: r.completionBuff === null ? '' : r.completionBuff,
      sortOrder:      r.sortOrder,
      createdAt:      cur ? cur.createdAt : now,
      updatedAt:      same ? cur.updatedAt : now,
    };
  });

  var levels = [];
  var levelIdByKey = Object.create(null);
  rarities.forEach(function (r) {
    [1, 2, 3, 4].forEach(function (n) {
      var cur = curLevelByKey[r.rarityId + '|' + n];
      var level = cur ? {
        podexLevelId: cur.podexLevelId,
        rarityId:     cur.rarityId,
        level:        cur.level,
        createdAt:    cur.createdAt,
        updatedAt:    cur.updatedAt,
      } : {
        podexLevelId: newUuid(),
        rarityId:     r.rarityId,
        level:        n,
        createdAt:    now,
        updatedAt:    now,
      };
      levelIdByKey[r.rarityId + '|' + n] = level.podexLevelId;
      levels.push(level);
    });
  });

  var items = parsed.items.map(function (it) {
    var cur = it.itemId === null ? null : curItem[it.itemId];
    var id  = cur ? cur.itemId : newUuid();
    itemRefToId[it.itemRef] = id;
    var same = cur && cur.name === it.name && cur.originType === it.originType &&
               cur.origin === it.origin && cur.imageUrl === it.imageUrl;
    return {
      itemId:     id,
      name:       it.name,
      originType: it.originType,
      origin:     it.origin,
      imageUrl:   it.imageUrl,
      createdAt:  cur ? cur.createdAt : now,
      updatedAt:  same ? cur.updatedAt : now,
    };
  });

  var requirements = parsed.requirements.map(function (q) {
    var podexLevelId = levelIdByKey[rarRefToId[q.rarityRef] + '|' + q.level];
    var itemId       = itemRefToId[q.itemRef];
    var cur          = curReqByKey[podexLevelId + '|' + itemId];
    return {
      podexRequirementId: cur ? cur.podexRequirementId : newUuid(),
      podexLevelId:       podexLevelId,
      itemId:             itemId,
      quantity:           q.quantity,
      createdAt:          cur ? cur.createdAt : now,
      updatedAt:          cur && cur.quantity === q.quantity ? cur.updatedAt : now,
    };
  });

  return {
    categories:    categories,
    subcategories: subcategories,
    rarities:      rarities,
    levels:        levels,
    items:         items,
    requirements:  requirements,
  };
}

/*
 * Pure — valida referências órfãs e chaves lógicas do estado final.
 * Lança VALIDATION_ERROR (nenhuma escrita ocorreu até aqui).
 */
function validatePodexImportFinalState_(final) {
  var ctx = createPodexImportValidationCtx_();

  function ids_(records, field) {
    var m = Object.create(null);
    records.forEach(function (r) { m[r[field]] = true; });
    return m;
  }

  function checkRefs_(section, records, idField, parentField, parentIds) {
    records.forEach(function (r) {
      if (!parentIds[r[parentField]]) {
        podexImportAddError_(ctx, section, r[idField], parentField, 'Referência órfã em ' + parentField + '.');
      }
    });
  }

  function checkUnique_(section, records, idField, keyFn, label) {
    var seen = Object.create(null);
    records.forEach(function (r) {
      var k = keyFn(r);
      if (seen[k]) {
        podexImportAddError_(ctx, section, r[idField], label, 'Combinação duplicada em ' + label + '.');
      }
      seen[k] = true;
    });
  }

  checkRefs_('Subcategories', final.subcategories, 'subcategoryId', 'categoryId',    ids_(final.categories,    'categoryId'));
  checkRefs_('Rarities',      final.rarities,      'rarityId',      'subcategoryId', ids_(final.subcategories, 'subcategoryId'));
  checkRefs_('Levels',        final.levels,        'podexLevelId',  'rarityId',      ids_(final.rarities,      'rarityId'));
  checkRefs_('Requirements',  final.requirements,  'podexRequirementId', 'podexLevelId', ids_(final.levels,    'podexLevelId'));
  checkRefs_('Requirements',  final.requirements,  'podexRequirementId', 'itemId',       ids_(final.items,     'itemId'));

  checkUnique_('Subcategories', final.subcategories, 'subcategoryId', function (s) { return s.categoryId + '|' + s.name; }, 'categoryId+name');
  checkUnique_('Items', final.items, 'itemId', function (i) { return i.name + '|' + i.originType + '|' + i.origin; }, 'name+originType+origin');
  checkUnique_('Requirements', final.requirements, 'podexRequirementId', function (q) { return q.podexLevelId + '|' + q.itemId; }, 'podexLevelId+itemId');

  podexImportThrowIfErrors_(ctx);
}

// ------------------------------------------------------------
// applyPodexImport_ — entry point da action podex.applyImport
// ------------------------------------------------------------

function applyPodexImport_(payload) {
  validateAllowedProperties_(payload, 'payload', ['spreadsheet', 'previewToken']);

  if (!payload.spreadsheet || typeof payload.spreadsheet !== 'string') {
    throw createControlledError_(ERROR_CODES.INVALID_REQUEST, 'spreadsheet é obrigatório.');
  }
  if (!payload.previewToken || typeof payload.previewToken !== 'string') {
    throw createControlledError_(ERROR_CODES.INVALID_REQUEST, 'previewToken é obrigatório.');
  }

  var parsed = parsePodexImportTemplate_(payload.spreadsheet, getAdminPodexCatalog_());
  var sourceFingerprint = computePodexImportSourceFingerprint_(parsed);

  return runPodexCatalogPersistenceLocked_(function () {
    var catalog = getAdminPodexCatalog_();

    if (parsed.mode === 'EMPTY') {
      validatePodexImportEmptyMode_(catalog);
    }

    var currentFingerprint = computePodexImportCurrentFingerprint_(catalog);
    var expectedToken = computePodexImportPreviewToken_(sourceFingerprint, currentFingerprint);

    if (expectedToken !== payload.previewToken) {
      throw createControlledError_(
        ERROR_CODES.CONFLICT,
        'Os dados mudaram desde a prévia. Gere uma nova prévia antes de aplicar a importação.'
      );
    }

    var diff  = computePodexImportDiff_(parsed, catalog);
    var final = buildPodexImportFinalState_(parsed, catalog, new Date(), generateUuid_);

    validatePodexImportFinalState_(final);
    replacePodexCatalogSnapshot_(final);

    var summary = buildPodexImportSummary_(diff);

    return {
      templateVersion:  PODEX_IMPORT_TEMPLATE_VERSION_,
      mode:             parsed.mode,
      summary:          summary,
      hasNewRecords:    summary.categories.new + summary.subcategories.new + summary.rarities.new +
                        summary.items.new + summary.requirements.new > 0,
    };
  });
}
