import {
  getProposalBlockReason,
  requiredCreateProjectCards,
} from '@/lib/assistant-proposal-deps';
import type { AssistantProposal } from '@/types/api';

const createPayments: AssistantProposal = {
  type: 'create_project',
  summary: 'Create Payments2',
  name: 'Payments2',
};

const moveDone: AssistantProposal = {
  type: 'move_tasks_to_project',
  summary: 'Move DONE to Payments2',
  sourceProjectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  targetProjectName: 'Payments2',
  statusIn: ['DONE'],
};

const createTask: AssistantProposal = {
  type: 'create_task',
  summary: 'Add setup',
  projectName: 'Payments2',
  title: 'Setup',
};

describe('assistant-proposal-deps', () => {
  it('blocks move until matching create_project is applied', () => {
    const cards = [
      { key: 'c1', proposal: createPayments, status: 'pending' },
      { key: 'm1', proposal: moveDone, status: 'pending' },
    ];
    expect(getProposalBlockReason(cards[0]!, cards)).toBeNull();
    expect(getProposalBlockReason(cards[1]!, cards)).toBe(
      "Apply “create project 'Payments2'” first",
    );
  });

  it('unblocks move after create_project is applied', () => {
    const cards = [
      { key: 'c1', proposal: createPayments, status: 'applied' },
      { key: 'm1', proposal: moveDone, status: 'pending' },
    ];
    expect(getProposalBlockReason(cards[1]!, cards)).toBeNull();
  });

  it('does not block move to an existing project UUID', () => {
    const moveExisting: AssistantProposal = {
      type: 'move_tasks_to_project',
      summary: 'Move to Auth',
      sourceProjectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      targetProjectId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    };
    const cards = [
      { key: 'c1', proposal: createPayments, status: 'pending' },
      { key: 'm1', proposal: moveExisting, status: 'pending' },
    ];
    expect(getProposalBlockReason(cards[1]!, cards)).toBeNull();
  });

  it('blocks create_task that references the new project by name', () => {
    const cards = [
      { key: 'c1', proposal: createPayments, status: 'pending' },
      { key: 't1', proposal: createTask, status: 'pending' },
    ];
    expect(requiredCreateProjectCards(createTask, cards)).toHaveLength(1);
    expect(getProposalBlockReason(cards[1]!, cards)).toMatch(/Payments2/);
  });
});
