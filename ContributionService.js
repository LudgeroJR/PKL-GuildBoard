function calculateWeeklyTargetSnapshot_(member, weekKey, dailyTarget) {
  validateObject_(member, "member");

  const normalizedWeekKey = validateGameWeekKey_(weekKey, "weekKey");

  const normalizedDailyTarget = validateNonNegativeInteger_(
    dailyTarget,
    "dailyTarget",
  );

  const targetRequired = validateBoolean_(
    member.targetRequired,
    "member.targetRequired",
  );

  assertValidDate_(member.joinedAt);

  if (!targetRequired) {
    return {
      targetRequired: false,
      targetAmount: 0,
      eligibleDays: 0,
    };
  }

  const weekStart = getGameWeekStart_(normalizedWeekKey);

  const weekEnd = getGameWeekEnd_(normalizedWeekKey);

  const nextWeekStart = new Date(weekEnd.getTime() + 1);

  /*
   * O dia de ingresso nunca conta.
   *
   * A primeira obrigação nasce no primeiro
   * reset diário estritamente posterior ao joinedAt.
   */
  const firstEligibleReset = getNextGameDailyReset_(member.joinedAt);

  /*
   * Para membros que já estavam na Guild antes
   * da semana começar, a contagem inicia no próprio
   * início da semana.
   */
  const effectiveStart =
    firstEligibleReset.getTime() > weekStart.getTime()
      ? firstEligibleReset
      : weekStart;

  const eligibleDays = countGameDailyResetsInRange_(
    effectiveStart,
    nextWeekStart,
  );

  const targetAmount = eligibleDays * normalizedDailyTarget;

  if (!Number.isSafeInteger(targetAmount) || targetAmount < 0) {
    throw new Error("A meta semanal calculada é inválida.");
  }

  return {
    targetRequired: true,
    targetAmount: targetAmount,
    eligibleDays: eligibleDays,
  };
}

function buildCurrentContributionWeekContext_() {
  const weekKey = getCurrentGameWeekKey_();

  const dailyTarget = getDailyTarget_();

  const members = findAllMembers_();

  const contributions = findAllContributions_();

  return buildContributionWeekContext_(
    weekKey,
    dailyTarget,
    members,
    contributions,
  );
}

function buildContributionWeekContext_(
  weekKey,
  dailyTarget,
  members,
  contributions,
) {
  const normalizedWeekKey = validateGameWeekKey_(weekKey, "weekKey");

  const normalizedDailyTarget = validateNonNegativeInteger_(
    dailyTarget,
    "dailyTarget",
  );

  if (!Array.isArray(members)) {
    throw new Error("Lista de membros inválida.");
  }

  if (!Array.isArray(contributions)) {
    throw new Error("Lista de contribuições inválida.");
  }

  const weekStart = getGameWeekStart_(normalizedWeekKey);

  const weekEnd = getGameWeekEnd_(normalizedWeekKey);

  const nextWeekStart = new Date(weekEnd.getTime() + 1);

  const memberIndex = buildContributionMemberIndex_(members);

  const contributionIndex = buildContributionWeekIndex_(
    contributions,
    normalizedWeekKey,
  );

  /*
   * Um registro de Contributions da semana é
   * autoridade suficiente para manter o membro
   * visível naquela operação semanal.
   *
   * Também validamos que nenhum registro aponta
   * para um memberId inexistente.
   */
  Object.keys(contributionIndex).forEach(function (memberId) {
    if (!Object.prototype.hasOwnProperty.call(memberIndex, memberId)) {
      throw new Error("Contribution semanal referencia membro inexistente.");
    }
  });

  const relevantMembers = members.filter(function (member) {
    return isMemberRelevantForContributionWeek_(
      member,
      normalizedWeekKey,
      weekStart,
      nextWeekStart,
      contributionIndex,
    );
  });

  relevantMembers.sort(compareContributionAdminMembers_);

  const rows = relevantMembers.map(function (member) {
    const existingContribution = Object.prototype.hasOwnProperty.call(
      contributionIndex,
      member.memberId,
    )
      ? contributionIndex[member.memberId]
      : null;

    if (existingContribution !== null) {
      /*
       * Snapshot já existente é congelado.
       *
       * Mudanças posteriores em:
       * - targetRequired;
       * - joinedAt;
       * - saída;
       * - reativação
       *
       * não reescrevem targetRequired/targetAmount
       * dessa semana.
       */
      return buildContributionWeekRow_(member, existingContribution, null);
    }

    const snapshot = calculateWeeklyTargetSnapshot_(
      member,
      normalizedWeekKey,
      normalizedDailyTarget,
    );

    return buildContributionWeekRow_(member, null, snapshot);
  });

  const collectiveTarget = rows.reduce(function (total, row) {
    if (!row.targetRequired) {
      return total;
    }

    return total + row.targetAmount;
  }, 0);

  const totalContributed = rows.reduce(function (total, row) {
    return total + row.amount;
  }, 0);

  assertSafeContributionAggregate_(collectiveTarget, "collectiveTarget");

  assertSafeContributionAggregate_(totalContributed, "totalContributed");

  return {
    weekKey: normalizedWeekKey,
    weekStart: weekStart,
    weekEnd: weekEnd,
    dailyTarget: normalizedDailyTarget,
    collectiveTarget: collectiveTarget,
    totalContributed: totalContributed,
    rows: rows,
  };
}

function buildContributionMemberIndex_(members) {
  const index = Object.create(null);

  members.forEach(function (member) {
    assertValidContributionMember_(member);

    if (Object.prototype.hasOwnProperty.call(index, member.memberId)) {
      throw new Error(`Membro duplicado em memória: ${member.memberId}.`);
    }

    index[member.memberId] = member;
  });

  return index;
}

function assertValidContributionMember_(member) {
  if (!isObject_(member)) {
    throw new Error("Registro de membro inválido para Contributions.");
  }

  try {
    /*
     * Confirma primeiro o contrato físico
     * oficial de Members.
     */
    validateMemberRepositoryRecord_(member);

    const validatedName = validateRequiredString_(
      member.name,
      "member.name",
      1,
      100,
    );

    if (validatedName !== member.name) {
      throw new Error("Nome persistido de membro não está normalizado.");
    }

    validateEnum_(member.guildRole, "member.guildRole", [
      "LEADER",
      "VICE_LEADER",
      "MEMBER",
    ]);

    validateNonNegativeInteger_(member.level, "member.level");

    validateEnum_(member.status, "member.status", ["ACTIVE", "INACTIVE"]);

    validateBoolean_(member.targetRequired, "member.targetRequired");

    assertValidDate_(member.joinedAt);

    assertValidDate_(member.createdAt);

    assertValidDate_(member.updatedAt);

    if (member.status === "ACTIVE") {
      if (member.leftAt !== null) {
        throw new Error("Membro ativo possui data de saída.");
      }
    }

    if (member.status === "INACTIVE") {
      if (member.leftAt === null) {
        throw new Error("Membro inativo não possui data de saída.");
      }

      assertValidDate_(member.leftAt);

      if (member.leftAt.getTime() < member.joinedAt.getTime()) {
        throw new Error(
          "Data de saída do membro é anterior à data de ingresso.",
        );
      }
    }

    return member;
  } catch (error) {
    if (isControlledError_(error)) {
      throw new Error("Registro de membro inválido para Contributions.");
    }

    throw error;
  }
}

function buildContributionWeekIndex_(contributions, weekKey) {
  const index = Object.create(null);

  contributions.forEach(function (contribution) {
    assertValidStoredContribution_(contribution);

    if (contribution.weekKey !== weekKey) {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(index, contribution.memberId)) {
      throw createControlledError_(
        ERROR_CODES.CONFLICT,
        "Existem contribuições duplicadas para o mesmo membro nesta semana.",
        null,
      );
    }

    index[contribution.memberId] = contribution;
  });

  return index;
}

function isMemberRelevantForContributionWeek_(
  member,
  weekKey,
  weekStart,
  nextWeekStart,
  contributionIndex,
) {
  assertValidContributionMember_(member);

  /*
   * Registro já existente sempre mantém
   * o membro relevante para aquela semana.
   */
  if (
    Object.prototype.hasOwnProperty.call(contributionIndex, member.memberId)
  ) {
    return true;
  }

  /*
   * Um membro cuja entrada está depois do
   * encerramento da semana não pertence
   * à operação desta semana.
   */
  if (member.joinedAt.getTime() >= nextWeekStart.getTime()) {
    return false;
  }

  if (member.status === "ACTIVE") {
    return true;
  }

  /*
   * Inativo sem Contribution só recebe
   * registro corrente quando sua saída
   * pertence à própria semana.
   */
  if (
    member.status === "INACTIVE" &&
    member.leftAt !== null &&
    member.leftAt.getTime() >= weekStart.getTime() &&
    member.leftAt.getTime() < nextWeekStart.getTime()
  ) {
    return true;
  }

  return false;
}

function buildContributionWeekRow_(member, contribution, pendingSnapshot) {
  if (contribution !== null && pendingSnapshot !== null) {
    throw new Error(
      "Linha semanal não pode possuir Contribution e snapshot pendente simultaneamente.",
    );
  }

  if (contribution === null && pendingSnapshot === null) {
    throw new Error("Linha semanal sem Contribution ou snapshot.");
  }

  if (contribution !== null) {
    return {
      member: member,
      contribution: contribution,
      needsCreation: false,
      amount: contribution.amount,
      targetRequired: contribution.targetRequired,
      targetAmount: contribution.targetAmount,
    };
  }

  return {
    member: member,
    contribution: null,
    needsCreation: true,
    amount: 0,
    targetRequired: pendingSnapshot.targetRequired,
    targetAmount: pendingSnapshot.targetAmount,
  };
}

function compareContributionAdminMembers_(left, right) {
  const leftName = left.name.toLocaleLowerCase("pt-BR");

  const rightName = right.name.toLocaleLowerCase("pt-BR");

  if (leftName < rightName) {
    return -1;
  }

  if (leftName > rightName) {
    return 1;
  }

  if (left.memberId < right.memberId) {
    return -1;
  }

  if (left.memberId > right.memberId) {
    return 1;
  }

  return 0;
}

function assertValidStoredContribution_(contribution) {
  if (!isObject_(contribution)) {
    throw new Error("Registro persistido de Contribution inválido.");
  }

  try {
    validateUuid_(contribution.contributionId, "contributionId");

    validateUuid_(contribution.memberId, "memberId");

    validateGameWeekKey_(contribution.weekKey, "weekKey");

    validateNonNegativeInteger_(contribution.amount, "amount");

    validateBoolean_(contribution.targetRequired, "targetRequired");

    validateNonNegativeInteger_(contribution.targetAmount, "targetAmount");

    assertValidDate_(contribution.createdAt);

    assertValidDate_(contribution.updatedAt);

    if (
      contribution.targetRequired === false &&
      contribution.targetAmount !== 0
    ) {
      throw new Error(
        "Contribution sem meta obrigatória deve possuir targetAmount igual a zero.",
      );
    }

    if (contribution.updatedAt.getTime() < contribution.createdAt.getTime()) {
      throw new Error("updatedAt de Contribution é anterior a createdAt.");
    }

    return contribution;
  } catch (error) {
    if (isControlledError_(error)) {
      throw new Error("Registro persistido de Contribution inválido.");
    }

    throw error;
  }
}

function readCurrentContributionWeekPreparation_() {
  const weekKey = getCurrentGameWeekKey_();

  const dailyTarget = getDailyTarget_();

  const members = findAllMembers_();

  const allContributions = findAllContributions_();

  const context = buildContributionWeekContext_(
    weekKey,
    dailyTarget,
    members,
    allContributions,
  );

  return {
    weekKey: weekKey,

    dailyTarget: dailyTarget,

    members: members,

    allContributions: allContributions,

    context: context,
  };
}

function getMissingCurrentWeekContributionRows_(context) {
  if (!isObject_(context) || !Array.isArray(context.rows)) {
    throw new Error("Contexto semanal inválido para preparação.");
  }

  return context.rows.filter(function (row) {
    return row.needsCreation === true;
  });
}

function ensureCurrentWeekContributions_() {
  /*
   * Primeira leitura sem lock.
   *
   * Se já estiver tudo preparado, esta é
   * apenas uma operação de leitura e não
   * precisamos bloquear outras gravações.
   */
  const initialPreparation = readCurrentContributionWeekPreparation_();

  const initialMissingRows = getMissingCurrentWeekContributionRows_(
    initialPreparation.context,
  );

  if (initialMissingRows.length === 0) {
    return Object.assign({}, initialPreparation.context, {
      createdCount: 0,
    });
  }

  /*
   * Existe possibilidade real de escrita.
   *
   * A partir daqui seguimos o contrato:
   *
   * lock
   * → releitura autoritativa
   * → cálculo
   * → batch write
   */
  return runContributionPersistenceLocked_(function () {
    /*
     * Não reutilizamos os dados da leitura
     * anterior ao lock.
     *
     * Members, Contributions, DAILY_TARGET
     * e até weekKey são relidos.
     */
    const authoritativePreparation = readCurrentContributionWeekPreparation_();

    const missingRows = getMissingCurrentWeekContributionRows_(
      authoritativePreparation.context,
    );

    /*
     * Outra execução pode ter preparado
     * a semana enquanto aguardávamos o lock.
     */
    if (missingRows.length === 0) {
      return Object.assign({}, authoritativePreparation.context, {
        createdCount: 0,
      });
    }

    const now = new Date();

    const newContributions = missingRows.map(function (row) {
      const contribution = {
        contributionId: generateUuid_(),

        memberId: row.member.memberId,

        weekKey: authoritativePreparation.weekKey,

        amount: 0,

        targetRequired: row.targetRequired,

        targetAmount: row.targetAmount,

        createdAt: now,

        updatedAt: now,
      };

      assertValidStoredContribution_(contribution);

      return contribution;
    });

    /*
     * insertContributions_ reutiliza o
     * ScriptLock que já está adquirido.
     */
    insertContributions_(newContributions);

    const finalContributions =
      authoritativePreparation.allContributions.concat(newContributions);

    const finalContext = buildContributionWeekContext_(
      authoritativePreparation.weekKey,
      authoritativePreparation.dailyTarget,
      authoritativePreparation.members,
      finalContributions,
    );

    return Object.assign({}, finalContext, {
      createdCount: newContributions.length,
    });
  });
}

function assertSafeContributionAggregate_(value, fieldName) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${fieldName} calculado é inválido.`);
  }

  return value;
}

function getCurrentContributionWeek_() {
  const context = ensureCurrentWeekContributions_();

  return toContributionWeekApiDto_(context);
}

function toContributionWeekApiDto_(context) {
  if (!isObject_(context)) {
    throw new Error("Contexto semanal de Contributions inválido.");
  }

  return {
    weekKey: context.weekKey,

    weekStart: formatDateToApiIso_(context.weekStart),

    weekEnd: formatDateToApiIso_(context.weekEnd),

    dailyTarget: context.dailyTarget,

    collectiveTarget: context.collectiveTarget,

    totalContributed: context.totalContributed,

    members: context.rows.map(function (row) {
      const member = row.member;

      const contribution = row.contribution;

      if (!contribution || row.needsCreation === true) {
        throw new Error("Contexto semanal não foi completamente preparado.");
      }

      return {
        memberId: member.memberId,

        name: member.name,

        guildRole: member.guildRole,

        level: member.level,

        status: member.status,

        joinedAt: formatDateToApiIso_(member.joinedAt),

        leftAt:
          member.leftAt === null ? null : formatDateToApiIso_(member.leftAt),

        contributionId: contribution.contributionId,

        amount: contribution.amount,

        targetRequired: contribution.targetRequired,

        targetAmount: contribution.targetAmount,

        targetMet: contribution.targetRequired
          ? contribution.amount >= contribution.targetAmount
          : null,
      };
    }),
  };
}

function saveContributionWeekBatch_(payload) {
  const input = validateContributionSaveBatchPayload_(payload);

  const mutationResult = runContributionPersistenceLocked_(function () {
    /*
     * Primeira proteção contra uma tela
     * carregada na semana anterior.
     */
    assertCurrentContributionWeekKey_(input.weekKey);

    /*
     * Leituras em lote.
     */
    const members = findAllMembers_();

    const contributions = findContributionsByWeekKey_(input.weekKey);

    const memberIndex = buildContributionMemberIndex_(members);

    const contributionIndex = buildContributionWeekIndex_(
      contributions,
      input.weekKey,
    );

    const weekStart = getGameWeekStart_(input.weekKey);

    const weekEnd = getGameWeekEnd_(input.weekKey);

    const nextWeekStart = new Date(weekEnd.getTime() + 1);

    const relevantContext = buildContributionWeekContext_(
      input.weekKey,
      getDailyTarget_(),
      members,
      contributions,
    );

    const allowedMemberIds = Object.create(null);

    relevantContext.rows.forEach(function (row) {
      allowedMemberIds[row.member.memberId] = true;
    });

    const now = new Date();

    const memberUpdates = [];
    const contributionUpdates = [];

    input.updates.forEach(function (update) {
      if (!Object.prototype.hasOwnProperty.call(memberIndex, update.memberId)) {
        throw createControlledError_(
          ERROR_CODES.NOT_FOUND,
          "Um dos membros informados não foi encontrado.",
          null,
        );
      }

      const member = memberIndex[update.memberId];

      /*
       * Defesa adicional da regra semanal.
       */
      if (
        !Object.prototype.hasOwnProperty.call(
          allowedMemberIds,
          update.memberId,
        ) ||
        !isMemberRelevantForContributionWeek_(
          member,
          input.weekKey,
          weekStart,
          nextWeekStart,
          contributionIndex,
        )
      ) {
        throw createControlledError_(
          ERROR_CODES.CONFLICT,
          "Um dos membros não pertence mais à operação semanal exibida. Recarregue os dados.",
          null,
        );
      }

      if (
        !Object.prototype.hasOwnProperty.call(
          contributionIndex,
          update.memberId,
        )
      ) {
        throw createControlledError_(
          ERROR_CODES.CONFLICT,
          "O registro semanal de um dos membros não está disponível. Recarregue os dados.",
          null,
        );
      }

      const contribution = contributionIndex[update.memberId];

      /*
       * Somente level é alterado em Members.
       */
      if (member.level !== update.level) {
        const updatedMember = Object.assign({}, member, {
          level: update.level,
          updatedAt: now,
        });

        assertValidContributionMember_(updatedMember);

        memberUpdates.push(updatedMember);
      }

      /*
       * amount é valor absoluto acumulado.
       *
       * Nunca:
       * amount atual + update.amount
       */
      if (contribution.amount !== update.amount) {
        const updatedContribution = Object.assign({}, contribution, {
          amount: update.amount,
          updatedAt: now,
        });

        /*
         * contributionId
         * memberId
         * weekKey
         * targetRequired
         * targetAmount
         * createdAt
         *
         * permanecem preservados.
         */
        assertValidStoredContribution_(updatedContribution);

        contributionUpdates.push(updatedContribution);
      }
    });

    /*
     * Tudo acima ocorre antes da primeira escrita.
     *
     * Verificamos novamente a semana imediatamente
     * antes de qualquer mutation.
     */
    assertCurrentContributionWeekKey_(input.weekKey);

    if (memberUpdates.length === 0 && contributionUpdates.length === 0) {
      return {
        updatedCount: 0,
      };
    }

    /*
     * Uma escrita batch de Members, quando necessária.
     */
    if (memberUpdates.length > 0) {
      updateMembers_(memberUpdates);
    }

    /*
     * Uma escrita batch de Contributions,
     * quando necessária.
     *
     * Sheets não oferece transação ACID multiaba.
     * Não criamos rollback próprio.
     */
    if (contributionUpdates.length > 0) {
      updateContributions_(contributionUpdates);
    }

    return {
      updatedCount: input.updates.length,
    };
  });
  return {
    updatedCount: mutationResult.updatedCount,

    /*
     * A resposta é relida depois que o lock
     * já foi liberado.
     */
    week: getCurrentContributionWeek_(),
  };
}

function validateContributionSaveBatchPayload_(payload) {
  validateObject_(payload, "payload");

  validateAllowedProperties_(payload, "payload", ["weekKey", "updates"]);

  const weekKey = validateGameWeekKey_(payload.weekKey, "weekKey");

  if (!Array.isArray(payload.updates)) {
    throwValidationError_(
      "updates",
      "As alterações devem ser enviadas em uma lista.",
    );
  }

  const seenMemberIds = Object.create(null);

  const updates = payload.updates.map(function (update, index) {
    const fieldPrefix = `updates[${index}]`;

    validateObject_(update, fieldPrefix);

    validateAllowedProperties_(update, fieldPrefix, [
      "memberId",
      "level",
      "amount",
    ]);

    const memberId = validateUuid_(update.memberId, `${fieldPrefix}.memberId`);

    const level = validateNonNegativeInteger_(
      update.level,
      `${fieldPrefix}.level`,
    );

    const amount = validateNonNegativeInteger_(
      update.amount,
      `${fieldPrefix}.amount`,
    );

    if (Object.prototype.hasOwnProperty.call(seenMemberIds, memberId)) {
      throwValidationError_(
        "updates",
        "O mesmo membro não pode aparecer mais de uma vez no lote.",
      );
    }

    seenMemberIds[memberId] = true;

    return {
      memberId: memberId,
      level: level,
      amount: amount,
    };
  });

  return {
    weekKey: weekKey,
    updates: updates,
  };
}

function assertCurrentContributionWeekKey_(weekKey) {
  const currentWeekKey = getCurrentGameWeekKey_();

  if (weekKey !== currentWeekKey) {
    throw createControlledError_(
      ERROR_CODES.CONFLICT,
      "A semana do jogo mudou. Recarregue os dados antes de salvar.",
      null,
    );
  }

  return true;
}

function ensureCurrentWeekContributionForMember_(member) {
  assertValidContributionMember_(member);

  const weekKey = getCurrentGameWeekKey_();

  /*
   * Se já existe snapshot, ele é autoridade
   * e nenhuma informação atual do cadastro
   * pode reescrevê-lo.
   */
  const existingContribution = findContributionByMemberAndWeek_(
    member.memberId,
    weekKey,
  );

  if (existingContribution !== null) {
    return existingContribution;
  }

  const weekStart = getGameWeekStart_(weekKey);

  const weekEnd = getGameWeekEnd_(weekKey);

  const nextWeekStart = new Date(weekEnd.getTime() + 1);

  /*
   * Índice vazio porque já confirmamos acima
   * que este membro não possui Contribution
   * da semana.
   */
  const emptyContributionIndex = Object.create(null);

  const isRelevant = isMemberRelevantForContributionWeek_(
    member,
    weekKey,
    weekStart,
    nextWeekStart,
    emptyContributionIndex,
  );

  /*
   * Exemplo:
   * membro inativo desde a semana anterior.
   *
   * Não fabricamos Contribution para ele.
   */
  if (!isRelevant) {
    return null;
  }

  const dailyTarget = getDailyTarget_();

  const snapshot = calculateWeeklyTargetSnapshot_(member, weekKey, dailyTarget);

  const now = new Date();

  const contribution = {
    contributionId: generateUuid_(),

    memberId: member.memberId,

    weekKey: weekKey,

    amount: 0,

    targetRequired: snapshot.targetRequired,

    targetAmount: snapshot.targetAmount,

    createdAt: now,

    updatedAt: now,
  };

  assertValidStoredContribution_(contribution);

  try {
    insertContributions_([contribution]);

    return contribution;
  } catch (error) {
    /*
     * Outra execução pode ter criado exatamente
     * o mesmo memberId + weekKey entre nossa
     * leitura e o insert.
     *
     * Nesse caso aceitamos o registro que venceu
     * a corrida, em vez de criar duplicidade.
     */
    if (isControlledError_(error) && error.code === ERROR_CODES.CONFLICT) {
      const concurrentContribution = findContributionByMemberAndWeek_(
        member.memberId,
        weekKey,
      );

      if (concurrentContribution !== null) {
        return concurrentContribution;
      }
    }

    throw error;
  }
}

function getRecentCompletedContributionHistory_(limit) {
  const normalizedLimit =
    limit === undefined ? 5 : validatePositiveInteger_(limit, "limit");

  const currentWeekKey = getCurrentGameWeekKey_();

  const members = findAllMembers_();

  const contributions = findAllContributions_();

  return buildCompletedContributionHistory_(
    members,
    contributions,
    currentWeekKey,
    normalizedLimit,
  );
}

function buildCompletedContributionHistory_(
  members,
  contributions,
  currentWeekKey,
  limit,
) {
  if (!Array.isArray(members)) {
    throw new Error("Lista histórica de membros inválida.");
  }

  if (!Array.isArray(contributions)) {
    throw new Error("Lista histórica de Contributions inválida.");
  }

  const normalizedCurrentWeekKey = validateGameWeekKey_(
    currentWeekKey,
    "currentWeekKey",
  );

  const normalizedLimit = validatePositiveInteger_(limit, "limit");

  const memberIndex = buildContributionMemberIndex_(members);

  const contributionsByWeek = Object.create(null);

  contributions.forEach(function (contribution) {
    assertValidStoredContribution_(contribution);

    /*
     * Histórico contém somente semanas
     * completamente anteriores à atual.
     *
     * YYYY-MM-DD é ordenável
     * lexicograficamente neste formato.
     */
    if (contribution.weekKey >= normalizedCurrentWeekKey) {
      return;
    }

    if (
      !Object.prototype.hasOwnProperty.call(memberIndex, contribution.memberId)
    ) {
      throw new Error("Contribution histórica referencia membro inexistente.");
    }

    if (
      !Object.prototype.hasOwnProperty.call(
        contributionsByWeek,
        contribution.weekKey,
      )
    ) {
      contributionsByWeek[contribution.weekKey] = [];
    }

    contributionsByWeek[contribution.weekKey].push(contribution);
  });

  const weekKeys = Object.keys(contributionsByWeek)
    .sort()
    .reverse()
    .slice(0, normalizedLimit);

  return weekKeys.map(function (weekKey) {
    return buildHistoricalContributionWeekDto_(
      weekKey,
      contributionsByWeek[weekKey],
      memberIndex,
    );
  });
}

function buildHistoricalContributionWeekDto_(
  weekKey,
  contributions,
  memberIndex,
) {
  const normalizedWeekKey = validateGameWeekKey_(weekKey, "weekKey");

  if (!Array.isArray(contributions) || contributions.length === 0) {
    throw new Error("Semana histórica sem Contributions.");
  }

  /*
   * Além de produzir o índice, esta chamada
   * rejeita memberId + weekKey duplicado.
   */
  const contributionIndex = buildContributionWeekIndex_(
    contributions,
    normalizedWeekKey,
  );

  const rows = Object.keys(contributionIndex).map(function (memberId) {
    if (!Object.prototype.hasOwnProperty.call(memberIndex, memberId)) {
      throw new Error("Membro histórico não encontrado.");
    }

    const member = memberIndex[memberId];

    const contribution = contributionIndex[memberId];

    return {
      memberId: member.memberId,

      name: member.name,

      guildRole: member.guildRole,

      level: member.level,

      contributionId: contribution.contributionId,

      amount: contribution.amount,

      targetRequired: contribution.targetRequired,

      targetAmount: contribution.targetAmount,

      targetMet: contribution.targetRequired
        ? contribution.amount >= contribution.targetAmount
        : null,
    };
  });

  rows.sort(function (left, right) {
    const leftName = left.name.toLocaleLowerCase("pt-BR");

    const rightName = right.name.toLocaleLowerCase("pt-BR");

    if (leftName < rightName) {
      return -1;
    }

    if (leftName > rightName) {
      return 1;
    }

    if (left.memberId < right.memberId) {
      return -1;
    }

    if (left.memberId > right.memberId) {
      return 1;
    }

    return 0;
  });

  const collectiveTarget = rows.reduce(function (total, row) {
    if (row.targetRequired !== true) {
      return total;
    }

    return total + row.targetAmount;
  }, 0);

  const totalContributed = rows.reduce(function (total, row) {
    return total + row.amount;
  }, 0);

  assertSafeContributionAggregate_(collectiveTarget, "collectiveTarget");

  assertSafeContributionAggregate_(totalContributed, "totalContributed");

  return {
    weekKey: normalizedWeekKey,

    weekStart: formatDateToApiIso_(getGameWeekStart_(normalizedWeekKey)),

    weekEnd: formatDateToApiIso_(getGameWeekEnd_(normalizedWeekKey)),

    collectiveTarget: collectiveTarget,

    totalContributed: totalContributed,

    members: rows,
  };
}

/*
 * ============================================================
 * FASE 11 — Ranking público (derivado, não persistido)
 * ============================================================
 *
 * Critério único: Contribution.amount da semana.
 *
 * Ranking competitivo padrão (1, 2, 2, 4). A ordem secundária
 * (name ASC pt-BR, memberId ASC) serve apenas para apresentação
 * entre empatados e nunca quebra o empate.
 */

function rankContributionRows_(entries) {
  if (!Array.isArray(entries)) {
    throw new Error("Lista de linhas de ranking inválida.");
  }

  const normalized = entries.map(function (entry) {
    assertValidRankableContributionEntry_(entry);

    return Object.assign({}, entry);
  });

  normalized.sort(compareRankableContributionEntries_);

  let previousAmount = null;
  let previousPosition = 0;

  return normalized.map(function (entry, index) {
    const humanPosition = index + 1;

    const position =
      previousAmount !== null && entry.amount === previousAmount
        ? previousPosition
        : humanPosition;

    previousAmount = entry.amount;
    previousPosition = position;

    return Object.assign({}, entry, { position: position });
  });
}

function compareRankableContributionEntries_(left, right) {
  if (left.amount !== right.amount) {
    return right.amount - left.amount;
  }

  const leftName = left.name.toLocaleLowerCase("pt-BR");

  const rightName = right.name.toLocaleLowerCase("pt-BR");

  if (leftName !== rightName) {
    return leftName < rightName ? -1 : 1;
  }

  if (left.memberId !== right.memberId) {
    return left.memberId < right.memberId ? -1 : 1;
  }

  return 0;
}

function assertValidRankableContributionEntry_(entry) {
  if (!isObject_(entry)) {
    throw new Error("Linha de ranking inválida.");
  }

  validateUuid_(entry.memberId, "entry.memberId");

  validateRequiredString_(entry.name, "entry.name", 1, 100);

  validateNonNegativeInteger_(entry.amount, "entry.amount");

  return entry;
}

function calculateContributionCollectiveProgressPercent_(
  totalContributed,
  collectiveTarget,
) {
  if (collectiveTarget <= 0) {
    return 0;
  }

  return (totalContributed / collectiveTarget) * 100;
}

function toPublicContributionRankingMemberEntry_(row) {
  const member = row.member;

  return {
    memberId: member.memberId,

    name: member.name,

    guildRole: member.guildRole,

    level: member.level,

    amount: row.amount,

    targetRequired: row.targetRequired,

    targetAmount: row.targetAmount,

    targetMet: row.targetRequired ? row.amount >= row.targetAmount : null,
  };
}

function buildPublicContributionRankingWeekDto_(
  weekKey,
  weekStart,
  weekEnd,
  collectiveTarget,
  totalContributed,
  isCurrentWeek,
  memberEntries,
) {
  const rankedMembers = rankContributionRows_(memberEntries);

  const targetMetCount = rankedMembers.reduce(function (count, entry) {
    return entry.targetRequired === true && entry.targetMet === true
      ? count + 1
      : count;
  }, 0);

  return {
    weekKey: weekKey,

    weekStart: weekStart,

    weekEnd: weekEnd,

    isCurrentWeek: isCurrentWeek,

    collectiveTarget: collectiveTarget,

    totalContributed: totalContributed,

    collectiveProgressPercent: calculateContributionCollectiveProgressPercent_(
      totalContributed,
      collectiveTarget,
    ),

    targetMetCount: targetMetCount,

    members: rankedMembers,
  };
}

/*
 * DTO público da semana atual a partir do contexto semanal.
 */
function buildPublicCurrentContributionRankingDto_(context) {
  const memberEntries = context.rows.map(toPublicContributionRankingMemberEntry_);

  return buildPublicContributionRankingWeekDto_(
    context.weekKey,
    formatDateToApiIso_(context.weekStart),
    formatDateToApiIso_(context.weekEnd),
    context.collectiveTarget,
    context.totalContributed,
    true,
    memberEntries,
  );
}

function toPublicHistoricalContributionRankingMemberEntry_(row) {
  return {
    memberId: row.memberId,

    name: row.name,

    guildRole: row.guildRole,

    level: row.level,

    amount: row.amount,

    targetRequired: row.targetRequired,

    targetAmount: row.targetAmount,

    targetMet: row.targetMet,
  };
}

function buildPublicHistoricalContributionRankingWeekDto_(week) {
  const memberEntries = week.members.map(
    toPublicHistoricalContributionRankingMemberEntry_,
  );

  return buildPublicContributionRankingWeekDto_(
    week.weekKey,
    week.weekStart,
    week.weekEnd,
    week.collectiveTarget,
    week.totalContributed,
    false,
    memberEntries,
  );
}

/*
 * Membros ativos, no sentido de estado atual da Guild.
 *
 * Não inclui membros que aparecem no ranking da semana
 * corrente apenas por participação/histórico (Fase 6).
 */
function countActiveContributionMembers_(members) {
  return members.filter(function (member) {
    return member.status === "ACTIVE";
  }).length;
}

/*
 * Ranking de nível: somente membros ativos, level DESC,
 * name ASC pt-BR, memberId ASC como fallback.
 *
 * O ranking completo é usado na Home; a apresentação decide a quantidade
 * quando precisar de uma vitrine compacta.
 */
function buildTopLevelContributionMembers_(members) {
  const activeMembers = members.filter(function (member) {
    return member.status === "ACTIVE";
  });

  const sorted = activeMembers.slice().sort(compareTopLevelContributionMembers_);

  return sorted.map(function (member) {
    return {
      memberId: member.memberId,

      name: member.name,

      guildRole: member.guildRole,

      level: member.level,
    };
  });
}

function compareTopLevelContributionMembers_(left, right) {
  if (left.level !== right.level) {
    return right.level - left.level;
  }

  const leftName = left.name.toLocaleLowerCase("pt-BR");

  const rightName = right.name.toLocaleLowerCase("pt-BR");

  if (leftName !== rightName) {
    return leftName < rightName ? -1 : 1;
  }

  if (left.memberId !== right.memberId) {
    return left.memberId < right.memberId ? -1 : 1;
  }

  return 0;
}

/*
 * Action pública principal da Fase 11.
 *
 * Lê Members e Contributions uma única vez e deriva:
 * - ranking da semana atual (read-only);
 * - ranking das últimas 5 semanas concluídas;
 * - activeMemberCount e topLevelMembers (estado atual da Guild).
 *
 * Read-only: não chama ensureCurrentWeekContributions_. Linha sem
 * Contribution persistida (needsCreation) é calculada só em memória
 * por buildContributionWeekContext_ e nunca gravada.
 *
 * Não inclui Guild Bank/objetivo aqui — permanecem em
 * guild.getPublicState / guild.getPublicObjective para não
 * misturar domínios.
 */
function getPublicContributionRanking_() {
  const weekKey = getCurrentGameWeekKey_();

  const dailyTarget = getDailyTarget_();

  const members = findAllMembers_();

  const contributions = findAllContributions_();

  const currentContext = buildContributionWeekContext_(
    weekKey,
    dailyTarget,
    members,
    contributions,
  );

  const current = buildPublicCurrentContributionRankingDto_(currentContext);

  const historicalWeeks = buildCompletedContributionHistory_(
    members,
    contributions,
    weekKey,
    5,
  );

  const history = historicalWeeks.map(
    buildPublicHistoricalContributionRankingWeekDto_,
  );

  const weeklyTasks = findWeeklyTasksByWeekKey_(weekKey);
  const memberNameIndex = buildContributionMemberNameIndex_(members);

  const enrichedCurrent = enrichCurrentRankingWithTasks_(
    current,
    weeklyTasks,
    memberNameIndex,
  );

  return {
    current: enrichedCurrent,

    history: history,

    activeMemberCount: countActiveContributionMembers_(members),

    topLevelMembers: buildTopLevelContributionMembers_(members),
  };
}

function getAdminTaskOverview_() {
  const weekKey = getCurrentGameWeekKey_();
  return buildAdminTaskOverview_(weekKey, findAllMembers_(),
    findWeeklyTasksByWeekKey_(weekKey), findDailyTasksByWeekKey_(weekKey));
}

function buildAdminTaskOverview_(weekKey, members, weeklyTasks, dailyTasks) {
  const names = buildContributionMemberNameIndex_(members);
  const weekly = weeklyTasks.map(function (task) {
    if (!Object.prototype.hasOwnProperty.call(names, task.memberId)) {
      throw createControlledError_(ERROR_CODES.CONFLICT, "Task semanal sem membro válido.", null);
    }
    return {memberId: task.memberId, name: names[task.memberId], delivered: task.delivered};
  });
  const daily = dailyTasks.map(function (task) {
    if (!Object.prototype.hasOwnProperty.call(names, task.memberId)) {
      throw createControlledError_(ERROR_CODES.CONFLICT, "Task diária sem membro válido.", null);
    }
    return {memberId: task.memberId, name: names[task.memberId], day: task.day, delivered: task.delivered};
  });
  weekly.sort(function (a, b) {
    return b.delivered - a.delivered || a.name.localeCompare(b.name, "pt-BR");
  });
  daily.sort(function (a, b) {
    return b.day.localeCompare(a.day) || a.name.localeCompare(b.name, "pt-BR");
  });
  return {
    weekKey: weekKey,
    weekly: weekly,
    daily: daily,
    recordedDays: Array.from(new Set(daily.map(function (row) { return row.day; }))).sort(),
  };
}

/*
 * Índice name por memberId para uso nas DTOs de tasks.
 * Inclui membros ativos e inativos (tasks podem existir para qualquer um).
 */
function buildContributionMemberNameIndex_(members) {
  const index = Object.create(null);

  members.forEach(function (member) {
    index[member.memberId] = member.name;
  });

  return index;
}

/*
 * Enriquece o DTO da semana atual com WeeklyTasks e DailyTasks.
 *
 * members recebe tasksDelivered (int | null — null = sem registro semanal).
 * Adicionado ao DTO:
 *   tasksRanking     — membros COM registro, ordenados por delivered DESC.
 *
 * Desempate do tasksRanking: delivered DESC, name ASC pt-BR, memberId ASC.
 */
function enrichCurrentRankingWithTasks_(
  current,
  weeklyTasks,
  memberNameIndex,
) {
  const tasksByMemberId = Object.create(null);

  weeklyTasks.forEach(function (task) {
    tasksByMemberId[task.memberId] = task;
  });

  const enrichedMembers = current.members.map(function (member) {
    const task = Object.prototype.hasOwnProperty.call(
      tasksByMemberId,
      member.memberId,
    )
      ? tasksByMemberId[member.memberId]
      : null;

    return Object.assign({}, member, {
      tasksDelivered: task !== null ? task.delivered : null,
    });
  });

  const tasksEntries = weeklyTasks
    .map(function (task) {
      if (
        !Object.prototype.hasOwnProperty.call(memberNameIndex, task.memberId)
      ) {
        return null;
      }
      return {
        memberId: task.memberId,
        name: memberNameIndex[task.memberId],
        delivered: task.delivered,
      };
    })
    .filter(function (entry) {
      return entry !== null;
    });

  const rankedTaskEntries = rankTaskEntries_(tasksEntries);

  return Object.assign({}, current, {
    members: enrichedMembers,
    tasksRanking: rankedTaskEntries,
  });
}

/*
 * Ranking competitivo de tasks: delivered DESC.
 * Desempate: name ASC pt-BR, memberId ASC.
 * Posições competitivas padrão (1, 2, 2, 4).
 */
function rankTaskEntries_(entries) {
  if (!Array.isArray(entries)) {
    throw new Error('Lista de entradas de ranking de tasks inválida.');
  }

  const sorted = entries.slice().sort(compareRankableTaskEntries_);

  let previousDelivered = null;
  let previousPosition = 0;

  return sorted.map(function (entry, index) {
    const humanPosition = index + 1;

    const position =
      previousDelivered !== null && entry.delivered === previousDelivered
        ? previousPosition
        : humanPosition;

    previousDelivered = entry.delivered;
    previousPosition = position;

    return Object.assign({}, entry, {position: position});
  });
}

function compareRankableTaskEntries_(left, right) {
  if (left.delivered !== right.delivered) {
    return right.delivered - left.delivered;
  }

  const leftName = left.name.toLocaleLowerCase('pt-BR');
  const rightName = right.name.toLocaleLowerCase('pt-BR');

  if (leftName !== rightName) {
    return leftName < rightName ? -1 : 1;
  }

  return left.memberId < right.memberId ? -1 : 1;
}
