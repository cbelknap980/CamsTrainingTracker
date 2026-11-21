// notes.js - v1.19 (idea 2): a short sticky note per exercise ("seat 4, pins at 7"), typed once on the start page and
// shown each time that lift's set-up countdown starts. Saved in the kv store (store.js getExNotes / setExNote).

import { el, showModal, closeModal, toast } from './ui.js';
import { icon } from './icons.js';
import { setExNote } from './store.js';

export const NOTE_MAX = 80;

/** The note text for an exercise, or ''. notes: the object from getExNotes(). */
export function noteText(notes, exerciseId) {
  const n = notes && notes[exerciseId];
  return n && n.text ? n.text : '';
}

/** The note as a line, for the start page and the set-up screen. Nothing when there is no note. */
export function noteLine(text, cls = 'ex-note') {
  if (!text) return null;
  return el('div', { class: cls }, [icon('edit'), el('span', {}, text)]);
}

/** A sheet to type, change or clear the note. onSaved gets the new notes object. */
export function editNote(exerciseId, name, current, onSaved) {
  const input = el('input', { type: 'text', id: 'note-input', maxlength: String(NOTE_MAX), value: current || '', placeholder: 'Seat 4, pins at 7', 'aria-label': `Note for ${name}`, autocomplete: 'off' });
  const left = el('div', { class: 'note-count muted' }, `${NOTE_MAX - (current || '').length} left`);
  input.addEventListener('input', () => { left.textContent = `${NOTE_MAX - input.value.length} left`; });
  const save = async text => {
    const all = await setExNote(exerciseId, text);
    closeModal();
    toast(text.trim() ? 'Note saved' : 'Note cleared');
    if (onSaved) onSaved(all);
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') save(input.value); });
  showModal(el('div', { class: 'note-sheet' }, [
    el('h2', {}, name),
    el('p', { class: 'muted' }, 'A short note that shows every time this lift comes up, like a seat setting or a cue for the knee.'),
    input, left,
    el('div', { class: 'btn-row' }, [
      current ? el('button', { class: 'btn ghost', id: 'note-clear', onclick: () => save('') }, 'Clear') : el('button', { class: 'btn ghost', onclick: () => closeModal() }, 'Cancel'),
      el('button', { class: 'btn primary', id: 'note-save', onclick: () => save(input.value) }, 'Save')
    ])
  ]));
  setTimeout(() => { try { input.focus(); } catch (e) { /* ignore */ } }, 50);
}
