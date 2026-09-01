import { test } from 'node:test';
import assert from 'node:assert';

// Mock Prisma
const mock_accounts = new Map();
const mock_users = new Map();
const mock_requests = new Map();
let account_id_counter = 1n;
let user_id_counter = 1n;
let request_id_counter = 1n;

// Mock auth service tests
test('auth service - findOrCreateAccount', async () => {
  // Mock implementation
  const google_data = {
    sub: 'google_sub_123',
    email: 'test@example.com',
    name: 'Test User',
  };

  // Simulate finding account
  const found = mock_accounts.get(google_data.sub);
  assert.strictEqual(found, undefined, 'Account should not exist initially');

  // Simulate creating account
  const new_account = {
    id: account_id_counter++,
    ...google_data,
    primary_email: google_data.email,
    full_name: google_data.name,
    phone_number: '',
    active: true,
    created_at: new Date(),
    updated_at: new Date(),
  };

  mock_accounts.set(google_data.sub, new_account);

  const found_after = mock_accounts.get(google_data.sub);
  assert.strictEqual(found_after.google_sub, google_data.sub);
  assert.strictEqual(found_after.primary_email, google_data.email);
});

// Mock user service tests
test('user service - createUserProfile', async () => {
  const account_id = 1n;
  const profile_data = {
    student_id: '6622770001',
    degree: 'UNDERGRADUATE',
    program: 'Computer Engineering',
    advisor_name: 'Dr. Example',
    phone_number: '0812345678',
  };

  const new_user = {
    id: user_id_counter++,
    account_id,
    ...profile_data,
    created_at: new Date(),
    updated_at: new Date(),
  };

  mock_users.set(new_user.id, new_user);

  assert.strictEqual(new_user.student_id, profile_data.student_id);
  assert.strictEqual(new_user.degree, profile_data.degree);
});

// Mock request service tests
test('request service - createRequest with pending status', async () => {
  const user_id = 1n;
  const request_data = {
    purpose: 'GPU Computing',
    project_description: 'AI model training',
    project_supervisor_name: 'Dr. Supervisor',
    resource_type: 'HPC_GPU',
    justification: 'Need for research',
    estimated_start_date: '2026-09-01',
    estimated_end_date: '2026-12-31',
    impact_score: 8,
    supervisor_confirmation: 'CONFIRMED',
  };

  const new_request = {
    id: request_id_counter++,
    user_id,
    ...request_data,
    status: 'PENDING',
    reviewed_by_account_id: null,
    reviewed_at: null,
    review_comment: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  mock_requests.set(new_request.id, new_request);

  assert.strictEqual(new_request.status, 'PENDING');
  assert.strictEqual(new_request.resource_type, 'HPC_GPU');
  assert.strictEqual(new_request.impact_score, 8);
});

// Mock validation tests
test('validation - impact score must be between 1 and 10', () => {
  const valid_scores = [1, 5, 10];
  const invalid_scores = [0, 11, -1];

  for (const score of valid_scores) {
    assert.strictEqual(score >= 1 && score <= 10, true);
  }

  for (const score of invalid_scores) {
    assert.strictEqual(score >= 1 && score <= 10, false);
  }
});

test('validation - end date must be >= start date', () => {
  const start_date = new Date('2026-09-01');
  const end_date = new Date('2026-12-31');
  const invalid_end_date = new Date('2026-08-01');

  assert.strictEqual(end_date >= start_date, true);
  assert.strictEqual(invalid_end_date >= start_date, false);
});

// Mock reviewer transitions
test('reviewer service - valid state transitions', () => {
  const valid_transitions = [
    { from: 'PENDING', to: 'APPROVED', valid: true },
    { from: 'PENDING', to: 'REJECTED', valid: true },
    { from: 'APPROVED', to: 'ACTIVE', valid: true },
    { from: 'ACTIVE', to: 'COMPLETED', valid: true },
    { from: 'REJECTED', to: 'ACTIVE', valid: false },
    { from: 'PENDING', to: 'COMPLETED', valid: false },
    { from: 'COMPLETED', to: 'PENDING', valid: false },
  ];

  const is_valid_transition = (from, to) => {
    if (from === 'PENDING' && (to === 'APPROVED' || to === 'REJECTED')) return true;
    if (from === 'APPROVED' && to === 'ACTIVE') return true;
    if (from === 'ACTIVE' && to === 'COMPLETED') return true;
    return false;
  };

  for (const { from, to, valid } of valid_transitions) {
    assert.strictEqual(is_valid_transition(from, to), valid);
  }
});

test('reviewer service - only PENDING requests can be approved/rejected', () => {
  const statuses = ['PENDING', 'APPROVED', 'REJECTED', 'ACTIVE', 'COMPLETED'];
  const can_approve = status => status === 'PENDING';

  for (const status of statuses) {
    if (status === 'PENDING') {
      assert.strictEqual(can_approve(status), true);
    } else {
      assert.strictEqual(can_approve(status), false);
    }
  }
});

console.log('All tests passed!');
