function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('PKL Tools')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function includeFile_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// --- Trigger handlers (called by GAS time-based triggers) ---

function runTimeDrivenGuildSync() {
  runGuildApiSync_();
}

function runDailyGuildSync() {
  // Captura o diário disponível na API antes do reset das 07:00.
  // A execução é aproximada; a API pode estar atrasada e não oferece backfill.
  runGuildApiSync_();
}

// --- Trigger setup (run once from Apps Script editor or admin console) ---

function inspectGuildSyncTriggers_() {
  const handlers = ScriptApp.getProjectTriggers()
    .map(function (trigger) { return trigger.getHandlerFunction(); })
    .filter(function (name) {
      return name === "runTimeDrivenGuildSync" || name === "runDailyGuildSync";
    });
  console.log("[Guild sync triggers] %s", JSON.stringify(handlers));
  return handlers;
}

function installGuildSyncTriggers() {
  return installGuildSyncTriggersWithScriptApp_(ScriptApp);
}

function installGuildSyncTriggersWithScriptApp_(scriptApp) {
  scriptApp.getProjectTriggers().forEach(function (trigger) {
    var fn = trigger.getHandlerFunction();

    if (fn === "runTimeDrivenGuildSync" || fn === "runDailyGuildSync") {
      scriptApp.deleteTrigger(trigger);
    }
  });

  scriptApp.newTrigger("runTimeDrivenGuildSync")
    .timeBased()
    .everyMinutes(30)
    .create();

  scriptApp.newTrigger("runDailyGuildSync")
    .timeBased()
    .atHour(6)
    .nearMinute(35)
    .everyDays(1)
    .inTimezone(DEFAULT_TIMEZONE)
    .create();

  console.log("[installGuildSyncTriggers] Triggers instalados com sucesso.");
  return scriptApp.getProjectTriggers().map(function (trigger) {
    return trigger.getHandlerFunction();
  }).filter(function (name) {
    return name === "runTimeDrivenGuildSync" || name === "runDailyGuildSync";
  });
}
