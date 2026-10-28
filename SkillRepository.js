function findAllSkills_() {
  return findAllSkillRepositoryRecords_(
    'Skills'
  );
}

function insertSkill_(skill) {
  return insertSkillRepositoryRecord_('Skills', 'skillId', [], skill);
}

function updateSkill_(skill) {
  return updateSkillRepositoryRecord_('Skills', 'skillId', [], skill);
}

function readSkillCatalogSnapshot_() {
  return {
    skills: findAllSkills_(),
    buffs: findAllSkillBuffs_(),
    requirements: findAllSkillRequirements_(),
    states: findAllSkillStates_()
  };
}

function runSkillCatalogPersistenceLocked_(callback) {
  return runSkillPersistenceLocked_(
    callback,
    'Operação coordenada do catálogo de habilidades inválida.'
  );
}

function runSkillProgressionPersistenceLocked_(callback) {
  return runSkillPersistenceLocked_(
    callback,
    'Operação coordenada da progressão de habilidades inválida.'
  );
}

function runSkillPersistenceLocked_(callback, errorMessage) {
  if (typeof callback !== 'function') {
    throw new Error(
      errorMessage
    );
  }

  return runWithDatabaseWriteLock_(callback);
}

function replaceSkillCatalogRecords_(
  skills,
  buffs,
  requirements
) {
  if (
    !Array.isArray(skills) ||
    !Array.isArray(buffs) ||
    !Array.isArray(requirements)
  ) {
    throw new Error(
      'Estado final do catálogo de habilidades inválido.'
    );
  }

  skills.forEach(function (skill) {
    validateSkillRepositoryRecord_(
      'Skills',
      'skillId',
      [],
      skill
    );
  });

  buffs.forEach(function (buff) {
    validateSkillRepositoryRecord_(
      'SkillBuffs',
      'skillBuffId',
      ['skillId'],
      buff
    );
  });

  requirements.forEach(function (requirement) {
    validateSkillRepositoryRecord_(
      'SkillRequirements',
      'skillRequirementId',
      ['skillId', 'requiredSkillId'],
      requirement
    );
  });

  return replaceDatabaseTables_([
    {
      sheetName: 'Skills',
      records: skills
    },
    {
      sheetName: 'SkillBuffs',
      records: buffs,
      uniqueKeyFields: ['skillId', 'level']
    },
    {
      sheetName: 'SkillRequirements',
      records: requirements,
      uniqueKeyFields: ['skillId', 'requiredSkillId']
    }
  ]);
}

function findAllSkillBuffs_() {
  return findAllSkillRepositoryRecords_(
    'SkillBuffs'
  );
}

function findAllSkillRequirements_() {
  return findAllSkillRepositoryRecords_(
    'SkillRequirements'
  );
}

function findAllSkillStates_() {
  return findAllSkillRepositoryRecords_(
    'SkillState'
  );
}

function insertSkillState_(skillState) {
  return insertSkillRepositoryRecord_(
    'SkillState',
    'skillStateId',
    ['skillId'],
    skillState
  );
}

function updateSkillState_(skillState) {
  return updateSkillRepositoryRecord_(
    'SkillState',
    'skillStateId',
    ['skillId'],
    skillState
  );
}


function findAllSkillRepositoryRecords_(
  sheetName
) {
  return readDatabaseTable_(
    sheetName
  ).map(function (record) {
    return normalizeSkillRepositoryRecordFromStorage_(
      sheetName,
      record
    );
  });
}

function findSkillRepositoryRecordById_(
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
    : normalizeSkillRepositoryRecordFromStorage_(
        sheetName,
        record
      );
}

function insertSkillRepositoryRecord_(
  sheetName,
  idFieldName,
  relatedUuidFields,
  record
) {
  validateSkillRepositoryRecord_(
    sheetName,
    idFieldName,
    relatedUuidFields,
    record
  );

  insertDatabaseRecord_(
    sheetName,
    record
  );

  return findSkillRepositoryRecordById_(
    sheetName,
    idFieldName,
    record[idFieldName]
  );
}

function updateSkillRepositoryRecord_(
  sheetName,
  idFieldName,
  relatedUuidFields,
  record
) {
  validateSkillRepositoryRecord_(
    sheetName,
    idFieldName,
    relatedUuidFields,
    record
  );

  updateDatabaseRecordByPrimaryKey_(
    sheetName,
    record[idFieldName],
    record
  );

  return findSkillRepositoryRecordById_(
    sheetName,
    idFieldName,
    record[idFieldName]
  );
}

function validateSkillRepositoryRecord_(
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

function normalizeSkillRepositoryRecordFromStorage_(
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

  if (sheetName === 'SkillState') {
    if (normalized.totalSteps === '') {
      normalized.totalSteps = null;
    }
  }

  return normalized;
}
