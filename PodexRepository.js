function findAllPodexCategories_() {
  return findAllPodexRepositoryRecords_(
    'PodexCategories'
  );
}

function findPodexCategoryById_(
  categoryId
) {
  return findPodexRepositoryRecordById_(
    'PodexCategories',
    'categoryId',
    categoryId
  );
}

function insertPodexCategory_(
  category
) {
  return insertPodexRepositoryRecord_(
    'PodexCategories',
    'categoryId',
    [],
    category
  );
}

function updatePodexCategoryRecord_(
  category
) {
  return updatePodexRepositoryRecord_(
    'PodexCategories',
    'categoryId',
    [],
    category
  );
}


function findAllPodexSubcategories_() {
  return findAllPodexRepositoryRecords_(
    'PodexSubcategories'
  );
}

function findPodexSubcategoryById_(
  subcategoryId
) {
  return findPodexRepositoryRecordById_(
    'PodexSubcategories',
    'subcategoryId',
    subcategoryId
  );
}

function insertPodexSubcategory_(
  subcategory,
  options
) {
  return insertPodexRepositoryRecord_(
    'PodexSubcategories',
    'subcategoryId',
    ['categoryId'],
    subcategory,
    options
  );
}

function updatePodexSubcategoryRecord_(
  subcategory,
  options
) {
  return updatePodexRepositoryRecord_(
    'PodexSubcategories',
    'subcategoryId',
    ['categoryId'],
    subcategory,
    options
  );
}


function findAllPodexRarities_() {
  return findAllPodexRepositoryRecords_(
    'PodexRarities'
  );
}

function findPodexRarityById_(
  rarityId
) {
  return findPodexRepositoryRecordById_(
    'PodexRarities',
    'rarityId',
    rarityId
  );
}

function updatePodexRarityRecord_(
  rarity
) {
  return updatePodexRepositoryRecord_(
    'PodexRarities',
    'rarityId',
    ['subcategoryId'],
    rarity
  );
}


function findAllPodexLevels_() {
  return findAllPodexRepositoryRecords_(
    'PodexLevels'
  );
}

function findPodexLevelById_(
  podexLevelId
) {
  return findPodexRepositoryRecordById_(
    'PodexLevels',
    'podexLevelId',
    podexLevelId
  );
}

function findAllItems_() {
  return findAllPodexRepositoryRecords_(
    'Items'
  );
}

function findItemById_(
  itemId
) {
  return findPodexRepositoryRecordById_(
    'Items',
    'itemId',
    itemId
  );
}

function insertItem_(
  item,
  options
) {
  return insertPodexRepositoryRecord_(
    'Items',
    'itemId',
    [],
    item,
    options
  );
}

function updateItemRecord_(
  item,
  options
) {
  return updatePodexRepositoryRecord_(
    'Items',
    'itemId',
    [],
    item,
    options
  );
}


function findAllPodexRequirements_() {
  return findAllPodexRepositoryRecords_(
    'PodexRequirements'
  );
}

/*
 * Substitui todos os requirements de um nível específico em uma
 * única operação de batch sob lock.
 * newRequirements: array de objetos já montados pelo Service.
 */
function replacePodexRequirementsForLevel_(
  podexLevelId,
  newRequirements
) {
  return runWithDatabaseWriteLock_(function () {
    const all = findAllPodexRequirements_();

    const others = all.filter(function (r) {
      return r.podexLevelId !== podexLevelId;
    });

    const combined = others.concat(newRequirements);

    replaceDatabaseTables_([{
      sheetName:      'PodexRequirements',
      records:        combined,
      uniqueKeyFields: ['podexLevelId', 'itemId'],
    }]);

    return newRequirements;
  });
}

function insertPodexRarityWithLevels_(rarity, levels) {
  return runWithDatabaseWriteLock_(function () {
    insertDatabaseRecords_('PodexRarities', [rarity]);
    insertDatabaseRecords_('PodexLevels', levels);

    return findPodexRarityById_(rarity.rarityId);
  });
}

function deletePodexRepositoryRecord_(sheetName, keyField, id) {
  return runWithDatabaseWriteLock_(function () {
    const remaining = findAllPodexRepositoryRecords_(sheetName).filter(
      function (record) {
        return record[keyField] !== id;
      }
    );

    replaceDatabaseTables_([{ sheetName: sheetName, records: remaining }]);
  });
}

function deletePodexCategoryRecord_(categoryId) {
  deletePodexRepositoryRecord_('PodexCategories', 'categoryId', categoryId);
}

function deletePodexSubcategoryRecord_(subcategoryId) {
  deletePodexRepositoryRecord_(
    'PodexSubcategories',
    'subcategoryId',
    subcategoryId
  );
}

function deleteItemRecord_(itemId) {
  deletePodexRepositoryRecord_('Items', 'itemId', itemId);
}

function deletePodexRarityWithLevelsRecord_(rarityId) {
  return runWithDatabaseWriteLock_(function () {
    replaceDatabaseTables_([
      {
        sheetName: 'PodexRarities',
        records: findAllPodexRarities_().filter(function (r) {
          return r.rarityId !== rarityId;
        }),
      },
      {
        sheetName: 'PodexLevels',
        records: findAllPodexLevels_().filter(function (l) {
          return l.rarityId !== rarityId;
        }),
      },
    ]);
  });
}


function runPodexCatalogPersistenceLocked_(callback) {
  if (typeof callback !== 'function') {
    throw new Error('Operação coordenada do catálogo Podex inválida.');
  }

  return runWithDatabaseWriteLock_(callback);
}

/*
 * Substitui as 6 tabelas do catálogo Podex em uma única operação
 * lógica de lote. Valida referências e chaves lógicas antes da
 * primeira escrita. Sem ACID entre abas (limitação do Sheets).
 */
function replacePodexCatalogSnapshot_(snapshot) {
  if (
    !isObject_(snapshot) ||
    !Array.isArray(snapshot.categories) ||
    !Array.isArray(snapshot.subcategories) ||
    !Array.isArray(snapshot.rarities) ||
    !Array.isArray(snapshot.levels) ||
    !Array.isArray(snapshot.items) ||
    !Array.isArray(snapshot.requirements)
  ) {
    throw new Error('Snapshot do catálogo Podex inválido.');
  }

  const tables = [
    ['PodexCategories', 'categoryId', [], snapshot.categories],
    ['PodexSubcategories', 'subcategoryId', ['categoryId'], snapshot.subcategories],
    ['PodexRarities', 'rarityId', ['subcategoryId'], snapshot.rarities],
    ['PodexLevels', 'podexLevelId', ['rarityId'], snapshot.levels],
    ['Items', 'itemId', [], snapshot.items],
    ['PodexRequirements', 'podexRequirementId', ['podexLevelId', 'itemId'], snapshot.requirements],
  ];

  tables.forEach(function (t) {
    t[3].forEach(function (record) {
      validatePodexRepositoryRecord_(t[0], t[1], t[2], record);
    });
  });

  return runPodexCatalogPersistenceLocked_(function () {
    replaceDatabaseTables_([
      { sheetName: 'PodexCategories', records: snapshot.categories },
      {
        sheetName: 'PodexSubcategories',
        records: snapshot.subcategories,
        uniqueKeyFields: ['categoryId', 'name'],
      },
      { sheetName: 'PodexRarities', records: snapshot.rarities },
      {
        sheetName: 'PodexLevels',
        records: snapshot.levels,
        uniqueKeyFields: ['rarityId', 'level'],
      },
      {
        sheetName: 'Items',
        records: snapshot.items,
        uniqueKeyFields: ['name', 'originType', 'origin'],
      },
      {
        sheetName: 'PodexRequirements',
        records: snapshot.requirements,
        uniqueKeyFields: ['podexLevelId', 'itemId'],
      },
    ]);
  });
}

function findAllPodexRepositoryRecords_(
  sheetName
) {
  return readDatabaseTable_(
    sheetName
  ).map(function (record) {
    return normalizePodexRepositoryRecordFromStorage_(
      sheetName,
      record
    );
  });
}

function findPodexRepositoryRecordById_(
  sheetName,
  idFieldName,
  id
) {
  const validatedId =
    validateUuid_(
      id,
      idFieldName
    );

  const record =
    findDatabaseRecordByPrimaryKey_(
      sheetName,
      validatedId
    );

  return record === null
    ? null
    : normalizePodexRepositoryRecordFromStorage_(
        sheetName,
        record
      );
}

function insertPodexRepositoryRecord_(
  sheetName,
  idFieldName,
  relatedUuidFields,
  record,
  options
) {
  validatePodexRepositoryRecord_(
    sheetName,
    idFieldName,
    relatedUuidFields,
    record
  );

  insertDatabaseRecords_(
    sheetName,
    [record],
    options
  );

  return findPodexRepositoryRecordById_(
    sheetName,
    idFieldName,
    record[idFieldName]
  );
}

function updatePodexRepositoryRecord_(
  sheetName,
  idFieldName,
  relatedUuidFields,
  record,
  options
) {
  validatePodexRepositoryRecord_(
    sheetName,
    idFieldName,
    relatedUuidFields,
    record
  );

  updateDatabaseRecordsByPrimaryKey_(
    sheetName,
    [
      {
        primaryKeyValue: record[idFieldName],
        record: record,
      },
    ],
    options
  );

  return findPodexRepositoryRecordById_(
    sheetName,
    idFieldName,
    record[idFieldName]
  );
}

function validatePodexRepositoryRecord_(
  sheetName,
  idFieldName,
  relatedUuidFields,
  record
) {
  validateObject_(
    record,
    sheetName
  );

  validateUuid_(
    record[idFieldName],
    idFieldName
  );

  relatedUuidFields.forEach(
    function (fieldName) {
      validateUuid_(
        record[fieldName],
        fieldName
      );
    }
  );

  databaseObjectToRow_(
    sheetName,
    record
  );

  return record;
}

function normalizePodexRepositoryRecordFromStorage_(
  sheetName,
  record
) {
  if (!isObject_(record)) {
    throw new Error(
      `Registro inválido em ${sheetName}.`
    );
  }

  const normalized =
    Object.assign({}, record);

  if (
    sheetName === 'PodexRarities' &&
    normalized.completionBuff === ''
  ) {
    normalized.completionBuff = null;
  }

  if (sheetName === 'Items' && normalized.imageUrl === '') {
    normalized.imageUrl = null;
  }

  return normalized;
}
