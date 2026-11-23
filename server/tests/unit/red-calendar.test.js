'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { todayInLagos, monthOf, daysInMonth, pace, trend, monthHistory, reportWindow, activeReportWindows } = require('../../lib/red-calendar');

test('R.E.D. days and months roll over at midnight in Lagos', () => {
  assert.equal(todayInLagos(new Date('2027-02-28T22:59:59Z')), '2027-02-28');
  assert.equal(monthOf(todayInLagos(new Date('2027-02-28T23:00:00Z'))), '2027-03-01');
  assert.equal(daysInMonth('2028-02-29'), 29);
});

test('monthly reports span the 25th to the 5th and the final report opens 22 April', () => {
  const settings = { campaign_start: '2026-11-20', campaign_end: '2027-04-22', final_report_opens: '2027-04-22', report_open_day: 25, report_close_day: 5 };
  assert.equal(reportWindow(settings, '2026-10-01'), null);
  assert.equal(reportWindow(settings, '2026-11-01').opens, '2026-11-25');
  assert.equal(reportWindow(settings, '2027-03-01').closes, '2027-04-05');
  assert.equal(activeReportWindows(settings, '2027-04-05')[0].month, '2027-03-01');
  assert.equal(activeReportWindows(settings, '2027-04-06').length, 0);
  assert.equal(activeReportWindows(settings, '2027-04-21').length, 0);
  assert.deepEqual(activeReportWindows(settings, '2027-04-22'), [
    { month: '2027-04-01', opens: '2027-04-22', closes: '2027-05-05', month_end: '2027-04-22', final: true },
  ]);
  assert.equal(activeReportWindows(settings, '2027-05-05').length, 1);
  assert.equal(activeReportWindows(settings, '2027-05-06').length, 0);
});

test('monthly history handles missed months and consecutive months at target', () => {
  const result = monthHistory('2026-11-20', '2027-03-01', 3, [
    { report_month: '2026-11-01', total: 3 }, { report_month: '2027-01-01', total: 4 }, { report_month: '2027-02-01', total: 3 },
  ]);
  assert.deepEqual(result.months.map(row => row.met), [true, false, true, true]);
  assert.equal(result.streak, 2);
});

test('pace uses the floored target and a neutral start to the month', () => {
  assert.equal(pace('2027-04-03', 3, 0).state, 'neutral');
  assert.equal(pace('2027-04-04', 3, 0).state, 'on_pace');
  assert.equal(pace('2027-04-10', 3, 0).label, 'Behind by 1');
  assert.equal(pace('2027-04-22', 3, 4).label, 'Ahead by 2');
  const points = trend('2027-04-03', 3, [{ recorded_on: '2027-03-29', total: 1 }, { recorded_on: '2027-04-03', total: 2 }]);
  assert.deepEqual(points.slice(0, 4).map(row => row.actual), [1, 1, 3, null]);
  assert.equal(points.at(-1).expected, 3);
});
