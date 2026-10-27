export class ActionError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ActionError';
    this.code = code; // NOT_FOUND | INVALID_STATE | VALIDATION | CONFLICT | POLICY | UNSUPPORTED
    this.details = details;
  }
  toJSON() {
    return { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) };
  }
}

export const fail = {
  notFound: (type, id) => new ActionError('NOT_FOUND', `${type} ${id} was not found`, { type, id }),
  state: (msg, details) => new ActionError('INVALID_STATE', msg, details),
  validation: (msg, details) => new ActionError('VALIDATION', msg, details),
  conflict: (msg, details) => new ActionError('CONFLICT', msg, details),
  policy: (msg, details) => new ActionError('POLICY', msg, details),
};
