import { render, screen } from '@testing-library/react';
import App from './App';

jest.mock('@wxcc-desktop/sdk', () => ({
  Desktop: {
    agentContact: {
      taskSelected: null
    }
  }
}));

jest.mock('webex', () => ({
  __esModule: true,
  default: {
    init: jest.fn(() => ({
      meetings: {
        syncMeetings: jest.fn(),
        getAllMeetings: jest.fn(() => ({}))
      }
    }))
  }
}));

beforeEach(() => {
  window.AudioContext = jest.fn(() => ({
    createMediaStreamDestination: jest.fn(() => ({ stream: {} }))
  }));
});

afterEach(() => {
  jest.clearAllMocks();
});

test('enables recording when the widget receives an interaction id prop', () => {
  render(<App interactionId="abc-123" />);

  expect(screen.getByText(/call detected - ready to record/i)).toBeInTheDocument();
  expect(screen.getByText(/interaction: abc-123/i)).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: /start signature recording/i })
  ).toBeEnabled();
});
