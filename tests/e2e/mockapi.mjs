// In-memory stand-in for the backend API, shaped like the Express controllers.
// Used only to drive the frontend end-to-end tests with Playwright.
const iso = (d) => new Date(d).toISOString();
const day = (offset) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString(); };

export function createMockApi() {
  const state = {
    session: null, // 'student' | 'approver' | null
    profile: null,
    nextId: 3,
    nextDraftId: 1,
    drafts: [],
    calls: [],
    requests: [
      { id: 1, purpose: 'Traffic Flow Analysis', project_description: 'Spark jobs on city traffic counts.', project_supervisor_name: 'Dr. Pakinee Aimmanee', resource_type: 'BIG_DATA', justification: 'The dataset is 40 GB.', technical_requirements: '', estimated_start_date: day(-60), estimated_end_date: day(-5), impact_score: 7, supervisor_confirmation: 'CONFIRMED', status: 'COMPLETED', review_comment: 'Approved for the semester.', reviewed_at: day(-58), created_at: day(-61), updated_at: day(-5), extension: null },
      { id: 2, purpose: 'LLM Fine-tuning Experiment', project_description: 'Fine-tune a 7B model.', project_supervisor_name: 'Dr. Pakinee Aimmanee', resource_type: 'HPC_GPU', justification: 'Needs an A40.', technical_requirements: '48 GB GPU memory', estimated_start_date: day(-20), estimated_end_date: day(20), impact_score: 6, supervisor_confirmation: 'CONFIRMED', status: 'REJECTED', review_comment: 'Please narrow the scope first.', reviewed_at: day(-18), created_at: day(-21), updated_at: day(-18), extension: null },
    ],
  };
  const student = { account_id: 1, user_id: 1, role: 'user', full_name: 'Somchai Student', email: '6622780000@g.siit.tu.ac.th', kind: 'student', student_id: '6622780000', degree: 'UNDERGRADUATE' };
  const approver = { account_id: 9, user_id: null, role: 'reviewer', full_name: 'Dr. Approver', email: 'approver@siit.tu.ac.th', kind: 'staff' };

  const json = (status, body, headers = {}) => ({ status, body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });
  const listRow = (r) => ({ id: String(r.id), purpose: r.purpose, resource_type: r.resource_type, status: r.status, impact_score: r.impact_score, estimated_start_date: r.estimated_start_date, estimated_end_date: r.estimated_end_date, extension_asked: Boolean(r.extension), created_at: r.created_at, reviewed_at: r.reviewed_at });
  const events = (r) => [{ id: r.id * 10, action: 'SUBMITTED', from: null, to: 'PENDING', actor: { role: 'Student', name: student.full_name }, comment: null, details: null, at: r.created_at }];
  const detail = (r) => ({ ...r, id: String(r.id), events: events(r) });

  function handle(method, path, body) {
    const url = new URL(path, 'http://api.test');
    const p = url.pathname;
    state.calls.push(`${method} ${p}`);
    if (p === '/api/auth/google') return json(200, { auth_url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=test' });
    if (p === '/api/auth/logout') { state.session = null; return json(200, { message: 'Logged out' }); }
    if (!state.session) return json(401, { message: 'Unauthorized' });
    const isApprover = state.session === 'approver';
    if (p === '/api/auth/me') return json(200, isApprover ? approver : { ...student, user_id: state.profile ? 1 : null });

    if (p === '/api/users/me') {
      if (isApprover) return json(200, { id: '9', role: 'Approver', full_name: approver.full_name, primary_email: approver.email, phone_number: '' });
      if (method === 'GET') return state.profile ? json(200, { ...state.profile, primary_email: student.email, full_name: student.full_name }) : json(404, { message: 'User profile not found' });
      const errors = ['program', 'advisor_name', 'phone_number'].filter((k) => !body?.[k]);
      if (errors.length) return json(400, { message: 'Validation error', errors: errors.map((k) => ({ path: [k], message: `${k} is required` })) });
      state.profile = { id: '1', kind: 'student', student_id: student.student_id, degree: 'UNDERGRADUATE', program: body.program, department: null, advisor_name: body.advisor_name, phone_number: body.phone_number };
      return json(method === 'POST' ? 201 : 200, state.profile);
    }

    if (p.startsWith('/api/requests')) {
      if (isApprover || !state.profile) return json(403, { message: 'Forbidden: User profile required' });
      if (p === '/api/requests' && method === 'POST') {
        const { draft_id, ...fields } = body ?? {};
        const r = { ...fields, id: state.nextId++, status: 'PENDING', review_comment: null, reviewed_at: null, created_at: iso(Date.now()), updated_at: iso(Date.now()), extension: null };
        state.requests.unshift(r);
        // Submitting from a draft deletes that draft (FR-3.2).
        if (draft_id) state.drafts = state.drafts.filter((d) => d.id !== draft_id);
        return json(201, { id: String(r.id), status: r.status, resource_type: r.resource_type, purpose: r.purpose, created_at: r.created_at });
      }
      if (p === '/api/requests/me') {
        const rows = state.requests.map(listRow);
        return json(200, rows, { 'X-Total-Count': String(rows.length) });
      }
      const m = p.match(/^\/api\/requests\/(\d+)$/);
      if (m) {
        const r = state.requests.find((x) => x.id === Number(m[1]));
        if (!r) return json(404, { message: 'Request not found' });
        if (method === 'GET') return json(200, detail(r));
        if (r.status !== 'PENDING') return json(400, { message: 'Can only update pending requests' });
        Object.assign(r, body, { updated_at: iso(Date.now()) });
        return json(200, detail(r));
      }
    }

    if (p.startsWith('/api/drafts')) {
      if (isApprover || !state.profile) return json(403, { message: 'Forbidden: User profile required' });
      if (p === '/api/drafts' && method === 'GET') return json(200, [...state.drafts].sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
      if (p === '/api/drafts' && method === 'POST') {
        const d = { id: state.nextDraftId++, data: body?.data ?? {}, updated_at: iso(Date.now()) };
        state.drafts.push(d);
        return json(201, d);
      }
      const m = p.match(/^\/api\/drafts\/(\d+)$/);
      const d = m && state.drafts.find((x) => x.id === Number(m[1]));
      if (!d) return json(404, { message: 'Draft not found' });
      if (method === 'DELETE') { state.drafts = state.drafts.filter((x) => x !== d); return { status: 204, body: '', headers: {} }; }
      Object.assign(d, { data: body?.data ?? {}, updated_at: iso(Date.now()) });
      return json(200, d);
    }

    if (p.startsWith('/api/reviewer')) {
      if (!isApprover) return json(403, { message: 'Forbidden: Reviewer access required' });
      if (p === '/api/reviewer/export') return { status: 200, body: '﻿id,status\r\n1,COMPLETED\r\n', headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="requests.csv"', 'access-control-expose-headers': 'Content-Disposition' } };
      if (p === '/api/reviewer/requests') {
        const status = url.searchParams.get('status');
        const rows = state.requests.filter((r) => !status || r.status === status).map((r) => ({ ...listRow(r), id: r.id, student_name: student.full_name, student_id: student.student_id, requester_kind: 'student', gpu_node: null }));
        return json(200, rows, { 'X-Total-Count': String(rows.length) });
      }
      const m = p.match(/^\/api\/reviewer\/requests\/(\d+)(?:\/(\w+))?$/);
      if (m) {
        const r = state.requests.find((x) => x.id === Number(m[1]));
        if (!r) return json(404, { message: 'Request not found' });
        if (!m[2]) return json(200, { ...detail(r), id: r.id, overlaps: [], provisioning: { automated: false, gpu_node: null, jobs: [] }, student: { id: '1', name: student.full_name, email: student.email, kind: 'student', student_id: student.student_id, department: null, degree: 'UNDERGRADUATE', program: state.profile?.program ?? 'Digital Engineering', advisor_name: r.project_supervisor_name } });
        const t = { approve: ['PENDING', 'APPROVED'], reject: ['PENDING', 'REJECTED'], activate: ['APPROVED', 'ACTIVE'], complete: ['ACTIVE', 'COMPLETED'] }[m[2]];
        if (!t) return json(404, { message: 'Not found' });
        if ((m[2] === 'approve' || m[2] === 'reject') && !body?.review_comment) return json(400, { message: 'Validation error', errors: [{ path: ['review_comment'], message: 'Review comment is required' }] });
        if (r.status !== t[0]) return json(400, { message: 'Invalid state transition' });
        r.status = t[1]; r.reviewed_at = iso(Date.now()); if (body?.review_comment) r.review_comment = body.review_comment;
        return json(200, { id: r.id, status: r.status, reviewed_at: r.reviewed_at });
      }
    }
    return json(404, { message: 'Not found' });
  }

  return { state, handle };
}
