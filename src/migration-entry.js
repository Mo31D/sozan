import app from './runtime-entry.js';

const EXPORT_PATH = '/api/v7/migration-export';
const TABLES = [
  'students_v3',
  'recurring_sessions_v3',
  'session_occurrences_v3',
  'payments_v3',
  'student_receipts_v4',
  'receipt_allocations_v4',
  'expenses_v3',
  'other_income_v3',
  'cash_checks_v3',
  'settings_v3',
  'activity_events_v4',
  'monthly_dues_v5',
  'monthly_due_allocations_v5',
  'student_billing_v6',
  'package_cycles_v6',
  'package_cycle_occurrences_v6',
  'package_receipt_allocations_v6',
  'package_opening_progress_v7',
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== EXPORT_PATH) return app.fetch(request, env, ctx);
    if (request.method !== 'GET') {
      return json({ error: 'Method not allowed' }, 405, { allow: 'GET' });
    }

    // Reuse the existing application's authentication instead of creating a
    // second security mechanism for migration exports.
    const probe = new Request(new URL('/api/v3/settings', request.url), {
      method: 'GET',
      headers: request.headers,
    });
    const auth = await app.fetch(probe, env, ctx);
    if (!auth.ok) return auth;

    try {
      const tables = {};
      for (const table of TABLES) {
        tables[table] = await readTable(env.DB, table);
      }

      const exportedAt = new Date().toISOString();
      const summary = buildSummary(tables);
      const payload = {
        schemaVersion: 'sozan1-d1-export-v1',
        source: 'Sozan Tutor OS',
        exportedAt,
        summary,
        tables,
      };
      const date = exportedAt.slice(0, 10);
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="sozan1-migration-${date}.json"`,
          'cache-control': 'no-store, max-age=0',
          'x-content-type-options': 'nosniff',
        },
      });
    } catch (error) {
      console.error('migration export failed', error);
      return json({ error: 'MIGRATION_EXPORT_FAILED' }, 500);
    }
  },
};

async function readTable(db, table) {
  const safeName = table.replaceAll('"', '""');
  try {
    const result = await db.prepare(`SELECT * FROM "${safeName}"`).all();
    return result.results || [];
  } catch (error) {
    const message = String(error?.message || error);
    if (message.includes('no such table')) return [];
    throw error;
  }
}

function buildSummary(tables) {
  const activePayments = (tables.payments_v3 || []).filter((row) => !row.reversed_at);
  const activeReceipts = (tables.student_receipts_v4 || []).filter((row) => !row.deleted_at);
  const activeExpenses = (tables.expenses_v3 || []).filter((row) => !row.deleted_at);
  const activeIncome = (tables.other_income_v3 || []).filter((row) => !row.deleted_at);
  return {
    students: (tables.students_v3 || []).length,
    recurringSessions: (tables.recurring_sessions_v3 || []).length,
    occurrences: (tables.session_occurrences_v3 || []).length,
    packageCycles: (tables.package_cycles_v6 || []).length,
    directPayments: activePayments.length,
    studentReceipts: activeReceipts.length,
    receivedPence:
      sum(activePayments, 'amount_pence') +
      sum(activeReceipts, 'amount_pence') +
      sum(activeIncome, 'amount_pence'),
    expensesPence: sum(activeExpenses, 'amount_pence'),
  };
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + Number(row?.[key] || 0), 0);
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}
