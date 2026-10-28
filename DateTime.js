const MILLISECONDS_PER_MINUTE_ = 60 * 1000;
const MILLISECONDS_PER_HOUR_ = 60 * 60 * 1000;

const WEEKDAY_INDEX_ = Object.freeze({
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6
});

function getGameWeekKey_(date) {
  const shiftedDate =
    getGameCalendarShiftedDate_(date);

  const weeklyResetDay =
    getWeeklyResetDayIndex_();

  const currentWeekday =
    shiftedDate.getUTCDay();

  const daysSinceWeeklyReset =
    (
      currentWeekday -
      weeklyResetDay +
      7
    ) % 7;

  shiftedDate.setUTCDate(
    shiftedDate.getUTCDate() -
    daysSinceWeeklyReset
  );

  return formatUtcDateKey_(shiftedDate);
}

function getCurrentGameWeekKey_() {
  return getGameWeekKey_(
    new Date()
  );
}

function validateGameWeekKey_(
  weekKey,
  fieldName
) {
  const normalized =
    validateString_(
      weekKey,
      fieldName || 'weekKey',
      {
        required: true,
        minLength: 10,
        maxLength: 10
      }
    );

  const match =
    normalized.match(
      /^(\d{4})-(\d{2})-(\d{2})$/
    );

  if (!match) {
    throwValidationError_(
      fieldName || 'weekKey',
      'A semana informada é inválida.'
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const civilDate =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day
      )
    );

  if (
    civilDate.getUTCFullYear() !== year ||
    civilDate.getUTCMonth() + 1 !== month ||
    civilDate.getUTCDate() !== day
  ) {
    throwValidationError_(
      fieldName || 'weekKey',
      'A semana informada não existe no calendário.'
    );
  }

  if (
    civilDate.getUTCDay() !==
    getWeeklyResetDayIndex_()
  ) {
    throwValidationError_(
      fieldName || 'weekKey',
      'A semana do jogo deve iniciar em uma segunda-feira.'
    );
  }

  return normalized;
}

function getGameWeekStart_(weekKey) {
  const normalizedWeekKey =
    validateGameWeekKey_(
      weekKey,
      'weekKey'
    );

  const civilParts =
    parseDateKeyParts_(
      normalizedWeekKey
    );

  return createDateInTimezone_(
    {
      year: civilParts.year,
      month: civilParts.month,
      day: civilParts.day,
      hour: DAILY_RESET_HOUR,
      minute: 0,
      second: 0,
      millisecond: 0
    },
    DEFAULT_TIMEZONE
  );
}

function getGameWeekEnd_(weekKey) {
  const normalizedWeekKey =
    validateGameWeekKey_(
      weekKey,
      'weekKey'
    );

  const nextWeekKey =
    addCivilDaysToDateKey_(
      normalizedWeekKey,
      7
    );

  const nextWeekStart =
    getGameWeekStart_(
      nextWeekKey
    );

  return new Date(
    nextWeekStart.getTime() - 1
  );
}

function getNextGameDailyReset_(date) {
  assertValidDate_(date);

  const localParts =
    getDateTimePartsInTimezone_(
      date,
      DEFAULT_TIMEZONE
    );

  const resetToday =
    createDateInTimezone_(
      {
        year: localParts.year,
        month: localParts.month,
        day: localParts.day,
        hour: DAILY_RESET_HOUR,
        minute: 0,
        second: 0,
        millisecond: 0
      },
      DEFAULT_TIMEZONE
    );

  if (
    date.getTime() <
    resetToday.getTime()
  ) {
    return resetToday;
  }

  const nextCivilDate =
    addCivilDaysToParts_(
      localParts.year,
      localParts.month,
      localParts.day,
      1
    );

  return createDateInTimezone_(
    {
      year: nextCivilDate.year,
      month: nextCivilDate.month,
      day: nextCivilDate.day,
      hour: DAILY_RESET_HOUR,
      minute: 0,
      second: 0,
      millisecond: 0
    },
    DEFAULT_TIMEZONE
  );
}

function countGameDailyResetsInRange_(
  startInclusive,
  endExclusive
) {
  assertValidDate_(startInclusive);
  assertValidDate_(endExclusive);

  if (
    startInclusive.getTime() >=
    endExclusive.getTime()
  ) {
    return 0;
  }

  let cursor =
    getGameDailyResetAtOrAfter_(
      startInclusive
    );

  let count = 0;

  while (
    cursor.getTime() <
    endExclusive.getTime()
  ) {
    count += 1;

    cursor =
      getNextGameDailyReset_(
        cursor
      );
  }

  return count;
}

function getGameDailyResetAtOrAfter_(date) {
  assertValidDate_(date);

  const localParts =
    getDateTimePartsInTimezone_(
      date,
      DEFAULT_TIMEZONE
    );

  const resetToday =
    createDateInTimezone_(
      {
        year: localParts.year,
        month: localParts.month,
        day: localParts.day,
        hour: DAILY_RESET_HOUR,
        minute: 0,
        second: 0,
        millisecond: 0
      },
      DEFAULT_TIMEZONE
    );

  if (
    date.getTime() <=
    resetToday.getTime()
  ) {
    return resetToday;
  }

  return getNextGameDailyReset_(
    date
  );
}

function getGameCalendarShiftedDate_(date) {
  assertValidDate_(date);

  const parts =
    getDateTimePartsInTimezone_(
      date,
      DEFAULT_TIMEZONE
    );

  const localClockAsUtc = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      parts.millisecond
    )
  );

  return new Date(
    localClockAsUtc.getTime() -
    (
      DAILY_RESET_HOUR *
      MILLISECONDS_PER_HOUR_
    )
  );
}

function getDateTimePartsInTimezone_(
  date,
  timezone
) {
  assertValidDate_(date);

  if (
    typeof timezone !== 'string' ||
    timezone.trim() === ''
  ) {
    throw new Error(
      'Timezone inválido.'
    );
  }

  const formatted = Utilities.formatDate(
    date,
    timezone,
    "yyyy-MM-dd'T'HH:mm:ss.SSS"
  );

  const match = formatted.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/
  );

  if (!match) {
    throw new Error(
      'Não foi possível interpretar a data no timezone configurado.'
    );
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6]),
    millisecond: Number(match[7])
  };
}

function createDateInTimezone_(
  parts,
  timezone
) {
  if (
    !parts ||
    typeof parts !== 'object' ||
    Array.isArray(parts)
  ) {
    throw new Error(
      'Partes de data inválidas.'
    );
  }

  if (
    typeof timezone !== 'string' ||
    timezone.trim() === ''
  ) {
    throw new Error(
      'Timezone inválido.'
    );
  }

  const utcCivilTimestamp =
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      parts.millisecond
    );

  let timestamp =
    utcCivilTimestamp;

  for (
    let iteration = 0;
    iteration < 3;
    iteration += 1
  ) {
    const offsetMinutes =
      getTimezoneOffsetMinutes_(
        new Date(timestamp),
        timezone
      );

    const adjustedTimestamp =
      utcCivilTimestamp -
      (
        offsetMinutes *
        MILLISECONDS_PER_MINUTE_
      );

    if (
      adjustedTimestamp ===
      timestamp
    ) {
      break;
    }

    timestamp =
      adjustedTimestamp;
  }

  const result =
    new Date(timestamp);

  const actualParts =
    getDateTimePartsInTimezone_(
      result,
      timezone
    );

  if (
    actualParts.year !== parts.year ||
    actualParts.month !== parts.month ||
    actualParts.day !== parts.day ||
    actualParts.hour !== parts.hour ||
    actualParts.minute !== parts.minute ||
    actualParts.second !== parts.second ||
    actualParts.millisecond !==
      parts.millisecond
  ) {
    throw new Error(
      'Não foi possível representar a data civil no timezone configurado.'
    );
  }

  return result;
}

function getTimezoneOffsetMinutes_(
  date,
  timezone
) {
  assertValidDate_(date);

  const formattedOffset =
    Utilities.formatDate(
      date,
      timezone,
      'Z'
    );

  const match =
    formattedOffset.match(
      /^([+-])(\d{2})(\d{2})$/
    );

  if (!match) {
    throw new Error(
      'Não foi possível determinar o offset do timezone.'
    );
  }

  const sign =
    match[1] === '-' ? -1 : 1;

  return sign * (
    Number(match[2]) * 60 +
    Number(match[3])
  );
}

function parseDateKeyParts_(dateKey) {
  const match =
    dateKey.match(
      /^(\d{4})-(\d{2})-(\d{2})$/
    );

  if (!match) {
    throw new Error(
      'Date key inválida.'
    );
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

function addCivilDaysToDateKey_(
  dateKey,
  days
) {
  if (!Number.isInteger(days)) {
    throw new Error(
      'Quantidade de dias inválida.'
    );
  }

  const parts =
    parseDateKeyParts_(
      dateKey
    );

  const result =
    addCivilDaysToParts_(
      parts.year,
      parts.month,
      parts.day,
      days
    );

  return [
    String(result.year).padStart(4, '0'),
    String(result.month).padStart(2, '0'),
    String(result.day).padStart(2, '0')
  ].join('-');
}

function addCivilDaysToParts_(
  year,
  month,
  day,
  days
) {
  if (!Number.isInteger(days)) {
    throw new Error(
      'Quantidade de dias inválida.'
    );
  }

  const civilDate =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day + days
      )
    );

  return {
    year: civilDate.getUTCFullYear(),
    month: civilDate.getUTCMonth() + 1,
    day: civilDate.getUTCDate()
  };
}

function getWeeklyResetDayIndex_() {
  if (
    !Object.prototype.hasOwnProperty.call(
      WEEKDAY_INDEX_,
      WEEKLY_RESET_DAY
    )
  ) {
    throw new Error(
      `WEEKLY_RESET_DAY inválido: ${WEEKLY_RESET_DAY}.`
    );
  }

  return WEEKDAY_INDEX_[
    WEEKLY_RESET_DAY
  ];
}

function formatUtcDateKey_(date) {
  assertValidDate_(date);

  return Utilities.formatDate(
    date,
    'UTC',
    'yyyy-MM-dd'
  );
}

function formatDateToApiIso_(date) {
  assertValidDate_(date);

  const formatted = Utilities.formatDate(
    date,
    DEFAULT_TIMEZONE,
    "yyyy-MM-dd'T'HH:mm:ss.SSSZ"
  );

  return formatted.replace(
    /([+-]\d{2})(\d{2})$/,
    '$1:$2'
  );
}

function parseApiIsoDateTime_(value, fieldName) {
  const normalized =
    validateIsoDateTime_(
      value,
      fieldName || 'datetime'
    );

  const date = new Date(normalized);

  assertValidDate_(date);

  return date;
}

function assertValidDate_(date) {
  if (
    !(date instanceof Date) ||
    Number.isNaN(date.getTime())
  ) {
    throw new Error(
      'Valor Date inválido.'
    );
  }

  return date;
}