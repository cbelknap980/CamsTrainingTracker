// export.js - Backup JSON (share sheet or download), restore, and Excel export in the Log tab layout.

import { exportAll, importAll, getSessions, getRuns } from './store.js';
import { runUpgrades } from './upgrade.js';
import { APP_VERSION, fmtDate } from './data.js';
import { epley } from './progression.js';
import { toast } from './ui.js';

async function shareOrDownload(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
      // fall through to download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  return 'downloaded';
}

export async function backupNow(settings, planVersion) {
  const data = await exportAll(APP_VERSION, planVersion);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const how = await shareOrDownload(blob, settings.backupFileName || 'CamsTrainingTracker-backup.json', 'Training tracker backup');
  if (how === 'shared') toast('Backup shared. Pick Drive > Training.');
  else if (how === 'downloaded') toast('Backup downloaded');
  return how;
}

export async function downloadBackup(settings, planVersion) {
  const data = await exportAll(APP_VERSION, planVersion);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = settings.backupFileName || 'CamsTrainingTracker-backup.json'; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  toast('Backup downloaded');
}

export function restoreFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result);
        const r = await importAll(data);
        // v1.18.1: a backup from an older version gets the one-time changes it has not had
        await runUpgrades().catch(() => null);
        resolve(r);
      } catch (e) { reject(e); }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// Excel export: Log sheet and Runs sheet in the same columns as the Excel log workbook.
export async function exportExcel(settings, plan) {
  if (typeof XLSX === 'undefined') { toast('Excel library not loaded'); return; }
  const sessions = (await getSessions()).slice().reverse();
  const runs = (await getRuns()).slice().reverse();
  const bw = settings.bodyweightLb || 0;
  const logRows = [['Date', 'Week', 'Session', 'Exercise', 'Set #', 'Weight (lb)', 'Reps', 'RPE', 'Est. 1RM (lb)', 'Notes']];
  for (const s of sessions) {
    for (const set of s.sets) {
      if (set.ramp || !set.done || set.skipped) continue;
      const ex = plan.exercises[set.exerciseId];
      const isBw = ex && ex.equipment === 'weighted_bw';
      const load = set.weight != null ? set.weight + (isBw ? bw : 0) : null;
      const e1 = load && set.reps && !set.holdSeconds ? epley(load, set.reps) : '';   // v1.18.10: to 5 lb, as the app shows it
      const notes = [set.baseline ? 'baseline top set' : '', set.retest ? 'retest' : '', set.holdSeconds ? 'seconds in Reps' : '', isBw ? `bodyweight ${bw} + added` : ''].filter(Boolean).join('; ');
      logRows.push([s.date, s.week, s.logName, set.logName || set.name, set.round || set.setIndex || '', isBw ? load : (set.weight == null ? '' : set.weight), set.reps == null ? '' : set.reps, set.rpe == null ? '' : set.rpe, e1, notes]);
    }
  }
  const runRows = [['Date', 'Week', 'Type', 'Distance (mi)', 'Time (min)', 'Pace (min/mi)', 'RPE', 'Avg HR', 'Notes']];
  for (const r of runs) {
    const pace = r.pace ? `${Math.floor(r.pace)}:${String(Math.round((r.pace - Math.floor(r.pace)) * 60)).padStart(2, '0')}` : '';
    runRows.push([r.date, r.week || '', r.type, r.distance == null ? '' : r.distance, r.minutes == null ? '' : r.minutes, pace, r.rpe == null ? '' : r.rpe, r.hr == null ? '' : r.hr, r.notes || '']);
  }
  const changeRows = [['Date', 'Week', 'Session', 'Exercise', 'What changed']];
  for (const s of sessions) for (const l of s.whatChanged || []) changeRows.push([s.date, s.week, s.logName, l.name, l.text]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(logRows), 'Log');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(runRows), 'Runs');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(changeRows), 'What changed');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const how = await shareOrDownload(blob, settings.exportFileName || 'CamsTrainingTracker-export.xlsx', 'Training log export');
  if (how === 'shared') toast('Export shared');
  else if (how === 'downloaded') toast('Export downloaded');
  return { sessions: sessions.length, sets: logRows.length - 1, runs: runs.length, how };
}

export { fmtDate };
