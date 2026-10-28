function findAllMembers_() {
  return readDatabaseTable_(
    'Members'
  ).map(
    function (record) {
      return normalizeMemberFromStorage_(
        record
      );
    }
  );
}

function findMemberById_(memberId) {
  const validatedMemberId =
    validateUuid_(
      memberId,
      'memberId'
    );

  const record =
    findDatabaseRecordByPrimaryKey_(
      'Members',
      validatedMemberId
    );

  return record === null
    ? null
    : normalizeMemberFromStorage_(
        record
      );
}

function insertMember_(member) {
  validateMemberRepositoryRecord_(
    member
  );

  insertDatabaseRecord_(
    'Members',
    member
  );

  return findMemberById_(
    member.memberId
  );
}

function updateMember_(member) {
  updateMembers_(
    [
      member
    ]
  );

  return findMemberById_(
    member.memberId
  );
}

function updateMembers_(members) {
  if (!Array.isArray(members)) {
    throw new Error(
      'Lote de membros inválido.'
    );
  }

  members.forEach(
    function (member) {
      validateMemberRepositoryRecord_(
        member
      );
    }
  );

  if (
    members.length === 0
  ) {
    return 0;
  }

  const updates =
    members.map(
      function (member) {
        return {
          primaryKeyValue:
            member.memberId,
          record:
            member
        };
      }
    );

  return updateDatabaseRecordsByPrimaryKey_(
    'Members',
    updates
  );
}

function validateMemberRepositoryRecord_(
  member
) {
  validateObject_(
    member,
    'member'
  );

  validateUuid_(
    member.memberId,
    'memberId'
  );

  /*
   * A validação estrutural completa do registro
   * pertence à infraestrutura central.
   *
   * Isso também rejeita:
   * - propriedades extras;
   * - propriedades ausentes;
   * - undefined.
   */
  databaseObjectToRow_(
    'Members',
    member
  );

  return member;
}

function normalizeMemberFromStorage_(
  record
) {
  if (!isObject_(record)) {
    throw new Error(
      'Registro de membro inválido.'
    );
  }

  const normalized =
    Object.assign(
      {},
      record
    );

  if (
    normalized.leftAt === ''
  ) {
    normalized.leftAt = null;
  }

  return normalized;
}