const MEMBER_GUILD_ROLES_ = Object.freeze(["LEADER", "VICE_LEADER", "MEMBER"]);

const MEMBER_STATUSES_ = Object.freeze(["ACTIVE", "INACTIVE"]);

function listMembers_() {
  return findAllMembers_().map(function (member) {
    return toMemberApiDto_(member);
  });
}

function createMember_(payload) {
  validateAllowedProperties_(payload, "payload", [
    "name",
    "guildRole",
    "level",
    "joinedAt",
    "targetRequired",
  ]);

  const now = new Date();

  const member = {
    memberId: generateUuid_(),
    name: validateMemberName_(payload.name),
    guildRole: validateMemberGuildRole_(payload.guildRole),
    level: validateMemberLevel_(payload.level),
    joinedAt: validateMemberJoinedAt_(payload.joinedAt),
    status: "ACTIVE",
    leftAt: null,
    targetRequired: validateMemberTargetRequired_(payload.targetRequired),
    createdAt: now,
    updatedAt: now,
  };

  assertValidStoredMember_(member);

  const savedMember = insertMember_(member);

  return toMemberApiDto_(savedMember);
}

function updateMemberDetails_(payload) {
  validateAllowedProperties_(payload, "payload", [
    "memberId",
    "name",
    "guildRole",
    "level",
    "joinedAt",
    "targetRequired",
  ]);

  const memberId = validateMemberId_(payload.memberId);
  return runContributionPersistenceLocked_(function () {
    const currentMember = getRequiredMemberById_(memberId);
    const updatedMember = Object.assign({}, currentMember);

    if (Object.prototype.hasOwnProperty.call(payload, "name")) {
      updatedMember.name = validateMemberName_(payload.name);
    }

    if (Object.prototype.hasOwnProperty.call(payload, "guildRole")) {
      updatedMember.guildRole = validateMemberGuildRole_(payload.guildRole);
    }

    if (Object.prototype.hasOwnProperty.call(payload, "level")) {
      updatedMember.level = validateMemberLevel_(payload.level);
    }

    if (Object.prototype.hasOwnProperty.call(payload, "joinedAt")) {
      updatedMember.joinedAt = validateMemberJoinedAt_(payload.joinedAt);
    }

    if (Object.prototype.hasOwnProperty.call(payload, "targetRequired")) {
      updatedMember.targetRequired = validateMemberTargetRequired_(
        payload.targetRequired,
      );
    }

    validateMemberUpdateTemporalConsistency_(updatedMember);

    updatedMember.updatedAt = new Date();

    assertValidStoredMember_(updatedMember);

    /*
     * targetRequired alterado durante a semana
     * não pode mudar semanticamente a semana atual.
     *
     * Portanto congelamos primeiro o snapshot
     * usando o estado ANTERIOR do membro.
     *
     * Importante: isso ocorre somente depois de
     * validar completamente o novo cadastro.
     */
    const targetRequiredChanged =
      Object.prototype.hasOwnProperty.call(payload, "targetRequired") &&
      updatedMember.targetRequired !== currentMember.targetRequired;

    if (targetRequiredChanged) {
      ensureCurrentWeekContributionForMember_(currentMember);
    }

    const savedMember = updateMember_(updatedMember);

    return toMemberApiDto_(savedMember);
  });
}

function deactivateMember_(payload) {
  validateAllowedProperties_(payload, "payload", ["memberId"]);

  const memberId = validateMemberId_(payload.memberId);
  return runContributionPersistenceLocked_(function () {
    const currentMember = getRequiredMemberById_(memberId);

    if (currentMember.status === "INACTIVE") {
      throw createControlledError_(
        ERROR_CODES.CONFLICT,
        "O membro já está inativo.",
        null,
      );
    }

    const now = new Date();

    if (now.getTime() < currentMember.joinedAt.getTime()) {
      throw createControlledError_(
        ERROR_CODES.CONFLICT,
        "Não é possível marcar o membro como inativo porque a data de ingresso é posterior ao horário atual. Corrija primeiro a data de ingresso.",
        null,
      );
    }

    const updatedMember = Object.assign({}, currentMember, {
      status: "INACTIVE",
      leftAt: now,
      updatedAt: now,
    });

    assertValidStoredMember_(updatedMember);

    /*
     * Congela a participação antes de registrar
     * a saída.
     *
     * leftAt não pode diminuir a meta da semana.
     */
    ensureCurrentWeekContributionForMember_(currentMember);

    const savedMember = updateMember_(updatedMember);

    return toMemberApiDto_(savedMember);
  });
}

function activateMember_(payload) {
  validateAllowedProperties_(payload, "payload", ["memberId"]);

  const memberId = validateMemberId_(payload.memberId);
  return runContributionPersistenceLocked_(function () {
    const currentMember = getRequiredMemberById_(memberId);

    if (currentMember.status === "ACTIVE") {
      throw createControlledError_(
        ERROR_CODES.CONFLICT,
        "O membro já está ativo.",
        null,
      );
    }

    const now = new Date();

    const updatedMember = Object.assign({}, currentMember, {
      joinedAt: now,
      status: "ACTIVE",
      leftAt: null,
      updatedAt: now,
    });

    assertValidStoredMember_(updatedMember);

    /*
     * Tentamos congelar a participação usando
     * o estado ANTERIOR à reativação.
     *
     * Se o membro saiu nesta mesma semana,
     * ele continua relevante e o snapshot é
     * preservado/criado antes de joinedAt mudar.
     *
     * Se ele estava inativo desde uma semana
     * anterior, esta função retorna null e não
     * fabrica Contribution corrente.
     */
    ensureCurrentWeekContributionForMember_(currentMember);

    const savedMember = updateMember_(updatedMember);

    return toMemberApiDto_(savedMember);
  });
}

function getRequiredMemberById_(memberId) {
  const validatedMemberId = validateMemberId_(memberId);
  const member = findMemberById_(validatedMemberId);

  if (member === null) {
    throw createControlledError_(
      ERROR_CODES.NOT_FOUND,
      "O membro solicitado não foi encontrado.",
      null,
    );
  }

  assertValidStoredMember_(member);

  return member;
}

function validateMemberUpdateTemporalConsistency_(member) {
  if (
    member.status === "INACTIVE" &&
    member.leftAt !== null &&
    member.leftAt.getTime() < member.joinedAt.getTime()
  ) {
    throwValidationError_(
      "joinedAt",
      "A data de ingresso não pode ser posterior à data de saída.",
    );
  }

  return member;
}

function validateMemberId_(value) {
  return validateUuid_(value, "memberId");
}

function validateMemberName_(value) {
  return validateRequiredString_(value, "name", 1, 100);
}

function validateMemberGuildRole_(value) {
  return validateEnum_(value, "guildRole", MEMBER_GUILD_ROLES_);
}

function validateMemberLevel_(value) {
  return validateNonNegativeInteger_(value, "level");
}

function validateMemberJoinedAt_(value) {
  return parseApiIsoDateTime_(value, "joinedAt");
}

function validateMemberTargetRequired_(value) {
  return validateBoolean_(value, "targetRequired");
}

function toMemberApiDto_(member) {
  assertValidStoredMember_(member);

  return {
    memberId: member.memberId,
    name: member.name,
    guildRole: member.guildRole,
    level: member.level,
    joinedAt: formatDateToApiIso_(member.joinedAt),
    status: member.status,
    leftAt: member.leftAt === null ? null : formatDateToApiIso_(member.leftAt),
    targetRequired: member.targetRequired,
    createdAt: formatDateToApiIso_(member.createdAt),
    updatedAt: formatDateToApiIso_(member.updatedAt),
  };
}

function assertValidStoredMember_(member) {
  if (!isObject_(member)) {
    throw new Error("Registro persistido de membro inválido.");
  }

  try {
    validateUuid_(member.memberId, "memberId");

    const validatedName = validateRequiredString_(member.name, "name", 1, 100);

    if (validatedName !== member.name) {
      throw new Error("Nome persistido de membro não está normalizado.");
    }

    validateEnum_(member.guildRole, "guildRole", MEMBER_GUILD_ROLES_);

    validateNonNegativeInteger_(member.level, "level");

    validateEnum_(member.status, "status", MEMBER_STATUSES_);

    validateBoolean_(member.targetRequired, "targetRequired");

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
      throw new Error("Registro persistido de membro inválido.");
    }

    throw error;
  }
}
