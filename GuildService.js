function getPublicGuildState_() {
  return toGuildStateApiDto_(findSingletonGuildState_());
}

function getAdminGuildState_() {
  return toGuildStateApiDto_(findSingletonGuildState_());
}

function getPublicGuildObjective_() {
  const guildState = findSingletonGuildState_();

  if (guildState === null || guildState.currentObjectiveSkillId === null) {
    return buildPublicGuildObjectiveDto_(guildState, []);
  }

  const progression = buildSkillProgressionDtos_(
    loadGuildObjectiveSkillSnapshot_(),
  );
  return buildPublicGuildObjectiveDto_(guildState, progression, findAllGuildHistory_(),
    loadGuildObjectiveExpectedWeeklyTarget_(), getCompletedWeeklyContributionTotals_());
}

function buildPublicGuildObjectiveDto_(guildState, progression, historyRecords, expectedWeeklyTarget, completedWeeklyTotals) {
  if (guildState === null) {
    return {
      initialized: false,
      objective: null,
    };
  }

  if (guildState.currentObjectiveSkillId === null) {
    return {
      initialized: true,
      objective: null,
    };
  }

  const objective = progression.find(function (skill) {
    return skill.skillId === guildState.currentObjectiveSkillId;
  });

  if (objective === undefined) {
    return {
      initialized: true,
      objective: {
        status: "INVALID_REFERENCE",
      },
    };
  }

  if (objective.status !== "IN_PROGRESS") {
    return {
      initialized: true,
      objective: {
        skillId: objective.skillId,
        name: objective.name,
        status: objective.status,
        currentLevel: objective.currentLevel,
      },
    };
  }

  return {
    initialized: true,
    objective: toGuildObjectiveDto_(objective, guildState.currentObjectiveTargetLevel || objective.currentLevel + 1, {
      guildState: guildState,
      historyRecords: historyRecords || [],
      expectedWeeklyTarget: expectedWeeklyTarget,
      completedWeeklyTotals: completedWeeklyTotals || [],
    }),
  };
}

function getAdminGuildObjective_() {
  const guildState = findSingletonGuildState_();

  if (guildState === null) {
    return buildUninitializedAdminGuildObjectiveDto_();
  }

  try {
    return buildAdminGuildObjectiveDto_(
      guildState,
      loadGuildObjectiveSkillSnapshot_(),
    );
  } catch (error) {
    if (!isControlledError_(error) || error.code !== ERROR_CODES.CONFLICT) {
      throw error;
    }

    return buildAdminGuildObjectiveDtoWithoutCandidates_(guildState);
  }
}

function setCurrentGuildObjective_(payload) {
  validateAllowedProperties_(payload, "payload", ["skillId", "targetLevel"]);
  const skillId = validateUuid_(payload.skillId, "skillId", {nullable: true});
  const requestedTargetLevel = payload.targetLevel === undefined || payload.targetLevel === null
    ? null : validateSafeInteger_(payload.targetLevel, "targetLevel", {min: 1});

  return runWithDatabaseWriteLock_(function () {
    const guildState = findSingletonGuildState_();

    if (guildState === null) {
      throw createControlledError_(
        ERROR_CODES.CONFLICT,
        "Configure a Guild antes de definir o objetivo atual.",
        null,
      );
    }

    let snapshot = null;

    if (skillId !== null) {
      snapshot = loadGuildObjectiveSkillSnapshot_();
      const candidate = findEligibleGuildObjectiveCandidate_(snapshot, skillId);

      if (candidate === null ||
          (requestedTargetLevel !== null &&
           (requestedTargetLevel < candidate.currentLevel + 1 || requestedTargetLevel > candidate.totalLevels))) {
        throw createControlledError_(
          ERROR_CODES.CONFLICT,
          "A habilidade selecionada não está elegível como objetivo atual.",
          null,
        );
      }
    }

    const updatedGuildState = Object.assign({}, guildState, {
      currentObjectiveSkillId: skillId,
      currentObjectiveTargetLevel: skillId === null ? null : (requestedTargetLevel ||
        findEligibleGuildObjectiveCandidate_(snapshot, skillId).currentLevel + 1),
      updatedAt: new Date(),
    });

    validateGuildStateRepositoryRecord_(updatedGuildState);
    const savedGuildState = updateGuildState_(updatedGuildState);

    if (snapshot === null) {
      try {
        snapshot = loadGuildObjectiveSkillSnapshot_();
      } catch (error) {
        return buildAdminGuildObjectiveDtoWithoutCandidates_(savedGuildState);
      }
    }

    return buildAdminGuildObjectiveDto_(savedGuildState, snapshot);
  });
}

function calculateObjectiveRemainingSteps_(currentStep, totalSteps) {
  const validatedCurrentStep = validateSafeInteger_(
    currentStep,
    "currentStep",
    {min: 0},
  );
  const validatedTotalSteps = validateSafeInteger_(
    totalSteps,
    "totalSteps",
    {min: 1},
  );
  const remainingSteps = validatedTotalSteps - validatedCurrentStep;

  if (!Number.isSafeInteger(remainingSteps) || remainingSteps < 1) {
    throwValidationError_(
      "currentStep",
      "O progresso atual não permite calcular um objetivo válido.",
    );
  }

  return remainingSteps;
}

function calculateMultiLevelObjectiveRemainingSteps_(currentStep, totalSteps, currentLevel, targetLevel) {
  const currentRemaining = calculateObjectiveRemainingSteps_(currentStep, totalSteps);
  const level = validateSafeInteger_(currentLevel, "currentLevel", {min: 0});
  const target = validateSafeInteger_(targetLevel, "targetLevel", {min: level + 1});
  return currentRemaining + (target - level - 1) * totalSteps;
}

function calculateObjectiveProgressPercent_(currentStep, totalSteps) {
  const remainingSteps = calculateObjectiveRemainingSteps_(
    currentStep,
    totalSteps,
  );
  const validatedTotalSteps = validateSafeInteger_(
    totalSteps,
    "totalSteps",
    {min: 1},
  );
  const completedSteps = validatedTotalSteps - remainingSteps;
  const progressPercent = (completedSteps / validatedTotalSteps) * 100;

  if (!Number.isFinite(progressPercent) || progressPercent < 0 || progressPercent >= 100) {
    throw new Error("Percentual de progresso do objetivo inválido.");
  }

  return progressPercent;
}

function calculateGuildObjectiveProgress_(input) {
  validateAllowedProperties_(input, "objective", [
    "currentStep",
    "totalSteps",
    "currentLevel",
    "targetLevel",
  ]);
  const currentLevel = input.currentLevel === undefined ? 0 : input.currentLevel;
  const targetLevel = input.targetLevel === undefined ? currentLevel + 1 : input.targetLevel;
  const remainingSteps = calculateMultiLevelObjectiveRemainingSteps_(
    input.currentStep, input.totalSteps, currentLevel, targetLevel,
  );
  const totalObjectiveSteps = (targetLevel - currentLevel) * input.totalSteps;

  return {
    remainingSteps: remainingSteps,
    progressPercent: (input.currentStep / totalObjectiveSteps) * 100,
  };
}

function buildUnavailableGuildProjection_(reason) {
  return {
    status: "UNAVAILABLE",
    reason: reason,
    days: null,
  };
}

function buildAvailableGuildProjection_(days, ratePerDay) {
  if (!Number.isFinite(days) || days <= 0 || !Number.isFinite(ratePerDay) || ratePerDay <= 0) {
    return buildUnavailableGuildProjection_("NON_POSITIVE_RATE");
  }

  return {
    status: "AVAILABLE",
    reason: null,
    days: Math.max(1, Math.ceil(days)),
    ratePerDay: ratePerDay,
  };
}

function buildGuildObjectiveProjections_(objective, guildState, historyRecords, expectedWeeklyTarget, currentGameDayKey, completedWeeklyTotals) {
  validateObject_(objective, "objective");
  validateObject_(guildState, "guildState");
  if (!Array.isArray(historyRecords)) throw new Error("Histórico de Guild inválido.");

  const stepValue = validateNonNegativeInteger_(objective.stepValue, "stepValue");
  const remainingSteps = validatePositiveInteger_(objective.remainingSteps, "remainingSteps");
  const cost = stepValue > 0 ? remainingSteps * stepValue : null;
  if (cost !== null && (!Number.isSafeInteger(cost) || cost < 1)) {
    throwValidationError_("stepValue", "O custo restante excede o limite seguro.");
  }
  const expectedTarget = expectedWeeklyTarget === null || expectedWeeklyTarget === undefined
    ? null : validateNonNegativeInteger_(expectedWeeklyTarget, "expectedWeeklyTarget");
  const dayKey = currentGameDayKey || getCurrentGameDayKey_();
  const currentWeekKey = getGameWeekKey_(createDateInTimezone_(
    Object.assign(parseDateKeyParts_(dayKey), {hour: 12, minute: 0, second: 0, millisecond: 0}),
    DEFAULT_TIMEZONE,
  ));
  const weeklyGold = Object.create(null);
  if (!Array.isArray(completedWeeklyTotals)) completedWeeklyTotals = [];
  let dailyXpTotal = 0;
  let dailyXpCount = 0;

  historyRecords.forEach(function (record) {
    if (!record || record.gameDayKey === dayKey) return;
    // Zero é uma produção diária válida; somente null/regressão fica fora da média.
    if (Number.isSafeInteger(record.xpDelta) && record.xpDelta >= 0) {
      dailyXpTotal += record.xpDelta;
      dailyXpCount += 1;
    }
  });

  completedWeeklyTotals.forEach(function (entry) {
    const weekKey = validateGameWeekKey_(entry.weekKey, "completedWeeklyTotal.weekKey");
    const total = validateNonNegativeInteger_(entry.totalContributed, "completedWeeklyTotal.totalContributed");
    if (weekKey < currentWeekKey) weeklyGold[weekKey] = total;
  });
  const completeWeeks = Object.keys(weeklyGold).sort().slice(-4);
  const averageWeeklyGold = completeWeeks.length === 0 ? 0
    : completeWeeks.reduce(function (sum, weekKey) { return sum + weeklyGold[weekKey]; }, 0) / completeWeeks.length;
  const averageDailyGold = expectedTarget === null || expectedTarget <= 0 ? 0 : expectedTarget / 7;
  const historicalDailyGold = averageWeeklyGold / 7;
  const xpRemaining = Number.isSafeInteger(guildState.xpProximoNivel) && guildState.xpProximoNivel >= 0
    ? guildState.xpProximoNivel : null;
  const averageDailyXp = dailyXpCount === 0 ? 0 : dailyXpTotal / dailyXpCount;

  return {
    cost: cost,
    ideal: cost === null ? buildUnavailableGuildProjection_("STEP_VALUE_NOT_CONFIGURED")
      : buildAvailableGuildProjection_(cost / averageDailyGold, averageDailyGold),
    historical: cost === null ? buildUnavailableGuildProjection_("STEP_VALUE_NOT_CONFIGURED")
      : buildAvailableGuildProjection_(cost / historicalDailyGold, historicalDailyGold),
    nextGuildLevel: xpRemaining === null
      ? buildUnavailableGuildProjection_("XP_REMAINING_UNAVAILABLE")
      : buildAvailableGuildProjection_(xpRemaining / averageDailyXp, averageDailyXp),
    historicalWeeks: completeWeeks.length,
  };
}

function loadGuildObjectiveExpectedWeeklyTarget_() {
  try {
    return getCurrentContributionWeek_().collectiveTarget;
  } catch (error) {
    return null;
  }
}

function loadGuildObjectiveSkillSnapshot_() {
  try {
    return loadValidatedSkillCatalogSnapshot_();
  } catch (error) {
    throw createControlledError_(
      ERROR_CODES.CONFLICT,
      "Os dados de habilidades estão inconsistentes. Solicite revisão à administração.",
      null,
    );
  }
}

function findEligibleGuildObjectiveCandidate_(snapshot, skillId) {
  const match = buildSkillProgressionDtos_(snapshot).find(function (skill) {
    return skill.skillId === skillId && skill.status === "IN_PROGRESS";
  });

  return match === undefined ? null : match;
}

function buildUninitializedAdminGuildObjectiveDto_() {
  return {
    initialized: false,
    objective: null,
    objectiveError: null,
    canClearObjective: false,
    candidatesAvailable: true,
    candidates: [],
  };
}

function buildAdminGuildObjectiveDtoWithoutCandidates_(guildState) {
  const hasPersistedObjective = guildState.currentObjectiveSkillId !== null;

  return {
    initialized: true,
    objective: null,
    objectiveError: hasPersistedObjective
      ? {
          code: "SKILL_DATA_INCONSISTENT",
          message: "O objetivo não pôde ser validado porque os dados de habilidades estão inconsistentes. A referência atual ainda pode ser removida.",
        }
      : null,
    canClearObjective: hasPersistedObjective,
    candidatesAvailable: false,
    candidates: [],
  };
}

function buildAdminGuildObjectiveDto_(guildState, snapshot) {
  const progression = buildSkillProgressionDtos_(snapshot);
  const candidates = progression
    .filter(function (skill) {
      return skill.status === "IN_PROGRESS";
    })
    .reduce(function (all, skill) {
      for (let target = skill.currentLevel + 1; target <= skill.totalLevels; target += 1) {
        all.push(toGuildObjectiveCandidateDto_(skill, target));
      }
      return all;
    }, []);
  const objectiveSkillId = guildState.currentObjectiveSkillId;
  let objective = null;
  let objectiveError = null;

  if (objectiveSkillId !== null) {
    const current = progression.find(function (skill) {
      return skill.skillId === objectiveSkillId;
    });

    if (current === undefined || current.status !== "IN_PROGRESS") {
      objectiveError = {
        code: "INVALID_OBJECTIVE_REFERENCE",
        message: "O objetivo salvo não aponta para uma habilidade elegível. Remova-o ou selecione outra habilidade.",
      };
    } else {
      objective = toGuildObjectiveDto_(current, guildState.currentObjectiveTargetLevel || current.currentLevel + 1, {
        guildState: guildState,
        historyRecords: findAllGuildHistory_(),
        expectedWeeklyTarget: loadGuildObjectiveExpectedWeeklyTarget_(),
        completedWeeklyTotals: getCompletedWeeklyContributionTotals_(),
      });
    }
  }

  return {
    initialized: true,
    objective: objective,
    objectiveError: objectiveError,
    canClearObjective: objectiveSkillId !== null,
    candidatesAvailable: true,
    candidates: candidates,
  };
}

function toGuildObjectiveCandidateDto_(skill, targetLevel) {
  const selectedTargetLevel = targetLevel || skill.currentLevel + 1;
  return {
    skillId: skill.skillId,
    name: skill.name,
    currentLevel: skill.currentLevel,
    targetLevel: selectedTargetLevel,
    maxTargetLevel: skill.totalLevels,
    currentStep: skill.currentStep,
    totalSteps: skill.totalSteps,
    nextBuff: (function () {
      const buff = (skill.buffs || []).find(function (item) { return item.level === selectedTargetLevel; }) || skill.nextBuff;
      return buff === null || buff === undefined ? null : {level: buff.level, description: buff.description};
    }()),
    stepValue: skill.stepValue,
  };
}

function toGuildObjectiveDto_(skill, targetLevel, projectionContext) {
  const dto = Object.assign(
    toGuildObjectiveCandidateDto_(skill, targetLevel),
    {status: skill.status},
    calculateGuildObjectiveProgress_({
      currentStep: skill.currentStep,
      totalSteps: skill.totalSteps,
      currentLevel: skill.currentLevel,
      targetLevel: targetLevel,
    }),
    {costConfigured: skill.stepValue > 0},
  );

  if (projectionContext) {
    dto.projections = buildGuildObjectiveProjections_(
      dto,
      projectionContext.guildState,
      projectionContext.historyRecords,
      projectionContext.expectedWeeklyTarget,
      null,
      projectionContext.completedWeeklyTotals,
    );
  }

  return dto;
}

function toGuildStateApiDto_(state) {
  return {
    initialized: state !== null,
    level: state === null ? null : state.level,
    bankBalance: state === null ? null : state.bankBalance,
    xpTotal: state === null ? null : state.xpTotal,
    xpProximoNivel: state === null ? null : state.xpProximoNivel,
    vagas: state === null ? null : state.vagas,
    rankingHoje: state === null ? null : state.rankingHoje,
    rankingOntem: state === null ? null : state.rankingOntem,
    updatedAt: state === null ? null : formatDateToApiIso_(state.updatedAt),
  };
}
