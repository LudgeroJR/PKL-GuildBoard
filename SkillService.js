const SKILL_PERSISTED_STATUSES_ = Object.freeze([
  "IN_PROGRESS",
  "AWAITING_LEVEL_CONFIG",
  "COMPLETED",
]);

function getAdminSkillCatalog_() {
  const snapshot = loadValidatedSkillCatalogSnapshot_();

  return buildSkillCatalogDtos_(snapshot);
}

function getAdminUnlinkedApiSkills_() {
  const catalog = findAllSkills_();
  const linked = new Set(catalog.map(function (skill) { return skill.apiSkillId; }));
  const payload = fetchGuildApiData_();
  if (!Array.isArray(payload.habilidades)) {
    throw createControlledError_(ERROR_CODES.CONFLICT, "Lista de habilidades da API inválida.", null);
  }
  const seen = new Set();
  return payload.habilidades.map(normalizeGuildApiSkill_)
    .filter(function (skill) {
      if (seen.has(skill.apiSkillId)) {
        throw createControlledError_(ERROR_CODES.CONFLICT, "apiSkillId duplicado na API.", null);
      }
      seen.add(skill.apiSkillId);
      return true;
    })
    .filter(function (skill) { return !linked.has(skill.apiSkillId); })
    .map(function (skill) {
      return {apiSkillId: skill.apiSkillId, name: skill.name, totalLevels: skill.nivelMax};
    });
}

function linkCatalogSkillToApi_(payload) {
  validateAllowedProperties_(payload, "payload", ["skillId", "apiSkillId"]);
  const skillId = validateUuid_(payload.skillId, "skillId");
  const apiSkillId = validateRequiredString_(payload.apiSkillId, "apiSkillId", 1, 100);
  const apiSkill = getAdminUnlinkedApiSkills_().find(function (skill) {
    return skill.apiSkillId === apiSkillId;
  });
  if (!apiSkill) {
    throw createControlledError_(ERROR_CODES.CONFLICT, "Habilidade da API já vinculada ou não encontrada.", null);
  }
  return runSkillCatalogPersistenceLocked_(function () {
    const snapshot = loadValidatedSkillCatalogSnapshot_();
    const finalSkills = buildLinkedSkillCatalogSkills_(snapshot.skills, skillId, apiSkill);
    replaceSkillCatalogRecords_(finalSkills, snapshot.buffs, snapshot.requirements);
    return findSkillCatalogDtoById_(Object.assign({}, snapshot, {skills: finalSkills}), skillId);
  });
}

function buildLinkedSkillCatalogSkills_(skills, skillId, apiSkill) {
  const local = skills.find(function (skill) { return skill.skillId === skillId; });
  if (!local) {
    throw createControlledError_(ERROR_CODES.NOT_FOUND, "Habilidade local não encontrada.", null);
  }
  if (local.apiSkillId && local.apiSkillId !== apiSkill.apiSkillId) {
    throw createControlledError_(ERROR_CODES.CONFLICT, "Esta habilidade já tem vínculo com a API.", null);
  }
  if (local.totalLevels !== apiSkill.totalLevels) {
    throw createControlledError_(ERROR_CODES.CONFLICT,
      "Ajuste o total de níveis local ao limite da API antes de vincular.", null);
  }
  if (skills.some(function (skill) {
    return skill.skillId !== skillId && skill.apiSkillId === apiSkill.apiSkillId;
  })) {
    throw createControlledError_(ERROR_CODES.CONFLICT, "apiSkillId já utilizado no catálogo.", null);
  }
  return skills.map(function (skill) {
    return skill.skillId === skillId
      ? Object.assign({}, local, {apiSkillId: apiSkill.apiSkillId, updatedAt: new Date()})
      : skill;
  });
}

function getAdminSkillProgression_() {
  const snapshot = loadValidatedSkillCatalogSnapshot_();
  const guildState = findSingletonGuildState_();

  return {
    guild: {
      initialized: guildState !== null,
      bankBalance: guildState === null ? null : guildState.bankBalance,
    },
    skills: buildSkillProgressionDtos_(snapshot),
  };
}

function getPublicSkillProgression_() {
  const snapshot = loadValidatedSkillCatalogSnapshot_();
  const catalog = buildSkillCatalogDtos_(snapshot);
  const stateBySkillId = buildUniqueIndex_(
    snapshot.states,
    "skillId",
    "SkillState",
  );

  return catalog
    .filter(function (skill) {
      return SKILL_PERSISTED_STATUSES_.indexOf(skill.status) !== -1;
    })
    .map(function (skill) {
      const state = stateBySkillId[skill.skillId];
      const nextBuff = skill.buffs.find(function (buff) {
        return buff.level === skill.currentLevel + 1;
      });

      return {
        skillId: skill.skillId,
        name: skill.name,
        totalLevels: skill.totalLevels,
        status: skill.status,
        currentLevel: skill.currentLevel,
        currentStep: state.currentStep,
        totalSteps: state.totalSteps,
        nextBuff:
          nextBuff === undefined
            ? null
            : {
                level: nextBuff.level,
                description: nextBuff.description,
              },
        earnedBuffs: skill.buffs
          .filter(function (buff) {
            return buff.level <= skill.currentLevel;
          })
          .map(function (buff) {
            return {
              level: buff.level,
              description: buff.description,
            };
          }),
      };
    });
}

function activateSkill_(payload) {
  const input = validateSkillLevelConfigurationPayload_(payload);

  return runSkillProgressionPersistenceLocked_(function () {
    const snapshot = loadValidatedSkillCatalogSnapshot_();
    const skillIndex = buildUniqueIndex_(snapshot.skills, "skillId", "Skills");

    if (!Object.prototype.hasOwnProperty.call(skillIndex, input.skillId)) {
      throw createControlledError_(
        ERROR_CODES.NOT_FOUND,
        "A habilidade solicitada não foi encontrada.",
        null,
      );
    }

    const stateBySkillId = buildUniqueIndex_(
      snapshot.states,
      "skillId",
      "SkillState",
    );

    if (Object.prototype.hasOwnProperty.call(stateBySkillId, input.skillId)) {
      throw createControlledError_(
        ERROR_CODES.CONFLICT,
        "A habilidade já foi ativada.",
        null,
      );
    }

    const requirements = snapshot.requirements.filter(function (requirement) {
      return requirement.skillId === input.skillId;
    });
    const status = calculateUnpersistedSkillStatus_(
      requirements,
      stateBySkillId,
    );

    if (status !== "AVAILABLE") {
      throw createControlledError_(
        ERROR_CODES.CONFLICT,
        "A habilidade ainda possui pré-requisitos pendentes.",
        null,
      );
    }

    const now = new Date();
    const skillState = {
      skillStateId: generateUuid_(),
      skillId: input.skillId,
      currentLevel: 0,
      currentStep: 0,
      totalSteps: input.totalSteps,
      status: "IN_PROGRESS",
      activatedAt: now,
      updatedAt: now,
    };
    const finalSnapshot = {
      skills: snapshot.skills.slice(),
      buffs: snapshot.buffs.slice(),
      requirements: snapshot.requirements.slice(),
      states: snapshot.states.concat([skillState]),
    };

    assertValidSkillCatalogSnapshot_(finalSnapshot);
    insertSkillState_(skillState);

    return findSkillProgressionDtoById_(finalSnapshot, input.skillId);
  });
}

function configureSkillLevel_(payload) {
  const input = validateSkillLevelConfigurationPayload_(payload);

  return runSkillProgressionPersistenceLocked_(function () {
    const snapshot = loadValidatedSkillCatalogSnapshot_();
    const skillIndex = buildUniqueIndex_(snapshot.skills, "skillId", "Skills");

    if (!Object.prototype.hasOwnProperty.call(skillIndex, input.skillId)) {
      throw createControlledError_(
        ERROR_CODES.NOT_FOUND,
        "A habilidade solicitada não foi encontrada.",
        null,
      );
    }

    const stateBySkillId = buildUniqueIndex_(
      snapshot.states,
      "skillId",
      "SkillState",
    );
    const currentState = stateBySkillId[input.skillId] || null;

    if (currentState === null) {
      throw createControlledError_(
        ERROR_CODES.NOT_FOUND,
        "A habilidade ainda não foi ativada.",
        null,
      );
    }

    if (currentState.status !== "AWAITING_LEVEL_CONFIG") {
      throw createControlledError_(
        ERROR_CODES.CONFLICT,
        "A habilidade não está aguardando configuração de nível.",
        null,
      );
    }

    const updatedState = {
      skillStateId: currentState.skillStateId,
      skillId: currentState.skillId,
      currentLevel: currentState.currentLevel,
      currentStep: 0,
      totalSteps: input.totalSteps,
      status: "IN_PROGRESS",
      activatedAt: currentState.activatedAt,
      updatedAt: new Date(),
    };
    const finalSnapshot = {
      skills: snapshot.skills.slice(),
      buffs: snapshot.buffs.slice(),
      requirements: snapshot.requirements.slice(),
      states: snapshot.states.map(function (state) {
        return state.skillId === input.skillId ? updatedState : state;
      }),
    };

    assertValidSkillCatalogSnapshot_(finalSnapshot);
    updateSkillState_(updatedState);

    return findSkillProgressionDtoById_(finalSnapshot, input.skillId);
  });
}

function validateSkillLevelConfigurationPayload_(payload) {
  validateAllowedProperties_(payload, "payload", [
    "skillId",
    "totalSteps",
  ]);

  const skillId = validateUuid_(payload.skillId, "skillId");
  const totalSteps = validateSafeInteger_(payload.totalSteps, "totalSteps", {
    min: 1,
  });

  return {
    skillId: skillId,
    totalSteps: totalSteps,
  };
}

function createCatalogSkill_(payload) {
  const input = validateCatalogSkillPayload_(payload, false);

  return runSkillCatalogPersistenceLocked_(function () {
    const snapshot = loadValidatedSkillCatalogSnapshot_();
    const usedIds = buildSkillCatalogIdSet_(snapshot);
    const skillId = generateUniqueSkillCatalogId_(usedIds);
    const now = new Date();

    validateCatalogRequirementsAgainstSkills_(
      input.requirements,
      skillId,
      snapshot.skills,
    );

    const skill = {
      skillId: skillId,
      apiSkillId: "",
      name: input.name,
      totalLevels: input.totalLevels,
      createdAt: now,
      updatedAt: now,
    };

    const buffs = input.buffs.map(function (buff) {
      return {
        skillBuffId: generateUniqueSkillCatalogId_(usedIds),
        skillId: skillId,
        level: buff.level,
        description: buff.description,
        createdAt: now,
        updatedAt: now,
      };
    });

    const requirements = input.requirements.map(function (requirement) {
      return {
        skillRequirementId: generateUniqueSkillCatalogId_(usedIds),
        skillId: skillId,
        requiredSkillId: requirement.requiredSkillId,
        minimumLevel: requirement.minimumLevel,
        createdAt: now,
        updatedAt: now,
      };
    });

    const finalSnapshot = {
      skills: snapshot.skills.concat([skill]),
      buffs: snapshot.buffs.concat(buffs),
      requirements: snapshot.requirements.concat(requirements),
      states: snapshot.states.slice(),
    };

    assertValidSkillCatalogSnapshot_(finalSnapshot);

    replaceSkillCatalogRecords_(
      finalSnapshot.skills,
      finalSnapshot.buffs,
      finalSnapshot.requirements,
    );

    return findSkillCatalogDtoById_(finalSnapshot, skillId);
  });
}

function updateCatalogSkill_(payload) {
  const input = validateCatalogSkillPayload_(payload, true);

  return runSkillCatalogPersistenceLocked_(function () {
    const snapshot = loadValidatedSkillCatalogSnapshot_();
    const skillIndex = buildUniqueIndex_(
      snapshot.skills,
      "skillId",
      "Skills",
    );

    if (!Object.prototype.hasOwnProperty.call(skillIndex, input.skillId)) {
      throw createControlledError_(
        ERROR_CODES.NOT_FOUND,
        "A habilidade solicitada não foi encontrada.",
        null,
      );
    }

    const currentSkill = skillIndex[input.skillId];

    if (currentSkill.apiSkillId && input.totalLevels !== currentSkill.totalLevels) {
      throw createControlledError_(ERROR_CODES.CONFLICT,
        "O total de níveis desta habilidade é governado pela API.", null);
    }

    assertCatalogLevelChangeIsCompatible_(input, snapshot);
    validateCatalogRequirementsAgainstSkills_(
      input.requirements,
      input.skillId,
      snapshot.skills,
    );

    const usedIds = buildSkillCatalogIdSet_(snapshot);
    const now = new Date();
    const updatedSkill = {
      skillId: currentSkill.skillId,
      apiSkillId: currentSkill.apiSkillId,
      name: input.name,
      totalLevels: input.totalLevels,
      createdAt: currentSkill.createdAt,
      updatedAt: now,
    };

    const currentBuffs = snapshot.buffs.filter(function (buff) {
      return buff.skillId === input.skillId;
    });
    const currentBuffByLevel = buildUniqueIndex_(
      currentBuffs,
      "level",
      "buffs da habilidade",
    );

    const updatedBuffs = input.buffs.map(function (buff) {
      const current = currentBuffByLevel[String(buff.level)] || null;

      return {
        skillBuffId:
          current === null
            ? generateUniqueSkillCatalogId_(usedIds)
            : current.skillBuffId,
        skillId: input.skillId,
        level: buff.level,
        description: buff.description,
        createdAt: current === null ? now : current.createdAt,
        updatedAt: now,
      };
    });

    const currentRequirements = snapshot.requirements.filter(
      function (requirement) {
        return requirement.skillId === input.skillId;
      },
    );
    const currentRequirementByRequiredSkillId = buildUniqueIndex_(
      currentRequirements,
      "requiredSkillId",
      "requisitos da habilidade",
    );

    const updatedRequirements = input.requirements.map(function (requirement) {
      const current =
        currentRequirementByRequiredSkillId[requirement.requiredSkillId] ||
        null;

      return {
        skillRequirementId:
          current === null
            ? generateUniqueSkillCatalogId_(usedIds)
            : current.skillRequirementId,
        skillId: input.skillId,
        requiredSkillId: requirement.requiredSkillId,
        minimumLevel: requirement.minimumLevel,
        createdAt: current === null ? now : current.createdAt,
        updatedAt: now,
      };
    });

    const finalSnapshot = {
      skills: snapshot.skills.map(function (skill) {
        return skill.skillId === input.skillId ? updatedSkill : skill;
      }),
      buffs: snapshot.buffs
        .filter(function (buff) {
          return buff.skillId !== input.skillId;
        })
        .concat(updatedBuffs),
      requirements: snapshot.requirements
        .filter(function (requirement) {
          return requirement.skillId !== input.skillId;
        })
        .concat(updatedRequirements),
      states: snapshot.states.slice(),
    };

    assertValidSkillCatalogSnapshot_(finalSnapshot);

    replaceSkillCatalogRecords_(
      finalSnapshot.skills,
      finalSnapshot.buffs,
      finalSnapshot.requirements,
    );

    return findSkillCatalogDtoById_(finalSnapshot, input.skillId);
  });
}

function validateCatalogSkillPayload_(payload, isUpdate) {
  const allowedProperties = isUpdate
    ? ["skillId", "name", "totalLevels", "buffs", "requirements"]
    : ["name", "totalLevels", "buffs", "requirements"];

  validateAllowedProperties_(payload, "payload", allowedProperties);

  const skillId = isUpdate
    ? validateUuid_(payload.skillId, "skillId")
    : null;
  const name = validateRequiredString_(payload.name, "name", 1, 100);
  const totalLevels = validatePositiveInteger_(
    payload.totalLevels,
    "totalLevels",
  );

  if (!Array.isArray(payload.buffs)) {
    throwValidationError_("buffs", "O valor deve ser uma lista.");
  }

  if (!Array.isArray(payload.requirements)) {
    throwValidationError_("requirements", "O valor deve ser uma lista.");
  }

  const seenLevels = Object.create(null);
  const buffs = payload.buffs.map(function (buff, index) {
    const fieldPrefix = `buffs[${index}]`;

    validateAllowedProperties_(buff, fieldPrefix, ["level", "description"]);

    const level = validatePositiveInteger_(
      buff.level,
      `${fieldPrefix}.level`,
      { max: totalLevels },
    );
    const description = validateRequiredString_(
      buff.description,
      `${fieldPrefix}.description`,
      1,
      500,
    );

    if (Object.prototype.hasOwnProperty.call(seenLevels, level)) {
      throwValidationError_("buffs", "Não repita o nível de um buff.");
    }

    seenLevels[level] = true;

    return {
      level: level,
      description: description,
    };
  });

  for (let level = 1; level <= totalLevels; level += 1) {
    if (!Object.prototype.hasOwnProperty.call(seenLevels, level)) {
      throwValidationError_(
        "buffs",
        `Informe exatamente um buff para o nível ${level}.`,
      );
    }
  }

  if (buffs.length !== totalLevels) {
    throwValidationError_(
      "buffs",
      "Informe exatamente um buff para cada nível da habilidade.",
    );
  }

  buffs.sort(function (left, right) {
    return left.level - right.level;
  });

  const seenRequiredSkillIds = Object.create(null);
  const requirements = payload.requirements.map(function (requirement, index) {
    const fieldPrefix = `requirements[${index}]`;

    validateAllowedProperties_(requirement, fieldPrefix, [
      "requiredSkillId",
      "minimumLevel",
    ]);

    const requiredSkillId = validateUuid_(
      requirement.requiredSkillId,
      `${fieldPrefix}.requiredSkillId`,
    );
    const minimumLevel = validatePositiveInteger_(
      requirement.minimumLevel,
      `${fieldPrefix}.minimumLevel`,
    );

    if (requiredSkillId === skillId) {
      throwValidationError_(
        `${fieldPrefix}.requiredSkillId`,
        "Uma habilidade não pode exigir a si mesma.",
      );
    }

    if (
      Object.prototype.hasOwnProperty.call(
        seenRequiredSkillIds,
        requiredSkillId,
      )
    ) {
      throwValidationError_(
        "requirements",
        "A mesma habilidade requerida não pode ser repetida.",
      );
    }

    seenRequiredSkillIds[requiredSkillId] = true;

    return {
      requiredSkillId: requiredSkillId,
      minimumLevel: minimumLevel,
    };
  });

  return {
    skillId: skillId,
    name: name,
    totalLevels: totalLevels,
    buffs: buffs,
    requirements: requirements,
  };
}

function validateCatalogRequirementsAgainstSkills_(
  requirements,
  skillId,
  skills,
) {
  const skillIndex = buildUniqueIndex_(skills, "skillId", "Skills");

  requirements.forEach(function (requirement, index) {
    const fieldName = `requirements[${index}].requiredSkillId`;

    if (requirement.requiredSkillId === skillId) {
      throwValidationError_(
        fieldName,
        "Uma habilidade não pode exigir a si mesma.",
      );
    }

    if (
      !Object.prototype.hasOwnProperty.call(
        skillIndex,
        requirement.requiredSkillId,
      )
    ) {
      throwValidationError_(
        fieldName,
        "A habilidade requerida não existe.",
      );
    }

    const requiredSkill = skillIndex[requirement.requiredSkillId];

    if (requirement.minimumLevel > requiredSkill.totalLevels) {
      throwValidationError_(
        `requirements[${index}].minimumLevel`,
        "O nível mínimo excede o total de níveis da habilidade requerida.",
      );
    }
  });

  return requirements;
}

function assertCatalogLevelChangeIsCompatible_(input, snapshot) {
  snapshot.requirements.forEach(function (requirement) {
    if (
      requirement.requiredSkillId === input.skillId &&
      requirement.minimumLevel > input.totalLevels
    ) {
      throw createControlledError_(
        ERROR_CODES.CONFLICT,
        "O total de níveis não pode tornar um requisito existente impossível.",
        null,
      );
    }
  });

  const state = snapshot.states.find(function (candidate) {
    return candidate.skillId === input.skillId;
  });

  if (state === undefined) {
    return true;
  }

  if (
    state.currentLevel > input.totalLevels ||
    (state.status === "COMPLETED" &&
      state.currentLevel !== input.totalLevels) ||
    (state.status !== "COMPLETED" &&
      state.currentLevel >= input.totalLevels)
  ) {
    throw createControlledError_(
      ERROR_CODES.CONFLICT,
      "O total de níveis informado é incompatível com o estado atual da habilidade.",
      null,
    );
  }

  return true;
}

function loadValidatedSkillCatalogSnapshot_() {
  const snapshot = readSkillCatalogSnapshot_();

  try {
    assertValidSkillCatalogSnapshot_(snapshot);
  } catch (error) {
    if (isControlledError_(error) && error.code === ERROR_CODES.CONFLICT) {
      throw error;
    }

    throw createControlledError_(
      ERROR_CODES.CONFLICT,
      "O catálogo de habilidades está inconsistente. Solicite revisão à administração.",
      null,
    );
  }

  return snapshot;
}

function assertValidSkillCatalogSnapshot_(snapshot) {
  if (!isObject_(snapshot)) {
    throw new Error("Snapshot do catálogo de habilidades inválido.");
  }

  ["skills", "buffs", "requirements", "states"].forEach(
    function (propertyName) {
      if (!Array.isArray(snapshot[propertyName])) {
        throw new Error(`Coleção inválida no catálogo: ${propertyName}.`);
      }
    },
  );

  snapshot.skills.forEach(assertValidStoredSkill_);
  snapshot.buffs.forEach(assertValidStoredSkillBuff_);
  snapshot.requirements.forEach(assertValidStoredSkillRequirement_);
  snapshot.states.forEach(assertValidStoredSkillState_);

  const skillIndex = buildUniqueIndex_(snapshot.skills, "skillId", "Skills");
  buildUniqueIndex_(
    snapshot.buffs,
    "skillBuffId",
    "SkillBuffs",
  );
  buildUniqueIndex_(
    snapshot.requirements,
    "skillRequirementId",
    "SkillRequirements",
  );
  buildUniqueIndex_(
    snapshot.states,
    "skillStateId",
    "SkillState",
  );

  const buffsBySkillId = Object.create(null);
  const buffLogicalKeys = Object.create(null);

  snapshot.buffs.forEach(function (buff) {
    if (!Object.prototype.hasOwnProperty.call(skillIndex, buff.skillId)) {
      throw new Error("Buff referencia uma habilidade inexistente.");
    }

    const skill = skillIndex[buff.skillId];

    if (buff.level > skill.totalLevels) {
      throw new Error("Buff excede o total de níveis da habilidade.");
    }

    const logicalKey = `${buff.skillId}:${buff.level}`;

    if (Object.prototype.hasOwnProperty.call(buffLogicalKeys, logicalKey)) {
      throw new Error("Buff duplicado para o mesmo nível.");
    }

    buffLogicalKeys[logicalKey] = true;

    if (!Object.prototype.hasOwnProperty.call(buffsBySkillId, buff.skillId)) {
      buffsBySkillId[buff.skillId] = [];
    }

    buffsBySkillId[buff.skillId].push(buff);
  });

  snapshot.skills.forEach(function (skill) {
    const skillBuffs = buffsBySkillId[skill.skillId] || [];

    if (skillBuffs.length !== skill.totalLevels) {
      throw new Error("A habilidade não possui exatamente um buff por nível.");
    }

    for (let level = 1; level <= skill.totalLevels; level += 1) {
      if (
        !Object.prototype.hasOwnProperty.call(
          buffLogicalKeys,
          `${skill.skillId}:${level}`,
        )
      ) {
        throw new Error("A habilidade possui lacuna nos níveis de buff.");
      }
    }
  });

  const requirementLogicalKeys = Object.create(null);

  snapshot.requirements.forEach(function (requirement) {
    if (
      !Object.prototype.hasOwnProperty.call(skillIndex, requirement.skillId) ||
      !Object.prototype.hasOwnProperty.call(
        skillIndex,
        requirement.requiredSkillId,
      )
    ) {
      throw new Error("Requisito referencia uma habilidade inexistente.");
    }

    if (requirement.skillId === requirement.requiredSkillId) {
      throw new Error("Uma habilidade não pode exigir a si mesma.");
    }

    const requiredSkill = skillIndex[requirement.requiredSkillId];

    if (requirement.minimumLevel > requiredSkill.totalLevels) {
      throw new Error("Requisito excede os níveis da habilidade requerida.");
    }

    const logicalKey = `${requirement.skillId}:${requirement.requiredSkillId}`;

    if (
      Object.prototype.hasOwnProperty.call(requirementLogicalKeys, logicalKey)
    ) {
      throw new Error("Requisito duplicado para a mesma habilidade.");
    }

    requirementLogicalKeys[logicalKey] = true;
  });

  const stateBySkillId = Object.create(null);

  snapshot.states.forEach(function (state) {
    if (!Object.prototype.hasOwnProperty.call(skillIndex, state.skillId)) {
      throw new Error("Estado referencia uma habilidade inexistente.");
    }

    if (Object.prototype.hasOwnProperty.call(stateBySkillId, state.skillId)) {
      throw new Error("A habilidade possui mais de um estado persistido.");
    }

    assertSkillStateCompatibleWithSkill_(state, skillIndex[state.skillId]);
    stateBySkillId[state.skillId] = state;
  });

  return snapshot;
}

function assertValidStoredSkill_(skill) {
  validateAllowedProperties_(skill, "skill", [
    "skillId",
    "apiSkillId",
    "name",
    "totalLevels",
    "createdAt",
    "updatedAt",
  ]);
  validateUuid_(skill.skillId, "skillId");

  const normalizedName = validateRequiredString_(skill.name, "name", 1, 100);

  if (normalizedName !== skill.name) {
    throw new Error("Nome persistido de habilidade não está normalizado.");
  }

  validatePositiveInteger_(skill.totalLevels, "totalLevels");
  assertValidDate_(skill.createdAt);
  assertValidDate_(skill.updatedAt);
  return skill;
}

function assertValidStoredSkillBuff_(buff) {
  validateAllowedProperties_(buff, "skillBuff", [
    "skillBuffId",
    "skillId",
    "level",
    "description",
    "createdAt",
    "updatedAt",
  ]);
  validateUuid_(buff.skillBuffId, "skillBuffId");
  validateUuid_(buff.skillId, "skillId");
  validatePositiveInteger_(buff.level, "level");

  const description = validateRequiredString_(
    buff.description,
    "description",
    1,
    500,
  );

  if (description !== buff.description) {
    throw new Error("Descrição persistida de buff não está normalizada.");
  }

  assertValidDate_(buff.createdAt);
  assertValidDate_(buff.updatedAt);
  return buff;
}

function assertValidStoredSkillRequirement_(requirement) {
  validateAllowedProperties_(requirement, "skillRequirement", [
    "skillRequirementId",
    "skillId",
    "requiredSkillId",
    "minimumLevel",
    "createdAt",
    "updatedAt",
  ]);
  validateUuid_(requirement.skillRequirementId, "skillRequirementId");
  validateUuid_(requirement.skillId, "skillId");
  validateUuid_(requirement.requiredSkillId, "requiredSkillId");
  validatePositiveInteger_(requirement.minimumLevel, "minimumLevel");
  assertValidDate_(requirement.createdAt);
  assertValidDate_(requirement.updatedAt);
  return requirement;
}

function assertValidStoredSkillState_(state) {
  validateAllowedProperties_(state, "skillState", [
    "skillStateId",
    "skillId",
    "currentLevel",
    "currentStep",
    "totalSteps",
    "status",
    "activatedAt",
    "updatedAt",
  ]);
  validateUuid_(state.skillStateId, "skillStateId");
  validateUuid_(state.skillId, "skillId");
  validateSafeInteger_(state.currentLevel, "currentLevel", {min: 0});
  validateSafeInteger_(state.currentStep, "currentStep", {min: 0});
  validateSafeInteger_(state.totalSteps, "totalSteps", {
    nullable: true,
    min: 1,
  });
  validateEnum_(state.status, "status", SKILL_PERSISTED_STATUSES_);
  assertValidDate_(state.activatedAt);
  assertValidDate_(state.updatedAt);
  return state;
}

function assertSkillStateCompatibleWithSkill_(state, skill) {
  if (state.status === "COMPLETED") {
    if (
      state.currentLevel !== skill.totalLevels ||
      state.currentStep !== 0 ||
      state.totalSteps !== null
    ) {
      throw new Error("Estado COMPLETED incompatível com a habilidade.");
    }

    return true;
  }

  if (state.currentLevel >= skill.totalLevels) {
    throw new Error("Estado ativo incompatível com o total de níveis.");
  }

  if (state.status === "AWAITING_LEVEL_CONFIG") {
    if (
      state.currentStep !== 0 ||
      state.totalSteps !== null
    ) {
      throw new Error("Estado AWAITING_LEVEL_CONFIG inválido.");
    }

    return true;
  }

  if (
    state.totalSteps === null ||
    state.currentStep >= state.totalSteps
  ) {
    throw new Error("Estado IN_PROGRESS inválido.");
  }

  return true;
}

function buildUniqueIndex_(records, fieldName, collectionName) {
  const index = Object.create(null);

  records.forEach(function (record) {
    const key = String(record[fieldName]);

    if (Object.prototype.hasOwnProperty.call(index, key)) {
      throw new Error(
        `Valor duplicado em ${collectionName}.${fieldName}: ${key}.`,
      );
    }

    index[key] = record;
  });

  return index;
}

function buildSkillCatalogIdSet_(snapshot) {
  const usedIds = Object.create(null);

  [snapshot.skills, snapshot.buffs, snapshot.requirements, snapshot.states].forEach(
    function (records) {
      records.forEach(function (record) {
        Object.keys(record).forEach(function (fieldName) {
          if (/Id$/.test(fieldName) && typeof record[fieldName] === "string") {
            usedIds[record[fieldName]] = true;
          }
        });
      });
    },
  );

  return usedIds;
}

function generateUniqueSkillCatalogId_(usedIds) {
  let id = generateUuid_();

  while (Object.prototype.hasOwnProperty.call(usedIds, id)) {
    id = generateUuid_();
  }

  usedIds[id] = true;
  return id;
}

function buildSkillCatalogDtos_(snapshot) {
  const buffsBySkillId = Object.create(null);
  const requirementsBySkillId = Object.create(null);
  const stateBySkillId = Object.create(null);

  snapshot.buffs.forEach(function (buff) {
    if (!Object.prototype.hasOwnProperty.call(buffsBySkillId, buff.skillId)) {
      buffsBySkillId[buff.skillId] = [];
    }

    buffsBySkillId[buff.skillId].push(buff);
  });

  snapshot.requirements.forEach(function (requirement) {
    if (
      !Object.prototype.hasOwnProperty.call(
        requirementsBySkillId,
        requirement.skillId,
      )
    ) {
      requirementsBySkillId[requirement.skillId] = [];
    }

    requirementsBySkillId[requirement.skillId].push(requirement);
  });

  snapshot.states.forEach(function (state) {
    stateBySkillId[state.skillId] = state;
  });

  return snapshot.skills.map(function (skill) {
    const state = stateBySkillId[skill.skillId] || null;
    const requirements = requirementsBySkillId[skill.skillId] || [];
    const status =
      state === null
        ? calculateUnpersistedSkillStatus_(requirements, stateBySkillId)
        : state.status;

    return {
      skillId: skill.skillId,
      apiSkillId: skill.apiSkillId,
      name: skill.name,
      totalLevels: skill.totalLevels,
      buffs: (buffsBySkillId[skill.skillId] || [])
        .slice()
        .sort(function (left, right) {
          return left.level - right.level;
        })
        .map(function (buff) {
          return {
            skillBuffId: buff.skillBuffId,
            level: buff.level,
            description: buff.description,
          };
        }),
      requirements: requirements.map(function (requirement) {
        return {
          skillRequirementId: requirement.skillRequirementId,
          requiredSkillId: requirement.requiredSkillId,
          minimumLevel: requirement.minimumLevel,
        };
      }),
      status: status,
      currentLevel: state === null ? 0 : state.currentLevel,
      createdAt: formatDateToApiIso_(skill.createdAt),
      updatedAt: formatDateToApiIso_(skill.updatedAt),
    };
  });
}

function buildSkillProgressionDtos_(snapshot) {
  const catalog = buildSkillCatalogDtos_(snapshot);
  const stateBySkillId = buildUniqueIndex_(
    snapshot.states,
    "skillId",
    "SkillState",
  );
  const skillById = buildUniqueIndex_(catalog, "skillId", "Skills");

  return catalog.map(function (skill) {
    const state = stateBySkillId[skill.skillId] || null;
    const nextBuff = skill.buffs.find(function (buff) {
      return buff.level === skill.currentLevel + 1;
    });

    return {
      skillId: skill.skillId,
      name: skill.name,
      totalLevels: skill.totalLevels,
      status: skill.status,
      currentLevel: skill.currentLevel,
      currentStep: state === null ? null : state.currentStep,
      totalSteps: state === null ? null : state.totalSteps,
      nextBuff:
        nextBuff === undefined
          ? null
          : {
              level: nextBuff.level,
              description: nextBuff.description,
            },
      requirements: skill.requirements.map(function (requirement) {
        const requiredSkill = skillById[requirement.requiredSkillId];

        return {
          requiredSkillId: requirement.requiredSkillId,
          requiredSkillName: requiredSkill.name,
          minimumLevel: requirement.minimumLevel,
          currentLevel: requiredSkill.currentLevel,
          satisfied: requiredSkill.currentLevel >= requirement.minimumLevel,
        };
      }),
    };
  });
}

function findSkillProgressionDtoById_(snapshot, skillId) {
  const match = buildSkillProgressionDtos_(snapshot).find(function (skill) {
    return skill.skillId === skillId;
  });

  if (match === undefined) {
    throw new Error("Habilidade salva não encontrada na progressão final.");
  }

  return match;
}

function calculateUnpersistedSkillStatus_(requirements, stateBySkillId) {
  const allRequirementsSatisfied = requirements.every(function (requirement) {
    const requiredState = stateBySkillId[requirement.requiredSkillId] || null;
    const currentLevel = requiredState === null ? 0 : requiredState.currentLevel;

    return currentLevel >= requirement.minimumLevel;
  });

  return allRequirementsSatisfied ? "AVAILABLE" : "LOCKED";
}

function findSkillCatalogDtoById_(snapshot, skillId) {
  const match = buildSkillCatalogDtos_(snapshot).find(function (skill) {
    return skill.skillId === skillId;
  });

  if (match === undefined) {
    throw new Error("Habilidade salva não encontrada no snapshot final.");
  }

  return match;
}
