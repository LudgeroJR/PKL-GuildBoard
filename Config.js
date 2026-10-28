const APP_NAME = "PKL GuildBoard";
const APP_FULL_NAME = "PKL GuildBoard";
const APP_VERSION = "1.0.0";

const DEFAULT_TIMEZONE = "America/Sao_Paulo";
const DAILY_RESET_HOUR = 7;
const WEEKLY_RESET_DAY = "MONDAY";

const GUILD_LOGO_URL_PROPERTY = "GUILD_LOGO_URL";
const GUILD_NAME_PROPERTY = "GUILD_NAME";

const POKE_LEGENDS_LOGO_URL = "https://imgur.com/dOgObo9";

const SPREADSHEET_ID_PROPERTY = "SPREADSHEET_ID";
const ADMIN_PASSWORD_HASH_PROPERTY = "ADMIN_PASSWORD_HASH";
const SESSION_SECRET_PROPERTY = "SESSION_SECRET";
const SESSION_DURATION_HOURS_PROPERTY = "SESSION_DURATION_HOURS";
const GUILD_API_URL_PROPERTY = "GUILD_API_URL";

const SESSION_DURATION_HOURS_CONTRACT = 6;

function getPublicAppConfig_() {
  return {
    appName: APP_NAME,
    appFullName: APP_FULL_NAME,
    version: APP_VERSION,
    timezone: DEFAULT_TIMEZONE,
    guildName: getOptionalGuildName_(),
    guildLogoUrl: getOptionalGuildLogoUrl_(),
    pokeLegendsLogoUrl: normalizeImgurUrl_(POKE_LEGENDS_LOGO_URL),
  };
}

function getOptionalGuildName_() {
  const value =
    PropertiesService.getScriptProperties().getProperty(GUILD_NAME_PROPERTY);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : "";
}

function getOptionalGuildLogoUrl_() {
  const value = PropertiesService.getScriptProperties().getProperty(
    GUILD_LOGO_URL_PROPERTY,
  );
  if (typeof value !== "string" || value.trim() === "") return "";
  return normalizeImgurUrl_(value.trim());
}

/**
 * Converte URLs de página do Imgur para URLs diretas de imagem.
 * Aceita tanto https://imgur.com/ID quanto https://i.imgur.com/ID.ext (sem modificar).
 */
function normalizeImgurUrl_(url) {
  if (typeof url !== "string" || url.trim() === "") return url;
  const trimmed = url.trim();
  // https://imgur.com/ID → https://i.imgur.com/ID.png (ignora álbuns /a/ID)
  const match = trimmed.match(/^https?:\/\/(?:www\.)?imgur\.com\/([A-Za-z0-9]+)\/?$/);
  if (match) {
    return "https://i.imgur.com/" + match[1] + ".png";
  }
  return trimmed;
}

function getRequiredScriptProperty_(propertyName) {
  if (typeof propertyName !== "string" || propertyName.trim() === "") {
    throw new Error("Nome de Script Property inválido.");
  }

  const normalizedName = propertyName.trim();

  const value =
    PropertiesService.getScriptProperties().getProperty(normalizedName);

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Configuração ausente: Script Property ${normalizedName}.`);
  }

  return value.trim();
}

function getSpreadsheetId_() {
  return getRequiredScriptProperty_(SPREADSHEET_ID_PROPERTY);
}

function getGuildApiUrl_() {
  return getRequiredScriptProperty_(GUILD_API_URL_PROPERTY);
}

function getAdminPasswordHash_() {
  const passwordHash = getRequiredScriptProperty_(ADMIN_PASSWORD_HASH_PROPERTY);

  if (!/^[A-Za-z0-9_-]{43}$/.test(passwordHash)) {
    throw new Error("Configuração de segurança inválida: ADMIN_PASSWORD_HASH.");
  }

  return passwordHash;
}

function getSessionSecret_() {
  const sessionSecret = getRequiredScriptProperty_(SESSION_SECRET_PROPERTY);

  if (!/^[A-Za-z0-9_-]{43,}$/.test(sessionSecret)) {
    throw new Error("Configuração de segurança inválida: SESSION_SECRET.");
  }

  return sessionSecret;
}

function getSessionDurationHours_() {
  const rawDuration = getRequiredScriptProperty_(
    SESSION_DURATION_HOURS_PROPERTY,
  );

  if (!/^\d+$/.test(rawDuration)) {
    throw new Error(
      "Configuração de segurança inválida: SESSION_DURATION_HOURS.",
    );
  }

  const durationHours = Number(rawDuration);

  if (
    !Number.isInteger(durationHours) ||
    durationHours !== SESSION_DURATION_HOURS_CONTRACT
  ) {
    throw new Error(
      "SESSION_DURATION_HOURS não corresponde ao contrato de segurança.",
    );
  }

  return durationHours;
}

function getDailyTarget_() {
  const dailyTarget = getDatabaseConfigValue_("DAILY_TARGET");

  return validateNonNegativeInteger_(dailyTarget, "DAILY_TARGET");
}

function setDailyTarget_(dailyTarget) {
  const normalizedTarget = validateNonNegativeInteger_(
    dailyTarget,
    "dailyTarget",
  );
  setDatabaseConfigNumber_("DAILY_TARGET", normalizedTarget);
  return { dailyTarget: getDailyTarget_() };
}

const PODEX_DATA_MODE_PROPERTY = "PODEX_DATA_MODE";

function getPodexDataMode_() {
  const value = PropertiesService.getScriptProperties().getProperty(
    PODEX_DATA_MODE_PROPERTY,
  );

  if (value === null || value === undefined || value.trim() === "") {
    return "HOMOLOG";
  }

  const trimmed = value.trim();

  if (trimmed === "HOMOLOG" || trimmed === "CANONICAL") {
    return trimmed;
  }

  throw new Error(
    "Configuração inválida: PODEX_DATA_MODE deve ser HOMOLOG ou CANONICAL, obtido: " +
      trimmed,
  );
}
