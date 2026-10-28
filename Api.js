const API_ACCESS_ = Object.freeze({
  PUBLIC: "PUBLIC",
  ADMIN: "ADMIN",
});

const API_ACTIONS_ = Object.freeze({
  "app.bootstrap": Object.freeze({
    access: API_ACCESS_.PUBLIC,
    handler: handleAppBootstrap_,
  }),

  "auth.login": Object.freeze({
    access: API_ACCESS_.PUBLIC,
    handler: handleAuthLogin_,
  }),

  "auth.session": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handleAuthSession_,
  }),

  "auth.logout": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handleAuthLogout_,
  }),

  "auth.changePassword": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handleAuthChangePassword_,
  }),

  "members.list": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handleMembersList_,
  }),

  "members.setTargetRequired": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handleMembersSetTargetRequired_,
  }),

  "contributions.getCurrentWeek": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handleContributionsGetCurrentWeek_,
  }),

  "contributions.getTaskOverview": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handleContributionsGetTaskOverview_,
  }),

  "contributions.setDailyTarget": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handleContributionsSetDailyTarget_,
  }),

  "contributions.getPublicRanking": Object.freeze({
    access: API_ACCESS_.PUBLIC,
    handler: handleContributionsGetPublicRanking_,
  }),

  "guild.getPublicState": Object.freeze({
    access: API_ACCESS_.PUBLIC,
    handler: handleGuildGetPublicState_,
  }),

  "guild.getPublicObjective": Object.freeze({
    access: API_ACCESS_.PUBLIC,
    handler: handleGuildGetPublicObjective_,
  }),

  "guild.getAdminState": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handleGuildGetAdminState_,
  }),

  "guild.getAdminObjective": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handleGuildGetAdminObjective_,
  }),

  "guild.setCurrentObjective": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handleGuildSetCurrentObjective_,
  }),

  "guild.syncNow": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handleGuildSyncNow_,
  }),

  "guild.getSyncStatus": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handleGuildGetSyncStatus_,
  }),

  "skills.getAdminCatalog": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handleSkillsGetAdminCatalog_,
  }),

  "skills.getUnlinkedApiSkills": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handleSkillsGetUnlinkedApiSkills_,
  }),

  "skills.linkApiSkill": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handleSkillsLinkApiSkill_,
  }),

  "skills.getAdminProgression": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handleSkillsGetAdminProgression_,
  }),

  "skills.getPublicProgression": Object.freeze({
    access: API_ACCESS_.PUBLIC,
    handler: handleSkillsGetPublicProgression_,
  }),

  "skills.createCatalogSkill": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handleSkillsCreateCatalogSkill_,
  }),

  "skills.updateCatalogSkill": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handleSkillsUpdateCatalogSkill_,
  }),

  "podex.getPublicCatalog": Object.freeze({
    access: API_ACCESS_.PUBLIC,
    handler: handlePodexGetPublicCatalog_,
  }),

  "podex.getAdminCatalog": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handlePodexGetAdminCatalog_,
  }),

  "podex.createCategory": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handlePodexCreateCategory_,
  }),

  "podex.updateCategory": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handlePodexUpdateCategory_,
  }),

  "podex.createSubcategory": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handlePodexCreateSubcategory_,
  }),

  "podex.updateSubcategory": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handlePodexUpdateSubcategory_,
  }),

  "podex.createRarity": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handlePodexCreateRarity_,
  }),

  "podex.updateRarity": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handlePodexUpdateRarity_,
  }),

  "podex.createItem": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handlePodexCreateItem_,
  }),

  "podex.updateItem": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handlePodexUpdateItem_,
  }),

  "podex.saveLevelRequirements": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handlePodexSaveLevelRequirements_,
  }),

  "podex.deleteCategory": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handlePodexDeleteCategory_,
  }),

  "podex.deleteSubcategory": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handlePodexDeleteSubcategory_,
  }),

  "podex.deleteRarity": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handlePodexDeleteRarity_,
  }),

  "podex.deleteItem": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handlePodexDeleteItem_,
  }),

  "podex.createImportTemplate": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handlePodexCreateImportTemplate_,
  }),

  "podex.previewImport": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handlePodexPreviewImport_,
  }),

  "podex.applyImport": Object.freeze({
    access: API_ACCESS_.ADMIN,
    handler: handlePodexApplyImport_,
  }),
});

function apiRequest(request) {
  let requestId = getRequestIdForResponse_(request);

  let action = getActionForDiagnostic_(request);

  try {
    const validatedRequest = validateApiRequest_(request);

    requestId = validatedRequest.requestId;

    action = validatedRequest.action;

    if (!Object.prototype.hasOwnProperty.call(API_ACTIONS_, action)) {
      throw createControlledError_(
        ERROR_CODES.UNKNOWN_ACTION,
        "A operação solicitada não está disponível.",
        null,
      );
    }

    const actionDefinition = API_ACTIONS_[action];

    const authorization = authorizeApiAction_(
      actionDefinition,
      validatedRequest,
    );

    const data = actionDefinition.handler(
      validatedRequest.payload,
      validatedRequest,
      authorization,
    );

    return serializeApiResponse_({
      ok: true,
      data: data === undefined ? null : data,
    });
  } catch (error) {
    if (isControlledError_(error)) {
      return serializeApiResponse_(
        buildErrorResponse_(error.code, error.message, error.fields, requestId),
      );
    }

    logUnexpectedApiError_(requestId, action, error);

    return serializeApiResponse_(
      buildErrorResponse_(
        ERROR_CODES.INTERNAL_ERROR,
        "Não foi possível concluir a solicitação. Tente novamente.",
        null,
        requestId,
      ),
    );
  }
}

function serializeApiResponse_(response) {
  return JSON.stringify(response);
}

function validateApiRequest_(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throwInvalidRequest_();
  }

  if (typeof request.action !== "string" || request.action.trim() === "") {
    throwInvalidRequest_();
  }

  if (
    !request.payload ||
    typeof request.payload !== "object" ||
    Array.isArray(request.payload)
  ) {
    throwInvalidRequest_();
  }

  if (typeof request.requestId !== "string" || !isUuid_(request.requestId)) {
    throwInvalidRequest_();
  }

  if (
    request.sessionToken !== null &&
    typeof request.sessionToken !== "string"
  ) {
    throwInvalidRequest_();
  }

  return {
    action: request.action.trim(),
    payload: request.payload,
    requestId: request.requestId,
    sessionToken: request.sessionToken,
  };
}

function throwInvalidRequest_() {
  throw createControlledError_(
    ERROR_CODES.INVALID_REQUEST,
    "A solicitação enviada é inválida.",
    null,
  );
}

function getRequestIdForResponse_(request) {
  if (
    request &&
    typeof request === "object" &&
    typeof request.requestId === "string" &&
    isUuid_(request.requestId)
  ) {
    return request.requestId;
  }

  return generateUuid_();
}

function getActionForDiagnostic_(request) {
  if (
    request &&
    typeof request === "object" &&
    typeof request.action === "string"
  ) {
    return request.action;
  }

  return "unknown";
}

function authorizeApiAction_(actionDefinition, request) {
  if (!actionDefinition || typeof actionDefinition !== "object") {
    throw new Error("Definição de action inválida.");
  }

  if (actionDefinition.access === API_ACCESS_.PUBLIC) {
    return null;
  }

  if (actionDefinition.access === API_ACCESS_.ADMIN) {
    const session = validateAdminSessionToken_(request.sessionToken);

    if (session === null) {
      throw createControlledError_(
        ERROR_CODES.AUTH_REQUIRED,
        "Sua sessão administrativa não é válida. Entre novamente.",
        null,
      );
    }

    return session;
  }

  throw new Error("Política de acesso da action inválida.");
}

function handleAppBootstrap_() {
  return getPublicAppConfig_();
}

function handleAuthLogin_(payload) {
  validateAllowedProperties_(payload, "payload", ["password"]);

  const password = validateString_(payload.password, "password", {
    trim: false,
    minLength: 1,
    maxLength: 512,
  });

  const session = loginAdmin_(password);

  if (session === null) {
    throw createControlledError_(
      ERROR_CODES.FORBIDDEN,
      "Não foi possível autenticar com a credencial informada.",
      null,
    );
  }

  return session;
}

function handleAuthSession_(payload, request, authorization) {
  validateAllowedProperties_(payload, "payload", []);

  if (!authorization || authorization.authenticated !== true) {
    throw new Error("Contexto de autorização administrativa ausente.");
  }

  return authorization;
}

function handleAuthLogout_(payload, request) {
  validateAllowedProperties_(payload, "payload", []);

  invalidateAdminSession_(request.sessionToken);

  return null;
}

function handleAuthChangePassword_(payload) {
  validateAllowedProperties_(payload, "payload", ["newPassword"]);

  const newPassword = validateString_(payload.newPassword, "newPassword", {
    trim: false,
    minLength: 8,
    maxLength: 512,
  });

  changeAdminPassword_(newPassword);
  return null;
}

function handleMembersList_(payload) {
  validateAllowedProperties_(payload, "payload", []);

  return listMembers_();
}

function handleMembersSetTargetRequired_(payload) {
  validateAllowedProperties_(payload, "payload", ["memberId", "targetRequired"]);
  validateBoolean_(payload.targetRequired, "targetRequired");
  return updateMemberDetails_(payload);
}

function handleContributionsGetCurrentWeek_(
  payload
) {
  validateAllowedProperties_(
    payload,
    'payload',
    []
  );

  return getCurrentContributionWeek_();
}

function handleContributionsGetTaskOverview_(payload) {
  validateAllowedProperties_(payload, "payload", []);
  return getAdminTaskOverview_();
}

function handleContributionsSetDailyTarget_(payload) {
  validateAllowedProperties_(payload, "payload", ["dailyTarget"]);
  const dailyTarget = validateNonNegativeInteger_(payload.dailyTarget, "dailyTarget");
  return setDailyTarget_(dailyTarget);
}

function handleContributionsGetPublicRanking_(payload) {
  validateAllowedProperties_(payload, "payload", []);

  return getPublicContributionRanking_();
}

function handleGuildGetPublicState_(payload) {
  validateAllowedProperties_(payload, "payload", []);
  return getPublicGuildState_();
}

function handleGuildGetPublicObjective_(payload) {
  validateAllowedProperties_(payload, "payload", []);
  return getPublicGuildObjective_();
}

function handleGuildGetAdminState_(payload) {
  validateAllowedProperties_(payload, "payload", []);
  return getAdminGuildState_();
}

function handleGuildGetAdminObjective_(payload) {
  validateAllowedProperties_(payload, "payload", []);
  return getAdminGuildObjective_();
}

function handleGuildSetCurrentObjective_(payload) {
  return setCurrentGuildObjective_(payload);
}

function handleGuildSyncNow_(payload) {
  validateAllowedProperties_(payload, "payload", []);

  const result = runGuildApiSync_();

  if (!result.ok) {
    throw createControlledError_(
      ERROR_CODES.INTERNAL_ERROR,
      result.reason || "Falha ao sincronizar com a API da guild.",
      null,
    );
  }

  return result;
}

function handleGuildGetSyncStatus_(payload) {
  validateAllowedProperties_(payload, "payload", []);
  return getLastGuildApiSyncStatus_();
}

function handleSkillsGetAdminCatalog_(payload) {
  validateAllowedProperties_(payload, "payload", []);
  return getAdminSkillCatalog_();
}

function handleSkillsGetUnlinkedApiSkills_(payload) {
  validateAllowedProperties_(payload, "payload", []);
  return getAdminUnlinkedApiSkills_();
}

function handleSkillsLinkApiSkill_(payload) {
  return linkCatalogSkillToApi_(payload);
}

function handleSkillsGetAdminProgression_(payload) {
  validateAllowedProperties_(payload, "payload", []);
  return getAdminSkillProgression_();
}

function handleSkillsGetPublicProgression_(payload) {
  validateAllowedProperties_(payload, "payload", []);
  return getPublicSkillProgression_();
}

function handleSkillsCreateCatalogSkill_(payload) {
  return createCatalogSkill_(payload);
}

function handleSkillsUpdateCatalogSkill_(payload) {
  return updateCatalogSkill_(payload);
}

function handlePodexGetPublicCatalog_(payload) {
  validateAllowedProperties_(payload, 'payload', []);
  return getPublicPodexCatalog_();
}

function handlePodexGetAdminCatalog_(payload) {
  validateAllowedProperties_(payload, 'payload', []);
  return getAdminPodexCatalog_();
}

function handlePodexCreateCategory_(payload) {
  return createPodexCategory_(payload);
}

function handlePodexUpdateCategory_(payload) {
  return updatePodexCategory_(payload);
}

function handlePodexCreateSubcategory_(payload) {
  return createPodexSubcategory_(payload);
}

function handlePodexUpdateSubcategory_(payload) {
  return updatePodexSubcategory_(payload);
}

function handlePodexCreateRarity_(payload) {
  return createPodexRarity_(payload);
}

function handlePodexUpdateRarity_(payload) {
  return updatePodexRarity_(payload);
}

function handlePodexCreateItem_(payload) {
  return createPodexItem_(payload);
}

function handlePodexUpdateItem_(payload) {
  return updatePodexItem_(payload);
}

function handlePodexSaveLevelRequirements_(payload) {
  return saveLevelRequirements_(payload);
}

function handlePodexDeleteCategory_(payload) {
  return deletePodexCategory_(payload);
}

function handlePodexDeleteSubcategory_(payload) {
  return deletePodexSubcategory_(payload);
}

function handlePodexDeleteRarity_(payload) {
  return deletePodexRarity_(payload);
}

function handlePodexDeleteItem_(payload) {
  return deletePodexItem_(payload);
}

function handlePodexCreateImportTemplate_(payload) {
  return createPodexImportTemplate_(payload);
}

function handlePodexPreviewImport_(payload) {
  return previewPodexImport_(payload);
}

function handlePodexApplyImport_(payload) {
  return applyPodexImport_(payload);
}

function logUnexpectedApiError_(requestId, action, error) {
  const errorName =
    error && typeof error.name === "string" ? error.name : "Error";

  const errorMessage =
    error && typeof error.message === "string"
      ? error.message
      : "Erro sem mensagem.";

  const errorStack =
    error && typeof error.stack === "string"
      ? error.stack
      : "Stack indisponível.";

  console.error(
    "[apiRequest] Unexpected error. requestId=%s action=%s name=%s message=%s stack=%s",
    requestId,
    action,
    errorName,
    errorMessage,
    errorStack,
  );
}
