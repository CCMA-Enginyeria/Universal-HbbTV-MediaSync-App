import React from 'react';
import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import StatusSlot from '../StatusSlot';

describe('StatusSlot', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders visible children and reserves the requested height', () => {
    const { UNSAFE_getByType } = render(
      <StatusSlot visible minHeight={32}>
        <Text>Loading devices</Text>
      </StatusSlot>,
    );

    const slot = UNSAFE_getByType(StatusSlot).children[0];

    expect(screen.getByText('Loading devices')).toBeTruthy();
    expect(slot.props.pointerEvents).toBe('auto');
    expect(slot.props.style).toEqual(expect.arrayContaining([{ minHeight: 32 }]));
  });

  it('does not render hidden initial children', () => {
    const { UNSAFE_getByType } = render(
      <StatusSlot visible={false}>
        <Text>Hidden message</Text>
      </StatusSlot>,
    );

    const slot = UNSAFE_getByType(StatusSlot).children[0];

    expect(screen.queryByText('Hidden message')).toBeNull();
    expect(slot.props.pointerEvents).toBe('none');
  });

  it('keeps children mounted during fade out and removes them when animation finishes', () => {
    const { rerender } = render(
      <StatusSlot visible duration={1}>
        <Text>Transient message</Text>
      </StatusSlot>,
    );

    expect(screen.getByText('Transient message')).toBeTruthy();

    act(() => {
      rerender(
        <StatusSlot visible={false} duration={1}>
          <Text>Transient message</Text>
        </StatusSlot>,
      );
    });

    expect(screen.getByText('Transient message')).toBeTruthy();

    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(screen.queryByText('Transient message')).toBeNull();
  });
});