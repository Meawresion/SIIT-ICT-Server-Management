// Settings for the scheduler (FR-8.2, FR-8.4, FR-6.7; step 7). Each one has a default, so the
// scheduler always runs.
//   SCHEDULER_INTERVAL_SEC  seconds between passes (at least 30); default 300
//   EXPIRY_REMINDER_DAYS    days before the end date the student is reminded; 0 = no reminders;
//                           default 3
//   SITE_TIME_ZONE          the time zone request dates are in (an end date lasts until midnight
//                           there); default Asia/Bangkok

const DEFAULTS = { SCHEDULER_INTERVAL_SEC: '300', EXPIRY_REMINDER_DAYS: '3', SITE_TIME_ZONE: 'Asia/Bangkok' };

const validTimeZone = (zone) => {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

// -> the settings. Throws one error that lists every problem.
export function loadSchedulerConfig(source = process.env) {
  const value = (k) => String(source[k] ?? '').trim() || DEFAULTS[k];
  const problems = [];
  const intervalSec = Number(value('SCHEDULER_INTERVAL_SEC'));
  if (!Number.isInteger(intervalSec) || intervalSec < 30) problems.push('SCHEDULER_INTERVAL_SEC must be a whole number of seconds, at least 30');
  const reminderDays = Number(value('EXPIRY_REMINDER_DAYS'));
  if (!Number.isInteger(reminderDays) || reminderDays < 0 || reminderDays > 60) problems.push('EXPIRY_REMINDER_DAYS must be a whole number from 0 to 60');
  const timeZone = value('SITE_TIME_ZONE');
  if (!validTimeZone(timeZone)) problems.push('SITE_TIME_ZONE must be an IANA time zone such as Asia/Bangkok');
  if (problems.length) throw new Error(`Scheduler settings: ${problems.join('; ')}`);
  return { intervalSec, reminderDays, timeZone };
}
