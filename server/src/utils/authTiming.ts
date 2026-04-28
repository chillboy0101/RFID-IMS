export const EMAIL_VERIFICATION_EXPIRES_MINUTES = 45;
export const PASSWORD_RESET_EXPIRES_MINUTES = 15;
export const LOGIN_ALERT_EXPIRES_MINUTES = 20;
export const ACCOUNT_RECOVERY_OTP_MINUTES = 10;

export function formatMinutesLabel(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
