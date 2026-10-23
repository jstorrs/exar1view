// @ts-check

/** A document or blob did not have the expected shape. The message names what and where. */
export class FormatError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'FormatError';
  }
}
