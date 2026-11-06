'use strict';

function readFieldControls() {
  const type = el('field-type').value;
  return normalizeFieldProfile({ type,
    groups: el('field-groups').valueAsNumber, separation: el('field-separation').valueAsNumber,
    height: el('field-height').valueAsNumber, columns: el('field-columns').valueAsNumber });
}

function fieldControlVisibility() {
  const type = el('field-type').value;
  el('field-groups-control').hidden = type !== 'clusters';
  el('field-separation-control').hidden = type !== 'clusters' && type !== 'outlier';
  el('field-height-control').hidden = type !== 'convex';
  el('field-columns-control').hidden = type !== 'grid';
  el('field-grid-note').hidden = type !== 'grid';
  el('field-seed').disabled = el('field-build').disabled = type === 'custom';
}

function showFieldControls() {
  const p = fieldProfile;
  el('field-type').value = p.type;
  for (const [key, id] of [['groups', 'field-groups'], ['separation', 'field-separation'], ['height', 'field-height'], ['columns', 'field-columns']]) {
    if (p[key] !== undefined) el(id).value = p[key];
  }
  if (fieldDescriptor.seed !== null) el('field-seed').value = fieldDescriptor.seed;
  el('field-code').value = encodeField(p, points.length, fieldDescriptor.seed, points);
  el('field-active').textContent = fieldProfileLabel(p);
  el('field-status').textContent = '';
  el('count').readOnly = el('generate').disabled = p.type === 'custom';
  fieldControlVisibility();
  updateFieldProfiles();
}

async function updateFieldProfiles() {
  try {
    const profiles = await knownFieldProfiles();
    el('field-profile').innerHTML = profiles.map(p => '<option value="' + fieldProfileKey(p) + '">' + fieldProfileLabel(p) + '</option>').join('');
    el('field-profile').value = fieldProfileKey(fieldProfile);
  } catch { /* Текущие настройки остаются доступны при недоступном каталоге. */ }
}

async function copyFieldText(input) {
  try { await navigator.clipboard.writeText(input.value); el('field-status').textContent = 'Код поля скопирован.'; }
  catch { input.focus(); input.select(); el('field-status').textContent = 'Код выделен — скопируй его через Ctrl+C.'; }
}

function rememberFieldProfile(profile) {
  try {
    const known = JSON.parse(localStorage.getItem('atlas-field-profiles-v1') || '[]');
    const key = fieldProfileKey(profile);
    if (!known.some(p => fieldProfileKey(p) === key)) known.push(profile);
    localStorage.setItem('atlas-field-profiles-v1', JSON.stringify(known));
  } catch { /* Сводки сохраняются в IndexedDB; каталог можно восстановить по именам баз. */ }
}

async function knownFieldProfiles() {
  const profiles = new Map([['', normalizeFieldProfile()], [fieldProfileKey(fieldProfile), fieldProfile]]);
  try {
    for (const p of JSON.parse(localStorage.getItem('atlas-field-profiles-v1') || '[]')) profiles.set(fieldProfileKey(p), normalizeFieldProfile(p));
  } catch { /* Повреждённый каталог не мешает чтению самих сводок. */ }
  if (indexedDB.databases) {
    for (const { name } of await indexedDB.databases()) {
      if (!name?.startsWith('atlas-route-statistics-v1') || !name.includes('-field-')) continue;
      try {
        const p = normalizeFieldProfile(JSON.parse(atob(name.split('-field-')[1].replaceAll('-', '+').replaceAll('_', '/'))));
        profiles.set(fieldProfileKey(p), p);
      } catch { /* Незнакомая версия базы не подменяет известную геометрию. */ }
    }
  }
  return [...profiles.values()];
}

function initFieldControls() {
  el('field-profile').onchange = () => {
    try {
      const key = el('field-profile').value;
      const p = key ? normalizeFieldProfile(JSON.parse(atob(key.replaceAll('-', '+').replaceAll('_', '/')))) : normalizeFieldProfile();
      el('field-type').value = p.type;
      for (const [name, id] of [['groups', 'field-groups'], ['separation', 'field-separation'], ['height', 'field-height'], ['columns', 'field-columns']]) {
        if (p[name] !== undefined) el(id).value = p[name];
      }
      newField(false, false);
    } catch (error) { el('field-status').textContent = error.message; }
  };
  el('field-build').onclick = () => newField(true, false);
  for (const id of ['field-type', 'field-groups', 'field-separation', 'field-height', 'field-columns']) el(id).onchange = () => {
    fieldControlVisibility();
    newField(true, false);
  };
  el('field-copy').onclick = () => copyFieldText(el('field-code'));
  el('field-load').onclick = () => {
    try { replaceField(decodeField(el('field-code').value)); }
    catch (error) { el('field-status').textContent = error.message; }
  };
  el('field-coordinates').onclick = () => {
    el('field-code').value = encodeField({ type: 'custom' }, points.length, null, points);
    el('field-status').textContent = 'В код записаны точные координаты. Его можно загрузить как отдельный частный случай.';
  };
  fieldControlVisibility();
}
