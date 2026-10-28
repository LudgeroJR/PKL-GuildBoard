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
  return buildPublicGuildObjectiveDto_(guildState, progression);
}

function buildPublicGuildObjectiveDto_(guildState, progression) {
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
    objective: toGuildObjectiveDto_(objective),
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
  validateAllowedProperties_(payload, "payload", ["skillId"]);
  const skillId = validateUuid_(payload.skillId, "skillId", {nullable: true});

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

      if (candidate === null) {
        throw createControlledError_(
          ERROR_CODES.CONFLICT,
          "A habilidade selecionada não está elegível como objetivo atual.",
          null,
        );
      }
    }

    const updatedGuildState = Object.assign({}, guildState, {
      currentObjectiveSkillId: skillId,
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
  ]);

  return {
    remainingSteps: calculateObjectiveRemainingSteps_(
      input.currentStep,
      input.totalSteps,
    ),
    progressPercent: calculateObjectiveProgressPercent_(
      input.currentStep,
      input.totalSteps,
    ),
  };
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
    .map(toGuildObjectiveCandidateDto_);
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
      objective = toGuildObjectiveDto_(current);
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

function toGuildObjectiveCandidateDto_(skill) {
  return {
    skillId: skill.skillId,
    name: skill.name,
    currentLevel: skill.currentLevel,
    targetLevel: skill.currentLevel + 1,
    currentStep: skill.currentStep,
    totalSteps: skill.totalSteps,
    nextBuff: skill.nextBuff,
  };
}

function toGuildObjectiveDto_(skill) {
  return Object.assign(
    toGuildObjectiveCandidateDto_(skill),
    {status: skill.status},
    calculateGuildObjectiveProgress_({
      currentStep: skill.currentStep,
      totalSteps: skill.totalSteps,
    }),
  );
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
