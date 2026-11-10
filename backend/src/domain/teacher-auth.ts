import type { AppConfig } from '../config.js';

/** Verifies the exact password for this request; authorization is stored by the live connection handler. */
export function isTeacherPasswordValid(config: AppConfig, submittedPassword: string): boolean {
  if (!config.teacherLoginEnabled || config.teacherPassword === null) return false;
  if (submittedPassword.trim().length === 0) return false;
  return submittedPassword === config.teacherPassword;
}
