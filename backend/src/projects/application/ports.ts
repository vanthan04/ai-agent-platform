export const PROJECT_REPOSITORY = Symbol("PROJECT_REPOSITORY");
export const PROJECT_POLICY_REPOSITORY = Symbol("PROJECT_POLICY_REPOSITORY");

/** Time comes through a port so a test can fix it. */
export interface Clock {
  now(): string;
}
export const CLOCK = Symbol("CLOCK");
