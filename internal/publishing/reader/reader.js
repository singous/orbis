const themeButton = document.querySelector('[data-theme-toggle]');
try { const saved = localStorage.getItem('orbis-public-theme'); if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved; } catch {}
themeButton?.addEventListener('click', () => { const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches); const next = dark ? 'light' : 'dark'; document.documentElement.dataset.theme = next; try { localStorage.setItem('orbis-public-theme', next); } catch {} });
document.querySelector('[data-menu-toggle]')?.addEventListener('click', (event) => { const navigation = document.querySelector('#site-navigation'); if (!navigation) return; const open = navigation.dataset.open !== 'true'; navigation.dataset.open = String(open); event.currentTarget.setAttribute('aria-expanded', String(open)); });
function display(field, value) {
  if (value == null) return '';
  if (field.kind === 'select') return field.options.find((item) => item.id === value)?.label ?? '';
  if (field.kind === 'multi_select') return value.map((id) => field.options.find((item) => item.id === id)?.label ?? '').join(', ');
  if (field.kind === 'checkbox') return value ? '是' : '否';
  if (field.kind === 'datetime') return new Intl.DateTimeFormat('zh-CN', {timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short'}).format(new Date(value));
  return String(value);
}
function cell(field, value) { const td = document.createElement('td'); if (field.kind === 'url' && value) { const link = document.createElement('a'); link.href = value; link.textContent = value; link.rel = 'noopener noreferrer'; td.append(link); } else td.textContent = display(field, value); return td; }
function renderRows(root, data) {
  const host = root.querySelector('[data-records]'); host.replaceChildren();
  if (data.view.kind === 'kanban' && data.view.group_field_id) {
    host.className = 'board'; const field = data.fields.find((item) => item.id === data.view.group_field_id);
    for (const group of [...(field?.options ?? []).map((item) => ({id: item.id, name: item.label})), {id: null, name: '未分组'}]) {
      const column = document.createElement('section'); column.className = 'board-column'; const title = document.createElement('h4'); const count = data.groups?.find((item) => (item.option_id ?? null) === group.id)?.count ?? 0; title.textContent = `${group.name} (${count})`; column.append(title);
      for (const record of data.items.filter((item) => (item.values[data.view.group_field_id] ?? null) === group.id)) { const card = document.createElement('div'); card.className = 'record-card'; for (const field of data.fields) { const label = document.createElement('div'); label.className = 'record-field'; label.textContent = field.name; const content = document.createElement('div'); content.textContent = display(field, record.values[field.id]); card.append(label, content); } column.append(card); }
      host.append(column);
    }
  } else {
    host.className = 'table-scroll'; const table = document.createElement('table'); const head = document.createElement('thead'); const tr = document.createElement('tr');
    for (const field of data.fields) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = field.name; if (data.view.widths?.[field.id]) th.style.width = `${data.view.widths[field.id]}px`; tr.append(th); } head.append(tr); const body = document.createElement('tbody');
    for (const record of data.items) { const row = document.createElement('tr'); for (const field of data.fields) row.append(cell(field, record.values[field.id])); body.append(row); } table.append(head, body); host.append(table);
  }
}
document.addEventListener('click', async (event) => {
  const button = event.target.closest?.('[data-table-page]'); const root = button?.closest('[data-table-url]'); if (!button || !root || root.dataset.busy === 'true') return;
  const page = Number(root.dataset.page || 1) + Number(button.dataset.tablePage); if (page < 1) return;
  root.dataset.busy = 'true'; const status = root.querySelector('[data-table-status]'); status.textContent = '正在读取…';
  try {
    const url = new URL(root.dataset.tableUrl, location.origin); if (url.origin !== location.origin) throw new Error('表格地址不可用'); url.searchParams.set('page', String(page)); url.searchParams.set('page_size', '100');
    const response = await fetch(url, {credentials: 'omit', headers: {Accept: 'application/json'}}); const result = await response.json();
    if (!response.ok || result.code !== 'OK') throw new Error(result.message || '表格读取失败，请刷新页面');
    renderRows(root, result.data); root.dataset.page = String(page); const total = result.data.pagination.total;
    root.querySelector('[data-table-page="-1"]').disabled = page === 1; root.querySelector('[data-table-page="1"]').disabled = page * 100 >= total; status.textContent = `第 ${page} 页，共 ${total} 条`;
  } catch (error) { status.textContent = error instanceof Error ? error.message : '表格读取失败，请刷新页面'; } finally { root.dataset.busy = 'false'; }
});
