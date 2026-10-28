function findAllGuildStates_() {
  return readDatabaseTable_('GuildState')
    .map(function (record) {
      return normalizeGuildStateFromStorage_(
        record
      );
    });
}

function findSingletonGuildState_() {
  const records = findAllGuildStates_();

  if (records.length > 1) {
    throw createControlledError_(
      ERROR_CODES.CONFLICT,
      'O estado da Guild está inconsistente. Solicite revisão à administração.',
      null
    );
  }

  if (records.length === 0) {
    return null;
  }

  try {
    validateGuildStateRepositoryRecord_(records[0]);
  } catch (error) {
    throw createControlledError_(
      ERROR_CODES.CONFLICT,
      'O estado da Guild está inconsistente. Solicite revisão à administração.',
      null
    );
  }

  return records[0];
}

// O callback monta o registro de domínio a partir da leitura feita sob lock.
function saveSingletonGuildState_(buildRecord) {
  if (typeof buildRecord !== 'function') {
    throw new Error('Operação de gravação da Guild inválida.');
  }

  return runWithDatabaseWriteLock_(function () {
    const current = findSingletonGuildState_();
    const record = buildRecord(current);

    return current === null
      ? insertGuildState_(record)
      : updateGuildState_(record);
  });
}

function findGuildStateById_(
  guildStateId
) {
  const validatedGuildStateId =
    validateUuid_(
      guildStateId,
      'guildStateId'
    );

  const record = findSingletonGuildState_();

  return record !== null && record.guildStateId === validatedGuildStateId
    ? record
    : null;
}

function insertGuildState_(
  guildState
) {
  validateGuildStateRepositoryRecord_(
    guildState
  );

  return runWithDatabaseWriteLock_(function () {
    if (findSingletonGuildState_() !== null) {
      throw createControlledError_(
        ERROR_CODES.CONFLICT,
        'A Guild já possui um estado configurado.',
        null
      );
    }

    insertDatabaseRecord_('GuildState', guildState);
    return findGuildStateById_(guildState.guildStateId);
  });
}

function updateGuildState_(
  guildState
) {
  validateGuildStateRepositoryRecord_(
    guildState
  );

  return runWithDatabaseWriteLock_(function () {
    const current = findGuildStateById_(guildState.guildStateId);

    if (current === null) {
      throw createControlledError_(
        ERROR_CODES.NOT_FOUND,
        'O estado da Guild não foi encontrado.',
        null
      );
    }

    updateDatabaseRecordByPrimaryKey_(
      'GuildState',
      guildState.guildStateId,
      guildState
    );

    return findGuildStateById_(guildState.guildStateId);
  });
}

function validateGuildStateRepositoryRecord_(
  guildState
) {
  validateObject_(
    guildState,
    'guildState'
  );

  validateUuid_(
    guildState.guildStateId,
    'guildStateId'
  );

  validateNonNegativeInteger_(guildState.level, 'level');
  validateNonNegativeInteger_(guildState.bankBalance, 'bankBalance');
  validateNonNegativeInteger_(guildState.xpTotal, 'xpTotal');
  validateNonNegativeInteger_(guildState.xpProximoNivel, 'xpProximoNivel');
  validateNonNegativeInteger_(guildState.vagas, 'vagas');
  validateNonNegativeInteger_(guildState.rankingHoje, 'rankingHoje');
  validateNonNegativeInteger_(guildState.rankingOntem, 'rankingOntem');
  assertValidDate_(guildState.createdAt);
  assertValidDate_(guildState.updatedAt);

  if (
    guildState.currentObjectiveSkillId !==
    null &&
    guildState.currentObjectiveSkillId !==
    ''
  ) {
    validateUuid_(
      guildState.currentObjectiveSkillId,
      'currentObjectiveSkillId'
    );
  }

  databaseObjectToRow_(
    'GuildState',
    guildState
  );

  return guildState;
}

function normalizeGuildStateFromStorage_(
  record
) {
  if (!isObject_(record)) {
    throw new Error(
      'Registro de estado da Guild inválido.'
    );
  }

  const normalized =
    Object.assign({}, record);

  if (
    normalized.currentObjectiveSkillId ===
    ''
  ) {
    normalized.currentObjectiveSkillId =
      null;
  }

  return normalized;
}
