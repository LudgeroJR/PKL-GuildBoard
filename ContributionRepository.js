function findAllContributions_() {
  return readDatabaseTable_("Contributions").map(function (record) {
    return normalizeContributionFromStorage_(record);
  });
}

function findContributionsByWeekKey_(weekKey) {
  const normalizedWeekKey = validateGameWeekKey_(weekKey, "weekKey");

  return findAllContributions_().filter(function (contribution) {
    return contribution.weekKey === normalizedWeekKey;
  });
}

function findContributionById_(contributionId) {
  const validatedContributionId = validateUuid_(
    contributionId,
    "contributionId",
  );

  const record = findDatabaseRecordByPrimaryKey_(
    "Contributions",
    validatedContributionId,
  );

  return record === null ? null : normalizeContributionFromStorage_(record);
}

function findContributionByMemberAndWeek_(memberId, weekKey) {
  const normalizedMemberId = validateUuid_(memberId, "memberId");

  const normalizedWeekKey = validateGameWeekKey_(weekKey, "weekKey");

  const matches = findContributionsByWeekKey_(normalizedWeekKey).filter(
    function (contribution) {
      return contribution.memberId === normalizedMemberId;
    },
  );

  if (matches.length > 1) {
    throw createControlledError_(
      ERROR_CODES.CONFLICT,
      "Existem contribuições duplicadas para o mesmo membro nesta semana.",
      null,
    );
  }

  return matches.length === 0 ? null : matches[0];
}

function insertContributions_(contributions) {
  if (!Array.isArray(contributions)) {
    throw new Error("Lote de contribuições inválido.");
  }

  contributions.forEach(function (contribution) {
    validateContributionRepositoryRecord_(contribution);
  });

  if (contributions.length === 0) {
    return 0;
  }

  return insertDatabaseRecords_("Contributions", contributions, {
    uniqueKeyFields: ["memberId", "weekKey"],
  });
}

function updateContributions_(contributions) {
  if (!Array.isArray(contributions)) {
    throw new Error("Lote de contribuições inválido.");
  }

  contributions.forEach(function (contribution) {
    validateContributionRepositoryRecord_(contribution);
  });

  if (contributions.length === 0) {
    return 0;
  }

  const updates = contributions.map(function (contribution) {
    return {
      primaryKeyValue: contribution.contributionId,
      record: contribution,
    };
  });

  return updateDatabaseRecordsByPrimaryKey_("Contributions", updates, {
    uniqueKeyFields: ["memberId", "weekKey"],
  });
}

function runContributionPersistenceLocked_(callback) {
  if (typeof callback !== "function") {
    throw new Error("Operação coordenada de Contributions inválida.");
  }

  return runWithDatabaseWriteLock_(callback);
}

function validateContributionRepositoryRecord_(contribution) {
  validateObject_(contribution, "contribution");

  validateUuid_(contribution.contributionId, "contributionId");

  validateUuid_(contribution.memberId, "memberId");

  databaseObjectToRow_("Contributions", contribution);

  return contribution;
}

function normalizeContributionFromStorage_(record) {
  if (!isObject_(record)) {
    throw new Error("Registro de contribuição inválido.");
  }

  return Object.assign({}, record);
}
