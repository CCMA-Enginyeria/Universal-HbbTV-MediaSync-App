import React from 'react';
import { render, screen } from '@testing-library/react-native';
import AppHeader from '../AppHeader';

describe('AppHeader', () => {
  it('renders the default brand title and supplied title/subtitle', () => {
    render(<AppHeader title="Televisions nearby" subtitle="Same Wi-Fi network" />);

    expect(screen.getByText('Universal MediaSync')).toBeTruthy();
    expect(screen.getByText('Televisions nearby')).toBeTruthy();
    expect(screen.getByText('Same Wi-Fi network')).toBeTruthy();
  });

  it('renders the searching badge when enabled', () => {
    render(<AppHeader title="Discovery" showSearching searchingText="Searching..." />);

    expect(screen.getByText('Discovery')).toBeTruthy();
    expect(screen.getByText('Searching...')).toBeTruthy();
  });

  it('omits optional title area when no title, subtitle, or search state is provided', () => {
    render(<AppHeader />);

    expect(screen.getByText('Universal MediaSync')).toBeTruthy();
    expect(screen.queryByText('Searching...')).toBeNull();
  });
});