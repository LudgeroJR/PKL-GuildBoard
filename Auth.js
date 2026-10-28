const AUTH_SESSION_CACHE_PREFIX_ = "pkl:admin-session:";

const AUTH_MILLISECONDS_PER_HOUR_ = 60 * 60 * 1000;

const AUTH_SECONDS_PER_HOUR_ = 60 * 60;

function hashAdminPassword_(password) {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("Credencial administrativa inválida.");
  }

  return computeAuthHmacBase64Url_(password, getSessionSecret_());
}

function verifyAdminPassword_(password) {
  const expectedHash = getAdminPasswordHash_();
  const candidateHash = hashAdminPassword_(password);

  return constantTimeStringEquals_(expectedHash, candidateHash);
}

function loginAdmin_(password) {
  if (!verifyAdminPassword_(password)) {
    return null;
  }

  return createAdminSession_();
}

function changeAdminPassword_(newPassword) {
  const passwordHash = hashAdminPassword_(newPassword);
  PropertiesService.getScriptProperties().setProperty(
    ADMIN_PASSWORD_HASH_PROPERTY,
    passwordHash,
  );
}

/**
 * Executar no editor do Apps Script durante a instalação para definir (ou redefinir) a senha de admin.
 * Exemplo: setupAdminPassword("minhasenha")
 */
function setupAdminPassword(password) {
  return resetAdminPasswordForSetup_(password);
}

/* Executar manualmente pelo proprietário do script para inicializar uma cópia. */
function resetAdminPasswordForSetup_(newPassword) {
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    throw new Error("A senha inicial deve possuir pelo menos 8 caracteres.");
  }

  ensureSecurityPropertiesForSetup_();
  changeAdminPassword_(newPassword);
  return "Senha administrativa inicializada.";
}

function ensureSecurityPropertiesForSetup_() {
  const properties = PropertiesService.getScriptProperties();
  const currentSecret = properties.getProperty(SESSION_SECRET_PROPERTY);

  if (typeof currentSecret !== "string" || !/^[A-Za-z0-9_-]{43,}$/.test(currentSecret.trim())) {
    const material = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      Utilities.getUuid() + String(Date.now()),
    );
    properties.setProperty(
      SESSION_SECRET_PROPERTY,
      Utilities.base64EncodeWebSafe(material).replace(/=+$/g, ""),
    );
  }

  properties.setProperty(
    SESSION_DURATION_HOURS_PROPERTY,
    String(SESSION_DURATION_HOURS_CONTRACT),
  );
}

function createAdminSession_() {
  const durationHours = getSessionDurationHours_();

  const durationMilliseconds = durationHours * AUTH_MILLISECONDS_PER_HOUR_;

  const durationSeconds = durationHours * AUTH_SECONDS_PER_HOUR_;

  const createdAt = Date.now();
  const expiresAt = createdAt + durationMilliseconds;

  const sessionToken = generateAdminSessionToken_();

  const cacheKey = getAdminSessionCacheKey_(sessionToken);

  const sessionRecord = {
    createdAt: createdAt,
    expiresAt: expiresAt,
  };

  CacheService.getScriptCache().put(
    cacheKey,
    JSON.stringify(sessionRecord),
    durationSeconds,
  );

  return {
    sessionToken: sessionToken,
    expiresAt: formatDateToApiIso_(new Date(expiresAt)),
  };
}

function validateAdminSessionToken_(
  sessionToken
) {
  if (
    typeof sessionToken !== 'string' ||
    sessionToken.trim() === ''
  ) {
    return null;
  }

  const normalizedToken =
    sessionToken.trim();

  const cacheKey =
    getAdminSessionCacheKey_(
      normalizedToken
    );

  const cache =
    CacheService.getScriptCache();

  const cachedValue =
    cache.get(cacheKey);

  if (cachedValue === null) {
    return null;
  }

  const sessionRecord =
    parseAdminSessionRecord_(
      cachedValue
    );

  if (sessionRecord === null) {
    cache.remove(cacheKey);
    return null;
  }

  if (
    isAdminSessionExpired_(
      sessionRecord.expiresAt,
      Date.now()
    )
  ) {
    cache.remove(cacheKey);
    return null;
  }

  return {
    authenticated: true,
    expiresAt: formatDateToApiIso_(
      new Date(
        sessionRecord.expiresAt
      )
    )
  };
}

function invalidateAdminSession_(sessionToken) {
  if (typeof sessionToken !== "string" || sessionToken.trim() === "") {
    return;
  }

  const cacheKey = getAdminSessionCacheKey_(sessionToken.trim());

  CacheService.getScriptCache().remove(cacheKey);
}

function generateAdminSessionToken_() {
  const randomMaterial = [
    generateUuid_(),
    generateUuid_(),
    generateUuid_(),
  ].join(":");

  return computeAuthHmacBase64Url_(randomMaterial, getSessionSecret_());
}

function getAdminSessionCacheKey_(sessionToken) {
  if (typeof sessionToken !== "string" || sessionToken.trim() === "") {
    throw new Error("Token de sessão inválido.");
  }

  const tokenDigest = computeAuthHmacBase64Url_(
    sessionToken.trim(),
    getSessionSecret_(),
  );

  return AUTH_SESSION_CACHE_PREFIX_ + tokenDigest;
}

function parseAdminSessionRecord_(serializedRecord) {
  if (typeof serializedRecord !== "string") {
    return null;
  }

  let record;

  try {
    record = JSON.parse(serializedRecord);
  } catch (error) {
    return null;
  }

  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }

  if (
    !Number.isFinite(record.createdAt) ||
    !Number.isFinite(record.expiresAt)
  ) {
    return null;
  }

  if (record.createdAt <= 0 || record.expiresAt <= record.createdAt) {
    return null;
  }

  return {
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}

function isAdminSessionExpired_(expiresAt, now) {
  if (!Number.isFinite(expiresAt) || !Number.isFinite(now)) {
    throw new Error("Data de expiração da sessão inválida.");
  }

  return now >= expiresAt;
}

function computeAuthHmacBase64Url_(value, secret) {
  if (typeof value !== "string" || typeof secret !== "string") {
    throw new Error("Entrada criptográfica inválida.");
  }

  const signature = Utilities.computeHmacSha256Signature(
    value,
    secret,
    Utilities.Charset.UTF_8,
  );

  return Utilities.base64EncodeWebSafe(signature).replace(/=+$/g, "");
}

function constantTimeStringEquals_(left, right) {
  if (typeof left !== "string" || typeof right !== "string") {
    return false;
  }

  const maxLength = Math.max(left.length, right.length);

  let difference = left.length ^ right.length;

  for (let index = 0; index < maxLength; index += 1) {
    const leftCode = index < left.length ? left.charCodeAt(index) : 0;

    const rightCode = index < right.length ? right.charCodeAt(index) : 0;

    difference |= leftCode ^ rightCode;
  }

  return difference === 0;
}
