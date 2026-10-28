const GUILD_API_MEMBER_GUILD_ROLE_MAP_ = Object.freeze({
  Leader: "LEADER",
  "Vice-Leader": "VICE_LEADER",
  Member: "MEMBER",
});
const GUILD_API_LAST_SYNC_PROPERTY_ = "GUILD_API_LAST_SYNC_STATUS";

function runGuildApiSync_() {
  try {
    const apiData = fetchGuildApiData_();

    // Pre-flight: validate week consistency before acquiring lock.
    validateGuildApiWeekConsistency_(apiData.semana, apiData.loja);

    let membersResult, skillsResult, guildStateResult, contributionsResult, weeklyTasksResult;

    runWithDatabaseWriteLock_(function () {
      /*
       * Snapshot all tables written by this núcleo before any write.
       * If any section fails, the snapshot is restored so that
       * no partial state is visible — the núcleo commits as a unit.
       */
      const snapshot = buildGuildApiSyncNucleoSnapshot_();

      try {
        membersResult = syncMembersFromGuildApi_(apiData.membros);
        skillsResult = syncSkillsFromGuildApi_(apiData.habilidades);
        guildStateResult = syncGuildStateFromGuildApi_(apiData.guild);
        contributionsResult = syncContributionsFromGuildApi_(
          apiData.placarSemanal,
          apiData.semana,
          apiData.loja,
        );
        weeklyTasksResult = syncWeeklyTasksFromGuildApi_(apiData.semana);
        commitDatabaseWrites_();
      } catch (nucleoError) {
        restoreGuildApiSyncNucleoSnapshot_(snapshot);
        commitDatabaseWrites_();
        throw nucleoError;
      }
    });

    // Daily tasks are independent: failure does not block the núcleo
    // and is reported as a separate result.
    const dailyResult = syncDailyTasksFromGuildApi_(apiData);

    const result = {
      ok: true,
      members: membersResult,
      skills: skillsResult,
      guildState: guildStateResult,
      contributions: contributionsResult,
      weeklyTasks: weeklyTasksResult,
      daily: dailyResult,
    };
    recordGuildApiSyncStatus_({
      checkedAt: new Date().toISOString(),
      core: { ok: true },
      daily: { ok: dailyResult.ok === true, reason: dailyResult.reason || null },
    });
    return result;
  } catch (error) {
    console.error(
      "[GuildApiSyncService] Falha ao sincronizar com a API da guild: %s",
      error && error.message,
    );

    const reason = error && error.message ? error.message : "Falha desconhecida.";
    recordGuildApiSyncStatus_({
      checkedAt: new Date().toISOString(),
      core: { ok: false, reason: reason },
      daily: { ok: false, reason: "Não executada após falha do núcleo." },
    });
    return { ok: false, reason: reason };
  }
}

function recordGuildApiSyncStatus_(status) {
  try {
    PropertiesService.getScriptProperties().setProperty(
      GUILD_API_LAST_SYNC_PROPERTY_, JSON.stringify(status),
    );
  } catch (error) {
    console.error("[GuildApiSyncService] Falha ao registrar resultado do sync: %s", error && error.message);
  }
}

function getLastGuildApiSyncStatus_() {
  const saved = PropertiesService.getScriptProperties().getProperty(GUILD_API_LAST_SYNC_PROPERTY_);
  return saved === null ? null : JSON.parse(saved);
}

function fetchGuildApiData_() {
  const url = getGuildApiUrl_();
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });

  return parseGuildApiResponseText_(response.getContentText(), response.getResponseCode());
}

function parseGuildApiResponseText_(responseText, responseCode) {
  if (responseCode !== undefined && responseCode !== 200) {
    throw new Error(`Guild API retornou status ${responseCode}.`);
  }

  const parsed = JSON.parse(responseText);

  if (!isObject_(parsed) || !Array.isArray(parsed.membros) ||
    !Array.isArray(parsed.habilidades) || !isObject_(parsed.guild) ||
    !Array.isArray(parsed.placarSemanal) || !isObject_(parsed.semana) ||
    !isObject_(parsed.loja)) {
    throw new Error("Guild API retornou um formato inesperado.");
  }

  return parsed;
}

/*
 * Validate that semana.semana and loja.semana refer to the same week
 * before any writes occur. Divergence indicates a stale or inconsistent
 * payload; the sync is cancelled entirely.
 */
function validateGuildApiWeekConsistency_(apiSemana, apiLoja) {
  validateObject_(apiSemana, "apiSemana");
  validateObject_(apiLoja, "apiLoja");

  const apiWeekLabel = validateRequiredString_(
    apiSemana.semana,
    "semana.semana",
    1,
    20,
  );
  const lojaWeekLabel = validateRequiredString_(
    apiLoja.semana,
    "loja.semana",
    1,
    20,
  );

  if (apiWeekLabel !== lojaWeekLabel) {
    throw new Error(
      `Semanas da API (${apiWeekLabel}) e da loja (${lojaWeekLabel}) divergentes. Sincronização cancelada.`,
    );
  }
}

/*
 * Snapshot all writable núcleo tables before any write in runGuildApiSync_.
 * The snapshot is restored on any failure to prevent partial state.
 */
function buildGuildApiSyncNucleoSnapshot_() {
  return {
    members: readDatabaseTableUncached_("Members"),
    skills: readDatabaseTableUncached_("Skills"),
    skillStates: readDatabaseTableUncached_("SkillState"),
    guildStates: readDatabaseTableUncached_("GuildState"),
    contributions: readDatabaseTableUncached_("Contributions"),
    weeklyTasks: readDatabaseTableUncached_("WeeklyTasks"),
  };
}

function restoreGuildApiSyncNucleoSnapshot_(snapshot) {
  replaceDatabaseTables_([
    { sheetName: "Members", records: snapshot.members },
    { sheetName: "Skills", records: snapshot.skills },
    {
      sheetName: "SkillState",
      records: snapshot.skillStates,
      uniqueKeyFields: ["skillId"],
    },
    { sheetName: "GuildState", records: snapshot.guildStates },
    {
      sheetName: "Contributions",
      records: snapshot.contributions,
      uniqueKeyFields: ["memberId", "weekKey"],
    },
    {
      sheetName: "WeeklyTasks",
      records: snapshot.weeklyTasks,
      uniqueKeyFields: ["weekKey", "memberId"],
    },
  ]);
}

/*
 * Syncs weekly task totals (semana.porMembro[].tasks.entregues) into WeeklyTasks.
 * Runs inside the nucleus lock — each member's delivered count is an absolute
 * total, not a delta.  Missing members in the payload are left unchanged.
 * Reductions are logged but accepted; zero is a valid explicit value.
 */
function syncWeeklyTasksFromGuildApi_(apiSemana) {
  const week = normalizeGuildApiContributionWeek_(apiSemana);

  return runWithDatabaseWriteLock_(function () {
    const now = new Date();

    const membersByName = Object.create(null);
    findAllMembers_().forEach(function (member) {
      membersByName[member.name] = member;
    });

    const existingByMemberId = Object.create(null);
    findWeeklyTasksByWeekKey_(week.weekKey).forEach(function (task) {
      existingByMemberId[task.memberId] = task;
    });

    const toInsert = [];
    const toUpdate = [];

    week.porMembro.forEach(function (entry) {
      if (!Object.prototype.hasOwnProperty.call(membersByName, entry.name)) {
        return;
      }

      const member = membersByName[entry.name];
      const delivered = entry.tasksCompleted;

      const existing = Object.prototype.hasOwnProperty.call(
        existingByMemberId,
        member.memberId,
      )
        ? existingByMemberId[member.memberId]
        : null;

      if (existing === null) {
        toInsert.push({
          weeklyTaskId: generateUuid_(),
          weekKey: week.weekKey,
          memberId: member.memberId,
          delivered: delivered,
          createdAt: now,
          updatedAt: now,
        });
        return;
      }

      if (existing.delivered === delivered) {
        return;
      }

      if (delivered < existing.delivered) {
        console.warn(
          "[GuildApiSyncService] Tasks entregues reduziu para %s: %d → %d.",
          entry.name,
          existing.delivered,
          delivered,
        );
      }

      toUpdate.push(
        Object.assign({}, existing, { delivered: delivered, updatedAt: now }),
      );
    });

    if (toInsert.length > 0) {
      insertWeeklyTasks_(toInsert);
    }

    if (toUpdate.length > 0) {
      updateWeeklyTasks_(toUpdate);
    }

    return { created: toInsert.length, updated: toUpdate.length };
  });
}

/*
 * Syncs daily task entries (diario.tasks[]) into DailyTasks independently.
 * Each entry carries an absolute delivered count for a specific day.
 * Only entries for the current semana week are accepted; other days are skipped.
 * Existing records for days not in the payload are left untouched.
 * Failure is isolated: does not block a valid núcleo result.
 */
function syncDailyTasksFromGuildApi_(apiData) {
  try {
    return runWithDatabaseWriteLock_(function () {
      const snapshot = readDatabaseTableUncached_("DailyTasks");
      try {
        const result = syncDailyTasksFromGuildApiLocked_(apiData, snapshot);
        commitDatabaseWrites_();
        return result;
      } catch (error) {
        replaceDatabaseTables_([{ sheetName: "DailyTasks", records: snapshot,
          uniqueKeyFields: ["weekKey", "memberId", "day"] }]);
        commitDatabaseWrites_();
        throw error;
      }
    });
  } catch (error) {
    console.error("[GuildApiSyncService] Falha no sync de tasks diárias: %s",
      error && error.message);
    return { ok: false, reason: error && error.message };
  }
}

function syncDailyTasksFromGuildApiLocked_(apiData, snapshot) {
    const apiSemana = apiData.semana;
    const apiDiario = apiData.diario;

    if (!isObject_(apiDiario) || !Array.isArray(apiDiario.tasks)) {
      return { ok: false, reason: "diario.tasks ausente ou inválido." };
    }

    const weekKey = validateGameWeekKey_(apiSemana.inicio, "apiSemana.inicio");
    const weekEnd = addCivilDaysToDateKey_(weekKey, 7);

    const normalizedEntries = [];

    apiDiario.tasks.forEach(function (task) {
      try {
        const entry = normalizeGuildApiDailyTaskEntry_(task);

        if (!entry.isMember) {
          return;
        }

        if (entry.day < weekKey || entry.day >= weekEnd) {
          console.warn(
            "[GuildApiSyncService] Dia %s fora da semana %s; ignorado.",
            entry.day,
            weekKey,
          );
          return;
        }

        normalizedEntries.push(entry);
      } catch (entryError) {
        console.warn(
          "[GuildApiSyncService] Entrada diária inválida ignorada: %s",
          entryError && entryError.message,
        );
      }
    });

    const membersByName = Object.create(null);
    findAllMembers_().forEach(function (member) {
      membersByName[member.name] = member;
    });

    const existingByKey = Object.create(null);
    snapshot.filter(function (task) { return task.weekKey === weekKey; }).forEach(function (task) {
      existingByKey[task.memberId + "|" + task.day] = task;
    });

    const now = new Date();
    const toInsert = [];
    const toUpdate = [];

    normalizedEntries.forEach(function (entry) {
      if (!Object.prototype.hasOwnProperty.call(membersByName, entry.name)) {
        console.warn(
          "[GuildApiSyncService] Membro de task diária não encontrado: %s",
          entry.name,
        );
        return;
      }

      const member = membersByName[entry.name];
      const compositeKey = member.memberId + "|" + entry.day;

      const existing = Object.prototype.hasOwnProperty.call(
        existingByKey,
        compositeKey,
      )
        ? existingByKey[compositeKey]
        : null;

      if (existing === null) {
        toInsert.push({
          dailyTaskId: generateUuid_(),
          weekKey: weekKey,
          memberId: member.memberId,
          day: entry.day,
          delivered: entry.delivered,
          createdAt: now,
          updatedAt: now,
        });
        return;
      }

      if (existing.delivered === entry.delivered) {
        return;
      }

      toUpdate.push(
        Object.assign({}, existing, {
          delivered: entry.delivered,
          updatedAt: now,
        }),
      );
    });

    if (toInsert.length > 0) {
      insertDailyTasks_(toInsert);
    }

    if (toUpdate.length > 0) {
      updateDailyTasks_(toUpdate);
    }

    return { ok: true, created: toInsert.length, updated: toUpdate.length };
}

function normalizeGuildApiDailyTaskEntry_(apiEntry) {
  validateObject_(apiEntry, "diario.tasks[]");

  const name = validateRequiredString_(
    apiEntry.nome,
    "diario.tasks[].nome",
    1,
    100,
  );

  const isMember = validateBoolean_(apiEntry.membro, "diario.tasks[].membro");

  const delivered = validateNonNegativeInteger_(
    apiEntry.entregues,
    "diario.tasks[].entregues",
  );

  const rawDay = validateRequiredString_(
    apiEntry.dia,
    "diario.tasks[].dia",
    10,
    10,
  );

  const dayMatch = rawDay.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dayMatch) {
    throwValidationError_(
      "diario.tasks[].dia",
      "O dia informado deve estar no formato YYYY-MM-DD.",
    );
  }

  const civilDate = new Date(
    Date.UTC(Number(dayMatch[1]), Number(dayMatch[2]) - 1, Number(dayMatch[3])),
  );

  if (
    civilDate.getUTCFullYear() !== Number(dayMatch[1]) ||
    civilDate.getUTCMonth() + 1 !== Number(dayMatch[2]) ||
    civilDate.getUTCDate() !== Number(dayMatch[3])
  ) {
    throwValidationError_(
      "diario.tasks[].dia",
      "O dia informado não existe no calendário.",
    );
  }

  return {
    name: name,
    isMember: isMember,
    delivered: delivered,
    day: rawDay,
  };
}

function syncMembersFromGuildApi_(apiMembers) {
  if (!Array.isArray(apiMembers)) {
    throw new Error("Lista de membros da API inválida.");
  }

  const now = new Date();
  const normalizedApiMembers = apiMembers.map(normalizeGuildApiMember_);

  const apiMembersByName = Object.create(null);

  normalizedApiMembers.forEach(function (apiMember) {
    if (Object.prototype.hasOwnProperty.call(apiMembersByName, apiMember.name)) {
      throw new Error(`Nome de membro duplicado na API: ${apiMember.name}.`);
    }

    apiMembersByName[apiMember.name] = apiMember;
  });

  return runWithDatabaseWriteLock_(function () {
    const currentMembers = findAllMembers_();

    const currentMembersByName = Object.create(null);

    currentMembers.forEach(function (member) {
      currentMembersByName[member.name] = member;
    });

    // Anomaly guard: reject sync when API returns an empty members list
    // but active members exist locally.
    const activeCount = currentMembers.filter(function (m) {
      return m.status === "ACTIVE";
    }).length;

    if (normalizedApiMembers.length === 0 && activeCount > 0) {
      throw new Error(
        `Lista de membros da API vazia com ${activeCount} ativo(s). Sincronização cancelada por anomalia.`,
      );
    }

    // Truly new names (not in DB as active or inactive).
    const membersToCreate = normalizedApiMembers.filter(function (apiMember) {
      return !Object.prototype.hasOwnProperty.call(
        currentMembersByName,
        apiMember.name,
      );
    });

    // Inactive members whose nickname returned to the API: reactivate the
    // same identity rather than creating a new one, preserving UUID and history.
    const membersToReactivate = currentMembers.filter(function (member) {
      return (
        member.status === "INACTIVE" &&
        Object.prototype.hasOwnProperty.call(apiMembersByName, member.name)
      );
    });

    const membersToDeactivate = currentMembers.filter(function (member) {
      return (
        member.status === "ACTIVE" &&
        !Object.prototype.hasOwnProperty.call(apiMembersByName, member.name)
      );
    });

    // Anomaly guard: suspicious bulk deactivation (≥3 and ≥50 % of active members).
    if (
      membersToDeactivate.length >= 3 &&
      membersToDeactivate.length >= Math.ceil(activeCount / 2)
    ) {
      throw new Error(
        `Inativação de ${membersToDeactivate.length}/${activeCount} membros é anômala. Sincronização cancelada.`,
      );
    }

    // Active members whose level or guildRole changed in the API.
    const membersToUpdate = currentMembers.filter(function (member) {
      if (
        member.status !== "ACTIVE" ||
        !Object.prototype.hasOwnProperty.call(apiMembersByName, member.name)
      ) {
        return false;
      }

      const apiMember = apiMembersByName[member.name];

      return apiMember.level !== member.level || apiMember.guildRole !== member.guildRole;
    });

    membersToCreate.forEach(function (apiMember) {
      insertMember_(buildNewMemberFromGuildApi_(apiMember, now));
    });

    if (membersToReactivate.length > 0) {
      updateMembers_(
        membersToReactivate.map(function (member) {
          const apiMember = apiMembersByName[member.name];

          return Object.assign({}, member, {
            guildRole: apiMember.guildRole,
            level: apiMember.level,
            joinedAt: apiMember.joinedAt,
            status: "ACTIVE",
            leftAt: null,
            updatedAt: now,
          });
        }),
      );
    }

    if (membersToDeactivate.length > 0) {
      updateMembers_(
        membersToDeactivate.map(function (member) {
          return Object.assign({}, member, {
            status: "INACTIVE",
            leftAt: now,
            updatedAt: now,
          });
        }),
      );
    }

    if (membersToUpdate.length > 0) {
      updateMembers_(
        membersToUpdate.map(function (member) {
          const apiMember = apiMembersByName[member.name];

          return Object.assign({}, member, {
            level: apiMember.level,
            guildRole: apiMember.guildRole,
            updatedAt: now,
          });
        }),
      );
    }

    const levelUpdated = membersToUpdate.filter(function (member) {
      return apiMembersByName[member.name].level !== member.level;
    }).length;

    const roleUpdated = membersToUpdate.filter(function (member) {
      return apiMembersByName[member.name].guildRole !== member.guildRole;
    }).length;

    return {
      created: membersToCreate.length,
      deactivated: membersToDeactivate.length,
      reactivated: membersToReactivate.length,
      levelUpdated: levelUpdated,
      roleUpdated: roleUpdated,
    };
  });
}

function syncSkillsFromGuildApi_(apiSkills) {
  if (!Array.isArray(apiSkills)) {
    throw new Error("Lista de habilidades da API inválida.");
  }

  const apiById = Object.create(null);

  apiSkills.map(normalizeGuildApiSkill_).forEach(function (apiSkill) {
    if (Object.prototype.hasOwnProperty.call(apiById, apiSkill.apiSkillId)) {
      throw new Error(`Habilidade duplicada na API: ${apiSkill.apiSkillId}.`);
    }

    apiById[apiSkill.apiSkillId] = apiSkill;
  });

  return runWithDatabaseWriteLock_(function () {
    const now = new Date();
    const allSkills = findAllSkills_();
    const catalogByApiSkillId = Object.create(null);
    const skillsWithoutApiSkillId = [];

    allSkills.forEach(function (skill) {
      if (!skill.apiSkillId) {
        skillsWithoutApiSkillId.push(skill.skillId);
        return;
      }

      if (Object.prototype.hasOwnProperty.call(catalogByApiSkillId, skill.apiSkillId)) {
        throw new Error(`Catálogo possui apiSkillId duplicado: ${skill.apiSkillId}.`);
      }

      catalogByApiSkillId[skill.apiSkillId] = skill;
    });

    const stateBySkillId = Object.create(null);

    findAllSkillStates_().forEach(function (state) {
      stateBySkillId[state.skillId] = state;
    });

    const unknownApiSkillIds = [];
    const inconsistencies = [];
    let upserted = 0;
    let created = 0;
    let levelsUpdated = 0;

    Object.keys(apiById).forEach(function (apiSkillId) {
      const apiSkill = apiById[apiSkillId];

      let skill = catalogByApiSkillId[apiSkillId] || null;
      if (skill === null) {
        // An unlinked local row may represent this API skill under a translated name.
        if (skillsWithoutApiSkillId.length > 0) {
          unknownApiSkillIds.push(apiSkillId);
          return;
        }
        skill = insertSkill_({
          skillId: generateUuid_(),
          apiSkillId: apiSkillId,
          name: apiSkill.name,
          totalLevels: apiSkill.nivelMax,
          createdAt: now,
          updatedAt: now,
        });
        catalogByApiSkillId[apiSkillId] = skill;
        created += 1;
      } else if (skill.totalLevels !== apiSkill.nivelMax) {
        skill = updateSkill_(Object.assign({}, skill, {
          totalLevels: apiSkill.nivelMax,
          updatedAt: now,
        }));
        catalogByApiSkillId[apiSkillId] = skill;
        levelsUpdated += 1;
      }
      const desbloqueada = apiSkill.desbloqueada;
      const nivel = apiSkill.nivel;

      if (desbloqueada && nivel === 0) {
        inconsistencies.push({
          apiSkillId: apiSkillId,
          reason: "desbloqueada=true mas nivel=0",
        });
        return;
      }

      if (!desbloqueada && nivel > 0) {
        inconsistencies.push({
          apiSkillId: apiSkillId,
          reason: "desbloqueada=false mas nivel>0",
        });
        return;
      }

      // desbloqueada=false AND nivel=0: catalog present, existing state preserved.
      if (!desbloqueada) {
        return;
      }

      // desbloqueada=true AND nivel>0: derive status and upsert state.
      const effectiveLevel = Math.min(nivel, skill.totalLevels);
      const existingState = stateBySkillId[skill.skillId] || null;

      let status, currentStep, totalSteps;

      if (effectiveLevel >= skill.totalLevels) {
        status = "COMPLETED";
        currentStep = 0;
        totalSteps = null;
      } else if (apiSkill.etapasPorNivel > 0) {
        status = "IN_PROGRESS";
        currentStep = apiSkill.etapas;
        totalSteps = apiSkill.etapasPorNivel;
      } else {
        status = "AWAITING_LEVEL_CONFIG";
        currentStep = 0;
        totalSteps = null;
      }

      const updatedState = {
        skillStateId: existingState === null ? generateUuid_() : existingState.skillStateId,
        skillId: skill.skillId,
        currentLevel: effectiveLevel,
        currentStep: currentStep,
        totalSteps: totalSteps,
        status: status,
        activatedAt: existingState === null ? now : existingState.activatedAt,
        updatedAt: now,
      };

      if (existingState === null) {
        insertSkillState_(updatedState);
      } else {
        updateSkillState_(updatedState);
      }

      upserted += 1;
    });

    const unmappedCatalogSkillIds = Object.keys(catalogByApiSkillId).filter(
      function (apiSkillId) {
        return !Object.prototype.hasOwnProperty.call(apiById, apiSkillId);
      },
    );

    return {
      upserted: upserted,
      created: created,
      levelsUpdated: levelsUpdated,
      unknownApiSkillIds: unknownApiSkillIds,
      inconsistencies: inconsistencies,
      unmappedCatalogSkillIds: unmappedCatalogSkillIds,
      skillsWithoutApiSkillId: skillsWithoutApiSkillId,
    };
  });
}

function syncGuildStateFromGuildApi_(apiGuild) {
  const normalized = normalizeGuildApiGuildState_(apiGuild);

  const saved = saveSingletonGuildState_(function (current) {
    const now = new Date();

    return Object.assign(
      {
        guildStateId: current === null ? generateUuid_() : current.guildStateId,
        currentObjectiveSkillId: current === null ? null : current.currentObjectiveSkillId,
        createdAt: current === null ? now : current.createdAt,
        updatedAt: now,
      },
      normalized,
    );
  });

  return { level: saved.level, bankBalance: saved.bankBalance };
}

function syncContributionsFromGuildApi_(apiPlacarSemanal, apiSemana, apiLoja) {
  if (!Array.isArray(apiPlacarSemanal)) {
    throw new Error("Placar semanal da API inválido.");
  }

  const week = normalizeGuildApiContributionWeek_(apiSemana);

  // Defense-in-depth: re-validate loja consistency (covers standalone calls).
  validateGuildApiContributionLoja_(apiLoja, week.weekLabel);

  const donationsByName = Object.create(null);

  apiPlacarSemanal
    .map(normalizeGuildApiContributionDonationEntry_)
    .filter(function (entry) {
      return entry.isMember && entry.weekLabel === week.weekLabel;
    })
    .forEach(function (entry) {
      if (Object.prototype.hasOwnProperty.call(donationsByName, entry.name)) {
        throw new Error(
          `Entrada duplicada de placarSemanal para a semana atual: ${entry.name}.`,
        );
      }

      donationsByName[entry.name] = entry;
    });

  const relevantNames = Object.keys(donationsByName);

  return runWithDatabaseWriteLock_(function () {
    const now = new Date();
    const dailyTarget = getDailyTarget_();

    const membersByName = Object.create(null);

    findAllMembers_().forEach(function (member) {
      membersByName[member.name] = member;
    });

    const existingByMemberId = Object.create(null);

    findContributionsByWeekKey_(week.weekKey).forEach(function (contribution) {
      existingByMemberId[contribution.memberId] = contribution;
    });

    const newContributions = [];
    const updatedContributions = [];

    relevantNames.forEach(function (name) {
      if (!Object.prototype.hasOwnProperty.call(membersByName, name)) {
        return;
      }

      const member = membersByName[name];
      const donation = donationsByName[name];

      const amount = donation.amount;

      const existing = Object.prototype.hasOwnProperty.call(
        existingByMemberId,
        member.memberId,
      )
        ? existingByMemberId[member.memberId]
        : null;

      if (existing === null) {
        const snapshot = calculateWeeklyTargetSnapshot_(
          member,
          week.weekKey,
          dailyTarget,
        );

        newContributions.push({
          contributionId: generateUuid_(),
          memberId: member.memberId,
          weekKey: week.weekKey,
          amount: amount,
          targetRequired: snapshot.targetRequired,
          targetAmount: snapshot.targetAmount,
          createdAt: now,
          updatedAt: now,
        });

        return;
      }

      if (existing.amount === amount) {
        return;
      }

      updatedContributions.push(
        Object.assign({}, existing, {
          amount: amount,
          updatedAt: now,
        }),
      );
    });

    if (newContributions.length > 0) {
      insertContributions_(newContributions);
    }

    if (updatedContributions.length > 0) {
      updateContributions_(updatedContributions);
    }

    return {
      created: newContributions.length,
      updated: updatedContributions.length,
    };
  });
}

/*
 * Validate that apiLoja.semana matches the week label already resolved
 * from semana.semana.  Called as defense-in-depth from
 * syncContributionsFromGuildApi_ after the pre-flight in runGuildApiSync_.
 */
function validateGuildApiContributionLoja_(apiLoja, weekLabel) {
  validateObject_(apiLoja, "apiLoja");

  const lojaWeekLabel = validateRequiredString_(
    apiLoja.semana,
    "apiLoja.semana",
    1,
    20,
  );

  if (lojaWeekLabel !== weekLabel) {
    throw new Error(
      `Semanas da API (${weekLabel}) e da loja (${lojaWeekLabel}) divergentes. Sincronização cancelada.`,
    );
  }
}

function normalizeGuildApiContributionWeek_(apiSemana) {
  validateObject_(apiSemana, "apiSemana");

  if (!Array.isArray(apiSemana.porMembro)) {
    throw new Error("apiSemana.porMembro inválido.");
  }

  return {
    weekKey: validateGameWeekKey_(apiSemana.inicio, "apiSemana.inicio"),
    weekLabel: validateRequiredString_(apiSemana.semana, "apiSemana.semana", 1, 20),
    porMembro: apiSemana.porMembro.map(normalizeGuildApiContributionMemberWeekEntry_),
  };
}

function normalizeGuildApiContributionDonationEntry_(apiEntry) {
  validateObject_(apiEntry, "apiPlacarSemanal[]");

  return {
    name: validateRequiredString_(apiEntry.nome, "apiPlacarSemanal[].nome", 1, 100),
    weekLabel: validateRequiredString_(
      apiEntry.semana,
      "apiPlacarSemanal[].semana",
      1,
      20,
    ),
    isMember: validateBoolean_(apiEntry.membro, "apiPlacarSemanal[].membro"),
    amount: validateNonNegativeInteger_(
      apiEntry.valorNoCofre,
      "apiPlacarSemanal[].valorNoCofre",
    ),
  };
}

function normalizeGuildApiContributionMemberWeekEntry_(apiEntry) {
  validateObject_(apiEntry, "apiSemana.porMembro[]");

  const tasks = validateObject_(apiEntry.tasks, "apiSemana.porMembro[].tasks");

  return {
    name: validateRequiredString_(apiEntry.nome, "apiSemana.porMembro[].nome", 1, 100),
    tasksCompleted: validateNonNegativeInteger_(
      tasks.entregues,
      "apiSemana.porMembro[].tasks.entregues",
    ),
  };
}

function normalizeGuildApiGuildState_(apiGuild) {
  validateObject_(apiGuild, "apiGuild");
  const ranking = validateObject_(apiGuild.ranking, "apiGuild.ranking");

  return {
    level: validateNonNegativeInteger_(apiGuild.nivel, "apiGuild.nivel"),
    bankBalance: validateNonNegativeInteger_(apiGuild.cofre, "apiGuild.cofre"),
    xpTotal: validateNonNegativeInteger_(apiGuild.xpTotal, "apiGuild.xpTotal"),
    xpProximoNivel: validateNonNegativeInteger_(
      apiGuild.xpProximoNivel,
      "apiGuild.xpProximoNivel",
    ),
    vagas: validateNonNegativeInteger_(apiGuild.vagas, "apiGuild.vagas"),
    rankingHoje: validateNonNegativeInteger_(ranking.hoje, "apiGuild.ranking.hoje"),
    rankingOntem: validateNonNegativeInteger_(ranking.ontem, "apiGuild.ranking.ontem"),
  };
}

function normalizeGuildApiSkill_(apiSkill) {
  validateObject_(apiSkill, "apiSkill");

  return {
    apiSkillId: validateRequiredString_(apiSkill.id, "apiSkill.id", 1, 100),
    name: validateRequiredString_(apiSkill.nome, "apiSkill.nome", 1, 100),
    nivel: validateNonNegativeInteger_(apiSkill.nivel, "apiSkill.nivel"),
    desbloqueada: validateBoolean_(apiSkill.desbloqueada, "apiSkill.desbloqueada"),
    nivelMax: validatePositiveInteger_(apiSkill.nivelMax, "apiSkill.nivelMax"),
    etapas: validateNonNegativeInteger_(apiSkill.etapas, "apiSkill.etapas"),
    etapasPorNivel: validateNonNegativeInteger_(apiSkill.etapasPorNivel, "apiSkill.etapasPorNivel"),
  };
}

function normalizeGuildApiMember_(apiMember) {
  validateObject_(apiMember, "apiMember");

  return {
    name: validateRequiredString_(apiMember.nome, "apiMember.nome", 1, 100),
    joinedAt: parseApiIsoDateTime_(apiMember.entrouEm, "apiMember.entrouEm"),
    level: validateNonNegativeInteger_(apiMember.level, "apiMember.level"),
    guildRole: mapGuildApiMemberGuildRole_(apiMember.cargo),
  };
}

function mapGuildApiMemberGuildRole_(cargo) {
  validateObject_(cargo, "apiMember.cargo");

  const roleName = validateRequiredString_(
    cargo.nome,
    "apiMember.cargo.nome",
    1,
    50,
  );

  const mappedRole = GUILD_API_MEMBER_GUILD_ROLE_MAP_[roleName];

  if (mappedRole === undefined) {
    throw new Error(`Cargo de membro desconhecido na API: ${roleName}.`);
  }

  return mappedRole;
}

function buildNewMemberFromGuildApi_(apiMember, now) {
  return {
    memberId: generateUuid_(),
    name: apiMember.name,
    guildRole: apiMember.guildRole,
    level: apiMember.level,
    joinedAt: apiMember.joinedAt,
    status: "ACTIVE",
    leftAt: null,
    targetRequired: true,
    createdAt: now,
    updatedAt: now,
  };
}
