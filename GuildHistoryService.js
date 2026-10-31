const GUILD_HISTORY_RETENTION_DAYS_ = 90;
const GUILD_HISTORY_ALLOWED_RANGES_ = Object.freeze([7, 15, 30, 90]);

function buildGuildHistoryUpsertRecord_(input) {
  validateObject_(input, "guildHistoryInput");
  validateAllowedProperties_(input, "guildHistoryInput", [
    "gameDayKey", "xpTotal", "totalContributed", "existing", "previous", "now", "historyId",
  ]);
  const gameDayKey = validateGameDayKey_(input.gameDayKey, "gameDayKey");
  const xpTotal = validateNonNegativeInteger_(input.xpTotal, "xpTotal");
  const totalContributed = validateNonNegativeInteger_(input.totalContributed, "totalContributed");
  const existing = input.existing || null;
  const previous = input.previous || null;
  const now = input.now || new Date();
  assertValidDate_(now);
  const previousXp = previous === null ? null : previous.xpTotal;
  const xpRegressed = previousXp !== null && xpTotal < previousXp;
  const effectiveXp = xpRegressed ? previousXp : xpTotal;
  const baseline = previous === null;
  const previousGold = previous === null ? 0 : previous.totalContributed;
  const xpDelta = baseline || xpRegressed ? null : effectiveXp - previousXp;
  const goldDelta = baseline ? null : totalContributed >= previousGold
    ? totalContributed - previousGold : totalContributed;

  return {
    record: {
      historyId: existing ? existing.historyId : (input.historyId || generateUuid_()),
      gameDayKey: gameDayKey,
      xpTotal: existing && existing.xpTotal > effectiveXp ? existing.xpTotal : effectiveXp,
      totalContributed: totalContributed,
      xpDelta: existing && existing.xpDelta !== null && xpRegressed ? existing.xpDelta : xpDelta,
      goldDelta: existing && existing.goldDelta !== null ? existing.goldDelta : goldDelta,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    },
    xpRegressed: xpRegressed,
  };
}

function retainGuildHistoryRecords_(records, limit) {
  if (!Array.isArray(records) || !Number.isInteger(limit) || limit < 1) {
    throw new Error("Parâmetros de retenção do histórico inválidos.");
  }
  return records.slice().sort(function (a, b) {
    return a.gameDayKey.localeCompare(b.gameDayKey);
  }).slice(-limit);
}

function syncGuildHistoryFromGuildApi_(apiData) {
  validateObject_(apiData, "apiData");
  const guild = normalizeGuildApiGuildState_(apiData.guild);
  const week = normalizeGuildApiContributionWeek_(apiData.semana);
  validateGuildApiContributionLoja_(apiData.loja, week.weekLabel);
  const totalContributed = apiData.placarSemanal.map(normalizeGuildApiContributionDonationEntry_)
    .filter(function (entry) { return entry.isMember && entry.weekLabel === week.weekLabel; })
    .reduce(function (total, entry) { return total + entry.amount; }, 0);
  if (!Number.isSafeInteger(totalContributed)) throw new Error("Arrecadação semanal excede o limite seguro.");

  const gameDayKey = getCurrentGameDayKey_();
  const now = new Date();
  const all = findAllGuildHistory_().sort(function (a, b) { return a.gameDayKey.localeCompare(b.gameDayKey); });
  const existing = all.find(function (record) { return record.gameDayKey === gameDayKey; }) || null;
  const previous = all.filter(function (record) { return record.gameDayKey < gameDayKey; }).slice(-1)[0] || null;
  const built = buildGuildHistoryUpsertRecord_({
    gameDayKey: gameDayKey,
    xpTotal: guild.xpTotal,
    totalContributed: totalContributed,
    existing: existing,
    previous: previous,
    now: now,
  });
  const record = built.record;
  validateGuildHistoryRepositoryRecord_(record);

  const retained = all.filter(function (item) { return item.gameDayKey !== gameDayKey; });
  retained.push(record);
  const records = retainGuildHistoryRecords_(retained, GUILD_HISTORY_RETENTION_DAYS_);
  replaceDatabaseTables_([{sheetName: "GuildHistory", records: records, uniqueKeyFields: ["gameDayKey"]}]);
  return {gameDayKey: gameDayKey, created: existing === null, updated: existing !== null,
    retained: records.length, xpRegressed: built.xpRegressed};
}

function getPublicGuildHistory_(payload) {
  validateAllowedProperties_(payload, "payload", ["days"]);
  const days = payload.days === undefined ? 7 : validatePositiveInteger_(payload.days, "days");
  if (!GUILD_HISTORY_ALLOWED_RANGES_.includes(days)) throwValidationError_("days", "Filtro de histórico inválido.");
  const records = findAllGuildHistory_().sort(function (a, b) { return a.gameDayKey.localeCompare(b.gameDayKey); }).slice(-days);
  const deltas = records.filter(function (record) { return record.xpDelta !== null || record.goldDelta !== null; });
  return {
    days: days,
    baselineOnly: records.length > 0 && deltas.length === 0,
    records: records.map(function (record) { return {
      gameDayKey: record.gameDayKey, xpTotal: record.xpTotal, totalContributed: record.totalContributed,
      xpDelta: record.xpDelta, goldDelta: record.goldDelta,
    }; }),
  };
}
