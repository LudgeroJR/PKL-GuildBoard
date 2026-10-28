const ERROR_CODES = Object.freeze({
  INVALID_REQUEST: "INVALID_REQUEST",
  UNKNOWN_ACTION: "UNKNOWN_ACTION",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
});

function createControlledError_(code, message, fields) {
  const error = new Error(message);

  error.name = "ControlledError";
  error.code = code;
  error.fields = fields === undefined ? null : fields;
  error.isControlled = true;

  return error;
}

function isControlledError_(error) {
  return Boolean(
    error && error.isControlled === true && typeof error.code === "string",
  );
}

function buildErrorResponse_(code, message, fields, requestId) {
  return {
    ok: false,
    error: {
      code: code,
      message: message,
      fields: fields === undefined ? null : fields,
      requestId: requestId,
    },
  };
}
