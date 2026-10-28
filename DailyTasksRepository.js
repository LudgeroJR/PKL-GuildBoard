function findAllDailyTasks_() {
  return readDatabaseTable_("DailyTasks").map(normalizeDailyTaskFromStorage_);
}

function findDailyTasksByWeekKey_(weekKey) {
  const normalizedWeekKey = validateGameWeekKey_(weekKey, "weekKey");

  return readDatabaseTable_("DailyTasks")
    .map(normalizeDailyTaskFromStorage_)
    .filter(function (task) {
      return task.weekKey === normalizedWeekKey;
    });
}

function insertDailyTasks_(tasks) {
  if (!Array.isArray(tasks)) {
    throw new Error("Lote de DailyTasks inválido.");
  }

  tasks.forEach(validateDailyTaskRepositoryRecord_);

  if (tasks.length === 0) {
    return 0;
  }

  return insertDatabaseRecords_("DailyTasks", tasks, {
    uniqueKeyFields: ["weekKey", "memberId", "day"],
  });
}

function updateDailyTasks_(tasks) {
  if (!Array.isArray(tasks)) {
    throw new Error("Lote de DailyTasks inválido.");
  }

  tasks.forEach(validateDailyTaskRepositoryRecord_);

  if (tasks.length === 0) {
    return 0;
  }

  const updates = tasks.map(function (task) {
    return { primaryKeyValue: task.dailyTaskId, record: task };
  });

  return updateDatabaseRecordsByPrimaryKey_("DailyTasks", updates, {
    uniqueKeyFields: ["weekKey", "memberId", "day"],
  });
}

function validateDailyTaskRepositoryRecord_(task) {
  validateObject_(task, "dailyTask");
  validateUuid_(task.dailyTaskId, "dailyTaskId");
  validateUuid_(task.memberId, "memberId");
  databaseObjectToRow_("DailyTasks", task);
  return task;
}

function normalizeDailyTaskFromStorage_(record) {
  if (!isObject_(record)) {
    throw new Error("Registro de DailyTask inválido.");
  }

  return Object.assign({}, record);
}
