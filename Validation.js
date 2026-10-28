function isObject_(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUuid_(value) {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function validateObject_(value, fieldName, options) {
  const settings = options || {};

  if (value === null) {
    if (settings.nullable === true) {
      return null;
    }

    throwValidationError_(fieldName, "O valor não pode ser nulo.");
  }

  if (!isObject_(value)) {
    throwValidationError_(fieldName, "O valor deve ser um objeto.");
  }

  return value;
}

function validateString_(value, fieldName, options) {
  const settings = options || {};

  if (value === null) {
    if (settings.nullable === true) {
      return null;
    }

    throwValidationError_(fieldName, "O valor não pode ser nulo.");
  }

  if (typeof value !== "string") {
    throwValidationError_(fieldName, "O valor deve ser um texto.");
  }

  const normalized = settings.trim === false ? value : value.trim();

  if (settings.required === true && normalized.length === 0) {
    throwValidationError_(fieldName, "O valor é obrigatório.");
  }

  if (
    Number.isInteger(settings.minLength) &&
    normalized.length < settings.minLength
  ) {
    throwValidationError_(
      fieldName,
      `O valor deve possuir pelo menos ${settings.minLength} caracteres.`,
    );
  }

  if (
    Number.isInteger(settings.maxLength) &&
    normalized.length > settings.maxLength
  ) {
    throwValidationError_(
      fieldName,
      `O valor deve possuir no máximo ${settings.maxLength} caracteres.`,
    );
  }

  return normalized;
}

function validateRequiredString_(value, fieldName, minLength, maxLength) {
  return validateString_(value, fieldName, {
    required: true,
    minLength: minLength,
    maxLength: maxLength,
  });
}

function validateInteger_(value, fieldName, options) {
  const settings = options || {};

  if (value === null) {
    if (settings.nullable === true) {
      return null;
    }

    throwValidationError_(fieldName, "O valor não pode ser nulo.");
  }

  if (!Number.isInteger(value)) {
    throwValidationError_(fieldName, "O valor deve ser um número inteiro.");
  }

  if (typeof settings.min === "number" && value < settings.min) {
    throwValidationError_(
      fieldName,
      `O valor deve ser maior ou igual a ${settings.min}.`,
    );
  }

  if (typeof settings.max === "number" && value > settings.max) {
    throwValidationError_(
      fieldName,
      `O valor deve ser menor ou igual a ${settings.max}.`,
    );
  }

  return value;
}

function validateNonNegativeInteger_(value, fieldName, options) {
  const settings = Object.assign({}, options || {}, {
    min: 0,
  });

  return validateInteger_(value, fieldName, settings);
}

function validatePositiveInteger_(value, fieldName, options) {
  const settings = Object.assign({}, options || {}, {
    min: 1,
  });

  return validateInteger_(value, fieldName, settings);
}

function validateSafeInteger_(value, fieldName, options) {
  const validated = validateInteger_(value, fieldName, options);

  if (validated !== null && !Number.isSafeInteger(validated)) {
    throwValidationError_(
      fieldName,
      "O valor deve ser um número inteiro seguro.",
    );
  }

  return validated;
}

function validateBoolean_(value, fieldName, options) {
  const settings = options || {};

  if (value === null) {
    if (settings.nullable === true) {
      return null;
    }

    throwValidationError_(fieldName, "O valor não pode ser nulo.");
  }

  if (typeof value !== "boolean") {
    throwValidationError_(fieldName, "O valor deve ser booleano.");
  }

  return value;
}

function validateEnum_(value, fieldName, allowedValues, options) {
  const settings = options || {};

  if (value === null) {
    if (settings.nullable === true) {
      return null;
    }

    throwValidationError_(fieldName, "O valor não pode ser nulo.");
  }

  if (!Array.isArray(allowedValues) || allowedValues.length === 0) {
    throw new Error("validateEnum_ requer uma lista de valores permitidos.");
  }

  if (!allowedValues.includes(value)) {
    throwValidationError_(fieldName, "O valor informado não é permitido.");
  }

  return value;
}

function validateUuid_(value, fieldName, options) {
  const settings = options || {};

  if (value === null) {
    if (settings.nullable === true) {
      return null;
    }

    throwValidationError_(fieldName, "O valor não pode ser nulo.");
  }

  if (!isUuid_(value)) {
    throwValidationError_(fieldName, "O identificador informado é inválido.");
  }

  return value;
}

function validateIsoDateTime_(value, fieldName, options) {
  const settings = options || {};

  if (value === null) {
    if (settings.nullable === true) {
      return null;
    }

    throwValidationError_(fieldName, "O valor não pode ser nulo.");
  }

  if (typeof value !== "string") {
    throwValidationError_(
      fieldName,
      "A data e hora devem estar em formato ISO 8601.",
    );
  }

  const normalized = value.trim();

  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/,
  );

  if (!match || Number.isNaN(Date.parse(normalized))) {
    throwValidationError_(
      fieldName,
      "A data e hora devem usar ISO 8601 com offset explícito.",
    );
  }

  const millisecondText = (match[7] || "0").padEnd(3, "0");

  const civilDate = new Date(
    `${match[1]}-${match[2]}-${match[3]}` +
      `T${match[4]}:${match[5]}:${match[6]}` +
      `.${millisecondText}Z`,
  );

  if (
    Number.isNaN(civilDate.getTime()) ||
    civilDate.getUTCFullYear() !== Number(match[1]) ||
    civilDate.getUTCMonth() + 1 !== Number(match[2]) ||
    civilDate.getUTCDate() !== Number(match[3]) ||
    civilDate.getUTCHours() !== Number(match[4]) ||
    civilDate.getUTCMinutes() !== Number(match[5]) ||
    civilDate.getUTCSeconds() !== Number(match[6]) ||
    civilDate.getUTCMilliseconds() !== Number(millisecondText)
  ) {
    throwValidationError_(
      fieldName,
      "A data e hora informadas não existem no calendário.",
    );
  }

  return normalized;
}

function validateAllowedProperties_(value, fieldName, allowedProperties) {
  validateObject_(value, fieldName);

  if (!Array.isArray(allowedProperties)) {
    throw new Error(`Allowlist inválida para ${fieldName}.`);
  }

  const unexpectedProperties = Object.keys(value).filter(
    function (propertyName) {
      return !allowedProperties.includes(propertyName);
    },
  );

  if (unexpectedProperties.length > 0) {
    throwValidationError_(
      fieldName,
      `Propriedades não permitidas: ${unexpectedProperties.join(", ")}.`,
    );
  }

  return value;
}

function throwValidationError_(fieldName, message) {
  const fields = {};

  if (typeof fieldName === "string" && fieldName.trim() !== "") {
    fields[fieldName] = message;
  }

  throw createControlledError_(
    ERROR_CODES.VALIDATION_ERROR,
    "Verifique os dados informados.",
    Object.keys(fields).length > 0 ? fields : null,
  );
}
