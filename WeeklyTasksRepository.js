function findAllWeeklyTasks_() {
  return readDatabaseTable_("WeeklyTasks").map(normalizeWeeklyTaskFromStorage_);
}

function findWeeklyTasksByWeekKey_(weekKey) {
  const normalizedWeekKey = validateGameWeekKey_(weekKey, "weekKey");

  return readDatabaseTable_("WeeklyTasks")
    .map(normalizeWeeklyTaskFromStorage_)
    .filter(function (task) {
      return task.weekKey === normalizedWeekKey;
    });
}

function insertWeeklyTasks_(tasks) {
  if (!Array.isArray(tasks)) {
    throw new Error("Lote de WeeklyTasks inválido.");
  }

  tasks.forEach(validateWeeklyTaskRepositoryRecord_);

  if (tasks.length === 0) {
    return 0;
  }

  return insertDatabaseRecords_("WeeklyTasks", tasks, {
    uniqueKeyFields: ["weekKey", "memberId"],
  });
}

function updateWeeklyTasks_(tasks) {
  if (!Array.isArray(tasks)) {
    throw new Error("Lote de WeeklyTasks inválido.");
  }

  tasks.forEach(validateWeeklyTaskRepositoryRecord_);

  if (tasks.length === 0) {
    return 0;
  }

  const updates = tasks.map(function (task) {
    return { primaryKeyValue: task.weeklyTaskId, record: task };
  });

  return updateDatabaseRecordsByPrimaryKey_("WeeklyTasks", updates, {
    uniqueKeyFields: ["weekKey", "memberId"],
  });
}

function validateWeeklyTaskRepositoryRecord_(task) {
  validateObject_(task, "weeklyTask");
  validateUuid_(task.weeklyTaskId, "weeklyTaskId");
  validateUuid_(task.memberId, "memberId");
  databaseObjectToRow_("WeeklyTasks", task);
  return task;
}

function normalizeWeeklyTaskFromStorage_(record) {
  if (!isObject_(record)) {
    throw new Error("Registro de WeeklyTask inválido.");
  }

  return Object.assign({}, record);
}
