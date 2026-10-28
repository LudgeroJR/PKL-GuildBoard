// ============================================================
// PodexService.js
// Regras de domínio administrativas do Podex.
// Coordena PodexRepository → Database → Google Sheets.
// Sem SpreadsheetApp.
// ============================================================

// ------------------------------------------------------------
// Leitura agregada
// ------------------------------------------------------------

function getAdminPodexCatalog_() {
  return {
    categories:    findAllPodexCategories_(),
    subcategories: findAllPodexSubcategories_(),
    rarities:      findAllPodexRarities_(),
    levels:        findAllPodexLevels_(),
    items:         findAllItems_(),
    requirements:  findAllPodexRequirements_(),
  };
}

// ------------------------------------------------------------
// Leitura pública (somente leitura, sem autenticação)
// ------------------------------------------------------------

function getPublicPodexCatalog_() {
  const categories    = findAllPodexCategories_();
  const subcategories = findAllPodexSubcategories_();
  const rarities      = findAllPodexRarities_();
  const levels        = findAllPodexLevels_();
  const items         = findAllItems_();
  const requirements  = findAllPodexRequirements_();

  const subcategoriesByCategory = Object.create(null);
  subcategories.forEach(function (sub) {
    if (!subcategoriesByCategory[sub.categoryId]) subcategoriesByCategory[sub.categoryId] = [];
    subcategoriesByCategory[sub.categoryId].push(sub);
  });

  const raritiesBySubcategory = Object.create(null);
  rarities.forEach(function (rar) {
    if (!raritiesBySubcategory[rar.subcategoryId]) raritiesBySubcategory[rar.subcategoryId] = [];
    raritiesBySubcategory[rar.subcategoryId].push(rar);
  });

  const levelsByRarity = Object.create(null);
  levels.forEach(function (lvl) {
    if (!levelsByRarity[lvl.rarityId]) levelsByRarity[lvl.rarityId] = [];
    levelsByRarity[lvl.rarityId].push(lvl);
  });

  const requirementsByLevel = Object.create(null);
  requirements.forEach(function (req) {
    if (!requirementsByLevel[req.podexLevelId]) requirementsByLevel[req.podexLevelId] = [];
    requirementsByLevel[req.podexLevelId].push(req);
  });

  const categoryIds = Object.create(null);
  categories.forEach(function (c) { categoryIds[c.categoryId] = true; });

  const orphanSubcategories = subcategories.filter(function (s) { return !categoryIds[s.categoryId]; });
  if (orphanSubcategories.length > 0) {
    throw createControlledError_(
      ERROR_CODES.INTERNAL_ERROR,
      'Catálogo Podex inconsistente: subcategoria sem categoria válida.',
      null
    );
  }

  const subcategoryIds = Object.create(null);
  subcategories.forEach(function (s) { subcategoryIds[s.subcategoryId] = true; });

  const orphanRarities = rarities.filter(function (r) { return !subcategoryIds[r.subcategoryId]; });
  if (orphanRarities.length > 0) {
    throw createControlledError_(
      ERROR_CODES.INTERNAL_ERROR,
      'Catálogo Podex inconsistente: raridade sem subcategoria válida.',
      null
    );
  }

  const rarityIds = Object.create(null);
  rarities.forEach(function (r) { rarityIds[r.rarityId] = true; });

  const orphanLevels = levels.filter(function (l) { return !rarityIds[l.rarityId]; });
  if (orphanLevels.length > 0) {
    throw createControlledError_(
      ERROR_CODES.INTERNAL_ERROR,
      'Catálogo Podex inconsistente: nível sem raridade válida.',
      null
    );
  }

  const levelIds = Object.create(null);
  levels.forEach(function (l) { levelIds[l.podexLevelId] = true; });

  const itemIds = Object.create(null);
  items.forEach(function (i) { itemIds[i.itemId] = true; });

  const orphanRequirements = requirements.filter(function (r) {
    return !levelIds[r.podexLevelId] || !itemIds[r.itemId];
  });
  if (orphanRequirements.length > 0) {
    throw createControlledError_(
      ERROR_CODES.INTERNAL_ERROR,
      'Catálogo Podex inconsistente: requisito referenciando nível ou item inexistente.',
      null
    );
  }

  function bySortOrderThenName_(a, b) {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return String(a.name).localeCompare(String(b.name), 'pt-BR');
  }

  const publicCategories = categories.slice().sort(bySortOrderThenName_).map(function (cat) {
    const catSubcategories = (subcategoriesByCategory[cat.categoryId] || [])
      .slice()
      .sort(bySortOrderThenName_)
      .map(function (sub) {
        const subRarities = (raritiesBySubcategory[sub.subcategoryId] || [])
          .slice()
          .sort(bySortOrderThenName_)
          .map(function (rar) {
            const rarLevels = (levelsByRarity[rar.rarityId] || [])
              .slice()
              .sort(function (a, b) { return a.level - b.level; })
              .map(function (lvl) {
                const lvlRequirements = (requirementsByLevel[lvl.podexLevelId] || []).map(function (req) {
                  return { itemId: req.itemId, quantity: req.quantity };
                });

                return {
                  podexLevelId: lvl.podexLevelId,
                  level:        lvl.level,
                  requirements: lvlRequirements,
                };
              });

            return {
              rarityId:  rar.rarityId,
              name:      rar.name,
              sortOrder: rar.sortOrder,
              levels:    rarLevels,
            };
          });

        return {
          subcategoryId: sub.subcategoryId,
          name:          sub.name,
          sortOrder:     sub.sortOrder,
          rarities:      subRarities,
        };
      });

    return {
      categoryId:    cat.categoryId,
      name:          cat.name,
      sortOrder:     cat.sortOrder,
      subcategories: catSubcategories,
    };
  });

  const publicItems = items.map(function (item) {
    return {
      itemId:     item.itemId,
      name:       item.name,
      originType: item.originType,
      origin:     item.origin,
      imageUrl:   item.imageUrl,
    };
  });

  return {
    categories: publicCategories,
    items:      publicItems,
  };
}

// ------------------------------------------------------------
// Category
// ------------------------------------------------------------

function createPodexCategory_(payload) {
  validateAllowedProperties_(payload, 'payload', ['name', 'sortOrder']);

  const name      = validateRequiredString_(payload.name, 'name', 1, 200);
  const sortOrder = validateInteger_(payload.sortOrder, 'sortOrder');

  const now        = new Date();
  const categoryId = generateUuid_();

  const record = {
    categoryId: categoryId,
    name:       name,
    sortOrder:  sortOrder,
    createdAt:  now,
    updatedAt:  now,
  };

  return insertPodexCategory_(record);
}

function updatePodexCategory_(payload) {
  validateAllowedProperties_(payload, 'payload', ['categoryId', 'name', 'sortOrder']);

  const categoryId = validateUuid_(payload.categoryId, 'categoryId');
  const existing   = findPodexCategoryById_(categoryId);

  if (existing === null) {
    throw createControlledError_(
      ERROR_CODES.NOT_FOUND,
      'Categoria não encontrada.',
      null
    );
  }

  const name      = validateRequiredString_(payload.name, 'name', 1, 200);
  const sortOrder = validateInteger_(payload.sortOrder, 'sortOrder');

  const record = {
    categoryId: categoryId,
    name:       name,
    sortOrder:  sortOrder,
    createdAt:  existing.createdAt,
    updatedAt:  new Date(),
  };

  return updatePodexCategoryRecord_(record);
}

// ------------------------------------------------------------
// Subcategory
// ------------------------------------------------------------

function createPodexSubcategory_(payload) {
  validateAllowedProperties_(payload, 'payload', ['categoryId', 'name', 'sortOrder']);

  const categoryId = validateUuid_(payload.categoryId, 'categoryId');

  const parentCategory = findPodexCategoryById_(categoryId);

  if (parentCategory === null) {
    throw createControlledError_(
      ERROR_CODES.NOT_FOUND,
      'Categoria pai não encontrada.',
      null
    );
  }

  const name      = validateRequiredString_(payload.name, 'name', 1, 200);
  const sortOrder = validateInteger_(payload.sortOrder, 'sortOrder');

  const now           = new Date();
  const subcategoryId = generateUuid_();

  const record = {
    subcategoryId: subcategoryId,
    categoryId:    categoryId,
    name:          name,
    sortOrder:     sortOrder,
    createdAt:     now,
    updatedAt:     now,
  };

  return insertPodexSubcategory_(record, {
    uniqueKeyFields: ['categoryId', 'name'],
  });
}

function updatePodexSubcategory_(payload) {
  validateAllowedProperties_(
    payload, 'payload',
    ['subcategoryId', 'categoryId', 'name', 'sortOrder']
  );

  const subcategoryId = validateUuid_(payload.subcategoryId, 'subcategoryId');
  const existing      = findPodexSubcategoryById_(subcategoryId);

  if (existing === null) {
    throw createControlledError_(
      ERROR_CODES.NOT_FOUND,
      'Subcategoria não encontrada.',
      null
    );
  }

  const categoryId = validateUuid_(payload.categoryId, 'categoryId');

  if (categoryId !== existing.categoryId) {
    const newParent = findPodexCategoryById_(categoryId);

    if (newParent === null) {
      throw createControlledError_(
        ERROR_CODES.NOT_FOUND,
        'Categoria pai não encontrada.',
        null
      );
    }
  }

  const name      = validateRequiredString_(payload.name, 'name', 1, 200);
  const sortOrder = validateInteger_(payload.sortOrder, 'sortOrder');

  const record = {
    subcategoryId: subcategoryId,
    categoryId:    categoryId,
    name:          name,
    sortOrder:     sortOrder,
    createdAt:     existing.createdAt,
    updatedAt:     new Date(),
  };

  return updatePodexSubcategoryRecord_(record, {
    uniqueKeyFields: ['categoryId', 'name'],
  });
}

// ------------------------------------------------------------
// Rarity  (cria automaticamente 4 levels na mesma operação)
// ------------------------------------------------------------

function createPodexRarity_(payload) {
  validateAllowedProperties_(
    payload, 'payload',
    ['subcategoryId', 'name', 'completionBuff', 'sortOrder']
  );

  const subcategoryId  = validateUuid_(payload.subcategoryId, 'subcategoryId');
  const name           = validateRequiredString_(payload.name, 'name', 1, 200);
  const completionBuff = validateString_(
    payload.completionBuff, 'completionBuff', { nullable: true }
  );
  const sortOrder      = validateInteger_(payload.sortOrder, 'sortOrder');

  // Valida parent antes do lock
  const parentSub = findPodexSubcategoryById_(subcategoryId);

  if (parentSub === null) {
    throw createControlledError_(
      ERROR_CODES.NOT_FOUND,
      'Subcategoria pai não encontrada.',
      null
    );
  }

  const rarityId = generateUuid_();
  const now      = new Date();

  const rarity = {
    rarityId:       rarityId,
    subcategoryId:  subcategoryId,
    name:           name,
    completionBuff: completionBuff === null ? '' : completionBuff,
    sortOrder:      sortOrder,
    createdAt:      now,
    updatedAt:      now,
  };

  const levels = [1, 2, 3, 4].map(function (n) {
    return {
      podexLevelId: generateUuid_(),
      rarityId:     rarityId,
      level:        n,
      createdAt:    now,
      updatedAt:    now,
    };
  });

  return insertPodexRarityWithLevels_(rarity, levels);
}

function updatePodexRarity_(payload) {
  validateAllowedProperties_(
    payload, 'payload',
    ['rarityId', 'subcategoryId', 'name', 'completionBuff', 'sortOrder']
  );

  const rarityId = validateUuid_(payload.rarityId, 'rarityId');
  const existing = findPodexRarityById_(rarityId);

  if (existing === null) {
    throw createControlledError_(
      ERROR_CODES.NOT_FOUND,
      'Raridade não encontrada.',
      null
    );
  }

  const subcategoryId  = validateUuid_(payload.subcategoryId, 'subcategoryId');
  const name           = validateRequiredString_(payload.name, 'name', 1, 200);
  const completionBuff = validateString_(
    payload.completionBuff, 'completionBuff', { nullable: true }
  );
  const sortOrder      = validateInteger_(payload.sortOrder, 'sortOrder');

  if (subcategoryId !== existing.subcategoryId) {
    const newParent = findPodexSubcategoryById_(subcategoryId);

    if (newParent === null) {
      throw createControlledError_(
        ERROR_CODES.NOT_FOUND,
        'Subcategoria pai não encontrada.',
        null
      );
    }
  }

  const record = {
    rarityId:       rarityId,
    subcategoryId:  subcategoryId,
    name:           name,
    completionBuff: completionBuff === null ? '' : completionBuff,
    sortOrder:      sortOrder,
    createdAt:      existing.createdAt,
    updatedAt:      new Date(),
  };

  return updatePodexRarityRecord_(record);
}

// ------------------------------------------------------------
// Item  (catálogo único global)
// ------------------------------------------------------------

const PODEX_ITEM_ORIGIN_TYPES_ = Object.freeze(['POKEMON', 'TYPE', 'OTHER']);

function createPodexItem_(payload) {
  validateAllowedProperties_(payload, 'payload', ['name', 'originType', 'origin', 'imageUrl']);

  const name       = validateRequiredString_(payload.name, 'name', 1, 200);
  const originType = validateEnum_(payload.originType, 'originType', PODEX_ITEM_ORIGIN_TYPES_);
  const origin     = validateRequiredString_(payload.origin, 'origin', 1, 200);
  const imageUrl   = Object.prototype.hasOwnProperty.call(payload, 'imageUrl')
    ? validateString_(payload.imageUrl, 'imageUrl', { nullable: true, maxLength: 500 })
    : null;

  const now    = new Date();
  const itemId = generateUuid_();

  const record = {
    itemId:     itemId,
    name:       name,
    originType: originType,
    origin:     origin,
    imageUrl:   imageUrl,
    createdAt:  now,
    updatedAt:  now,
  };

  return insertItem_(record, {
    uniqueKeyFields: ['name', 'originType', 'origin'],
  });
}

function updatePodexItem_(payload) {
  validateAllowedProperties_(payload, 'payload', ['itemId', 'name', 'originType', 'origin', 'imageUrl']);

  const itemId = validateUuid_(payload.itemId, 'itemId');
  const existing = findItemById_(itemId);

  if (existing === null) {
    throw createControlledError_(
      ERROR_CODES.NOT_FOUND,
      'Item não encontrado.',
      null
    );
  }

  const name       = validateRequiredString_(payload.name, 'name', 1, 200);
  const originType = validateEnum_(payload.originType, 'originType', PODEX_ITEM_ORIGIN_TYPES_);
  const origin     = validateRequiredString_(payload.origin, 'origin', 1, 200);
  const imageUrl   = Object.prototype.hasOwnProperty.call(payload, 'imageUrl')
    ? validateString_(payload.imageUrl, 'imageUrl', { nullable: true, maxLength: 500 })
    : existing.imageUrl;

  const record = {
    itemId:     itemId,
    name:       name,
    originType: originType,
    origin:     origin,
    imageUrl:   imageUrl,
    createdAt:  existing.createdAt,
    updatedAt:  new Date(),
  };

  return updateItemRecord_(record, {
    uniqueKeyFields: ['name', 'originType', 'origin'],
  });
}

// ------------------------------------------------------------
// Requirements em lote
// ------------------------------------------------------------

function saveLevelRequirements_(payload) {
  validateAllowedProperties_(payload, 'payload', ['podexLevelId', 'requirements']);

  const podexLevelId = validateUuid_(payload.podexLevelId, 'podexLevelId');

  if (!Array.isArray(payload.requirements)) {
    throwValidationError_('requirements', 'requirements deve ser um array.');
  }

  // Valida estrutura e detecta itemId duplicado no payload
  const seenItemIds = Object.create(null);

  const validated = payload.requirements.map(function (req, idx) {
    const field = 'requirements[' + idx + ']';

    validateAllowedProperties_(req, field, ['itemId', 'quantity']);

    const itemId  = validateUuid_(req.itemId, field + '.itemId');
    const quantity = validatePositiveInteger_(req.quantity, field + '.quantity');

    if (Object.prototype.hasOwnProperty.call(seenItemIds, itemId)) {
      throw createControlledError_(
        ERROR_CODES.VALIDATION_ERROR,
        'Item duplicado no payload de requirements.',
        null
      );
    }

    seenItemIds[itemId] = true;

    return { itemId: itemId, quantity: quantity };
  });

  // Valida level e itens antes do lock (early exit)
  const level = findPodexLevelById_(podexLevelId);

  if (level === null) {
    throw createControlledError_(
      ERROR_CODES.NOT_FOUND,
      'Nível não encontrado.',
      null
    );
  }

  validated.forEach(function (req) {
    const item = findItemById_(req.itemId);

    if (item === null) {
      throw createControlledError_(
        ERROR_CODES.NOT_FOUND,
        'Item não encontrado: ' + req.itemId,
        null
      );
    }
  });

  // Monta registros finais sob lock na primitiva do repository
  return runWithDatabaseWriteLock_(function () {
    // Releitura autoritativa dos requirements deste nível
    const currentForLevel = findAllPodexRequirements_().filter(function (r) {
      return r.podexLevelId === podexLevelId;
    });

    // Índice itemId → requirement existente (para preservar IDs/createdAt)
    const existingByItemId = Object.create(null);

    currentForLevel.forEach(function (r) {
      existingByItemId[r.itemId] = r;
    });

    const now = new Date();

    const newRequirements = validated.map(function (req) {
      const existing = existingByItemId[req.itemId];

      if (existing) {
        return {
          podexRequirementId: existing.podexRequirementId,
          podexLevelId:       podexLevelId,
          itemId:             req.itemId,
          quantity:           req.quantity,
          createdAt:          existing.createdAt,
          updatedAt:          now,
        };
      }

      return {
        podexRequirementId: generateUuid_(),
        podexLevelId:       podexLevelId,
        itemId:             req.itemId,
        quantity:           req.quantity,
        createdAt:          now,
        updatedAt:          now,
      };
    });

    replacePodexRequirementsForLevel_(podexLevelId, newRequirements);

    return {
      podexLevelId:  podexLevelId,
      requirements:  newRequirements,
    };
  });
}

// ------------------------------------------------------------
// Remoções seguras (política restritiva — sem cascade silencioso)
// ------------------------------------------------------------

function deletePodexCategory_(payload) {
  validateAllowedProperties_(payload, 'payload', ['categoryId']);

  const categoryId = validateUuid_(payload.categoryId, 'categoryId');

  const existing = findPodexCategoryById_(categoryId);

  if (existing === null) {
    throw createControlledError_(
      ERROR_CODES.NOT_FOUND,
      'Categoria não encontrada.',
      null
    );
  }

  return runWithDatabaseWriteLock_(function () {
    const subcategories = findAllPodexSubcategories_();

    const hasChildren = subcategories.some(function (s) {
      return s.categoryId === categoryId;
    });

    if (hasChildren) {
      throw createControlledError_(
        ERROR_CODES.CONFLICT,
        'Não é possível remover a categoria: existem subcategorias vinculadas. ' +
        'Remova ou mova as subcategorias antes de excluir a categoria.',
        null
      );
    }

    deletePodexCategoryRecord_(categoryId);

    return null;
  });
}

function deletePodexSubcategory_(payload) {
  validateAllowedProperties_(payload, 'payload', ['subcategoryId']);

  const subcategoryId = validateUuid_(payload.subcategoryId, 'subcategoryId');

  const existing = findPodexSubcategoryById_(subcategoryId);

  if (existing === null) {
    throw createControlledError_(
      ERROR_CODES.NOT_FOUND,
      'Subcategoria não encontrada.',
      null
    );
  }

  return runWithDatabaseWriteLock_(function () {
    const rarities = findAllPodexRarities_();

    const hasChildren = rarities.some(function (r) {
      return r.subcategoryId === subcategoryId;
    });

    if (hasChildren) {
      throw createControlledError_(
        ERROR_CODES.CONFLICT,
        'Não é possível remover a subcategoria: existem raridades vinculadas. ' +
        'Remova ou mova as raridades antes de excluir a subcategoria.',
        null
      );
    }

    deletePodexSubcategoryRecord_(subcategoryId);

    return null;
  });
}

function deletePodexRarity_(payload) {
  validateAllowedProperties_(payload, 'payload', ['rarityId']);

  const rarityId = validateUuid_(payload.rarityId, 'rarityId');

  const existing = findPodexRarityById_(rarityId);

  if (existing === null) {
    throw createControlledError_(
      ERROR_CODES.NOT_FOUND,
      'Raridade não encontrada.',
      null
    );
  }

  return runWithDatabaseWriteLock_(function () {
    const levels       = findAllPodexLevels_();
    const requirements = findAllPodexRequirements_();

    const rarityLevelIds = levels
      .filter(function (l) { return l.rarityId === rarityId; })
      .map(function (l) { return l.podexLevelId; });

    const hasRequirements = requirements.some(function (r) {
      return rarityLevelIds.indexOf(r.podexLevelId) !== -1;
    });

    if (hasRequirements) {
      throw createControlledError_(
        ERROR_CODES.CONFLICT,
        'Não é possível remover a raridade: um ou mais níveis possuem requisitos. ' +
        'Remova todos os requisitos antes de excluir a raridade.',
        null
      );
    }

    deletePodexRarityWithLevelsRecord_(rarityId);

    return null;
  });
}

function deletePodexItem_(payload) {
  validateAllowedProperties_(payload, 'payload', ['itemId']);

  const itemId = validateUuid_(payload.itemId, 'itemId');

  const existing = findItemById_(itemId);

  if (existing === null) {
    throw createControlledError_(
      ERROR_CODES.NOT_FOUND,
      'Item não encontrado.',
      null
    );
  }

  return runWithDatabaseWriteLock_(function () {
    const requirements = findAllPodexRequirements_();

    const isReferenced = requirements.some(function (r) {
      return r.itemId === itemId;
    });

    if (isReferenced) {
      throw createControlledError_(
        ERROR_CODES.CONFLICT,
        'Não é possível remover o item: ele é referenciado por um ou mais requisitos. ' +
        'Remova as referências antes de excluir o item.',
        null
      );
    }

    deleteItemRecord_(itemId);

    return null;
  });
}
