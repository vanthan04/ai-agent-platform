/** Base of every error that states a broken business rule. The interface layer maps `code` to a response; the domain knows nothing about HTTP. */
export abstract class DomainError extends Error {
  abstract readonly code: string;
}
