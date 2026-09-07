const https = require('https');

const MONDAY_API_TOKEN = (process.env.MONDAY_API_TOKEN || '').trim();

const TASK_TYPE_RECURRENCE = 'RECURRENCE';
const TASK_TYPE_ONE_TIME_LABEL = 'ONE-TIME';
const STATUS_DONE = 'Done';
const STATUS_BLOCKED = 'Closed (not done)';

const COL_TITLES = {
  TASK_TYPE: 'TASK TYPE',
  RECURRENCE_PERIOD: 'Recurrence Period',
  START_DATE: 'Recurrence Start Date',
  END_DATE: 'Recurrence End Date',
  DEADLINE: 'Timeline',
  STATUS: 'Status',
  PRIORITY: 'Priority',
  STRATEGIC_OBJ: 'TALMA Strategic Objective',
  DEPT_OBJ: 'Department Objective',
  OWNER: 'Primary Owner',
  OWNER_PEOPLE: 'Owner',
  PARTNERS: 'Partners / Supporters',
  QUARTER: 'Quarter',
  QUARTER_YEAR: 'QuarterYear',
  QUARTER_YEAR_LEGACY: 'Quarter NEW',
  KPI: 'KPI',
  NOTES: 'Notes',
  CROSS_DEPT: 'Cross-Department Collaboration',
  BUDGET: 'Estimated Budget',
  FOCUS_AREAS: 'Focus Areas',
  OBJECTIVES: 'Objectives',
  RECURRENCE_PARENT: 'Recurrence Parent',
  COLOR_STATUS: 'color status automation',
};

const QUARTER_YEAR_FALLBACK_ID = 'dropdown_mm6b9hp2';

const TEXT_TITLES_TO_COPY = [
  COL_TITLES.OWNER,
  COL_TITLES.PARTNERS, COL_TITLES.CROSS_DEPT, COL_TITLES.KPI, COL_TITLES.BUDGET,
];
const BOARD_RELATION_TITLES = [COL_TITLES.FOCUS_AREAS, COL_TITLES.OBJECTIVES];

const boardColumnCache = {};

const agent = new https.Agent({ keepAlive: true });

function mondayApi(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const options = {
      hostname: 'api.monday.com', path: '/v2', method: 'POST', agent,
      headers: { 'Content-Type': 'application/json', 'Authorization': MONDAY_API_TOKEN, 'API-Version': '2024-10' },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.errors) console.error('Monday API errors:', JSON.stringify(parsed.errors).substring(0, 300));
          resolve(parsed);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function mondayJsonArg(obj) {
  // Monday API requires column_values as JSON-string-inside-JSON-string
  return JSON.stringify(JSON.stringify(obj));
}

async function getBoardColumns(boardId) {
  if (boardColumnCache[boardId]) return boardColumnCache[boardId];
  const query = `{ boards(ids: [${boardId}]) { columns { id title type settings_str } } }`;
  const res = await mondayApi(query);
  const columns = res.data?.boards?.[0]?.columns || [];
  const titleToId = {};
  columns.forEach((c) => { titleToId[c.title] = c.id; });
  boardColumnCache[boardId] = { titleToId, columns };
  return boardColumnCache[boardId];
}

function colId(bc, titleKey) {
  return bc.titleToId[COL_TITLES[titleKey]];
}

// Look up a status column's index by its label text (works across duplicated boards)
function getStatusIndexByLabel(bc, titleKey, labelText) {
  const id = colId(bc, titleKey);
  if (!id) return null;
  const col = bc.columns.find((c) => c.id === id);
  if (!col) return null;
  try {
    const settings = JSON.parse(col.settings_str || '{}');
    const labels = settings.labels || {};
    for (const [index, name] of Object.entries(labels)) {
      if (name === labelText) return Number(index);
    }
  } catch { /* ignore parse errors */ }
  return null;
}

// Look up a dropdown option's ID by its label text
function getDropdownIdByLabel(bc, titleKey, labelText) {
  const id = colId(bc, titleKey);
  if (!id) return null;
  const col = bc.columns.find((c) => c.id === id);
  if (!col) return null;
  try {
    const settings = JSON.parse(col.settings_str || '{}');
    const label = (settings.labels || []).find((l) => l.name === labelText);
    return label ? label.id : null;
  } catch { return null; }
}

function getQuarterFromDate(isoDate) {
  const month = parseInt(isoDate.split('-')[1], 10);
  if (month <= 3) return 'Q1';
  if (month <= 6) return 'Q2';
  if (month <= 9) return 'Q3';
  return 'Q4';
}

function getYearQuarterFromDate(isoDate) {
  const [year, monthStr] = isoDate.split('-');
  const month = parseInt(monthStr, 10);
  let quarter;
  if (month <= 3) quarter = 'Q1';
  else if (month <= 6) quarter = 'Q2';
  else if (month <= 9) quarter = 'Q3';
  else quarter = 'Q4';
  return `${year} - ${quarter}`;
}

function resolveQuarterYearColumnId(bc) {
  const statusCol = bc.columns.find((c) => (c.title === COL_TITLES.QUARTER_YEAR || c.title === COL_TITLES.QUARTER_YEAR_LEGACY) && (c.type === 'status' || c.type === 'color'));
  if (statusCol) return statusCol.id;

  return bc.titleToId[COL_TITLES.QUARTER_YEAR]
    || bc.titleToId[COL_TITLES.QUARTER_YEAR_LEGACY]
    || (bc.columns.some((c) => c.id === QUARTER_YEAR_FALLBACK_ID) ? QUARTER_YEAR_FALLBACK_ID : null);
}

function getQuarterYearUpdate(bc, columnId, labelText) {
  if (!columnId) return null;
  const col = bc.columns.find((c) => c.id === columnId);
  if (!col) return null;
  const isStatus = col.type === 'status' || col.type === 'color';
  try {
    const settings = JSON.parse(col.settings_str || '{}');
    const rawLabels = settings.labels;
    if (isStatus) {
      if (Array.isArray(rawLabels)) {
        const found = rawLabels.find((l) => (typeof l === 'string' ? l : l?.name) === labelText);
        return found ? { label: typeof found === 'string' ? found : found.name } : null;
      }
      if (rawLabels && typeof rawLabels === 'object') {
        const found = Object.values(rawLabels).find((val) => {
          const str = typeof val === 'string' ? val : val?.name;
          return str === labelText;
        });
        if (found) {
          const labelStr = typeof found === 'string' ? found : found.name;
          return { label: labelStr };
        }
        return null;
      }
      return null;
    }
    // Dropdown column
    if (Array.isArray(rawLabels)) {
      const found = rawLabels.find((l) => l?.name === labelText);
      return found ? { ids: [found.id] } : null;
    }
    return null;
  } catch { return null; }
}

function getDropdownIdByColumnId(bc, columnId, labelText) {
  if (!columnId) return null;
  const col = bc.columns.find((c) => c.id === columnId);
  if (!col) return null;
  try {
    const settings = JSON.parse(col.settings_str || '{}');
    const label = (settings.labels || []).find((l) => l.name === labelText);
    return label ? label.id : null;
  } catch { return null; }
}

// Date helpers

function addMonths(y, m, d, n) {
  const totalMonths = m - 1 + n;
  const newY = y + Math.floor(totalMonths / 12);
  const newM = (totalMonths % 12) + 1;
  const maxDay = new Date(newY, newM, 0).getDate();
  return fmtISO(newY, newM, Math.min(d, maxDay));
}

function getNextDateISO(currentDateISO, period) {
  const [y, m, d] = currentDateISO.split('-').map(Number);
  switch (period) {
    case 'Every Week': {
      const dt = new Date(y, m - 1, d + 7);
      return fmtISO(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
    }
    case 'Every Two Weeks': {
      const dt = new Date(y, m - 1, d + 14);
      return fmtISO(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
    }
    case 'Every Month': return addMonths(y, m, d, 1);
    case 'Every Two Months': return addMonths(y, m, d, 2);
    case 'Every Quarter': return addMonths(y, m, d, 3);
    case 'Every Six Months': return addMonths(y, m, d, 6);
    default: {
      console.error(`Unknown recurrence period: "${period}", defaulting to monthly`);
      return addMonths(y, m, d, 1);
    }
  }
}

function fmtISO(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function fmtDDMMYYYY(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function parseDeadlineStart(text) {
  if (!text) return null;
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function getOwnerId(cols, bc) {
  return cols[colId(bc, 'OWNER_PEOPLE')]?.persons_and_teams?.[0]?.id;
}

async function notifyOwner(ownerId, targetId, message) {
  if (!ownerId) return;
  const escaped = message.replace(/"/g, '\\"');
  const query = `mutation { create_notification(user_id: ${ownerId}, target_id: ${targetId}, text: "${escaped}", target_type: Project) { text } }`;
  try { await mondayApi(query); }
  catch (e) { console.error('Notification failed:', e.message); }
}

async function fetchItem(itemId) {
  const query = `{
    items(ids: [${Number(itemId)}]) {
      name
      board { id }
      column_values {
        id text value
        ... on BoardRelationValue { linked_item_ids }
        ... on StatusValue { index }
        ... on DropdownValue { values { id } }
        ... on PeopleValue { persons_and_teams { id kind } }
      }
    }
  }`;
  const res = await mondayApi(query);
  if (!res.data?.items?.[0]) return null;
  const item = res.data.items[0];
  const cols = {};
  item.column_values.forEach((c) => { cols[c.id] = c; });
  return { name: item.name, cols, boardId: Number(item.board.id) };
}

async function childExistsForDate(boardId, parentId, dateISO, bc) {
  const parentColId = colId(bc, 'RECURRENCE_PARENT');
  const deadlineColId = colId(bc, 'DEADLINE');
  const query = `{
    boards(ids: [${boardId}]) {
      items_page(limit: 500, query_params: {
        rules: [{column_id: "${parentColId}", compare_value: ["${parentId}"]}]
      }) {
        items { column_values(ids: ["${deadlineColId}"]) { text } }
      }
    }
  }`;
  const res = await mondayApi(query);
  const items = res.data?.boards?.[0]?.items_page?.items || [];
  return items.some((item) => {
    const deadline = item.column_values?.[0]?.text;
    return deadline && deadline.startsWith(dateISO);
  });
}

function buildChildColumnValues(parentCols, parentId, bc, fallbackUserId) {
  const colValues = {};

  // Owner: inherit from parent's Owner column; fall back to the user who triggered the webhook
  const ownerColId = colId(bc, 'OWNER_PEOPLE');
  if (ownerColId) {
    const parentOwnerId = parentCols[ownerColId]?.persons_and_teams?.[0]?.id;
    const ownerIdToUse = parentOwnerId || fallbackUserId;
    if (ownerIdToUse) {
      colValues[ownerColId] = { personsAndTeams: [{ id: Number(ownerIdToUse), kind: 'person' }] };
    }
  }

  TEXT_TITLES_TO_COPY.forEach((title) => {
    const id = bc.titleToId[title];
    if (id && parentCols[id]?.text) colValues[id] = parentCols[id].text;
  });

  const priorityId = colId(bc, 'PRIORITY');
  if (priorityId && parentCols[priorityId]?.index != null) {
    colValues[priorityId] = { index: parentCols[priorityId].index };
  }

  const stratObjId = colId(bc, 'STRATEGIC_OBJ');
  if (stratObjId && parentCols[stratObjId]?.index != null) {
    colValues[stratObjId] = { index: parentCols[stratObjId].index };
  }

  const notesId = colId(bc, 'NOTES');
  if (notesId && parentCols[notesId]?.text) {
    colValues[notesId] = { text: parentCols[notesId].text };
  }

  // Set TASK TYPE to ONE-TIME by looking up the label dynamically
  const oneTimeIndex = getStatusIndexByLabel(bc, 'TASK_TYPE', TASK_TYPE_ONE_TIME_LABEL);
  const taskTypeId = colId(bc, 'TASK_TYPE');
  if (taskTypeId && oneTimeIndex != null) {
    colValues[taskTypeId] = { index: oneTimeIndex };
  }

  const parentColId = colId(bc, 'RECURRENCE_PARENT');
  if (parentColId) colValues[parentColId] = String(parentId);

  BOARD_RELATION_TITLES.forEach((title) => {
    const id = bc.titleToId[title];
    if (id && parentCols[id]?.linked_item_ids?.length > 0) {
      colValues[id] = {
        linkedPulseIds: parentCols[id].linked_item_ids.map((lid) => ({ linkedPulseId: Number(lid) })),
      };
    }
  });

  return colValues;
}

async function createChildItem(parent, parentId, date, boardId, bc, fallbackUserId) {
  const exists = await childExistsForDate(boardId, parentId, date, bc);
  if (exists) {
    console.log(`Duplicate prevented: child for ${date} already exists (parent ${parentId})`);
    return null;
  }

  const colValues = buildChildColumnValues(parent.cols, parentId, bc, fallbackUserId);

  const deadlineId = colId(bc, 'DEADLINE');
  if (deadlineId) colValues[deadlineId] = { from: date, to: date };

  const quarterLabel = getQuarterFromDate(date);
  const quarterDropdownId = getDropdownIdByLabel(bc, 'QUARTER', quarterLabel);
  const quarterId = colId(bc, 'QUARTER');
  if (quarterId && quarterDropdownId) colValues[quarterId] = { ids: [quarterDropdownId] };

  // Technology (and any board with QuarterYear): also set year-aware label e.g. "2026 - Q2"
  const quarterYearId = resolveQuarterYearColumnId(bc);
  if (quarterYearId) {
    const yearQuarterLabel = getYearQuarterFromDate(date);
    const qyUpdate = getQuarterYearUpdate(bc, quarterYearId, yearQuarterLabel);
    if (qyUpdate) {
      colValues[quarterYearId] = qyUpdate;
    } else {
      console.log(`Board ${boardId} has no QuarterYear label "${yearQuarterLabel}", skipping year-quarter write`);
    }
  }

  const colorStatusId = colId(bc, 'COLOR_STATUS');
  if (colorStatusId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekEnd = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    const endDate = new Date(date + 'T00:00:00');
    let label;
    if (endDate <= today) label = 'ends on or before today';
    else if (endDate <= weekEnd) label = 'ends this week';
    else label = 'ends after this week';
    colValues[colorStatusId] = { label };
  }

  const itemName = `${parent.name} - ${fmtDDMMYYYY(date)}`;
  const mutation = `mutation { create_item(board_id: ${boardId}, item_name: ${JSON.stringify(itemName)}, column_values: ${mondayJsonArg(colValues)}) { id } }`;

  const res = await mondayApi(mutation);
  if (res.data?.create_item?.id) {
    console.log(`Created: ${itemName} (id: ${res.data.create_item.id}) on board ${boardId}`);
    return res.data.create_item.id;
  }
  console.log(`Failed to create: ${itemName} - ${JSON.stringify(res).substring(0, 200)}`);
  return null;
}

module.exports = async function handler(req, res) {
  if (req.body?.challenge) {
    return res.status(200).json({ challenge: req.body.challenge });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { event } = req.body || {};
    if (!event?.pulseId) {
      return res.status(200).json({ message: 'No event or pulseId, skipping' });
    }

    const itemId = event.pulseId;
    const eventBoardId = event.boardId;
    const eventUserId = event.userId;
    console.log(`Processing item ${itemId} on board ${eventBoardId || 'unknown'} (triggered by user ${eventUserId || 'unknown'})`);

    // Parallelize fetchItem + getBoardColumns when boardId is in the event
    let item, bc;
    if (eventBoardId) {
      [item, bc] = await Promise.all([fetchItem(itemId), getBoardColumns(eventBoardId)]);
    } else {
      item = await fetchItem(itemId);
      if (!item) return res.status(200).json({ message: 'Item not found' });
      bc = await getBoardColumns(item.boardId);
    }
    if (!item) return res.status(200).json({ message: 'Item not found' });

    const boardId = item.boardId;

    const taskType = item.cols[colId(bc, 'TASK_TYPE')]?.text;
    const status = item.cols[colId(bc, 'STATUS')]?.text;
    const parentRef = item.cols[colId(bc, 'RECURRENCE_PARENT')]?.text;

    // CASE 1: New recurring parent — create first child
    if (taskType === TASK_TYPE_RECURRENCE && !parentRef) {
      const period = item.cols[colId(bc, 'RECURRENCE_PERIOD')]?.text;
      const startDate = item.cols[colId(bc, 'START_DATE')]?.text;
      const endDate = item.cols[colId(bc, 'END_DATE')]?.text;

      if (!period || !startDate || !endDate) {
        const missing = [];
        if (!period) missing.push('Recurrence Period');
        if (!startDate) missing.push('Start Date');
        if (!endDate) missing.push('End Date');
        await notifyOwner(getOwnerId(item.cols, bc), itemId, `Recurring task "${item.name}" is missing: ${missing.join(', ')}. Please fill in all fields.`);
        return res.status(200).json({ message: 'Missing recurrence fields, owner notified' });
      }

      const firstDate = getNextDateISO(startDate, period);
      if (firstDate > endDate) {
        return res.status(200).json({ message: 'No occurrences before end date', boardId });
      }
      console.log(`New recurring on board ${boardId}: ${item.name} | ${period} | first child ${firstDate} (start ${startDate}, end ${endDate})`);
      const childId = await createChildItem(item, itemId, firstDate, boardId, bc, eventUserId);
      return res.status(200).json({
        message: childId ? 'First occurrence created' : 'Skipped (duplicate or error)',
        source: item.name, date: firstDate, boardId,
      });
    }

    // CASE 2: Child completed/not completed — create next child
    if (parentRef && (status === STATUS_DONE || status === STATUS_BLOCKED)) {
      console.log(`Child completed on board ${boardId}: ${item.name} | Parent: ${parentRef}`);

      const parent = await fetchItem(Number(parentRef));
      if (!parent) return res.status(200).json({ message: 'Parent item not found' });

      // Assumption: parent and child live on the same board. Reuse bc if so.
      const parentBc = (parent.boardId === boardId) ? bc : await getBoardColumns(parent.boardId);

      const period = parent.cols[colId(parentBc, 'RECURRENCE_PERIOD')]?.text;
      const endDate = parent.cols[colId(parentBc, 'END_DATE')]?.text;
      if (!period || !endDate) return res.status(200).json({ message: 'Parent missing period or end date' });

      const currentDate = parseDeadlineStart(item.cols[colId(bc, 'DEADLINE')]?.text);
      if (!currentDate) return res.status(200).json({ message: 'Child has no deadline' });

      const nextDateISO = getNextDateISO(currentDate, period);

      if (nextDateISO > endDate) {
        console.log(`Recurrence ended: next ${nextDateISO} > end ${endDate}`);
        await notifyOwner(getOwnerId(parent.cols, parentBc), Number(parentRef), `Recurring task "${parent.name}" has reached its end date. All occurrences completed!`);
        return res.status(200).json({ message: 'Recurrence complete, end date reached' });
      }

      const childId = await createChildItem(parent, parentRef, nextDateISO, boardId, bc, eventUserId);
      return res.status(200).json({
        message: childId ? 'Next occurrence created' : 'Skipped (duplicate or error)',
        source: parent.name, date: nextDateISO, boardId,
      });
    }

    return res.status(200).json({ message: 'No action needed for this event' });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
