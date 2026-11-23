'use strict';
const { addDays, validDate } = require('../http');

const lagosDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' });
const dayMs = 86400000;
const monthOf = date => `${date.slice(0, 7)}-01`;
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / dayMs);

function todayInLagos(now = new Date()) {
  const parts = Object.fromEntries(lagosDate.formatToParts(now).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftMonth(month, offset) {
  const date = new Date(monthOf(month));
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 10);
}

const daysInMonth = month => daysBetween(monthOf(month), shiftMonth(month, 1));
const campaignDate = (settings, today = todayInLagos()) => today > settings.campaign_end ? settings.campaign_end : today;
const dateInCampaign = (settings, date) => date >= settings.campaign_start && date <= settings.campaign_end;

function pace(today, target, actual) {
  const day = Number(today.slice(-2));
  const expected = target * day / daysInMonth(today);
  const difference = actual - Math.floor(expected);
  const state = day < 4 && actual === 0 ? 'neutral' : difference < 0 ? 'behind' : 'on_pace';
  const label = state === 'neutral' ? 'Just getting started' : difference === 0 ? 'On pace' : difference > 0 ? `Ahead by ${difference}` : `Behind by ${-difference}`;
  return { state, label, expected, difference };
}

function trend(today, target, counts) {
  const month = monthOf(today);
  const day = Number(today.slice(-2));
  const days = daysInMonth(month);
  const daily = new Map();
  for (const row of counts) {
    const index = Math.max(1, daysBetween(month, row.recorded_on) + 1);
    daily.set(index, (daily.get(index) || 0) + Number(row.total));
  }
  let total = 0;
  return Array.from({ length: days }, (_, index) => {
    const number = index + 1;
    total += daily.get(number) || 0;
    return { day: number, actual: number <= day ? total : null, expected: Math.round(100 * target * number / days) / 100 };
  });
}

function weekOf(date) {
  const weekday = new Date(date).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

function monthHistory(start, before, target, rows) {
  const totals = new Map(rows.map(row => [row.report_month, Number(row.total)]));
  const months = [];
  let streak = 0;
  const first = [monthOf(start), shiftMonth(before, -24)].sort().at(-1);
  for (let month = first; month < before; month = shiftMonth(month, 1)) {
    const total = totals.get(month) || 0;
    const met = total >= target;
    streak = met ? streak + 1 : 0;
    months.push({ month, total, target, met });
  }
  return { months, streak };
}

const dateOn = (month, day) => `${month.slice(0, 7)}-${String(day).padStart(2, '0')}`;

function reportWindow(settings, month) {
  if (!validDate(month) || month !== monthOf(month) || month < monthOf(settings.campaign_start) || month > monthOf(settings.campaign_end)) return null;
  const final = month === monthOf(settings.campaign_end);
  const monthEnd = final ? settings.campaign_end : addDays(shiftMonth(month, 1), -1);
  const opens = final ? settings.final_report_opens : [settings.campaign_start, dateOn(month, settings.report_open_day)].sort().at(-1);
  const closes = dateOn(shiftMonth(final ? opens : month, 1), settings.report_close_day);
  return { month, opens, closes, month_end: monthEnd, final };
}

function activeReportWindows(settings, today) {
  return [...new Set([monthOf(today), shiftMonth(today, -1), monthOf(settings.campaign_end)])]
    .map(month => reportWindow(settings, month))
    .filter(window => window && today >= window.opens && today <= window.closes)
    .sort((a, b) => a.opens.localeCompare(b.opens));
}

function utcToLagosDate(value) {
  return todayInLagos(new Date(`${value.replace(' ', 'T')}Z`));
}

module.exports = { todayInLagos, monthOf, shiftMonth, daysBetween, daysInMonth, campaignDate, dateInCampaign,
  pace, trend, weekOf, monthHistory, reportWindow, activeReportWindows, utcToLagosDate };
